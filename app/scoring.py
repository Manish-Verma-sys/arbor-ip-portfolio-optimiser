"""Deterministic, explainable scoring (spec section 5).

Key rules implemented here:
  * Seven dimensions rated 0-5 or UNKNOWN; UNKNOWN is excluded from the numerator AND denominator.
  * Score = 100 * sum(W_i * R_i / 5) / sum(W_i) over known dimensions.
  * Data coverage = share of weight with a known rating. Evidence confidence is computed separately
    from source reliability, recency, directness and consistency - never from model self-reports.
  * Hard gates can block or force review regardless of score.
  * The same inputs + config always produce the same output.
"""
from __future__ import annotations

import hashlib
import json
from datetime import date, datetime
from typing import Optional

DIMENSIONS = [
    ("commercial", "Commercial and product relevance"),
    ("claim_quality", "Claim quality and practical protection"),
    ("competitive", "Competitive and market relevance"),
    ("strategic", "Strategic and defensive value"),
    ("portfolio", "Portfolio contribution"),
    ("licensing", "Licensing and monetisation potential"),
    ("future", "Future option value"),
]
DIM_LABEL = dict(DIMENSIONS)

DEFAULT_WEIGHTS = {"commercial": 25, "claim_quality": 20, "competitive": 15, "strategic": 15,
                   "portfolio": 10, "licensing": 10, "future": 5}

DEFAULT_THRESHOLDS = {
    "strong_retain": 80,
    "retain_monitor": 65,
    "strategic_review": 45,
    "coverage_min": 70,
    "confidence_min": 50,
}

DEFAULT_GATES = {
    "deadline_warning_days": 120,
    "stale_status_days": 30,
    "min_owner_confidence": 0.6,
}

RECOMMENDATIONS = {
    "strong_retain": "Strong retain candidate",
    "retain_monitor": "Retain / monitor",
    "strategic_review": "Strategic review",
    "abandonment_review_candidate": "Abandonment review candidate",
    "insufficient_evidence": "Insufficient evidence",
    "blocked": "Blocked — resolve gate",
    "not_in_force": "Not in force — review family",
}

REQUIRED_HANDLING = {
    "strong_retain": "Verify cost, ownership, status, family and strategic dependencies.",
    "retain_monitor": "Review cost trends and refresh commercial evidence.",
    "strategic_review": "Request missing business inputs; compare alternative assets and family-level protection.",
    "abandonment_review_candidate": "Human-led legal and business review required; never automatically abandon.",
    "insufficient_evidence": "Supply the missing inputs listed below before any portfolio decision.",
    "blocked": "Resolve the blocking gate (ownership/status) before any recommendation can be issued.",
    "not_in_force": "Confirm status with the official register; check reinstatement windows and remaining family protection.",
}

MISSING_INPUT_HINTS = {
    "commercial": "Upload a patent-to-product mapping (product, lifecycle, revenue band, confirmed use).",
    "claim_quality": "Provide claim data (independent claims, claim 1 length, prosecution narrowing) or a counsel claim review.",
    "competitive": "Add at least two competitive signals (normalised citations, competitor citing docs, standards relevance).",
    "strategic": "Record the business strategy tag (core / defensive / non-core) and FTO or roadmap relevance.",
    "portfolio": "Provide CPC classification and family membership so uniqueness and redundancy can be assessed.",
    "licensing": "Record licensing history or evidence-of-use leads.",
    "future": "Provide technology classification so emerging-market signals can be assessed.",
}

NOT_IN_FORCE = ("expired", "abandoned", "lapsed", "withdrawn")


def clamp(v, lo=0, hi=5):
    return max(lo, min(hi, v))


# ---------------------------------------------------------------- core formula

def weighted_score(ratings: dict, weights: dict) -> tuple[Optional[float], float]:
    """Return (score 0-100 or None, coverage %)."""
    total_w = sum(weights.values()) or 1
    known = {d: r for d, r in ratings.items() if r is not None and d in weights}
    wk = sum(weights[d] for d in known)
    coverage = round(100.0 * wk / total_w, 1)
    if wk == 0:
        return None, coverage
    s = 100.0 * sum(weights[d] * (r / 5.0) for d, r in known.items()) / wk
    return round(s, 1), coverage


def band(score: Optional[float], thr: dict) -> str:
    if score is None:
        return "insufficient_evidence"
    if score >= thr["strong_retain"]:
        return "strong_retain"
    if score >= thr["retain_monitor"]:
        return "retain_monitor"
    if score >= thr["strategic_review"]:
        return "strategic_review"
    return "abandonment_review_candidate"


# ---------------------------------------------------------------- dimension rating rules

def _rate_commercial(a: dict):
    maps = a.get("product_mappings")
    sig = a.get("signals") or {}
    public = sig.get("public_product_evidence") or []
    roadmap = (a.get("customer_inputs") or {}).get("roadmap_relevance")
    if maps is None:
        if public:
            r = 3 if len(public) >= 2 else 2
            return r, (f"No customer mapping; {len(public)} public product reference(s) suggest use "
                       f"({', '.join(p['product'] for p in public[:2])}). Indirect evidence — confirm with business unit."), "public"
        return None, "No product mapping supplied. Absence of public product evidence is not proof of no use.", None
    if len(maps) == 0:
        r = 0 if roadmap == "low" else 1
        return r, "Customer mapping confirms no current product practises this patent" + (" and roadmap relevance is low." if r == 0 else "."), "customer"
    life = {"growth": 5, "mature": 4, "sunset": 2, "discontinued": 1}
    best = 0
    for m in maps:
        v = life.get(m.get("lifecycle"), 3)
        if m.get("revenue_band") == "low":
            v -= 1
        if m.get("confirmed_use") is False:
            v -= 1
        best = max(best, v)
    if len(maps) >= 2:
        best += 1
    r = clamp(best)
    names = ", ".join(f"{m['product']} ({m.get('lifecycle', 'n/a')}, {m.get('revenue_band', 'n/a')} revenue)" for m in maps[:3])
    return r, f"Mapped to {len(maps)} product(s): {names}.", "customer"


def _rate_claims(a: dict):
    s = a.get("signals") or {}
    if s.get("independent_claims") is None or s.get("claim1_words") is None:
        return None, "Claim data unavailable.", None
    r = 3
    why = []
    if s["independent_claims"] >= 3:
        r += 1; why.append(f"{s['independent_claims']} independent claims give layered protection")
    elif s["independent_claims"] == 1:
        r -= 1; why.append("single independent claim")
    if s["claim1_words"] < 120:
        r += 1; why.append(f"concise claim 1 ({s['claim1_words']} words) suggests broader scope")
    elif s["claim1_words"] > 220:
        r -= 1; why.append(f"long claim 1 ({s['claim1_words']} words) suggests narrow scope")
    red = s.get("claim_scope_reduction")
    if red is not None and red > 0.4:
        r -= 1; why.append(f"claim scope narrowed ~{int(red * 100)}% during prosecution")
    if (s.get("rce_count") or 0) >= 2:
        r -= 1; why.append(f"{s['rce_count']} RCEs indicate contested allowability")
    r = clamp(r)
    if a.get("status") == "pending":
        r = min(r, 3)
        why.append("pending — claims not final (capped at 3)")
    return r, "; ".join(why).capitalize() + ". Signals only — enforceability conclusions require counsel.", "derived"


def _rate_competitive(a: dict):
    s = a.get("signals") or {}
    signals = 0
    r = 2
    why = []
    fc, med = s.get("forward_citations"), s.get("cohort_citation_median")
    if fc is not None and med is not None:
        signals += 1
        ratio = fc / max(med, 1)
        if ratio >= 3:
            r += 2
        elif ratio >= 1.5:
            r += 1
        elif ratio < 0.5:
            r -= 1
        why.append(f"{fc} forward citations vs cohort median {med} ({ratio:.1f}x, normalised by CPC/year)")
    cc = s.get("competitor_citations")
    if cc is not None:
        signals += 1
        if cc >= 3:
            r += 1
        why.append(f"cited by competitors {cc} time(s)" + (f" ({', '.join(s.get('competitor_names', [])[:3])})" if cc else ""))
    sr = s.get("standards_relevance")
    if sr is not None:
        signals += 1
        if sr == "declared":
            r += 2; why.append("declared standard-essential candidate")
        elif sr == "candidate":
            r += 1; why.append("possible standards relevance")
        else:
            why.append("no standards relevance identified")
    if signals < 2:
        return None, "Fewer than two competitive signals available; citations alone are a weak proxy and are not used in isolation.", None
    return clamp(r), "; ".join(why).capitalize() + ".", "derived"


def _rate_strategic(a: dict):
    ci = a.get("customer_inputs") or {}
    pri = ci.get("strategic_priority")
    obligations = a.get("obligations") or []
    if pri is None and not obligations:
        return None, "No customer-supplied strategy input; strategic value is never inferred without evidence.", None
    base = {"core": 5, "defensive": 4, "non_core": 1}.get(pri, 2)
    why = [f"strategy tag: {pri.replace('_', '-')}" if pri else "no strategy tag"]
    if ci.get("fto_relevance"):
        base += 1; why.append("FTO / blocking relevance noted")
    if any(o.get("type") == "standards" for o in obligations):
        base = max(base, 3); why.append("standards commitment")
    if ci.get("roadmap_relevance") == "high":
        base += 1; why.append("high roadmap relevance")
    return clamp(base), "; ".join(why).capitalize() + ".", "customer"


def _rate_portfolio(a: dict, ctx: dict):
    cpc = a.get("cpc")
    if not cpc:
        return None, "No classification available to assess uniqueness.", None
    group = cpc.split("/")[0]
    others = ctx.get("cpc_group_active", {}).get(group, 0) - (1 if a.get("status") in ("active", "pending") else 0)
    if others <= 0:
        r = 4; why = ["unique technology coverage in this portfolio (no other in-force asset in " + group + ")"]
    elif others <= 2:
        r = 3; why = [f"{others} other in-force asset(s) in {group}"]
    elif others <= 5:
        r = 2; why = [f"{others} other in-force assets in {group} — partial redundancy"]
    else:
        r = 1; why = [f"{others} other in-force assets in {group} — high redundancy"]
    fam = ctx.get("family", {})
    if fam.get("sole_in_force_us"):
        r += 1; why.append("sole in-force US member of its family")
    if fam.get("pending_children"):
        r += 1; why.append(f"{fam['pending_children']} pending continuation(s) depend on this disclosure")
    if fam.get("same_jur_in_force_siblings", 0) >= 2:
        r -= 1; why.append("multiple in-force siblings in same jurisdiction")
    return clamp(r), "; ".join(why).capitalize() + ".", "derived"


def _rate_licensing(a: dict):
    s = a.get("signals") or {}
    hist = s.get("licensing_history")
    leads = s.get("evidence_of_use_leads")
    cc = s.get("competitor_citations")
    if hist is None and leads is None:
        return None, "No licensing history or evidence-of-use leads supplied.", None
    why = []
    if hist == "licensed":
        r = 5; why.append("currently licensed (customer record)")
    elif hist == "offered":
        r = 3; why.append("previously offered for licence")
    else:
        r = 1; why.append("no licensing history")
    if leads:
        r = max(r, 4 if leads >= 2 else 3); why.append(f"{leads} evidence-of-use lead(s) — unverified, uncertainty high")
    elif cc and cc >= 3 and r < 2:
        r = 2; why.append("competitor citations suggest potential counterparties")
    return clamp(r), "; ".join(why).capitalize() + ".", "derived"


def _rate_future(a: dict, as_of: date):
    s = a.get("signals") or {}
    trend = s.get("tech_trend_growth")
    if trend is None:
        return None, "No technology trend signal.", None
    if a.get("status") in NOT_IN_FORCE:
        return 0, "Not in force — no remaining term to carry future options.", "derived"
    r = 4 if trend > 30 else 3 if trend > 10 else 2 if trend > -10 else 1
    why = [f"filings in this CPC area changed {trend:+.0f}% over 5 years"]
    exp = a.get("expiry_estimate")
    if exp:
        yrs = (exp - as_of).days / 365.25
        if yrs < 3:
            r -= 1; why.append(f"only ~{yrs:.1f} years of term remain")
        else:
            why.append(f"~{yrs:.0f} years of term remain")
    if (a.get("customer_inputs") or {}).get("roadmap_relevance") == "high":
        r += 1; why.append("on documented product roadmap")
    return clamp(r), "; ".join(why).capitalize() + ".", "derived"


def derive_ratings(a: dict, ctx: dict, analyst_inputs: dict, as_of: date) -> dict:
    out = {}
    raw = {
        "commercial": _rate_commercial(a),
        "claim_quality": _rate_claims(a),
        "competitive": _rate_competitive(a),
        "strategic": _rate_strategic(a),
        "portfolio": _rate_portfolio(a, ctx),
        "licensing": _rate_licensing(a),
        "future": _rate_future(a, as_of),
    }
    for dim, (rating, rationale, basis) in raw.items():
        entry = {"rating": rating, "rationale": rationale, "basis": basis, "derived_rating": rating}
        ai = analyst_inputs.get(dim)
        if ai is not None:
            entry.update({"rating": ai["rating"], "basis": "analyst",
                          "rationale": f"Analyst input: {ai['rationale']}" + (f" (source: {ai['source']})" if ai.get("source") else ""),
                          "analyst": ai})
        out[dim] = entry
    return out


# ---------------------------------------------------------------- confidence

def _recency(src_date: Optional[date], as_of: date) -> float:
    if not src_date:
        return 0.7
    age = (as_of - src_date).days / 365.25
    return 1.0 if age < 1 else 0.9 if age < 3 else 0.8 if age < 5 else 0.65


def evidence_confidence(dims: dict, evidence: list[dict], weights: dict, a: dict, as_of: date, gates_cfg: dict) -> tuple[float, list[str]]:
    by_dim: dict[str, list[float]] = {}
    pol: dict[str, set] = {}
    for e in evidence:
        q = e["reliability"] * e["directness"] * _recency(e.get("source_date"), as_of)
        by_dim.setdefault(e["dimension"], []).append(q)
        if e.get("polarity"):
            pol.setdefault(e["dimension"], set()).add(e["polarity"])
    num = den = 0.0
    notes = []
    for d, info in dims.items():
        if info["rating"] is None:
            continue
        if info["basis"] == "analyst":
            q = 0.75
        else:
            qs = by_dim.get(d)
            q = sum(qs) / len(qs) if qs else 0.45
        if len(pol.get(d, ())) > 1:
            q *= 0.8
            notes.append(f"Mixed-direction evidence on {DIM_LABEL[d].lower()}")
        num += weights[d] * q
        den += weights[d]
    conf = 100.0 * num / den if den else 0.0
    if a.get("status_conflict"):
        conf -= 15; notes.append("Conflicting legal status between sources (-15)")
    if a.get("ownership_issue") or (a.get("owner_confidence") or 0) < gates_cfg["min_owner_confidence"]:
        conf -= 15; notes.append("Ownership not verified (-15)")
    lsc = a.get("last_status_check")
    if lsc and (as_of - lsc.date()).days > gates_cfg["stale_status_days"]:
        conf -= 10; notes.append("Legal status not rechecked recently (-10)")
    return round(max(0.0, min(100.0, conf)), 1), notes


# ---------------------------------------------------------------- gates

def evaluate_gates(a: dict, ctx: dict, cost: dict, as_of: date, gates_cfg: dict) -> list[dict]:
    g = []
    status = a.get("status")
    if not a.get("current_owner") or (a.get("owner_confidence") or 0) < gates_cfg["min_owner_confidence"] or a.get("ownership_issue"):
        g.append({"code": "OWNERSHIP_UNRESOLVED", "severity": "block",
                  "message": a.get("ownership_issue") or "Current legal owner is unknown or unverified. Resolve before any recommendation."})
    if a.get("status_conflict"):
        sc = a["status_conflict"]
        g.append({"code": "STATUS_CONFLICT", "severity": "block",
                  "message": f"Sources disagree on legal status: {sc.get('summary', '')}. Recheck the official register."})
    if status in (None, "", "unknown"):
        g.append({"code": "STATUS_UNKNOWN", "severity": "block", "message": "Legal status unknown."})
    if status == "pending":
        g.append({"code": "PENDING_PROSECUTION", "severity": "review",
                  "message": "Pending application — prosecution review required before abandonment is considered."})
    if status in NOT_IN_FORCE:
        g.append({"code": "NOT_IN_FORCE", "severity": "review",
                  "message": f"Recorded status is '{status}'. A status label alone is not proof of strategic worthlessness — check reinstatement and family coverage."})
    nd = (cost or {}).get("next_deadline")
    if nd and nd.get("state") != "estimate":
        days = (date.fromisoformat(nd["date"]) - as_of).days
        if nd.get("state") == "in_grace":
            g.append({"code": "IN_GRACE_PERIOD", "severity": "review",
                      "message": f"Maintenance fee in grace period; surcharge applies and right lapses after {nd['date']} ({days} days)."})
        elif days <= gates_cfg["deadline_warning_days"]:
            g.append({"code": "DEADLINE_IMMINENT", "severity": "review",
                      "message": f"{nd['label']} due {nd['date']} ({days} days). Recheck authoritative data now."})
    for o in a.get("obligations") or []:
        g.append({"code": f"OBLIGATION_{o['type'].upper()}", "severity": "review",
                  "message": f"Known {o['type']} obligation: {o.get('detail', '')}. Human review required."})
    fam = ctx.get("family", {})
    if fam.get("pending_children") or fam.get("in_force_children"):
        g.append({"code": "FAMILY_DEPENDENCY", "severity": "warn",
                  "message": f"Parent of {fam.get('in_force_children', 0)} in-force and {fam.get('pending_children', 0)} pending continuation(s); dropping it does not remove their protection but may affect terminal disclaimers and priority."})
    if fam.get("sole_in_force_us") and fam.get("in_force_foreign"):
        g.append({"code": "JURISDICTION_IMPACT", "severity": "warn",
                  "message": f"Sole in-force US member; family retains protection in {', '.join(fam['in_force_foreign'])}."})
    elif fam.get("sole_in_force_us"):
        g.append({"code": "JURISDICTION_IMPACT", "severity": "warn",
                  "message": "Sole in-force member of the family — abandoning it ends all family protection."})
    lsc = a.get("last_status_check")
    if lsc and (as_of - lsc.date()).days > gates_cfg["stale_status_days"]:
        g.append({"code": "STALE_STATUS", "severity": "review",
                  "message": f"Legal status last checked {lsc.date().isoformat()}; mandatory recheck before final decision."})
    return g


def gate_status(gates: list[dict]) -> str:
    sev = {x["severity"] for x in gates}
    return "BLOCK" if "block" in sev else "REVIEW" if "review" in sev else "PASS"


# ---------------------------------------------------------------- sensitivity

def _shift_weights(weights: dict, dim: str, delta: int) -> dict:
    w = dict(weights)
    new = max(0, w[dim] + delta)
    rest = sum(v for k, v in w.items() if k != dim)
    if rest == 0:
        return w
    scale = (100 - new) / rest
    out = {k: (v * scale if k != dim else new) for k, v in w.items()}
    return out


def sensitivity(ratings: dict, weights: dict, thr: dict, delta: int = 5) -> list[dict]:
    base_score, _ = weighted_score(ratings, weights)
    base_band = band(base_score, thr)
    changes = []
    for d in weights:
        for sign in (-1, 1):
            w2 = _shift_weights(weights, d, sign * delta)
            s2, _ = weighted_score(ratings, w2)
            b2 = band(s2, thr)
            if b2 != base_band:
                changes.append({"dimension": d, "delta": sign * delta, "score": s2, "recommendation": b2})
    return changes


# ---------------------------------------------------------------- main entry

def score_asset(a: dict, ctx: dict, evidence: list[dict], analyst_inputs: dict, cost: dict,
                config: dict, as_of: date) -> dict:
    weights = config["weights"]
    thr = {**DEFAULT_THRESHOLDS, **config.get("thresholds", {})}
    gcfg = {**DEFAULT_GATES, **config.get("gates", {})}

    dims = derive_ratings(a, ctx, analyst_inputs, as_of)
    ratings = {d: v["rating"] for d, v in dims.items()}
    score, coverage = weighted_score(ratings, weights)
    conf, conf_notes = evidence_confidence(dims, evidence, weights, a, as_of, gcfg)
    gates = evaluate_gates(a, ctx, cost, as_of, gcfg)
    gstat = gate_status(gates)

    score_band = band(score, thr)
    if gstat == "BLOCK":
        rec = "blocked"
    elif a.get("status") in NOT_IN_FORCE:
        rec = "not_in_force"
    elif coverage < thr["coverage_min"] or conf < thr["confidence_min"] or score is None:
        rec = "insufficient_evidence"
    else:
        rec = score_band
    # Abandonment candidates with live continuation children always need review
    if rec == "abandonment_review_candidate" and ctx.get("family", {}).get("pending_children"):
        for gt in gates:
            if gt["code"] == "FAMILY_DEPENDENCY":
                gt["severity"] = "review"
        gstat = gate_status(gates)

    # ---- explanation
    contrib = []
    for d, v in dims.items():
        if v["rating"] is not None:
            contrib.append((d, v["rating"], weights[d]))
    positives = sorted([c for c in contrib if c[1] >= 3], key=lambda c: -(c[1] - 2.5) * c[2])[:3]
    negatives = sorted([c for c in contrib if c[1] <= 2], key=lambda c: -(2.5 - c[1]) * c[2])[:3]
    pos = [{"dimension": d, "rating": r, "weight": w, "text": f"{DIM_LABEL[d]} rated {r}/5 — {dims[d]['rationale']}"} for d, r, w in positives]
    neg = [{"dimension": d, "rating": r, "weight": w, "text": f"{DIM_LABEL[d]} rated {r}/5 — {dims[d]['rationale']}"} for d, r, w in negatives]
    t5 = (cost.get("totals") or {}).get("5", {}).get("total")
    if t5 and float(t5) >= 8000:
        neg.append({"dimension": "cost", "text": f"High 5-year forward cost of ${float(t5):,.0f}."})
    missing = [{"dimension": d, "weight": weights[d], "label": DIM_LABEL[d], "hint": MISSING_INPUT_HINTS[d], "reason": v["rationale"]}
               for d, v in dims.items() if v["rating"] is None]
    what_changes = []
    for m in missing:
        lo, _ = weighted_score({**ratings, m["dimension"]: 0}, weights)
        hi, _ = weighted_score({**ratings, m["dimension"]: 5}, weights)
        what_changes.append(f"Supplying {m['label'].lower()} evidence would move the score into the range {lo:.0f}–{hi:.0f} and raise coverage by {m['weight']} points.")
    if score is not None:
        bounds = [(thr["strong_retain"], "Strong retain"), (thr["retain_monitor"], "Retain / monitor"), (thr["strategic_review"], "Strategic review")]
        nearest = min(bounds, key=lambda b: abs(score - b[0]))
        what_changes.append(f"Score is {abs(score - nearest[0]):.1f} points {'above' if score >= nearest[0] else 'below'} the '{nearest[1]}' threshold ({nearest[0]}).")
    sens = sensitivity(ratings, weights, thr) if score is not None else []
    if sens:
        what_changes.append(f"Recommendation is weight-sensitive: a ±5 point weight change on {len({s['dimension'] for s in sens})} dimension(s) changes the category.")
    if gstat != "PASS":
        what_changes.append("Resolving the gate(s) listed is required before this recommendation can be finalised.")

    return {
        "dimension_scores": dims,
        "strategic_score": score,
        "score_band": score_band,
        "data_coverage": coverage,
        "evidence_confidence": conf,
        "confidence_notes": conf_notes,
        "recommendation": rec,
        "gate_status": gstat,
        "gate_reasons": gates,
        "explanation": {
            "positives": pos,
            "negatives": neg[:4],
            "missing": missing,
            "what_could_change": what_changes,
            "sensitivity": sens,
            "required_handling": REQUIRED_HANDLING[rec],
        },
    }


def snapshot_hash(obj) -> str:
    def default(o):
        if isinstance(o, (date, datetime)):
            return o.isoformat()
        return str(o)
    return hashlib.sha256(json.dumps(obj, sort_keys=True, default=default).encode()).hexdigest()


def validate_weights(weights: dict) -> dict:
    if set(weights) != set(DEFAULT_WEIGHTS):
        raise ValueError("Weights must cover exactly the seven dimensions.")
    if any((not isinstance(v, (int, float))) or v < 0 for v in weights.values()):
        raise ValueError("Weights must be non-negative numbers.")
    total = sum(weights.values())
    if abs(total - 100) > 0.01:
        raise ValueError(f"Weights must sum to 100 (got {total}).")
    return weights
