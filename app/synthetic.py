"""Deterministic synthetic portfolio generator.

Used when no licensed patent-data provider is configured. It deliberately includes the spec's
critical test cases: acquired subsidiaries with a chain-of-title gap, conflicting legal status,
fee in grace period, imminent deadline, pending continuations, multi-jurisdiction families with
different statuses, standards/licence/litigation obligations and stale status records.
"""
from __future__ import annotations

import hashlib
import random
from datetime import date, datetime, timedelta

from .catalog import COMPANIES, FIRST, INVENTORS, LAST, TECH
from .costs import add_months, expiry_estimate

SRC_USPTO = "USPTO Patent Center — bibliographic & file wrapper (synthetic demo)"
SRC_ASSIGN = "USPTO Assignment records (synthetic demo)"
SRC_FEED = "Commercial legal-status feed (synthetic demo)"
SRC_EPO = "EPO Register (synthetic demo)"
SRC_CNIPA = "CNIPA register (synthetic demo)"
SRC_CUST = "Customer product-mapping upload v1"
SRC_STRAT = "Customer portfolio strategy inputs"
SRC_LIC = "Customer licensing register"


def _rng(key: str) -> random.Random:
    return random.Random(int(hashlib.sha256(key.encode()).hexdigest()[:12], 16))


def _rand_date(r: random.Random, start: date, end: date) -> date:
    return start + timedelta(days=r.randint(0, max(0, (end - start).days)))


def _patent_number(r, kind):
    return f"US-S{r.randint(1000000, 1999999)}-{kind}"


def _person(r):
    return f"{r.choice(FIRST)} {r.choice(LAST)}"


def _company(entity_id):
    for c in COMPANIES:
        if c["entity_id"] == entity_id:
            return c
    return None


def generate(entity: dict, as_of: date, scope: dict | None = None) -> dict:
    scope = scope or {}
    if entity["entity_type"] == "inventor":
        return _generate_inventor(entity, as_of, scope)
    comp = _company(entity["entity_id"])
    tech_key = comp["tech"] if comp else entity.get("tech_key", "software")
    owner = entity["canonical_name"]
    customer_data = bool(comp and comp.get("customer_data"))
    subs = comp["subsidiaries"] if comp else []
    include_subs = scope.get("include_related_entities")
    if include_subs is not None:
        subs = [s for s in subs if s["name"] in include_subs]
    r = _rng(entity["entity_id"])
    n_fam = r.randint(16, 22) if comp else r.randint(12, 16)
    return _build(r, owner, tech_key, n_fam, as_of, customer_data, subs, inventor_focus=None,
                  standards=(tech_key == "telecom"), scope_label=scope.get("ownership_scope", "current_owner"))


def _generate_inventor(entity: dict, as_of: date, scope: dict) -> dict:
    inv = next((i for i in INVENTORS if i["entity_id"] == entity["entity_id"]), None)
    affs = inv["affiliations"] if inv else entity.get("affiliations", [{"org": "Unknown employer", "from": 2012, "to": None}])
    tech_key = inv["tech"] if inv else entity.get("tech_key", "software")
    r = _rng(entity["entity_id"])
    families, assets = [], []
    for aff in affs:
        comp = next((c for c in COMPANIES if c["canonical_name"] == aff["org"]), None)
        tk = comp["tech"] if comp else tech_key
        part = _build(r, aff["org"], tk, r.randint(4, 7), as_of, bool(comp and comp["customer_data"]), [],
                      inventor_focus=(entity["canonical_name"], aff), standards=(tk == "telecom"))
        off = len(families)
        families.extend(part["families"])
        for a in part["assets"]:
            a["family_idx"] += off
            assets.append(a)
    sel = scope.get("owner_filter")
    if sel:
        assets = [a for a in assets if a["current_owner"] == sel or a["original_applicant"] == sel]
        used = sorted({a["family_idx"] for a in assets})
        remap = {o: i for i, o in enumerate(used)}
        families = [families[o] for o in used]
        for a in assets:
            a["family_idx"] = remap[a["family_idx"]]
    return {"families": families, "assets": assets, "tech": tech_key}


def _build(r, owner, tech_key, n_fam, as_of, customer_data, subs, inventor_focus=None, standards=False, scope_label="current_owner"):
    tech = TECH[tech_key]
    cpcs = list(tech["cpc"].items())
    titles = list(tech["titles"])
    families, assets = [], []
    team = [_person(r) for _ in range(8)]
    special = {"grace": 0, "imminent": 1, "conflict": 2, "chain_gap": 3, "stale": 4}

    for fi in range(n_fam):
        fam_id = f"FAM-S{r.randint(100000, 999999)}"
        families.append({"provider_family_id": fam_id, "family_type": "extended (priority-linked)", "source_id": SRC_USPTO})
        cpc, (cpc_label, trend) = cpcs[fi % len(cpcs)] if fi < len(cpcs) else r.choice(cpcs)
        title = titles[fi % len(titles)] if fi < len(titles) else f"{r.choice(titles)} — improved variant"
        priority = _rand_date(r, date(2006, 1, 1), date(2024, 3, 1))
        if fi == special["grace"]:
            priority = add_months(as_of, -(90 + 30 + 2))
        elif fi == special["imminent"]:
            priority = add_months(as_of, -(42 + 28 + 10))
        filing = priority + timedelta(days=r.randint(200, 365))
        original_applicant = owner
        sub = None
        if subs and r.random() < 0.3 and priority.year < subs[0]["year"]:
            sub = subs[0]
            original_applicant = sub["name"]
        if fi == special["chain_gap"] and subs:
            sub = subs[0]
            original_applicant = sub["name"]
            priority = _rand_date(r, date(2010, 1, 1), date(subs[0]["year"] - 1, 6, 1))
            filing = priority + timedelta(days=300)
        inventors = r.sample(team, k=r.randint(1, 3))
        if inventor_focus:
            inventors = [inventor_focus[0]] + inventors[:2]
            lo = date(inventor_focus[1]["from"], 1, 1)
            hi = date(inventor_focus[1]["to"] or min(as_of.year - 1, 2024), 6, 1)
            priority = _rand_date(r, lo, max(lo, hi))
            filing = priority + timedelta(days=r.randint(200, 365))

        members = []
        # --- US parent
        grant_months = r.randint(22, 46)
        if fi == special["grace"]:
            grant = add_months(as_of, -92)  # 7.5-year fee in grace period
            filing = add_months(grant, -30)
        elif fi == special["imminent"]:
            grant = add_months(as_of, -42) + timedelta(days=55)  # 3.5-year fee due in ~55 days
            filing = add_months(grant, -28)
        else:
            grant = add_months(filing, grant_months)
        will_grant = r.random() > 0.12 or fi in (special["grace"], special["imminent"], special["conflict"], special["chain_gap"], special["stale"])
        members.append(("original", filing, grant if (will_grant and grant <= as_of) else None, None))
        # continuation
        if r.random() < 0.38 and filing < add_months(as_of, -30):
            cfil = add_months(filing, r.randint(14, 36))
            cgr = add_months(cfil, r.randint(18, 40))
            members.append(("continuation", cfil, cgr if (cgr <= as_of and r.random() > 0.25) else None, 0))
        fam_assets = []
        for rel, fdate, gdate, parent_idx in members:
            exp = expiry_estimate(fdate if rel == "original" else None, members[0][1])
            if gdate:
                status = "expired" if exp <= as_of else "active"
                if status == "active" and r.random() < 0.06 and fi > 4:
                    status = "lapsed"
                kind = "B2"
                pub = _patent_number(r, kind)
            else:
                old = fdate < add_months(as_of, -60)
                status = "abandoned" if old else "pending"
                kind = "A1"
                pub = f"US-S{fdate.year}0{r.randint(100000, 999999)}-A1"
            appno = f"{r.choice([15, 16, 17, 18])}/S{r.randint(100000, 999999)}"
            a = _asset(r, tech, cpc, cpc_label, trend, title if rel == "original" else title + " (continuation)",
                       pub, appno, "US", kind, fdate, priority, gdate, exp, status, rel, inventors,
                       original_applicant, owner, sub, as_of, customer_data, standards, fi)
            a["family_idx"] = fi
            if rel == "continuation":
                a["parent_publication"] = fam_assets[0]["publication_number"]
            fam_assets.append(a)
        # foreign members
        for jur, src, p in (("EP", SRC_EPO, 0.42), ("CN", SRC_CNIPA, 0.2)):
            if r.random() < p and fam_assets[0]["grant_date"]:
                fgr = add_months(filing, r.randint(30, 60))
                if fgr > as_of:
                    st, fgr2, kind = "pending", None, "A1"
                else:
                    exp = expiry_estimate(filing)
                    st = "expired" if exp <= as_of else r.choice(["active", "active", "active", "lapsed"])
                    fgr2, kind = fgr, ("B1" if jur == "EP" else "B")
                num = f"{jur}-S{r.randint(1000000, 3999999)}-{kind}"
                a = _asset(r, tech, cpc, cpc_label, trend, title, num, f"{jur}S{r.randint(10000000, 99999999)}.{r.randint(1, 9)}",
                           jur, kind, filing, priority, fgr2, expiry_estimate(filing), st, "foreign counterpart",
                           inventors, original_applicant, owner, sub, as_of, customer_data, standards, fi, source=src)
                a["family_idx"] = fi
                fam_assets.append(a)
        # special cases
        if fi == special["conflict"]:
            us = fam_assets[0]
            if us["status"] in ("active",):
                us["status_conflict"] = {
                    "sources": [{"source": SRC_USPTO, "status": "active", "date": (as_of - timedelta(days=3)).isoformat()},
                                {"source": SRC_FEED, "status": "lapsed", "date": (as_of - timedelta(days=9)).isoformat()}],
                    "summary": "USPTO register shows ACTIVE; commercial feed shows LAPSED (fee not recorded)",
                }
                us["status_snapshots"].append({"status": "lapsed", "status_date": as_of - timedelta(days=9), "source_id": SRC_FEED,
                                               "retrieved_at": datetime.combine(as_of - timedelta(days=1), datetime.min.time())})
        if fi == special["chain_gap"] and sub:
            for a in fam_assets:
                if a["jurisdiction"] == "US":
                    a["current_owner"] = None
                    a["owner_confidence"] = 0.35
                    a["ownership_issue"] = (f"Chain-of-title gap: recorded assignee is {sub['name']}; no assignment to {owner} "
                                            f"recorded after the {sub['relation']}.")
                    a["ownership_events"] = [e for e in a["ownership_events"] if e["role"] != "current_owner"]
        if fi == special["stale"]:
            for a in fam_assets:
                a["last_status_check"] = datetime.combine(as_of - timedelta(days=46), datetime.min.time())
        assets.extend(fam_assets)
    return {"families": families, "assets": assets, "tech": tech_key}


def _asset(r, tech, cpc, cpc_label, trend, title, pub, appno, jur, kind, filing, priority, grant, exp, status, rel,
           inventors, original_applicant, owner, sub, as_of, customer_data, standards, fi, source=SRC_USPTO):
    now = datetime.combine(as_of, datetime.min.time()) + timedelta(hours=6)
    age_years = max(0.5, (as_of - (grant or filing)).days / 365.25)
    med = max(1, int(round(age_years * 1.4)))
    quality = r.random()
    fwd = int(max(0, r.gauss(med * (0.5 + 2.2 * quality), med * 0.6))) if grant else int(r.random() * 2)
    comp_names = r.sample(tech["competitors"], k=r.randint(0, 3)) if quality > 0.35 else []
    comp_cit = len(comp_names) + (r.randint(0, 3) if comp_names else 0)
    signals = {
        "independent_claims": r.choice([1, 2, 2, 3, 3, 4, 5]),
        "total_claims": r.randint(10, 30),
        "claim1_words": r.randint(70, 280),
        "claim_scope_reduction": round(r.uniform(0, 0.65), 2) if grant else round(r.uniform(0, 0.3), 2),
        "rce_count": r.choice([0, 0, 0, 1, 1, 2, 3]),
        "office_actions": r.randint(1, 5),
        "expected_remaining_office_actions": round(r.uniform(0.5, 2.5), 1) if status == "pending" else 0,
        "forward_citations": fwd,
        "cohort_citation_median": med,
        "competitor_citations": comp_cit if r.random() > 0.15 else None,
        "competitor_names": comp_names,
        "standards_relevance": (r.choice(["declared", "candidate", "none", "none"]) if standards else
                                (r.choice(["none", "none", None]))),
        "public_product_evidence": ([{"product": p, "source": "Public product page (synthetic demo)"} for p in r.sample(tech["products"], k=r.randint(1, 2))]
                                    if r.random() < 0.28 else []),
        "licensing_history": (r.choice(["licensed", "offered", "none", "none", "none", "none", None]) if customer_data else None),
        "evidence_of_use_leads": (r.choice([None, None, 0, 1, 2, 3]) if customer_data else None),
        "tech_trend_growth": trend,
        "cpc_label": cpc_label,
    }
    if jur != "US":
        for k in ("claim1_words",):
            signals[k] = None if r.random() < 0.5 else signals[k]
    product_mappings = None
    cinputs = {}
    obligations = []
    if customer_data and jur == "US" and r.random() < 0.85:
        if r.random() < 0.3:
            product_mappings = []
        else:
            product_mappings = [{"product": p, "lifecycle": r.choice(["growth", "mature", "mature", "sunset", "discontinued"]),
                                 "revenue_band": r.choice(["high", "medium", "low"]), "confirmed_use": r.random() > 0.15}
                                for p in r.sample(tech["products"], k=r.choice([1, 1, 2]))]
        cinputs = {"strategic_priority": r.choice(["core", "defensive", "defensive", "non_core", "non_core"]),
                   "fto_relevance": r.random() < 0.2,
                   "roadmap_relevance": r.choice(["high", "medium", "low", None])}
    if signals["standards_relevance"] == "declared":
        obligations.append({"type": "standards", "detail": "FRAND licensing declaration recorded with a standards body (synthetic)"})
    if customer_data and r.random() < 0.05:
        obligations.append({"type": "licence", "detail": f"Exclusive field-of-use licence to {r.choice(tech['competitors'])} until {as_of.year + r.randint(1, 4)}"})
    if customer_data and r.random() < 0.03:
        obligations.append({"type": "litigation", "detail": "Asserted in pending infringement action (synthetic)"})

    events = []
    for inv in inventors:
        events.append({"assignee": inv, "role": "inventor", "event_type": "Inventor of record", "effective_date": filing,
                       "source_id": source, "confidence": 0.98})
    events.append({"assignee": original_applicant, "role": "original_applicant", "event_type": "Assignment by inventors",
                   "effective_date": filing + timedelta(days=r.randint(5, 60)), "source_id": SRC_ASSIGN, "confidence": 0.95})
    current_owner = owner
    if sub and original_applicant != owner:
        events.append({"assignee": owner, "role": "recorded_assignee", "event_type": f"Merger / assignment ({sub['relation']})",
                       "effective_date": date(sub["year"], r.randint(1, 12), r.randint(1, 28)), "source_id": SRC_ASSIGN, "confidence": 0.9})
    events.append({"assignee": owner, "role": "current_owner", "event_type": "Current owner (latest recorded assignee)",
                   "effective_date": None, "source_id": SRC_ASSIGN, "confidence": 0.9})

    snaps = [{"status": status, "status_date": grant or filing, "source_id": source, "retrieved_at": now}]

    evidence = []

    def ev(dim, etype, src, date_, excerpt, rel_, dir_, pol):
        evidence.append({"dimension": dim, "evidence_type": etype, "source_name": src, "source_uri": f"synthetic://{pub}/{etype}",
                         "source_date": date_, "excerpt": excerpt, "reliability": rel_, "directness": dir_, "polarity": pol})

    ev("claim_quality", "claims", source, grant or filing,
       f"{signals['independent_claims']} independent / {signals['total_claims']} total claims; claim 1 is {signals['claim1_words']} words.", 0.95, 0.8, 0)
    if grant:
        ev("claim_quality", "prosecution_history", source, grant,
           f"{signals['office_actions']} office action(s), {signals['rce_count']} RCE(s); estimated scope narrowing {int(signals['claim_scope_reduction'] * 100)}%.",
           0.95, 0.7, -1 if signals["claim_scope_reduction"] > 0.4 else 1)
    ev("competitive", "citations", "Forward-citation records, CPC/year cohort (synthetic demo)", as_of - timedelta(days=20),
       f"{fwd} forward citations; cohort median {med} for {cpc} / {(grant or filing).year}.", 0.9, 0.5, 1 if fwd > med else -1)
    if signals["competitor_citations"]:
        ev("competitive", "competitor_citations", "Citing-document assignee analysis (synthetic demo)", as_of - timedelta(days=20),
           f"Cited by: {', '.join(comp_names)}.", 0.9, 0.7, 1)
    if signals["standards_relevance"] in ("declared", "candidate"):
        ev("competitive", "standards", "Standards IPR declaration database (synthetic demo)", as_of - timedelta(days=200),
           f"Standards relevance: {signals['standards_relevance']}.", 0.9, 0.8, 1)
    if product_mappings is not None:
        ev("commercial", "product_mapping", SRC_CUST, as_of - timedelta(days=75),
           ("; ".join(f"{m['product']} — {m['lifecycle']}, {m['revenue_band']} revenue" for m in product_mappings) or "No mapped product confirmed by business unit."),
           0.85, 0.9, 1 if product_mappings else -1)
    for pe in signals["public_product_evidence"]:
        ev("commercial", "public_product", pe["source"], as_of - timedelta(days=r.randint(30, 500)),
           f"Product page for {pe['product']} describes features overlapping the claimed subject-matter (not verified claim mapping).", 0.6, 0.45, 1)
    if cinputs.get("strategic_priority"):
        ev("strategic", "strategy_tag", SRC_STRAT, as_of - timedelta(days=120), f"Business strategy tag: {cinputs['strategic_priority']}.", 0.85, 0.85, 0)
    ev("portfolio", "classification", "Portfolio classification analysis (derived)", as_of, f"Primary CPC {cpc} ({cpc_label}).", 0.8, 0.7, 0)
    if signals["licensing_history"] is not None:
        ev("licensing", "licensing_register", SRC_LIC, as_of - timedelta(days=60), f"Licensing history: {signals['licensing_history']}.", 0.85, 0.85, 0)
    if signals["evidence_of_use_leads"]:
        ev("licensing", "eou_lead", "Evidence-of-use lead (unverified, synthetic demo)", as_of - timedelta(days=r.randint(20, 300)),
           f"{signals['evidence_of_use_leads']} third-party product(s) flagged for claim-chart review.", 0.5, 0.5, 1)
    ev("future", "trend", "CPC filing-trend statistics (synthetic demo)", as_of - timedelta(days=40), f"{cpc_label}: {trend:+d}% filings over 5 years.", 0.7, 0.4, 1 if trend > 10 else -1 if trend < -5 else 0)

    actuals = []
    if customer_data and jur == "US" and r.random() < 0.6:
        actuals.append({"category": "Prosecution (historical, invoiced)", "amount": str(r.randint(8, 32) * 500), "currency": "USD",
                        "incurred_on": grant or filing, "source_id": "Customer outside-counsel invoices"})
        if grant and (as_of - grant).days > 4 * 365 and status == "active":
            actuals.append({"category": "3.5-year maintenance fee (paid)", "amount": "2000", "currency": "USD",
                            "incurred_on": add_months(grant, 41), "source_id": "Customer annuity records"})

    return {
        "publication_number": pub, "application_number": appno, "jurisdiction": jur, "kind_code": kind,
        "title": title, "abstract": f"A {title.lower()} for {tech['label'].lower()} applications, addressing {cpc_label.lower()}. (Synthetic demo abstract.)",
        "cpc": cpc, "technology": cpc_label, "filing_date": filing, "priority_date": priority, "grant_date": grant,
        "expiry_estimate": exp, "status": status, "status_conflict": None, "relationship_type": rel,
        "parent_publication": None, "inventors": inventors, "original_applicant": original_applicant,
        "current_owner": current_owner, "owner_confidence": 0.9, "ownership_issue": None, "entity_size": "large",
        "signals": signals, "obligations": obligations, "product_mappings": product_mappings, "customer_inputs": cinputs,
        "ownership_events": events, "status_snapshots": snaps, "evidence": evidence, "cost_actuals": actuals,
        "last_status_check": now, "data_as_of": now,
    }
