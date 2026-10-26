"""Deterministic cost engine (spec FR-08, section 8: cost engine is rules-based, never LLM).

Official US maintenance fees are applied from versioned fee schedules keyed by effective date.
Professional/administrative costs are configurable assumptions and are always labelled as estimates.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal
from typing import Optional

TWO = Decimal("0.01")


def money(v) -> Decimal:
    return Decimal(str(v)).quantize(TWO, rounding=ROUND_HALF_UP)


def add_months(d: date, months: int) -> date:
    y = d.year + (d.month - 1 + months) // 12
    m = (d.month - 1 + months) % 12 + 1
    # clamp day
    for day in (d.day, 30, 29, 28):
        try:
            return date(y, m, day)
        except ValueError:
            continue
    raise ValueError("bad date")


@dataclass(frozen=True)
class FeeSchedule:
    version: str
    jurisdiction: str
    effective_from: date
    maintenance: dict  # stage -> {large, small, micro}
    grace_surcharge: dict  # entity -> amount
    source: str


# Versioned official fee schedules. Amounts in USD.
FEE_SCHEDULES: list[FeeSchedule] = [
    FeeSchedule(
        version="US-2020-10-02",
        jurisdiction="US",
        effective_from=date(2020, 10, 2),
        maintenance={
            "3.5": {"large": "2000", "small": "1000", "micro": "500"},
            "7.5": {"large": "3760", "small": "1880", "micro": "940"},
            "11.5": {"large": "7700", "small": "3850", "micro": "1925"},
        },
        grace_surcharge={"large": "500", "small": "250", "micro": "125"},
        source="USPTO fee schedule effective 2 Oct 2020 (37 CFR 1.20)",
    ),
    FeeSchedule(
        version="US-2025-01-19",
        jurisdiction="US",
        effective_from=date(2025, 1, 19),
        maintenance={
            "3.5": {"large": "2150", "small": "860", "micro": "430"},
            "7.5": {"large": "4040", "small": "1616", "micro": "808"},
            "11.5": {"large": "8280", "small": "3312", "micro": "1656"},
        },
        grace_surcharge={"large": "540", "small": "216", "micro": "108"},
        source="USPTO fee schedule effective 19 Jan 2025 (37 CFR 1.20)",
    ),
]

STAGES = [("3.5", 36, 42, 48), ("7.5", 84, 90, 96), ("11.5", 132, 138, 144)]  # stage, window opens, due, grace end (months after grant)

DEFAULT_COST_ASSUMPTIONS = {
    "currency": "USD",
    "annuity_service_fee_per_payment": "150",
    "office_action_response_cost": "3500",
    "issue_fee_large": "1290",
    "issue_fee_prep_cost": "400",
    "expected_months_to_grant": 14,
    "foreign_member_annual_estimate": None,  # None = unknown; no fee schedule configured for non-US in MVP
    "assumption_version": "cost-assumptions-v1",
}


def schedule_for(jurisdiction: str, on: date) -> Optional[FeeSchedule]:
    candidates = [s for s in FEE_SCHEDULES if s.jurisdiction == jurisdiction and s.effective_from <= on]
    if not candidates:
        candidates = [s for s in FEE_SCHEDULES if s.jurisdiction == jurisdiction]
        return min(candidates, key=lambda s: s.effective_from) if candidates else None
    return max(candidates, key=lambda s: s.effective_from)


def _current_schedule(on: date) -> FeeSchedule:
    return schedule_for("US", on)


def maintenance_events(grant_date: date, expiry: Optional[date], entity_size: str, as_of: date) -> list[dict]:
    """All US maintenance-fee events for a granted utility patent, with their state relative to as_of."""
    events = []
    entity = entity_size if entity_size in ("large", "small", "micro") else "large"
    for stage, open_m, due_m, grace_m in STAGES:
        window_open = add_months(grant_date, open_m)
        due = add_months(grant_date, due_m)
        grace_end = add_months(grant_date, grace_m)
        if expiry and window_open >= expiry:
            continue
        if grace_end < as_of:
            state = "past"
        elif due < as_of <= grace_end:
            state = "in_grace"
        elif window_open <= as_of <= due:
            state = "payable_now"
        else:
            state = "upcoming"
        # Fees are charged at the schedule in force when paid; we assume payment on the due date
        # (or today, if already in the grace period).
        pay_on = as_of if state in ("in_grace",) else max(due, as_of) if state != "past" else due
        sched = _current_schedule(pay_on)
        fee = money(sched.maintenance[stage][entity])
        surcharge = money(sched.grace_surcharge[entity]) if state == "in_grace" else money(0)
        events.append({
            "type": "maintenance_fee",
            "stage": stage,
            "window_open": window_open.isoformat(),
            "due_date": due.isoformat(),
            "grace_end": grace_end.isoformat(),
            "state": state,
            "official_fee": str(fee),
            "surcharge": str(surcharge),
            "schedule_version": sched.version,
            "schedule_source": sched.source,
        })
    return events


def forecast(asset: dict, as_of: date, horizons: list[int], assumptions: dict | None = None) -> dict:
    """Forward cost forecast for one asset.

    asset keys: jurisdiction, status, grant_date, expiry_estimate, entity_size, kind_code, signals
    Returns totals per horizon split into official vs professional, plus itemised events.
    """
    a = {**DEFAULT_COST_ASSUMPTIONS, **(assumptions or {})}
    jur = asset.get("jurisdiction", "US")
    status = asset.get("status", "unknown")
    grant = asset.get("grant_date")
    expiry = asset.get("expiry_estimate")
    entity = asset.get("entity_size") or "large"
    notes: list[str] = []
    items: list[dict] = []
    unknown = False

    def horizon_end(h):
        return add_months(as_of, 12 * h)

    max_end = horizon_end(max(horizons)) if horizons else as_of

    if status in ("expired", "abandoned", "lapsed", "withdrawn"):
        notes.append(f"Asset is {status}; no forward official fees are forecast. Check reinstatement windows and family dependencies.")
    elif jur != "US":
        if a.get("foreign_member_annual_estimate"):
            est = money(a["foreign_member_annual_estimate"])
            for y in range(max(horizons)):
                d = add_months(as_of, 12 * y + 6)
                if expiry and d >= expiry:
                    break
                items.append({"type": "annuity_estimate", "date": d.isoformat(), "official_fee": "0.00",
                              "professional_fee": str(est), "basis": "estimate", "label": f"{jur} annuity (flat assumption)"})
            notes.append(f"{jur} costs use a flat configurable assumption, not an official fee schedule.")
        else:
            unknown = True
            notes.append(f"No official fee schedule configured for {jur} in this release; forward cost is UNKNOWN (not zero).")
    elif (asset.get("kind_code") or "").startswith("S"):
        notes.append("US design patents carry no maintenance fees.")
    elif status == "pending":
        sig = asset.get("signals") or {}
        exp_oas = Decimal(str(sig.get("expected_remaining_office_actions", 1.5)))
        oa_cost = money(Decimal(a["office_action_response_cost"]) * exp_oas)
        items.append({"type": "prosecution_estimate", "date": add_months(as_of, 6).isoformat(), "official_fee": "0.00",
                      "professional_fee": str(oa_cost), "basis": "estimate",
                      "label": f"Office action responses (~{exp_oas} expected)"})
        est_grant = add_months(as_of, int(a.get("expected_months_to_grant", 14)))
        issue = money(a["issue_fee_large"])
        if entity == "small":
            issue = money(issue * Decimal("0.4"))
        elif entity == "micro":
            issue = money(issue * Decimal("0.2"))
        items.append({"type": "issue_fee", "date": est_grant.isoformat(), "official_fee": str(issue),
                      "professional_fee": str(money(a["issue_fee_prep_cost"])), "basis": "estimate",
                      "label": "Issue fee on estimated allowance"})
        for ev in maintenance_events(est_grant, expiry, entity, as_of):
            if ev["state"] == "upcoming" and date.fromisoformat(ev["due_date"]) <= max_end:
                items.append({**ev, "date": ev["due_date"], "professional_fee": str(money(a["annuity_service_fee_per_payment"])),
                              "basis": "estimate", "label": f"{ev['stage']}-year maintenance fee (after estimated grant)"})
        notes.append("Pending application: grant timing and prosecution costs are assumptions.")
    elif status in ("active", "granted") and grant:
        for ev in maintenance_events(grant, expiry, entity, as_of):
            if ev["state"] == "past":
                continue
            pay_date = as_of if ev["state"] == "in_grace" else date.fromisoformat(ev["due_date"])
            items.append({**ev, "date": pay_date.isoformat(), "professional_fee": str(money(a["annuity_service_fee_per_payment"])),
                          "basis": "official_schedule", "label": f"{ev['stage']}-year maintenance fee"})
        if not items:
            notes.append("All maintenance fees for this patent are paid or no further fees fall before expiry.")
    else:
        unknown = True
        notes.append("Status or grant date unknown; cost cannot be forecast.")

    totals = {}
    for h in horizons:
        end = horizon_end(h)
        off = prof = sur = Decimal("0")
        for it in items:
            d = date.fromisoformat(it["date"])
            if as_of <= d <= end or it.get("state") == "in_grace":
                off += Decimal(it.get("official_fee", "0")) + Decimal(it.get("surcharge", "0"))
                sur += Decimal(it.get("surcharge", "0"))
                prof += Decimal(it.get("professional_fee", "0"))
        totals[str(h)] = {
            "official": str(money(off)),
            "professional": str(money(prof)),
            "surcharge": str(money(sur)),
            "total": None if unknown else str(money(off + prof)),
        }

    next_deadline = None
    for it in sorted(items, key=lambda x: x["date"]):
        if it["type"] == "maintenance_fee":
            next_deadline = {"date": it["grace_end"] if it["state"] == "in_grace" else it["due_date"],
                             "label": it["label"] + (" — IN GRACE PERIOD (surcharge applies)" if it["state"] == "in_grace" else ""),
                             "state": it["state"]}
            break
    if next_deadline is None and status == "pending":
        next_deadline = {"date": add_months(as_of, 3).isoformat(), "label": "Prosecution response (estimated)", "state": "estimate"}

    return {
        "currency": a.get("currency", "USD"),
        "items": items,
        "totals": totals,
        "unknown": unknown,
        "notes": notes,
        "next_deadline": next_deadline,
        "assumption_version": a.get("assumption_version"),
    }


def fee_schedules_public() -> list[dict]:
    return [
        {"version": s.version, "jurisdiction": s.jurisdiction, "effective_from": s.effective_from.isoformat(),
         "maintenance": s.maintenance, "grace_surcharge": s.grace_surcharge, "source": s.source}
        for s in FEE_SCHEDULES
    ]


def days_until(d: Optional[str], as_of: date) -> Optional[int]:
    if not d:
        return None
    return (date.fromisoformat(d) - as_of).days


def expiry_estimate(filing: Optional[date], priority_parent_filing: Optional[date] = None, kind: str = "") -> Optional[date]:
    """20 years from earliest non-provisional US filing (15 years from grant for designs handled by caller).
    Patent term adjustment/extension is ignored and flagged in the UI."""
    base = priority_parent_filing or filing
    if not base:
        return None
    try:
        return base.replace(year=base.year + 20)
    except ValueError:
        return base + timedelta(days=365 * 20 + 5)
