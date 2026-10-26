"""Portfolio persistence, scoring runs, scenarios and budget shortlists."""
from __future__ import annotations

import csv
import io
import uuid
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import SCORING_VERSION
from .costs import DEFAULT_COST_ASSUMPTIONS, expiry_estimate, forecast, money
from .models import (CostActual, DimensionInput, EvidenceItem, LegalStatusSnapshot, OwnershipEvent, PatentAsset,
                     PatentFamily, PatentScore, Portfolio, ReviewDecision, ScoreRun, ScoringConfig, utcnow)
from .scoring import (DEFAULT_GATES, DEFAULT_THRESHOLDS, DEFAULT_WEIGHTS, NOT_IN_FORCE, RECOMMENDATIONS, score_asset,
                      snapshot_hash)


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def today() -> date:
    return utcnow().date()


# ------------------------------------------------------------------ persistence

def persist_generated(db: Session, tenant_id: str, name: str, entity: dict, gen: dict, scope: dict,
                      query_type: str, data_mode: str = "synthetic", sources=None) -> Portfolio:
    pf = Portfolio(id=new_id("pf"), tenant_id=tenant_id, name=name, entity=entity, query_type=query_type,
                   ownership_scope=scope.get("ownership_scope", "current_owner"), data_mode=data_mode,
                   provisional=(query_type == "inventor" and not scope.get("owner_filter") and not scope.get("inventor_centric_confirmed")),
                   sources=sources or ["USPTO bibliographic & assignment (synthetic demo)", "EPO / CNIPA registers (synthetic demo)",
                                       "Customer inputs (synthetic demo)" if entity.get("customer_data") else "No customer inputs supplied"],
                   unavailable_sources=["Live patent-office connector (not configured in this deployment)"] if data_mode == "synthetic" else [])
    db.add(pf)
    fam_ids = []
    for f in gen["families"]:
        fam = PatentFamily(id=new_id("fam"), portfolio_id=pf.id, **f)
        db.add(fam)
        fam_ids.append(fam.id)
    seen = set()
    for a in gen["assets"]:
        key = (a["jurisdiction"], a["publication_number"])
        if key in seen:  # idempotent de-duplication
            continue
        seen.add(key)
        aid = new_id("pa")
        fields = {k: v for k, v in a.items() if k not in ("ownership_events", "status_snapshots", "evidence", "cost_actuals", "family_idx")}
        asset = PatentAsset(id=aid, portfolio_id=pf.id, family_id=fam_ids[a["family_idx"]] if fam_ids else None, **fields)
        db.add(asset)
        for e in a.get("ownership_events", []):
            db.add(OwnershipEvent(patent_asset_id=aid, **e))
        for s in a.get("status_snapshots", []):
            db.add(LegalStatusSnapshot(patent_asset_id=aid, **s))
        for e in a.get("evidence", []):
            db.add(EvidenceItem(id=new_id("ev"), patent_asset_id=aid, content_hash=snapshot_hash(e)[:32], **e))
        for c in a.get("cost_actuals", []):
            db.add(CostActual(patent_asset_id=aid, category=c["category"], amount=Decimal(c["amount"]), currency=c["currency"],
                              incurred_on=c["incurred_on"], source_id=c["source_id"]))
    db.flush()
    return pf


# ------------------------------------------------------------------ configs

def ensure_default_config(db: Session, tenant_id: str) -> ScoringConfig:
    cid = f"default_v1_{tenant_id}"
    cfg = db.get(ScoringConfig, cid)
    if not cfg:
        cfg = ScoringConfig(id=cid, tenant_id=tenant_id, name="Default model v1", kind="default", version=1,
                            weights=dict(DEFAULT_WEIGHTS), thresholds=dict(DEFAULT_THRESHOLDS), gates=dict(DEFAULT_GATES),
                            cost_assumptions=dict(DEFAULT_COST_ASSUMPTIONS), budget={})
        db.add(cfg)
        db.flush()
    return cfg


def config_dict(cfg: ScoringConfig) -> dict:
    return {"id": cfg.id, "name": cfg.name, "kind": cfg.kind, "version": cfg.version, "weights": cfg.weights,
            "thresholds": cfg.thresholds, "gates": cfg.gates, "cost_assumptions": cfg.cost_assumptions,
            "budget": cfg.budget or {}, "portfolio_id": cfg.portfolio_id, "created_by": cfg.created_by,
            "created_at": cfg.created_at.isoformat() if cfg.created_at else None}


# ------------------------------------------------------------------ asset context

def asset_dict(a: PatentAsset) -> dict:
    return {c.name: getattr(a, c.name) for c in PatentAsset.__table__.columns}


def latest_inputs(db: Session, asset_ids: list[str]) -> dict:
    rows = db.scalars(select(DimensionInput).where(DimensionInput.patent_asset_id.in_(asset_ids)).order_by(DimensionInput.id)).all()
    out: dict = defaultdict(dict)
    for r in rows:
        out[r.patent_asset_id][r.dimension] = {"rating": r.rating, "rationale": r.rationale, "source": r.evidence_source,
                                               "user_id": r.user_id, "created_at": r.created_at.isoformat()}
    return out


def build_context(assets: list[PatentAsset]) -> dict:
    group_active = Counter()
    by_family = defaultdict(list)
    for a in assets:
        if a.status in ("active", "pending") and a.cpc:
            group_active[a.cpc.split("/")[0]] += 1
        by_family[a.family_id].append(a)
    ctx = {}
    for a in assets:
        fam = by_family.get(a.family_id, [])
        others = [m for m in fam if m.id != a.id]
        pending_children = sum(1 for m in others if m.parent_publication == a.publication_number and m.status == "pending")
        in_force_children = sum(1 for m in others if m.parent_publication == a.publication_number and m.status == "active")
        us_others_live = [m for m in others if m.jurisdiction == "US" and m.status in ("active", "pending")]
        sole_us = a.jurisdiction == "US" and a.status == "active" and not us_others_live
        foreign = sorted({m.jurisdiction for m in others if m.jurisdiction != "US" and m.status == "active"})
        same_jur = sum(1 for m in others if m.jurisdiction == a.jurisdiction and m.status == "active")
        ctx[a.id] = {
            "cpc_group_active": group_active,
            "family": {"pending_children": pending_children, "in_force_children": in_force_children,
                       "sole_in_force_us": sole_us, "in_force_foreign": foreign, "same_jur_in_force_siblings": same_jur,
                       "size": len(fam)},
        }
    return ctx


def evidence_by_asset(db: Session, asset_ids: list[str]) -> dict:
    rows = db.scalars(select(EvidenceItem).where(EvidenceItem.patent_asset_id.in_(asset_ids))).all()
    out = defaultdict(list)
    for e in rows:
        out[e.patent_asset_id].append({"id": e.id, "dimension": e.dimension, "reliability": e.reliability,
                                       "directness": e.directness, "source_date": e.source_date, "polarity": e.polarity})
    return out


# ------------------------------------------------------------------ scoring

def compute(db: Session, portfolio: Portfolio, cfg: dict, as_of: date, horizons=(3, 5)) -> tuple[list[dict], str]:
    assets = db.scalars(select(PatentAsset).where(PatentAsset.portfolio_id == portfolio.id)).all()
    ids = [a.id for a in assets]
    ctx = build_context(assets)
    ev = evidence_by_asset(db, ids)
    inputs = latest_inputs(db, ids)
    results = []
    snap_material = []
    for a in assets:
        ad = asset_dict(a)
        if portfolio.entity_size and not ad.get("entity_size"):
            ad["entity_size"] = portfolio.entity_size
        cost = forecast(ad, as_of, list(horizons), cfg.get("cost_assumptions"))
        res = score_asset(ad, ctx[a.id], ev.get(a.id, []), inputs.get(a.id, {}), cost, cfg, as_of)
        res["cost"] = cost
        res["asset_id"] = a.id
        results.append(res)
        snap_material.append([ad, sorted([e["id"] for e in ev.get(a.id, [])]), inputs.get(a.id, {})])
    data_hash = snapshot_hash(snap_material)
    return results, data_hash


def summarise(results: list[dict], assets: dict[str, PatentAsset], horizons=(3, 5)) -> dict:
    by_rec = Counter(r["recommendation"] for r in results)
    gates = Counter(r["gate_status"] for r in results)
    totals = {}
    unknown_cost = 0
    for h in horizons:
        s = Decimal("0")
        for r in results:
            t = r["cost"]["totals"][str(h)]["total"]
            if t is None:
                continue
            s += Decimal(t)
        totals[str(h)] = str(money(s))
    unknown_cost = sum(1 for r in results if r["cost"]["unknown"])
    scored = [r for r in results if r["strategic_score"] is not None]
    by_year = defaultdict(Decimal)
    for r in results:
        for it in r["cost"]["items"]:
            y = it["date"][:4]
            by_year[y] += Decimal(it.get("official_fee", "0")) + Decimal(it.get("surcharge", "0")) + Decimal(it.get("professional_fee", "0"))
    stale = sum(1 for r in results if any(g["code"] == "STALE_STATUS" for g in r["gate_reasons"]))
    fam = {assets[r["asset_id"]].family_id for r in results}
    return {
        "assets": len(results),
        "families": len(fam),
        "by_recommendation": dict(by_rec),
        "by_gate": dict(gates),
        "forward_cost": totals,
        "unknown_cost_assets": unknown_cost,
        "cost_by_year": {k: str(money(v)) for k, v in sorted(by_year.items())},
        "avg_coverage": round(sum(r["data_coverage"] for r in results) / len(results), 1) if results else 0,
        "avg_confidence": round(sum(r["evidence_confidence"] for r in results) / len(results), 1) if results else 0,
        "avg_score": round(sum(r["strategic_score"] for r in scored) / len(scored), 1) if scored else None,
        "stale_records": stale,
        "in_force": sum(1 for a in assets.values() if a.status == "active"),
        "pending": sum(1 for a in assets.values() if a.status == "pending"),
    }


def run_scoring(db: Session, portfolio: Portfolio, cfg_row: ScoringConfig, user_id: str, as_of: date | None = None,
                horizons=(3, 5)) -> ScoreRun:
    as_of = as_of or today()
    cfg = config_dict(cfg_row)
    results, data_hash = compute(db, portfolio, cfg, as_of, horizons)
    assets = {a.id: a for a in db.scalars(select(PatentAsset).where(PatentAsset.portfolio_id == portfolio.id)).all()}
    run = ScoreRun(id=new_id("sr"), tenant_id=portfolio.tenant_id, portfolio_id=portfolio.id, config_id=cfg_row.id,
                   config_snapshot={**cfg, "horizons": list(horizons)}, scoring_version=SCORING_VERSION,
                   data_snapshot_hash=data_hash, as_of_date=as_of, summary=summarise(results, assets, horizons), created_by=user_id)
    db.add(run)
    for r in results:
        db.add(PatentScore(score_run_id=run.id, patent_asset_id=r["asset_id"], dimension_scores=r["dimension_scores"],
                           strategic_score=r["strategic_score"], data_coverage=r["data_coverage"],
                           evidence_confidence=r["evidence_confidence"], recommendation=r["recommendation"],
                           gate_status=r["gate_status"], gate_reasons=r["gate_reasons"],
                           explanation={**r["explanation"], "confidence_notes": r["confidence_notes"], "score_band": r["score_band"]},
                           cost=r["cost"]))
    db.flush()
    return run


def latest_run(db: Session, portfolio_id: str, kind: str = "default") -> ScoreRun | None:
    q = select(ScoreRun).where(ScoreRun.portfolio_id == portfolio_id).order_by(ScoreRun.run_at.desc())
    for run in db.scalars(q):
        if (run.config_snapshot or {}).get("kind", "default") == kind:
            return run
    return None


# ------------------------------------------------------------------ results / rows

def result_row(a: PatentAsset, s: PatentScore, decision: ReviewDecision | None = None) -> dict:
    nd = (s.cost or {}).get("next_deadline")
    totals = (s.cost or {}).get("totals", {})
    return {
        "patent_asset_id": a.id, "publication_number": a.publication_number, "application_number": a.application_number,
        "title": a.title, "jurisdiction": a.jurisdiction, "status": a.status, "kind_code": a.kind_code,
        "family_id": a.family_id, "relationship_type": a.relationship_type, "cpc": a.cpc, "technology": a.technology,
        "current_owner": a.current_owner, "grant_date": a.grant_date.isoformat() if a.grant_date else None,
        "filing_date": a.filing_date.isoformat() if a.filing_date else None,
        "expiry_estimate": a.expiry_estimate.isoformat() if a.expiry_estimate else None,
        "strategic_score": s.strategic_score, "data_coverage": s.data_coverage, "evidence_confidence": s.evidence_confidence,
        "recommendation": s.recommendation, "recommendation_label": RECOMMENDATIONS.get(s.recommendation, s.recommendation),
        "review_reason": (s.explanation or {}).get("review_reason"),
        "review_reason_label": (s.explanation or {}).get("review_reason_label"),
        "ratings": {k: v.get("rating") for k, v in (s.dimension_scores or {}).items()},
        "gate_status": s.gate_status, "gate_codes": [g["code"] for g in s.gate_reasons],
        "cost_3y": totals.get("3", {}).get("total"), "cost_5y": totals.get("5", {}).get("total"),
        "cost_unknown": (s.cost or {}).get("unknown", False),
        "next_deadline": nd["date"] if nd else None, "next_deadline_label": nd["label"] if nd else None,
        "data_as_of": a.data_as_of.isoformat() if a.data_as_of else None,
        "last_status_check": a.last_status_check.isoformat() if a.last_status_check else None,
        "sensitive": bool((s.explanation or {}).get("sensitivity")),
        "decision": decision.decision if decision else None,
        "decision_at": decision.created_at.isoformat() if decision else None,
    }


# ------------------------------------------------------------------ scenarios & budget

REC_ORDER = {"abandon": 0, "review": 1, "retain": 2, "not_in_force": 3}


def budget_shortlist(rows: list[dict], target: float, horizon: str = "5") -> dict:
    """Pick review candidates whose forward cost would close the budget gap. Human review only; never abandons."""
    key = "cost_5y" if horizon == "5" else "cost_3y"
    cands = [r for r in rows if (r["recommendation"] == "abandon" or (r["recommendation"] == "review" and r.get("review_reason") == "borderline_value"))
             and r.get(key) and float(r[key]) > 0 and r["gate_status"] != "BLOCK"]
    cands.sort(key=lambda r: (REC_ORDER[r["recommendation"]], r["strategic_score"] or 0, -float(r[key])))
    picked, total = [], 0.0
    for r in cands:
        if total >= target:
            break
        picked.append({**r, "dependency_warning": any(c in ("FAMILY_DEPENDENCY", "JURISDICTION_IMPACT") for c in r["gate_codes"])})
        total += float(r[key])
    return {"target": target, "horizon_years": int(horizon), "identified_savings": round(total, 2),
            "met": total >= target, "candidates": picked,
            "note": "Shortlist only — Abandon outcomes first, then borderline Review assets. Savings are forecast official + professional costs avoided if each is confirmed and allowed to lapse; check family dependencies first."}


def compare(base_rows: list[dict], scen_rows: list[dict]) -> dict:
    b = {r["patent_asset_id"]: r for r in base_rows}
    changes = []
    for r in scen_rows:
        o = b.get(r["patent_asset_id"])
        if o and o["recommendation"] != r["recommendation"]:
            changes.append({"patent_asset_id": r["patent_asset_id"], "publication_number": r["publication_number"], "title": r["title"],
                            "family_id": r["family_id"], "from": o["recommendation"], "to": r["recommendation"],
                            "score_from": o["strategic_score"], "score_to": r["strategic_score"], "cost_5y": r["cost_5y"]})

    def cost_of(rows, recs):
        return round(sum(float(x["cost_5y"]) for x in rows if x["recommendation"] in recs and x["cost_5y"]), 2)
    abandon = ("abandon",)
    return {
        "changed": changes,
        "changed_families": len({c["family_id"] for c in changes}),
        "baseline_counts": dict(Counter(r["recommendation"] for r in base_rows)),
        "scenario_counts": dict(Counter(r["recommendation"] for r in scen_rows)),
        "abandon_review_cost_5y": {"baseline": cost_of(base_rows, abandon), "scenario": cost_of(scen_rows, abandon)},
        "avg_coverage": {"baseline": round(sum(r["data_coverage"] for r in base_rows) / max(1, len(base_rows)), 1),
                         "scenario": round(sum(r["data_coverage"] for r in scen_rows) / max(1, len(scen_rows)), 1)},
    }


def preview_rows(db: Session, portfolio: Portfolio, cfg: dict, as_of: date) -> list[dict]:
    results, _ = compute(db, portfolio, cfg, as_of)
    assets = {a.id: a for a in db.scalars(select(PatentAsset).where(PatentAsset.portfolio_id == portfolio.id)).all()}
    rows = []
    for r in results:
        fake = PatentScore(score_run_id="preview", patent_asset_id=r["asset_id"], dimension_scores=r["dimension_scores"],
                           strategic_score=r["strategic_score"], data_coverage=r["data_coverage"],
                           evidence_confidence=r["evidence_confidence"], recommendation=r["recommendation"],
                           gate_status=r["gate_status"], gate_reasons=r["gate_reasons"], explanation=r["explanation"], cost=r["cost"])
        rows.append(result_row(assets[r["asset_id"]], fake))
    return rows


# ------------------------------------------------------------------ CSV import

PORTFOLIO_CSV_COLUMNS = [
    "publication_number", "application_number", "jurisdiction", "kind_code", "title", "filing_date", "priority_date",
    "grant_date", "status", "family_id", "relationship_type", "parent_publication", "current_owner", "entity_size", "cpc",
    "independent_claims", "claim1_words", "forward_citations", "cohort_citation_median", "competitor_citations",
    "standards_relevance", "products", "product_lifecycle", "revenue_band", "strategic_priority", "fto_relevance",
    "roadmap_relevance", "licensing_history", "obligations",
]

CUSTOMER_CSV_COLUMNS = ["publication_number", "products", "product_lifecycle", "revenue_band", "confirmed_use",
                        "strategic_priority", "fto_relevance", "roadmap_relevance", "licensing_history", "evidence_of_use_leads"]

VALID_STATUS = {"active", "pending", "expired", "abandoned", "lapsed", "withdrawn", "unknown"}


def _d(v):
    v = (v or "").strip()
    if not v:
        return None
    return date.fromisoformat(v[:10])


def _i(v):
    v = (v or "").strip()
    return int(float(v)) if v else None


def _b(v):
    v = (v or "").strip().lower()
    return None if not v else v in ("1", "true", "yes", "y")


def _opt(v):
    v = (v or "").strip()
    return v or None


def parse_portfolio_csv(text: str, owner: str, as_of: date) -> tuple[dict, list[str]]:
    reader = csv.DictReader(io.StringIO(text))
    errors = []
    if not reader.fieldnames or "publication_number" not in reader.fieldnames:
        raise ValueError("CSV must include a header row with at least 'publication_number'.")
    fams = {}
    assets = []
    from .catalog import TECH
    trends = {k: v[1] for t in TECH.values() for k, v in t["cpc"].items()}
    for i, row in enumerate(reader, start=2):
        try:
            pub = (row.get("publication_number") or "").strip()
            if not pub:
                errors.append(f"Row {i}: missing publication_number — skipped")
                continue
            status = (row.get("status") or "unknown").strip().lower()
            if status not in VALID_STATUS:
                errors.append(f"Row {i}: unknown status '{status}' treated as 'unknown'")
                status = "unknown"
            fid = (row.get("family_id") or pub).strip()
            if fid not in fams:
                fams[fid] = len(fams)
            filing, grant = _d(row.get("filing_date")), _d(row.get("grant_date"))
            products = [p.strip() for p in (row.get("products") or "").split(";") if p.strip()]
            prod_raw = row.get("products")
            mappings = None
            if prod_raw is not None and prod_raw.strip() != "":
                if prod_raw.strip().lower() in ("none", "no product"):
                    mappings = []
                else:
                    mappings = [{"product": p, "lifecycle": _opt(row.get("product_lifecycle")) or "mature",
                                 "revenue_band": _opt(row.get("revenue_band")) or "medium", "confirmed_use": True} for p in products]
            cpc = _opt(row.get("cpc")) or ""
            trend = None
            for k, v in trends.items():
                if cpc and cpc.split("/")[0] == k.split("/")[0]:
                    trend = v
                    break
            obligations = []
            for o in (row.get("obligations") or "").split(";"):
                o = o.strip()
                if o:
                    t, _, detail = o.partition(":")
                    obligations.append({"type": t.strip().lower() or "other", "detail": detail.strip() or t})
            signals = {
                "independent_claims": _i(row.get("independent_claims")), "claim1_words": _i(row.get("claim1_words")),
                "forward_citations": _i(row.get("forward_citations")), "cohort_citation_median": _i(row.get("cohort_citation_median")),
                "competitor_citations": _i(row.get("competitor_citations")), "competitor_names": [],
                "standards_relevance": _opt(row.get("standards_relevance")), "public_product_evidence": [],
                "licensing_history": _opt(row.get("licensing_history")), "evidence_of_use_leads": None,
                "tech_trend_growth": trend, "claim_scope_reduction": None, "rce_count": None,
            }
            cinputs = {k: v for k, v in {"strategic_priority": _opt(row.get("strategic_priority")),
                                         "fto_relevance": _b(row.get("fto_relevance")),
                                         "roadmap_relevance": _opt(row.get("roadmap_relevance"))}.items() if v is not None}
            cur_owner = _opt(row.get("current_owner")) or owner
            rel = _opt(row.get("relationship_type")) or "original"
            now = datetime.combine(as_of, datetime.min.time())
            ev = []
            if signals["independent_claims"] is not None:
                ev.append({"dimension": "claim_quality", "evidence_type": "claims", "source_name": "Customer portfolio import",
                           "source_uri": "", "source_date": as_of, "excerpt": "Claim metrics supplied in import.", "reliability": 0.8, "directness": 0.75, "polarity": 0})
            if mappings is not None:
                ev.append({"dimension": "commercial", "evidence_type": "product_mapping", "source_name": "Customer portfolio import",
                           "source_uri": "", "source_date": as_of, "excerpt": "; ".join(products) or "No product", "reliability": 0.85, "directness": 0.9, "polarity": 0})
            if cinputs.get("strategic_priority"):
                ev.append({"dimension": "strategic", "evidence_type": "strategy_tag", "source_name": "Customer portfolio import",
                           "source_uri": "", "source_date": as_of, "excerpt": cinputs["strategic_priority"], "reliability": 0.85, "directness": 0.85, "polarity": 0})
            if signals["forward_citations"] is not None:
                ev.append({"dimension": "competitive", "evidence_type": "citations", "source_name": "Customer portfolio import",
                           "source_uri": "", "source_date": as_of, "excerpt": f"{signals['forward_citations']} forward citations", "reliability": 0.8, "directness": 0.5, "polarity": 0})
            assets.append({
                "publication_number": pub, "application_number": (row.get("application_number") or "").strip(),
                "jurisdiction": (row.get("jurisdiction") or "US").strip().upper(), "kind_code": (row.get("kind_code") or "").strip(),
                "title": (row.get("title") or pub).strip(), "abstract": "", "cpc": cpc, "technology": cpc,
                "filing_date": filing, "priority_date": _d(row.get("priority_date")), "grant_date": grant,
                "expiry_estimate": expiry_estimate(filing), "status": status, "status_conflict": None,
                "relationship_type": rel, "parent_publication": _opt(row.get("parent_publication")), "inventors": [],
                "original_applicant": cur_owner, "current_owner": cur_owner, "owner_confidence": 0.8 if row.get("current_owner") else 0.65,
                "ownership_issue": None, "entity_size": (_opt(row.get("entity_size")) or "large").lower(),
                "signals": signals, "obligations": obligations, "product_mappings": mappings, "customer_inputs": cinputs,
                "ownership_events": [{"assignee": cur_owner, "role": "current_owner", "event_type": "Owner per customer import",
                                      "effective_date": None, "source_id": "Customer portfolio import", "confidence": 0.8}],
                "status_snapshots": [{"status": status, "status_date": grant or filing, "source_id": "Customer portfolio import", "retrieved_at": now}],
                "evidence": ev, "cost_actuals": [], "family_idx": fams[fid], "last_status_check": now, "data_as_of": now,
            })
        except Exception as ex:  # noqa: BLE001
            errors.append(f"Row {i}: {ex}")
    families = [{"provider_family_id": k, "family_type": "customer-supplied", "source_id": "Customer portfolio import"} for k in fams]
    return {"families": families, "assets": assets}, errors


def apply_customer_csv(db: Session, portfolio: Portfolio, text: str) -> tuple[int, list[str]]:
    reader = csv.DictReader(io.StringIO(text))
    assets = {a.publication_number: a for a in db.scalars(select(PatentAsset).where(PatentAsset.portfolio_id == portfolio.id))}
    n, errors = 0, []
    for i, row in enumerate(reader, start=2):
        pub = (row.get("publication_number") or "").strip()
        a = assets.get(pub)
        if not a:
            errors.append(f"Row {i}: {pub or '(blank)'} not in this portfolio — skipped")
            continue
        prod = (row.get("products") or "").strip()
        if prod:
            if prod.lower() in ("none", "no product"):
                a.product_mappings = []
            else:
                a.product_mappings = [{"product": p.strip(), "lifecycle": _opt(row.get("product_lifecycle")) or "mature",
                                       "revenue_band": _opt(row.get("revenue_band")) or "medium",
                                       "confirmed_use": _b(row.get("confirmed_use")) if _b(row.get("confirmed_use")) is not None else True}
                                      for p in prod.split(";") if p.strip()]
            db.add(EvidenceItem(id=new_id("ev"), patent_asset_id=a.id, dimension="commercial", evidence_type="product_mapping",
                                source_name="Customer inputs CSV upload", source_date=today(), excerpt=prod, reliability=0.85, directness=0.9))
        ci = dict(a.customer_inputs or {})
        for k in ("strategic_priority", "roadmap_relevance"):
            if _opt(row.get(k)):
                ci[k] = _opt(row.get(k))
        if _b(row.get("fto_relevance")) is not None:
            ci["fto_relevance"] = _b(row.get("fto_relevance"))
        if ci != (a.customer_inputs or {}):
            a.customer_inputs = ci
            db.add(EvidenceItem(id=new_id("ev"), patent_asset_id=a.id, dimension="strategic", evidence_type="strategy_tag",
                                source_name="Customer inputs CSV upload", source_date=today(),
                                excerpt=str(ci), reliability=0.85, directness=0.85))
        sig = dict(a.signals or {})
        if _opt(row.get("licensing_history")):
            sig["licensing_history"] = _opt(row.get("licensing_history"))
        if _opt(row.get("evidence_of_use_leads")):
            sig["evidence_of_use_leads"] = _i(row.get("evidence_of_use_leads"))
        a.signals = sig
        n += 1
    db.flush()
    return n, errors
