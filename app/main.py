"""Portfolio Maintenance Calculator API + static web app."""
from __future__ import annotations

import os
import threading
import time
import uuid
from datetime import date, datetime, timedelta
from typing import Any, Optional

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from . import APP_NAME, APP_VERSION, DISCLAIMER, SCORING_VERSION
from .costs import DEFAULT_COST_ASSUMPTIONS, fee_schedules_public
from .db import Base, SessionLocal, engine, get_db
from .entity import resolve_company, resolve_inventor
from .exports import to_csv, to_pdf, to_xlsx
from .models import (AuditEvent, CostActual, DimensionInput, EvidenceItem, LegalStatusSnapshot, OwnershipEvent, PatentAsset,
                     PatentFamily, PatentScore, Portfolio, PortfolioSearch, ReviewBatch, ReviewDecision, ScoreRun,
                     ScoringConfig, Tenant, User, utcnow)
from .pipeline import (CUSTOMER_CSV_COLUMNS, PORTFOLIO_CSV_COLUMNS, apply_customer_csv, budget_shortlist, compare,
                       config_dict, ensure_default_config, latest_run, new_id, parse_portfolio_csv, persist_generated,
                       preview_rows, result_row, run_scoring, today)
from .scoring import (DEFAULT_GATES, DEFAULT_THRESHOLDS, DEFAULT_WEIGHTS, DIMENSIONS, MISSING_INPUT_HINTS, RECOMMENDATIONS,
                      REQUIRED_HANDLING, REVIEW_REASONS, snapshot_hash, validate_weights)
from .synthetic import generate

STATIC_DIR = os.path.join(os.path.dirname(__file__), "..", "static")
JOB_DELAY = float(os.environ.get("JOB_STEP_DELAY", "0.6"))

from contextlib import asynccontextmanager


@asynccontextmanager
async def lifespan(_app):
    seed()
    yield


app = FastAPI(title=f"{APP_NAME} API", version=APP_VERSION, lifespan=lifespan,
              description="Patent Portfolio Optimisation Engine — explainable retain / review recommendations. " + DISCLAIMER)

# ------------------------------------------------------------------ identity & permissions

ROLES = {
    "ip_manager": {"label": "Corporate IP manager", "perms": {"search", "score", "scenario", "batch", "decide", "inputs", "export"}},
    "counsel": {"label": "Patent counsel", "perms": {"score", "decide", "decide_abandon", "inputs", "resolve", "export"}},
    "analyst": {"label": "Portfolio analyst", "perms": {"search", "score", "scenario", "inputs", "resolve", "export"}},
    "finance": {"label": "Finance partner", "perms": {"scenario", "cost_config", "export"}},
    "tenant_admin": {"label": "Portfolio manager", "perms": {"search", "score", "scenario", "batch", "decide", "decide_abandon", "inputs", "resolve",
                                                             "cost_config", "weights_config", "export", "admin"}},
    "viewer": {"label": "Read-only viewer", "perms": {"export"}},
}

DEMO_USERS = [
    ("u_ipm", "tenant_demo", "Asha Kapoor", "ip_manager"),
    ("u_counsel", "tenant_demo", "Rahul Sethi", "counsel"),
    ("u_analyst", "tenant_demo", "Neha Bansal", "analyst"),
    ("u_finance", "tenant_demo", "Vikram Rao", "finance"),
    ("u_admin", "tenant_demo", "Portfolio Manager", "tenant_admin"),
    ("u_viewer", "tenant_demo", "Guest Viewer", "viewer"),
    ("u_beta", "tenant_beta", "Beta Tenant Manager", "ip_manager"),
]

REASON_CODES = {
    "CORE_PRODUCT_RELEVANCE": "Confirmed core product relevance",
    "DEFENSIVE_VALUE": "Defensive / blocking value",
    "LICENSING_OPPORTUNITY": "Active licensing opportunity",
    "STANDARDS_OBLIGATION": "Standards / FRAND obligation",
    "CONTRACTUAL_OBLIGATION": "Contractual or licence obligation",
    "LITIGATION_HOLD": "Litigation or dispute hold",
    "FAMILY_COVERAGE_SUFFICIENT": "Family members provide sufficient coverage",
    "NO_COMMERCIAL_USE": "No current or planned commercial use",
    "COST_EXCEEDS_VALUE": "Forward cost exceeds expected value",
    "TECHNOLOGY_OBSOLETE": "Technology superseded",
    "DATA_INSUFFICIENT": "More evidence required",
    "AWAITING_BUSINESS_INPUT": "Awaiting business-unit input",
    "OTHER": "Other (see notes)",
}

DECISIONS = {"accept": "Accept recommendation", "reject": "Reject recommendation", "override": "Override to another category",
             "defer": "Defer decision"}

_idempotency: dict[tuple, Any] = {}


def current_user(x_user_id: Optional[str] = Header(default=None), db: Session = Depends(get_db)) -> User:
    uid = x_user_id or "u_ipm"
    u = db.get(User, uid)
    if not u or u.status != "active":
        raise HTTPException(401, "Unknown or inactive user")
    return u


def require(user: User, perm: str):
    if perm not in ROLES[user.role]["perms"]:
        raise HTTPException(403, f"Role '{ROLES[user.role]['label']}' is not permitted to perform this action ({perm}).")


def audit(db: Session, user: User, action: str, otype: str, oid: str, before=None, after=None, **detail):
    db.add(AuditEvent(tenant_id=user.tenant_id, actor_id=user.id, action=action, object_type=otype, object_id=oid,
                      before_hash=snapshot_hash(before)[:32] if before is not None else None,
                      after_hash=snapshot_hash(after)[:32] if after is not None else None, detail=detail))


def get_portfolio(db: Session, user: User, pid: str) -> Portfolio:
    p = db.get(Portfolio, pid)
    if not p or p.tenant_id != user.tenant_id:  # object-level tenant isolation
        raise HTTPException(404, "Portfolio not found")
    return p


def get_asset(db: Session, user: User, aid: str) -> tuple[PatentAsset, Portfolio]:
    a = db.get(PatentAsset, aid)
    if not a:
        raise HTTPException(404, "Patent asset not found")
    p = db.get(Portfolio, a.portfolio_id)
    if p.tenant_id != user.tenant_id:
        raise HTTPException(404, "Patent asset not found")
    return a, p


def get_run(db: Session, user: User, rid: str) -> ScoreRun:
    r = db.get(ScoreRun, rid)
    if not r or r.tenant_id != user.tenant_id:
        raise HTTPException(404, "Score run not found")
    return r


# ------------------------------------------------------------------ middleware / errors

@app.middleware("http")
async def correlation(request: Request, call_next):
    cid = request.headers.get("x-correlation-id") or uuid.uuid4().hex[:16]
    request.state.cid = cid
    response = await call_next(request)
    response.headers["X-Correlation-Id"] = cid
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


@app.exception_handler(HTTPException)
async def http_err(request: Request, exc: HTTPException):
    code = {400: "BAD_REQUEST", 401: "UNAUTHENTICATED", 403: "FORBIDDEN", 404: "NOT_FOUND", 409: "CONFLICT", 422: "INVALID"}.get(exc.status_code, "ERROR")
    return JSONResponse(status_code=exc.status_code, content={"error": {"code": code, "message": exc.detail,
                        "correlation_id": getattr(request.state, "cid", None), "retryable": exc.status_code >= 500}})


@app.exception_handler(Exception)
async def any_err(request: Request, exc: Exception):
    return JSONResponse(status_code=500, content={"error": {"code": "INTERNAL", "message": "Unexpected error. Please retry.",
                        "correlation_id": getattr(request.state, "cid", None), "retryable": True}})


# ------------------------------------------------------------------ startup / seed

def seed():
    Base.metadata.create_all(engine)
    db = SessionLocal()
    try:
        for tid, name in (("tenant_demo", "Demo IP Department"), ("tenant_beta", "Beta Corp (isolation test tenant)")):
            if not db.get(Tenant, tid):
                db.add(Tenant(id=tid, name=name, policy_config={"third_party_ai_approved": False, "retention_days": 365}))
        db.flush()
        for uid, tid, name, role in DEMO_USERS:
            if not db.get(User, uid):
                db.add(User(id=uid, tenant_id=tid, name=name, role=role))
        db.flush()
        for tid in ("tenant_demo", "tenant_beta"):
            ensure_default_config(db, tid)
        db.commit()
        if not db.scalars(select(Portfolio).where(Portfolio.tenant_id == "tenant_demo")).first():
            ent = resolve_company("Northwind Medical Technologies Inc.", "US")[0]
            scope = {"ownership_scope": "current_and_historical_assignees",
                     "include_related_entities": [s["name"] for s in ent.get("related_entities", [])]}
            gen = generate(ent, today(), scope)
            pf = persist_generated(db, "tenant_demo", ent["canonical_name"], ent, gen, scope, "company")
            run_scoring(db, pf, ensure_default_config(db, "tenant_demo"), "system")
            sys_user = db.get(User, "u_admin")
            audit(db, sys_user, "seed_demo_portfolio", "portfolio", pf.id, name=pf.name)
            db.commit()
    finally:
        db.close()


# ------------------------------------------------------------------ meta

@app.get("/healthz")
def healthz():
    return {"ok": True, "version": APP_VERSION, "scoring_version": SCORING_VERSION, "time": utcnow().isoformat()}


@app.get("/v1/meta")
def meta():
    return {
        "app": APP_NAME, "version": APP_VERSION, "scoring_version": SCORING_VERSION, "disclaimer": DISCLAIMER,
        "dimensions": [{"key": k, "label": l, "default_weight": DEFAULT_WEIGHTS[k], "missing_hint": MISSING_INPUT_HINTS[k]} for k, l in DIMENSIONS],
        "recommendations": [{"key": k, "label": v, "handling": REQUIRED_HANDLING[k]} for k, v in RECOMMENDATIONS.items()],
        "review_reasons": REVIEW_REASONS,
        "default_thresholds": DEFAULT_THRESHOLDS, "default_gates": DEFAULT_GATES,
        "reason_codes": [{"key": k, "label": v} for k, v in REASON_CODES.items()],
        "decisions": [{"key": k, "label": v} for k, v in DECISIONS.items()],
        "roles": {k: {"label": v["label"], "perms": sorted(v["perms"])} for k, v in ROLES.items()},
        "fee_schedules": fee_schedules_public(),
        "default_cost_assumptions": DEFAULT_COST_ASSUMPTIONS,
        "connectors": [
            {"name": "Synthetic demo data", "status": "active", "note": "Deterministic fictional portfolios for evaluation"},
            {"name": "Customer CSV import", "status": "active", "note": "Upload your own portfolio and business inputs"},
            {"name": "USPTO / EPO / licensed aggregator", "status": "not_configured",
             "note": "Provider adapters plug in behind the connector interface once data licences are confirmed (spec §18)"},
        ],
        "demo_queries": {
            "company": ["Northwind Medical Technologies", "Northwind Medical", "Helixon Semiconductor", "Aurora Wireless", "Bluegate Software", "Verdant Energy Storage"],
            "inventor": ["Priya Raman", "Daniel Okafor", "Mei-Lin Chen"],
        },
    }


@app.get("/v1/me")
def me(user: User = Depends(current_user), db: Session = Depends(get_db)):
    t = db.get(Tenant, user.tenant_id)
    return {"id": user.id, "name": user.name, "role": user.role, "role_label": ROLES[user.role]["label"],
            "perms": sorted(ROLES[user.role]["perms"]), "tenant": {"id": t.id, "name": t.name}}


@app.get("/v1/users")
def users(user: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.scalars(select(User).where(User.tenant_id == user.tenant_id)).all()
    return [{"id": u.id, "name": u.name, "role": u.role, "role_label": ROLES[u.role]["label"]} for u in rows]


@app.get("/v1/demo-identities")
def demo_identities():
    return [{"id": uid, "tenant_id": tid, "name": n, "role": r, "role_label": ROLES[r]["label"]} for uid, tid, n, r in DEMO_USERS]


# ------------------------------------------------------------------ search & entity resolution

class SearchIn(BaseModel):
    query_type: str = Field(pattern="^(company|inventor)$")
    name: str = Field(min_length=2, max_length=200)
    country: Optional[str] = None
    jurisdiction_scope: list[str] = ["US"]
    include_subsidiaries: bool = False
    known_subsidiaries: list[str] = []
    former_names: list[str] = []
    domain: Optional[str] = None
    organisation: Optional[str] = None
    co_inventor: Optional[str] = None
    as_of_date: Optional[date] = None


def search_dict(s: PortfolioSearch) -> dict:
    return {"search_id": s.id, "query_type": s.query_type, "name": s.name, "status": s.status, "progress": s.progress,
            "candidates": s.candidates, "confirmed": s.confirmed, "portfolio_id": s.portfolio_id, "messages": s.messages,
            "error": s.error, "params": s.params, "created_at": s.created_at.isoformat(), "updated_at": s.updated_at.isoformat()}


@app.post("/v1/portfolio-searches")
def start_search(body: SearchIn, user: User = Depends(current_user), db: Session = Depends(get_db),
                 idempotency_key: Optional[str] = Header(default=None)):
    require(user, "search")
    if idempotency_key and (user.tenant_id, "search", idempotency_key) in _idempotency:
        return _idempotency[(user.tenant_id, "search", idempotency_key)]
    if body.query_type == "company":
        cands = resolve_company(body.name, body.country, body.domain, body.former_names, body.known_subsidiaries)
    else:
        cands = resolve_inventor(body.name, body.organisation, body.country, body.co_inventor)
    s = PortfolioSearch(id=new_id("ps"), tenant_id=user.tenant_id, query_type=body.query_type, name=body.name,
                        params=body.model_dump(mode="json"), status="ENTITY_REVIEW_REQUIRED", progress=5, candidates=cands,
                        created_by=user.id, messages=[{"t": utcnow().isoformat(), "msg": f"{len(cands)} candidate entities found"}])
    db.add(s)
    audit(db, user, "start_search", "portfolio_search", s.id, query_type=body.query_type, name=body.name)
    db.commit()
    out = search_dict(s)
    if idempotency_key:
        _idempotency[(user.tenant_id, "search", idempotency_key)] = out
    return out


@app.get("/v1/portfolio-searches/{sid}")
def get_search(sid: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    s = db.get(PortfolioSearch, sid)
    if not s or s.tenant_id != user.tenant_id:
        raise HTTPException(404, "Search not found")
    return search_dict(s)


@app.get("/v1/portfolio-searches")
def list_searches(user: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.scalars(select(PortfolioSearch).where(PortfolioSearch.tenant_id == user.tenant_id).order_by(PortfolioSearch.created_at.desc()).limit(20)).all()
    return [search_dict(s) for s in rows]


class ConfirmIn(BaseModel):
    entity_id: str
    ownership_scope: str = "current_owner"
    include_related_entities: list[str] = []
    owner_filter: Optional[str] = None
    inventor_centric_confirmed: bool = False
    entity_size: str = Field(default="large", pattern="^(large|small|micro)$")


def _set(db, s, status, progress, msg):
    s.status, s.progress = status, progress
    s.messages = list(s.messages or []) + [{"t": utcnow().isoformat(), "msg": msg}]
    db.commit()


def _discover_job(sid: str, entity: dict, scope: dict, user_id: str, entity_size: str):
    db = SessionLocal()
    try:
        s = db.get(PortfolioSearch, sid)
        user = db.get(User, user_id)
        _set(db, s, "DISCOVERING", 20, "Retrieving applications, grants, publications and assignment records")
        time.sleep(JOB_DELAY)
        gen = generate(entity, today(), scope)
        _set(db, s, "NORMALISING", 45, f"Retrieved {len(gen['assets'])} records; de-duplicating and grouping {len(gen['families'])} families")
        time.sleep(JOB_DELAY)
        pf = persist_generated(db, user.tenant_id, entity["canonical_name"] + (" — inventor view" if entity["entity_type"] == "inventor" else ""),
                               entity, gen, scope, entity["entity_type"])
        pf.entity_size = entity_size
        for a in db.scalars(select(PatentAsset).where(PatentAsset.portfolio_id == pf.id)):
            a.entity_size = entity_size
        db.commit()
        _set(db, s, "ENRICHING", 65, "Attaching evidence, legal-status snapshots and fee-schedule costs")
        time.sleep(JOB_DELAY)
        _set(db, s, "SCORING", 85, "Calculating dimension ratings, coverage, confidence, gates and recommendations")
        run = run_scoring(db, pf, ensure_default_config(db, user.tenant_id), user.id)
        audit(db, user, "create_portfolio", "portfolio", pf.id, entity=entity["canonical_name"], scope=scope, score_run=run.id)
        s.portfolio_id = pf.id
        db.commit()
        time.sleep(JOB_DELAY / 2)
        status = "PARTIAL" if pf.unavailable_sources else "REVIEW_READY"
        _set(db, s, status, 100, "Results ready" + (" — some sources unavailable; limitations are shown with results" if status == "PARTIAL" else ""))
    except Exception as ex:  # noqa: BLE001
        db.rollback()
        s = db.get(PortfolioSearch, sid)
        s.status, s.error = "FAILED", f"Discovery failed: {type(ex).__name__}. Retry the search."
        db.commit()
    finally:
        db.close()


@app.post("/v1/portfolio-searches/{sid}/confirm-entity")
def confirm_entity(sid: str, body: ConfirmIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    require(user, "search")
    s = db.get(PortfolioSearch, sid)
    if not s or s.tenant_id != user.tenant_id:
        raise HTTPException(404, "Search not found")
    if s.status not in ("ENTITY_REVIEW_REQUIRED", "FAILED"):
        raise HTTPException(409, f"Search is already {s.status}")
    ent = next((c for c in s.candidates if c["entity_id"] == body.entity_id), None)
    if not ent:
        raise HTTPException(400, "entity_id is not one of the candidates")
    scope = body.model_dump()
    s.confirmed = {"entity": ent, "scope": scope, "confirmed_by": user.id, "confirmed_at": utcnow().isoformat()}
    s.status, s.progress = "CREATED", 10
    audit(db, user, "confirm_entity", "portfolio_search", s.id, entity_id=ent["entity_id"], match_confidence=ent["match_confidence"], scope=scope)
    db.commit()
    threading.Thread(target=_discover_job, args=(s.id, ent, scope, user.id, body.entity_size), daemon=True).start()
    return search_dict(s)


# ------------------------------------------------------------------ CSV import

@app.get("/v1/templates/portfolio.csv")
def portfolio_template():
    sample = [
        "US-S1234567-B2,16/S12345,US,B2,Example sensor housing,2015-03-02,2014-03-05,2017-06-20,active,FAM-1,original,,Example Co.,large,A61B5/024,3,110,14,5,2,none,Product A;Product B,growth,high,core,true,high,none,",
        "US-S20240123456-A1,18/S98765,US,A1,Example continuation,2023-01-10,2014-03-05,,pending,FAM-1,continuation,US-S1234567-B2,Example Co.,large,A61B5/024,2,140,,,,,,,,,,,",
    ]
    return PlainTextResponse(",".join(PORTFOLIO_CSV_COLUMNS) + "\n" + "\n".join(sample) + "\n", media_type="text/csv",
                             headers={"Content-Disposition": "attachment; filename=portfolio_import_template.csv"})


@app.post("/v1/portfolios/import")
async def import_portfolio(name: str = Form(...), owner: str = Form(...), entity_size: str = Form("large"),
                           file: UploadFile = File(...), user: User = Depends(current_user), db: Session = Depends(get_db)):
    require(user, "search")
    raw = await file.read()
    if len(raw) > 5_000_000:
        raise HTTPException(400, "File too large (max 5 MB)")
    try:
        gen, errors = parse_portfolio_csv(raw.decode("utf-8-sig"), owner, today())
    except (ValueError, UnicodeDecodeError) as ex:
        raise HTTPException(400, f"Could not read CSV: {ex}")
    if not gen["assets"]:
        raise HTTPException(400, "No valid rows found. " + "; ".join(errors[:5]))
    ent = {"entity_id": new_id("ent_imp"), "entity_type": "company", "canonical_name": owner, "data_mode": "imported", "customer_data": True}
    pf = persist_generated(db, user.tenant_id, name, ent, gen, {"ownership_scope": "customer_supplied"}, "company", data_mode="imported",
                           sources=["Customer portfolio import (CSV)"])
    pf.entity_size = entity_size
    run = run_scoring(db, pf, ensure_default_config(db, user.tenant_id), user.id)
    audit(db, user, "import_portfolio", "portfolio", pf.id, rows=len(gen["assets"]), warnings=len(errors))
    db.commit()
    return {"portfolio_id": pf.id, "score_run_id": run.id, "imported": len(gen["assets"]), "warnings": errors}


@app.get("/v1/portfolios/{pid}/customer-inputs-template.csv")
def customer_template(pid: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    pf = get_portfolio(db, user, pid)
    rows = db.scalars(select(PatentAsset).where(PatentAsset.portfolio_id == pf.id, PatentAsset.jurisdiction == "US")).all()
    lines = [",".join(CUSTOMER_CSV_COLUMNS)]
    for a in rows:
        prods = "" if a.product_mappings is None else ("none" if a.product_mappings == [] else ";".join(m["product"] for m in a.product_mappings))
        ci = a.customer_inputs or {}
        lines.append(",".join([a.publication_number, prods, "", "", "", ci.get("strategic_priority") or "",
                               "" if ci.get("fto_relevance") is None else str(ci.get("fto_relevance")).lower(),
                               ci.get("roadmap_relevance") or "", (a.signals or {}).get("licensing_history") or "", ""]))
    return PlainTextResponse("\n".join(lines) + "\n", media_type="text/csv",
                             headers={"Content-Disposition": f"attachment; filename=customer_inputs_{pf.id}.csv"})


@app.post("/v1/portfolios/{pid}/customer-inputs")
async def upload_customer_inputs(pid: str, file: UploadFile = File(...), user: User = Depends(current_user), db: Session = Depends(get_db)):
    require(user, "inputs")
    pf = get_portfolio(db, user, pid)
    text = (await file.read()).decode("utf-8-sig")
    n, errors = apply_customer_csv(db, pf, text)
    run = run_scoring(db, pf, ensure_default_config(db, user.tenant_id), user.id)
    audit(db, user, "upload_customer_inputs", "portfolio", pf.id, updated=n, warnings=len(errors), score_run=run.id)
    db.commit()
    return {"updated": n, "warnings": errors, "score_run_id": run.id}


# ------------------------------------------------------------------ portfolios

def portfolio_dict(db, p: Portfolio) -> dict:
    run = latest_run(db, p.id)
    return {"portfolio_id": p.id, "name": p.name, "entity": p.entity, "query_type": p.query_type, "ownership_scope": p.ownership_scope,
            "entity_size": p.entity_size, "data_mode": p.data_mode, "provisional": p.provisional, "sources": p.sources,
            "unavailable_sources": p.unavailable_sources, "created_at": p.created_at.isoformat(), "refreshed_at": p.refreshed_at.isoformat(),
            "latest_score_run_id": run.id if run else None, "summary": run.summary if run else None,
            "latest_run_at": run.run_at.isoformat() if run else None, "as_of_date": run.as_of_date.isoformat() if run else None}


@app.get("/v1/portfolios")
def list_portfolios(user: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.scalars(select(Portfolio).where(Portfolio.tenant_id == user.tenant_id).order_by(Portfolio.created_at.desc())).all()
    return [portfolio_dict(db, p) for p in rows]


@app.get("/v1/portfolios/{pid}")
def get_portfolio_ep(pid: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return portfolio_dict(db, get_portfolio(db, user, pid))


class InventorScopeIn(BaseModel):
    inventor_centric_confirmed: bool = True


@app.post("/v1/portfolios/{pid}/confirm-inventor-scope")
def confirm_inventor_scope(pid: str, body: InventorScopeIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    require(user, "search")
    p = get_portfolio(db, user, pid)
    p.provisional = not body.inventor_centric_confirmed
    audit(db, user, "confirm_inventor_scope", "portfolio", p.id, inventor_centric=body.inventor_centric_confirmed)
    db.commit()
    return portfolio_dict(db, p)


@app.get("/v1/portfolios/{pid}/families")
def families(pid: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    p = get_portfolio(db, user, pid)
    fams = db.scalars(select(PatentFamily).where(PatentFamily.portfolio_id == p.id)).all()
    assets = db.scalars(select(PatentAsset).where(PatentAsset.portfolio_id == p.id)).all()
    by = {}
    for a in assets:
        by.setdefault(a.family_id, []).append({"id": a.id, "publication_number": a.publication_number, "jurisdiction": a.jurisdiction,
                                               "status": a.status, "relationship_type": a.relationship_type, "parent": a.parent_publication})
    return [{"family_id": f.id, "provider_family_id": f.provider_family_id, "family_type": f.family_type, "members": by.get(f.id, [])} for f in fams]


class ScoreRunIn(BaseModel):
    scoring_config_id: Optional[str] = None
    cost_horizon_years: list[int] = [3, 5]
    currency: str = "USD"
    include_product_enrichment: bool = True


@app.post("/v1/portfolios/{pid}/score-runs")
def start_score_run(pid: str, body: ScoreRunIn, user: User = Depends(current_user), db: Session = Depends(get_db),
                    idempotency_key: Optional[str] = Header(default=None)):
    require(user, "score")
    p = get_portfolio(db, user, pid)
    if idempotency_key and (user.tenant_id, "score", idempotency_key) in _idempotency:
        return _idempotency[(user.tenant_id, "score", idempotency_key)]
    if body.currency != "USD":
        raise HTTPException(400, "Only USD is supported in this release (fee schedules are USD).")
    hz = sorted({h for h in body.cost_horizon_years if 1 <= h <= 15}) or [3, 5]
    if 3 not in hz:
        hz.append(3)
    if 5 not in hz:
        hz.append(5)
    cfg = db.get(ScoringConfig, body.scoring_config_id) if body.scoring_config_id else ensure_default_config(db, user.tenant_id)
    if not cfg or cfg.tenant_id != user.tenant_id:
        raise HTTPException(404, "Scoring config not found")
    run = run_scoring(db, p, cfg, user.id, horizons=tuple(sorted(hz)))
    audit(db, user, "score_run", "score_run", run.id, portfolio=p.id, config=cfg.id, data_hash=run.data_snapshot_hash)
    db.commit()
    out = {"score_run_id": run.id, "status": "REVIEW_READY", "summary": run.summary, "data_snapshot_hash": run.data_snapshot_hash}
    if idempotency_key:
        _idempotency[(user.tenant_id, "score", idempotency_key)] = out
    return out


@app.get("/v1/portfolios/{pid}/score-runs")
def list_runs(pid: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    p = get_portfolio(db, user, pid)
    rows = db.scalars(select(ScoreRun).where(ScoreRun.portfolio_id == p.id).order_by(ScoreRun.run_at.desc()).limit(50)).all()
    return [{"score_run_id": r.id, "run_at": r.run_at.isoformat(), "config": r.config_snapshot.get("name"), "kind": r.config_snapshot.get("kind"),
             "scoring_version": r.scoring_version, "data_snapshot_hash": r.data_snapshot_hash, "summary": r.summary, "created_by": r.created_by}
            for r in rows]


@app.post("/v1/portfolios/{pid}/refresh-status")
def refresh_status(pid: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    require(user, "score")
    p = get_portfolio(db, user, pid)
    now = utcnow()
    n = 0
    for a in db.scalars(select(PatentAsset).where(PatentAsset.portfolio_id == p.id)):
        a.last_status_check = now
        db.add(LegalStatusSnapshot(patent_asset_id=a.id, status=a.status, status_date=today(),
                                   source_id="Status recheck (synthetic demo register)" if p.data_mode == "synthetic" else "Status recheck (customer data — verify externally)",
                                   retrieved_at=now))
        n += 1
    p.refreshed_at = now
    run = run_scoring(db, p, ensure_default_config(db, user.tenant_id), user.id)
    audit(db, user, "refresh_status", "portfolio", p.id, assets=n, score_run=run.id)
    db.commit()
    return {"rechecked": n, "score_run_id": run.id,
            "note": "Conflicting statuses remain flagged until an analyst resolves them against the official register."}


# ------------------------------------------------------------------ results

def _decisions_map(db, asset_ids):
    rows = db.scalars(select(ReviewDecision).where(ReviewDecision.patent_asset_id.in_(asset_ids)).order_by(ReviewDecision.created_at)).all()
    return {r.patent_asset_id: r for r in rows}


def run_rows(db: Session, run: ScoreRun) -> list[dict]:
    scores = db.scalars(select(PatentScore).where(PatentScore.score_run_id == run.id)).all()
    assets = {a.id: a for a in db.scalars(select(PatentAsset).where(PatentAsset.portfolio_id == run.portfolio_id))}
    dec = _decisions_map(db, list(assets))
    return [result_row(assets[s.patent_asset_id], s, dec.get(s.patent_asset_id)) for s in scores if s.patent_asset_id in assets]


SORTABLE = {"strategic_score", "data_coverage", "evidence_confidence", "cost_3y", "cost_5y", "next_deadline", "publication_number",
            "status", "recommendation", "jurisdiction", "grant_date", "expiry_estimate"}


@app.get("/v1/score-runs/{rid}/results")
def results(rid: str, user: User = Depends(current_user), db: Session = Depends(get_db),
            recommendation: Optional[str] = None, gate: Optional[str] = None, jurisdiction: Optional[str] = None,
            status: Optional[str] = None, q: Optional[str] = None, min_score: Optional[float] = None, max_score: Optional[float] = None,
            min_confidence: Optional[float] = None, family_id: Optional[str] = None, deadline_days: Optional[int] = None,
            technology: Optional[str] = None, decided: Optional[str] = None,
            sort: str = "strategic_score", order: str = "desc", page: int = Query(1, ge=1), page_size: int = Query(50, ge=1, le=500)):
    run = get_run(db, user, rid)
    rows = run_rows(db, run)

    def keep(r):
        if recommendation and r["recommendation"] not in recommendation.split(","):
            return False
        if gate and r["gate_status"] not in gate.split(","):
            return False
        if jurisdiction and r["jurisdiction"] not in jurisdiction.split(","):
            return False
        if status and r["status"] not in status.split(","):
            return False
        if family_id and r["family_id"] != family_id:
            return False
        if technology and r["technology"] != technology:
            return False
        if q and q.lower() not in (r["publication_number"] + " " + r["title"] + " " + (r["current_owner"] or "")).lower():
            return False
        if min_score is not None and (r["strategic_score"] is None or r["strategic_score"] < min_score):
            return False
        if max_score is not None and (r["strategic_score"] is None or r["strategic_score"] > max_score):
            return False
        if min_confidence is not None and r["evidence_confidence"] < min_confidence:
            return False
        if deadline_days is not None:
            if not r["next_deadline"] or (date.fromisoformat(r["next_deadline"]) - run.as_of_date).days > deadline_days:
                return False
        if decided == "yes" and not r["decision"]:
            return False
        if decided == "no" and r["decision"]:
            return False
        return True
    rows = [r for r in rows if keep(r)]
    if sort not in SORTABLE:
        sort = "strategic_score"

    def sk(r):
        v = r.get(sort)
        if sort in ("cost_3y", "cost_5y"):
            v = float(v) if v else None
        return (v is None, v if v is not None else 0)
    rows.sort(key=sk, reverse=(order == "desc"))
    if order == "desc":  # keep None last
        rows = [r for r in rows if r.get(sort) is not None] + [r for r in rows if r.get(sort) is None]
    total = len(rows)
    start = (page - 1) * page_size
    return {"score_run_id": run.id, "as_of_date": run.as_of_date.isoformat(), "scoring_version": run.scoring_version,
            "config": {k: run.config_snapshot.get(k) for k in ("id", "name", "kind", "version", "weights", "thresholds")},
            "total": total, "page": page, "page_size": page_size, "items": rows[start:start + page_size], "disclaimer": DISCLAIMER}


@app.get("/v1/score-runs/{rid}")
def get_run_ep(rid: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    r = get_run(db, user, rid)
    return {"score_run_id": r.id, "portfolio_id": r.portfolio_id, "run_at": r.run_at.isoformat(), "as_of_date": r.as_of_date.isoformat(),
            "config": r.config_snapshot, "scoring_version": r.scoring_version, "data_snapshot_hash": r.data_snapshot_hash, "summary": r.summary}


# ------------------------------------------------------------------ patent detail

def _iso(v):
    return v.isoformat() if isinstance(v, (date, datetime)) else v


@app.get("/v1/patents/{aid}")
def patent_detail(aid: str, score_run_id: Optional[str] = None, user: User = Depends(current_user), db: Session = Depends(get_db)):
    a, p = get_asset(db, user, aid)
    run = get_run(db, user, score_run_id) if score_run_id else latest_run(db, p.id)
    score = db.scalars(select(PatentScore).where(PatentScore.score_run_id == run.id, PatentScore.patent_asset_id == a.id)).first() if run else None
    fam = db.scalars(select(PatentAsset).where(PatentAsset.family_id == a.family_id)).all() if a.family_id else [a]
    fam_scores = {}
    if run:
        for s in db.scalars(select(PatentScore).where(PatentScore.score_run_id == run.id, PatentScore.patent_asset_id.in_([m.id for m in fam]))):
            fam_scores[s.patent_asset_id] = s
    evs = db.scalars(select(EvidenceItem).where(EvidenceItem.patent_asset_id == a.id)).all()
    own = db.scalars(select(OwnershipEvent).where(OwnershipEvent.patent_asset_id == a.id)).all()
    snaps = db.scalars(select(LegalStatusSnapshot).where(LegalStatusSnapshot.patent_asset_id == a.id).order_by(LegalStatusSnapshot.retrieved_at.desc())).all()
    acts = db.scalars(select(CostActual).where(CostActual.patent_asset_id == a.id)).all()
    inputs = db.scalars(select(DimensionInput).where(DimensionInput.patent_asset_id == a.id).order_by(DimensionInput.created_at.desc())).all()
    decs = db.scalars(select(ReviewDecision).where(ReviewDecision.patent_asset_id == a.id).order_by(ReviewDecision.created_at.desc())).all()
    aud = db.scalars(select(AuditEvent).where(AuditEvent.tenant_id == user.tenant_id, AuditEvent.object_id == a.id).order_by(AuditEvent.timestamp.desc()).limit(50)).all()
    unames = {u.id: u.name for u in db.scalars(select(User).where(User.tenant_id == user.tenant_id))}
    unames["system"] = "System"
    asset = {c.name: _iso(getattr(a, c.name)) for c in PatentAsset.__table__.columns}
    return {
        "asset": asset,
        "portfolio": {"id": p.id, "name": p.name, "data_mode": p.data_mode, "provisional": p.provisional, "entity_size": p.entity_size},
        "score_run": {"id": run.id, "as_of_date": run.as_of_date.isoformat(), "config": run.config_snapshot, "scoring_version": run.scoring_version,
                      "data_snapshot_hash": run.data_snapshot_hash} if run else None,
        "score": {"strategic_score": score.strategic_score, "data_coverage": score.data_coverage, "evidence_confidence": score.evidence_confidence,
                  "recommendation": score.recommendation, "recommendation_label": RECOMMENDATIONS.get(score.recommendation, score.recommendation),
                  "gate_status": score.gate_status, "gate_reasons": score.gate_reasons, "dimension_scores": score.dimension_scores,
                  "explanation": score.explanation, "cost": score.cost} if score else None,
        "family": [{"id": m.id, "publication_number": m.publication_number, "jurisdiction": m.jurisdiction, "status": m.status,
                    "relationship_type": m.relationship_type, "parent_publication": m.parent_publication, "title": m.title,
                    "grant_date": _iso(m.grant_date), "expiry_estimate": _iso(m.expiry_estimate),
                    "recommendation": fam_scores[m.id].recommendation if m.id in fam_scores else None,
                    "strategic_score": fam_scores[m.id].strategic_score if m.id in fam_scores else None,
                    "cost_5y": ((fam_scores[m.id].cost or {}).get("totals", {}).get("5", {}).get("total")) if m.id in fam_scores else None}
                   for m in fam],
        "ownership_events": [{"assignee": e.assignee, "role": e.role, "event_type": e.event_type, "effective_date": _iso(e.effective_date),
                              "source_id": e.source_id, "confidence": e.confidence} for e in own],
        "status_snapshots": [{"status": s.status, "status_date": _iso(s.status_date), "source_id": s.source_id, "retrieved_at": _iso(s.retrieved_at)} for s in snaps],
        "evidence": [{"id": e.id, "dimension": e.dimension, "evidence_type": e.evidence_type, "source_name": e.source_name, "source_uri": e.source_uri,
                      "source_date": _iso(e.source_date), "retrieved_at": _iso(e.retrieved_at), "excerpt": e.excerpt, "reliability": e.reliability,
                      "directness": e.directness, "polarity": e.polarity} for e in evs],
        "cost_actuals": [{"category": c.category, "amount": str(c.amount), "currency": c.currency, "incurred_on": _iso(c.incurred_on), "source_id": c.source_id} for c in acts],
        "dimension_inputs": [{"dimension": i.dimension, "rating": i.rating, "rationale": i.rationale, "source": i.evidence_source,
                              "user": unames.get(i.user_id, i.user_id), "created_at": _iso(i.created_at)} for i in inputs],
        "decisions": [{"id": d.id, "decision": d.decision, "override_recommendation": d.override_recommendation, "reason_code": d.reason_code,
                       "reason_label": REASON_CODES.get(d.reason_code, d.reason_code), "notes": d.notes, "reviewer": unames.get(d.reviewer_id, d.reviewer_id),
                       "original_recommendation": d.original_recommendation, "original_score": d.original_score, "score_run_id": d.score_run_id,
                       "freshness_check": d.freshness_check, "created_at": _iso(d.created_at)} for d in decs],
        "audit": [{"action": e.action, "actor": unames.get(e.actor_id, e.actor_id), "timestamp": _iso(e.timestamp), "detail": e.detail,
                   "before_hash": e.before_hash, "after_hash": e.after_hash} for e in aud],
        "disclaimer": DISCLAIMER,
    }


class DimensionInputIn(BaseModel):
    dimension: str
    rating: Optional[int] = Field(default=None, ge=0, le=5)
    rationale: str = Field(min_length=5, max_length=2000)
    source: str = ""


def _rescore(db, user, p):
    return run_scoring(db, p, ensure_default_config(db, user.tenant_id), user.id)


@app.post("/v1/patents/{aid}/dimension-inputs")
def add_dimension_input(aid: str, body: DimensionInputIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    require(user, "inputs")
    a, p = get_asset(db, user, aid)
    if body.dimension not in DEFAULT_WEIGHTS:
        raise HTTPException(400, "Unknown dimension")
    db.add(DimensionInput(patent_asset_id=a.id, dimension=body.dimension, rating=body.rating, rationale=body.rationale,
                          evidence_source=body.source, user_id=user.id))
    db.flush()
    run = _rescore(db, user, p)
    audit(db, user, "dimension_input", "patent_asset", a.id, dimension=body.dimension, rating=body.rating, score_run=run.id)
    db.commit()
    return {"ok": True, "score_run_id": run.id}


class CustomerInputsIn(BaseModel):
    product_mappings: Optional[list[dict]] = None
    strategic_priority: Optional[str] = Field(default=None, pattern="^(core|defensive|non_core)$")
    fto_relevance: Optional[bool] = None
    roadmap_relevance: Optional[str] = Field(default=None, pattern="^(high|medium|low)$")
    licensing_history: Optional[str] = Field(default=None, pattern="^(licensed|offered|none)$")
    evidence_of_use_leads: Optional[int] = Field(default=None, ge=0, le=50)
    clear_product_mappings: bool = False


@app.put("/v1/patents/{aid}/customer-inputs")
def put_customer_inputs(aid: str, body: CustomerInputsIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    require(user, "inputs")
    a, p = get_asset(db, user, aid)
    before = {"product_mappings": a.product_mappings, "customer_inputs": a.customer_inputs, "signals": a.signals}
    if body.clear_product_mappings:
        a.product_mappings = None
    elif body.product_mappings is not None:
        clean = []
        for m in body.product_mappings:
            if not m.get("product"):
                continue
            clean.append({"product": str(m["product"])[:120], "lifecycle": m.get("lifecycle", "mature"),
                          "revenue_band": m.get("revenue_band", "medium"), "confirmed_use": bool(m.get("confirmed_use", True))})
        a.product_mappings = clean
        db.add(EvidenceItem(id=new_id("ev"), patent_asset_id=a.id, dimension="commercial", evidence_type="product_mapping",
                            source_name=f"Customer input by {user.name}", source_date=today(),
                            excerpt="; ".join(m["product"] for m in clean) or "No product confirmed", reliability=0.85, directness=0.9))
    ci = dict(a.customer_inputs or {})
    changed_ci = False
    for k in ("strategic_priority", "fto_relevance", "roadmap_relevance"):
        v = getattr(body, k)
        if v is not None:
            ci[k] = v
            changed_ci = True
    if changed_ci:
        a.customer_inputs = ci
        db.add(EvidenceItem(id=new_id("ev"), patent_asset_id=a.id, dimension="strategic", evidence_type="strategy_tag",
                            source_name=f"Customer input by {user.name}", source_date=today(), excerpt=str(ci), reliability=0.85, directness=0.85))
    sig = dict(a.signals or {})
    if body.licensing_history is not None:
        sig["licensing_history"] = body.licensing_history
        db.add(EvidenceItem(id=new_id("ev"), patent_asset_id=a.id, dimension="licensing", evidence_type="licensing_register",
                            source_name=f"Customer input by {user.name}", source_date=today(), excerpt=f"Licensing history: {body.licensing_history}",
                            reliability=0.85, directness=0.85))
    if body.evidence_of_use_leads is not None:
        sig["evidence_of_use_leads"] = body.evidence_of_use_leads
    a.signals = sig
    db.flush()
    run = _rescore(db, user, p)
    audit(db, user, "customer_inputs", "patent_asset", a.id, before=before,
          after={"product_mappings": a.product_mappings, "customer_inputs": a.customer_inputs, "signals": a.signals}, score_run=run.id)
    db.commit()
    return {"ok": True, "score_run_id": run.id}


class ResolveStatusIn(BaseModel):
    status: str = Field(pattern="^(active|pending|expired|abandoned|lapsed|withdrawn)$")
    source: str = Field(min_length=3)
    note: str = Field(min_length=5)


@app.post("/v1/patents/{aid}/resolve-status")
def resolve_status(aid: str, body: ResolveStatusIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    require(user, "resolve")
    a, p = get_asset(db, user, aid)
    before = {"status": a.status, "status_conflict": a.status_conflict}
    a.status, a.status_conflict, a.last_status_check = body.status, None, utcnow()
    db.add(LegalStatusSnapshot(patent_asset_id=a.id, status=body.status, status_date=today(), source_id=f"Analyst resolution: {body.source}", retrieved_at=utcnow()))
    db.flush()
    run = _rescore(db, user, p)
    audit(db, user, "resolve_status", "patent_asset", a.id, before=before, after={"status": a.status}, note=body.note, source=body.source, score_run=run.id)
    db.commit()
    return {"ok": True, "score_run_id": run.id}


class ResolveOwnerIn(BaseModel):
    current_owner: str = Field(min_length=2)
    evidence: str = Field(min_length=5)
    effective_date: Optional[date] = None


@app.post("/v1/patents/{aid}/resolve-ownership")
def resolve_ownership(aid: str, body: ResolveOwnerIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    require(user, "resolve")
    a, p = get_asset(db, user, aid)
    before = {"current_owner": a.current_owner, "owner_confidence": a.owner_confidence, "ownership_issue": a.ownership_issue}
    a.current_owner, a.owner_confidence, a.ownership_issue = body.current_owner, 0.9, None
    db.add(OwnershipEvent(patent_asset_id=a.id, assignee=body.current_owner, role="current_owner", event_type="Ownership confirmed by reviewer",
                          effective_date=body.effective_date, source_id=f"Reviewer evidence: {body.evidence}", confidence=0.9))
    db.flush()
    run = _rescore(db, user, p)
    audit(db, user, "resolve_ownership", "patent_asset", a.id, before=before, after={"current_owner": a.current_owner}, evidence=body.evidence, score_run=run.id)
    db.commit()
    return {"ok": True, "score_run_id": run.id}


@app.post("/v1/patents/{aid}/recheck-status")
def recheck_status(aid: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    require(user, "score")
    a, p = get_asset(db, user, aid)
    a.last_status_check = utcnow()
    db.add(LegalStatusSnapshot(patent_asset_id=a.id, status=a.status, status_date=today(), source_id="Status recheck (synthetic demo register)", retrieved_at=utcnow()))
    db.flush()
    run = _rescore(db, user, p)
    audit(db, user, "recheck_status", "patent_asset", a.id, status=a.status, conflict=bool(a.status_conflict), score_run=run.id)
    db.commit()
    return {"ok": True, "status": a.status, "conflict_remaining": bool(a.status_conflict), "score_run_id": run.id}


# ------------------------------------------------------------------ review decisions

class DecisionIn(BaseModel):
    score_run_id: str
    decision: str = Field(pattern="^(accept|reject|override|defer)$")
    reason_code: str
    notes: str = ""
    override_recommendation: Optional[str] = None


@app.post("/v1/patents/{aid}/review-decisions")
def review_decision(aid: str, body: DecisionIn, user: User = Depends(current_user), db: Session = Depends(get_db),
                    idempotency_key: Optional[str] = Header(default=None)):
    require(user, "decide")
    if idempotency_key and (user.tenant_id, "decision", idempotency_key) in _idempotency:
        return _idempotency[(user.tenant_id, "decision", idempotency_key)]
    a, p = get_asset(db, user, aid)
    run = get_run(db, user, body.score_run_id)
    if run.portfolio_id != p.id:
        raise HTTPException(400, "Score run does not belong to this asset's portfolio")
    if body.reason_code not in REASON_CODES:
        raise HTTPException(400, "Unknown reason code")
    sc = db.scalars(select(PatentScore).where(PatentScore.score_run_id == run.id, PatentScore.patent_asset_id == a.id)).first()
    if not sc:
        raise HTTPException(404, "No score for this asset in that run")
    if body.decision == "override":
        if body.override_recommendation not in RECOMMENDATIONS:
            raise HTTPException(400, "override_recommendation must be a valid category")
        if len(body.notes.strip()) < 10:
            raise HTTPException(400, "Overrides require a written justification (min 10 characters).")
    if body.decision in ("accept", "override") and len(body.notes.strip()) < 3 and body.reason_code == "OTHER":
        raise HTTPException(400, "Reason 'Other' requires notes.")
    target = body.override_recommendation if body.decision == "override" else sc.recommendation
    if body.decision in ("accept", "override") and target == "abandon" and "decide_abandon" not in ROLES[user.role]["perms"]:
        raise HTTPException(403, "Only patent counsel can approve an abandonment-review outcome.")
    # Mandatory freshness recheck of critical status / deadline before a final decision (FR-16)
    fresh = {"rechecked_at": utcnow().isoformat(), "status": a.status, "conflict": bool(a.status_conflict),
             "owner_verified": bool(a.current_owner) and not a.ownership_issue}
    if body.decision in ("accept", "override"):
        a.last_status_check = utcnow()
        db.add(LegalStatusSnapshot(patent_asset_id=a.id, status=a.status, status_date=today(), source_id="Pre-decision recheck", retrieved_at=utcnow()))
        if a.status_conflict or not fresh["owner_verified"]:
            db.commit()
            raise HTTPException(409, "Pre-decision recheck failed: legal status conflict or unverified ownership must be resolved first.")
    d = ReviewDecision(id=new_id("rd"), tenant_id=user.tenant_id, patent_asset_id=a.id, score_run_id=run.id, reviewer_id=user.id,
                       decision=body.decision, override_recommendation=body.override_recommendation, reason_code=body.reason_code,
                       notes=body.notes.strip(), original_recommendation=sc.recommendation, original_score=sc.strategic_score, freshness_check=fresh)
    db.add(d)
    audit(db, user, f"review_{body.decision}", "patent_asset", a.id, before={"recommendation": sc.recommendation},
          after={"decision": body.decision, "target": target}, reason=body.reason_code, notes=body.notes, score_run=run.id)
    db.commit()
    out = {"decision_id": d.id, "decision": d.decision, "original_recommendation": d.original_recommendation, "freshness_check": fresh,
           "note": "Decision recorded for review. No filing, payment or abandonment action is executed by this system."}
    if idempotency_key:
        _idempotency[(user.tenant_id, "decision", idempotency_key)] = out
    return out


@app.get("/v1/review-decisions")
def list_decisions(portfolio_id: Optional[str] = None, user: User = Depends(current_user), db: Session = Depends(get_db)):
    q = select(ReviewDecision).where(ReviewDecision.tenant_id == user.tenant_id).order_by(ReviewDecision.created_at.desc()).limit(500)
    rows = db.scalars(q).all()
    assets = {a.id: a for a in db.scalars(select(PatentAsset).where(PatentAsset.id.in_([r.patent_asset_id for r in rows])))}
    unames = {u.id: u.name for u in db.scalars(select(User).where(User.tenant_id == user.tenant_id))}
    out = []
    for r in rows:
        a = assets.get(r.patent_asset_id)
        if portfolio_id and (not a or a.portfolio_id != portfolio_id):
            continue
        out.append({"id": r.id, "patent_asset_id": r.patent_asset_id, "publication_number": a.publication_number if a else None,
                    "title": a.title if a else None, "decision": r.decision, "override_recommendation": r.override_recommendation,
                    "reason_code": r.reason_code, "reason_label": REASON_CODES.get(r.reason_code), "notes": r.notes,
                    "original_recommendation": r.original_recommendation, "original_score": r.original_score,
                    "reviewer": unames.get(r.reviewer_id, r.reviewer_id), "created_at": r.created_at.isoformat()})
    return out


class BatchIn(BaseModel):
    portfolio_id: str
    name: str = Field(min_length=2, max_length=200)
    asset_ids: list[str] = Field(min_length=1, max_length=500)
    assignee_id: Optional[str] = None
    due_date: Optional[date] = None


@app.post("/v1/review-batches")
def create_batch(body: BatchIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    require(user, "batch")
    p = get_portfolio(db, user, body.portfolio_id)
    valid = {a.id for a in db.scalars(select(PatentAsset).where(PatentAsset.portfolio_id == p.id, PatentAsset.id.in_(body.asset_ids)))}
    if not valid:
        raise HTTPException(400, "No valid assets for this portfolio")
    if body.assignee_id:
        u = db.get(User, body.assignee_id)
        if not u or u.tenant_id != user.tenant_id:
            raise HTTPException(400, "Assignee not found")
    b = ReviewBatch(id=new_id("rb"), tenant_id=user.tenant_id, portfolio_id=p.id, name=body.name,
                    asset_ids=[i for i in body.asset_ids if i in valid], assignee_id=body.assignee_id, due_date=body.due_date, created_by=user.id)
    db.add(b)
    audit(db, user, "create_review_batch", "review_batch", b.id, assets=len(b.asset_ids), assignee=body.assignee_id)
    db.commit()
    return {"batch_id": b.id, "assets": len(b.asset_ids)}


@app.get("/v1/review-batches")
def list_batches(portfolio_id: Optional[str] = None, user: User = Depends(current_user), db: Session = Depends(get_db)):
    q = select(ReviewBatch).where(ReviewBatch.tenant_id == user.tenant_id).order_by(ReviewBatch.created_at.desc())
    if portfolio_id:
        q = q.where(ReviewBatch.portfolio_id == portfolio_id)
    rows = db.scalars(q).all()
    unames = {u.id: u.name for u in db.scalars(select(User).where(User.tenant_id == user.tenant_id))}
    out = []
    for b in rows:
        dec = _decisions_map(db, b.asset_ids)
        out.append({"batch_id": b.id, "portfolio_id": b.portfolio_id, "name": b.name, "assets": len(b.asset_ids),
                    "decided": sum(1 for i in b.asset_ids if i in dec), "assignee": unames.get(b.assignee_id), "assignee_id": b.assignee_id,
                    "due_date": _iso(b.due_date), "created_by": unames.get(b.created_by, b.created_by), "created_at": b.created_at.isoformat()})
    return out


@app.get("/v1/review-batches/{bid}")
def get_batch(bid: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    b = db.get(ReviewBatch, bid)
    if not b or b.tenant_id != user.tenant_id:
        raise HTTPException(404, "Batch not found")
    run = latest_run(db, b.portfolio_id)
    rows = [r for r in run_rows(db, run) if r["patent_asset_id"] in set(b.asset_ids)] if run else []
    return {"batch_id": b.id, "name": b.name, "portfolio_id": b.portfolio_id, "score_run_id": run.id if run else None,
            "due_date": _iso(b.due_date), "items": rows}


# ------------------------------------------------------------------ scoring configs & scenarios

@app.get("/v1/scoring-configs")
def list_configs(portfolio_id: Optional[str] = None, user: User = Depends(current_user), db: Session = Depends(get_db)):
    ensure_default_config(db, user.tenant_id)
    db.commit()
    q = select(ScoringConfig).where(ScoringConfig.tenant_id == user.tenant_id).order_by(ScoringConfig.created_at.desc())
    rows = db.scalars(q).all()
    return [config_dict(c) for c in rows if not portfolio_id or c.kind == "default" or c.portfolio_id == portfolio_id]


class ConfigUpdateIn(BaseModel):
    weights: Optional[dict[str, float]] = None
    thresholds: Optional[dict[str, float]] = None
    gates: Optional[dict[str, float]] = None
    cost_assumptions: Optional[dict[str, Any]] = None


@app.put("/v1/scoring-configs/default")
def update_default(body: ConfigUpdateIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    cfg = ensure_default_config(db, user.tenant_id)
    before = config_dict(cfg)
    if body.weights is not None or body.thresholds is not None or body.gates is not None:
        require(user, "weights_config")
    if body.cost_assumptions is not None:
        require(user, "cost_config")
    try:
        if body.weights is not None:
            cfg.weights = validate_weights(body.weights)
    except ValueError as ex:
        raise HTTPException(400, str(ex))
    if body.thresholds is not None:
        cfg.thresholds = {**cfg.thresholds, **body.thresholds}
    if body.gates is not None:
        cfg.gates = {**cfg.gates, **body.gates}
    if body.cost_assumptions is not None:
        allowed = set(DEFAULT_COST_ASSUMPTIONS)
        upd = {k: v for k, v in body.cost_assumptions.items() if k in allowed and k != "assumption_version"}
        cfg.cost_assumptions = {**cfg.cost_assumptions, **upd, "assumption_version": f"cost-assumptions-v{cfg.version + 1}"}
    cfg.version += 1
    audit(db, user, "update_default_config", "scoring_config", cfg.id, before=before, after=config_dict(cfg), version=cfg.version)
    db.commit()
    return config_dict(cfg)


class ScenarioIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    weights: dict[str, float]
    thresholds: Optional[dict[str, float]] = None
    cost_assumptions: Optional[dict[str, Any]] = None
    budget_target: Optional[float] = Field(default=None, ge=0)
    budget_horizon: int = 5


def _scenario_cfg(db, user, body: ScenarioIn) -> dict:
    base = config_dict(ensure_default_config(db, user.tenant_id))
    try:
        w = validate_weights(body.weights)
    except ValueError as ex:
        raise HTTPException(400, str(ex))
    return {**base, "id": "preview", "name": body.name, "kind": "scenario", "weights": w,
            "thresholds": {**base["thresholds"], **(body.thresholds or {})},
            "cost_assumptions": {**base["cost_assumptions"], **(body.cost_assumptions or {})}}


@app.post("/v1/portfolios/{pid}/scenario-preview")
def scenario_preview(pid: str, body: ScenarioIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    p = get_portfolio(db, user, pid)
    base_run = latest_run(db, p.id)
    if not base_run:
        raise HTTPException(409, "Run a baseline score first")
    cfg = _scenario_cfg(db, user, body)
    scen = preview_rows(db, p, cfg, base_run.as_of_date)
    base = run_rows(db, base_run)
    out = {"saved": False, "comparison": compare(base, scen)}
    if body.budget_target:
        out["budget"] = budget_shortlist(scen, body.budget_target, str(body.budget_horizon))
    return out


@app.post("/v1/portfolios/{pid}/scenarios")
def save_scenario(pid: str, body: ScenarioIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    require(user, "scenario")
    p = get_portfolio(db, user, pid)
    base_run = latest_run(db, p.id)
    if not base_run:
        raise HTTPException(409, "Run a baseline score first")
    cfgd = _scenario_cfg(db, user, body)
    cfg = ScoringConfig(id=new_id("scn"), tenant_id=user.tenant_id, name=body.name, kind="scenario", portfolio_id=p.id, version=1,
                        weights=cfgd["weights"], thresholds=cfgd["thresholds"], gates=cfgd["gates"], cost_assumptions=cfgd["cost_assumptions"],
                        budget={"target": body.budget_target, "horizon": body.budget_horizon}, created_by=user.id)
    db.add(cfg)
    db.flush()
    run = run_scoring(db, p, cfg, user.id, as_of=base_run.as_of_date)
    scen = run_rows(db, run)
    base = run_rows(db, base_run)
    comp = compare(base, scen)
    budget = budget_shortlist(scen, body.budget_target, str(body.budget_horizon)) if body.budget_target else None
    run.summary = {**run.summary, "comparison_to": base_run.id, "changed": len(comp["changed"])}
    audit(db, user, "save_scenario", "scoring_config", cfg.id, weights=cfg.weights, score_run=run.id, baseline=base_run.id)
    db.commit()
    return {"saved": True, "scenario_id": cfg.id, "score_run_id": run.id, "baseline_run_id": base_run.id, "comparison": comp, "budget": budget}


@app.get("/v1/portfolios/{pid}/scenarios")
def list_scenarios(pid: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    p = get_portfolio(db, user, pid)
    cfgs = db.scalars(select(ScoringConfig).where(ScoringConfig.portfolio_id == p.id, ScoringConfig.kind == "scenario").order_by(ScoringConfig.created_at.desc())).all()
    out = []
    for c in cfgs:
        run = db.scalars(select(ScoreRun).where(ScoreRun.config_id == c.id).order_by(ScoreRun.run_at.desc())).first()
        out.append({**config_dict(c), "score_run_id": run.id if run else None, "summary": run.summary if run else None})
    return out


@app.get("/v1/compare")
def compare_runs(baseline: str, scenario: str, budget_target: Optional[float] = None, budget_horizon: int = 5,
                 user: User = Depends(current_user), db: Session = Depends(get_db)):
    b, s = get_run(db, user, baseline), get_run(db, user, scenario)
    if b.portfolio_id != s.portfolio_id:
        raise HTTPException(400, "Runs belong to different portfolios")
    srows = run_rows(db, s)
    out = {"comparison": compare(run_rows(db, b), srows)}
    if budget_target:
        out["budget"] = budget_shortlist(srows, budget_target, str(budget_horizon))
    return out


# ------------------------------------------------------------------ exports & audit

def _export_rows(db, run, recommendation):
    rows = run_rows(db, run)
    if recommendation:
        rows = [r for r in rows if r["recommendation"] in recommendation.split(",")]
    rows.sort(key=lambda r: (r["strategic_score"] is None, -(r["strategic_score"] or 0)))
    return rows


@app.get("/v1/score-runs/{rid}/export.{fmt}")
def export(rid: str, fmt: str, recommendation: Optional[str] = None, user: User = Depends(current_user), db: Session = Depends(get_db)):
    require(user, "export")
    run = get_run(db, user, rid)
    p = db.get(Portfolio, run.portfolio_id)
    rows = _export_rows(db, run, recommendation)
    fname = f"portfolio_maintenance_{p.name.split()[0].lower()}_{run.as_of_date}_{run.id}"
    audit(db, user, "export", "score_run", run.id, format=fmt, rows=len(rows))
    db.commit()
    if fmt == "csv":
        return Response(to_csv(p, run, rows), media_type="text/csv", headers={"Content-Disposition": f"attachment; filename={fname}.csv"})
    if fmt == "xlsx":
        return Response(to_xlsx(p, run, rows), media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                        headers={"Content-Disposition": f"attachment; filename={fname}.xlsx"})
    if fmt == "pdf":
        n = len(_decisions_map(db, [r["patent_asset_id"] for r in rows]))
        return Response(to_pdf(p, run, rows, n), media_type="application/pdf", headers={"Content-Disposition": f"attachment; filename={fname}.pdf"})
    raise HTTPException(400, "Format must be csv, xlsx or pdf")


@app.get("/v1/audit")
def audit_log(object_id: Optional[str] = None, action: Optional[str] = None, limit: int = Query(200, le=1000),
              user: User = Depends(current_user), db: Session = Depends(get_db)):
    q = select(AuditEvent).where(AuditEvent.tenant_id == user.tenant_id).order_by(AuditEvent.timestamp.desc()).limit(limit)
    if object_id:
        q = q.where(AuditEvent.object_id == object_id)
    if action:
        q = q.where(AuditEvent.action == action)
    unames = {u.id: u.name for u in db.scalars(select(User).where(User.tenant_id == user.tenant_id))}
    unames["system"] = "System"
    return [{"id": e.id, "action": e.action, "actor": unames.get(e.actor_id, e.actor_id), "object_type": e.object_type,
             "object_id": e.object_id, "before_hash": e.before_hash, "after_hash": e.after_hash, "detail": e.detail,
             "timestamp": e.timestamp.isoformat()} for e in db.scalars(q)]


# ------------------------------------------------------------------ static SPA

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/")
def index():
    return FileResponse(os.path.join(STATIC_DIR, "index.html"))
