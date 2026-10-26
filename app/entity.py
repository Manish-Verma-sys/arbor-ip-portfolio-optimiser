"""Entity resolution (spec 6.2): normalise names, generate candidates with explained evidence,
never silently merge ambiguous entities."""
from __future__ import annotations

import hashlib
import re
from difflib import SequenceMatcher

from .catalog import COMPANIES, INVENTORS, TECH

SUFFIXES = {"inc", "incorporated", "corp", "corporation", "co", "company", "llc", "ltd", "limited", "gmbh", "ag",
            "plc", "sa", "bv", "nv", "kk", "pvt", "private", "holdings", "group", "the"}


def normalise(name: str) -> str:
    s = name.lower()
    s = re.sub(r"[\.,'&()/\-]", " ", s)
    toks = [t for t in s.split() if t and t not in SUFFIXES]
    return " ".join(toks)


def _sim(a: str, b: str) -> float:
    na, nb = normalise(a), normalise(b)
    if not na or not nb:
        return 0.0
    if na == nb:
        return 1.0
    ratio = SequenceMatcher(None, na, nb).ratio()
    ta, tb = set(na.split()), set(nb.split())
    jacc = len(ta & tb) / len(ta | tb)
    return 0.55 * ratio + 0.45 * jacc


def resolve_company(name: str, country: str | None = None, domain: str | None = None,
                    former_names: list[str] | None = None, subsidiaries: list[str] | None = None) -> list[dict]:
    out = []
    for c in COMPANIES:
        best, why = 0.0, []
        s = _sim(name, c["canonical_name"])
        if s > best:
            best = s
        if normalise(name) == normalise(c["canonical_name"]):
            why.append("Normalised assignee name exact match")
        elif s >= 0.6:
            why.append(f"Fuzzy assignee-name match ({s:.2f})")
        for al in c["aliases"]:
            sa = _sim(name, al)
            if sa >= 0.85:
                why.append(f"Alias match: '{al}'")
                best = max(best, sa * 0.97)
        for fn in c["former_names"] + (former_names or []):
            if fn in c["former_names"] and _sim(name, fn) >= 0.85:
                why.append(f"Historical name match: '{fn}'")
                best = max(best, 0.9)
        for fn in former_names or []:
            if any(_sim(fn, x) >= 0.85 for x in c["former_names"]):
                why.append(f"User-supplied former name '{fn}' matches recorded history")
                best = min(1.0, best + 0.05)
        if best < 0.45:
            continue
        if country:
            if country.upper() == c["country"]:
                why.append(f"Country match: {c['country']}"); best = min(1.0, best + 0.04)
            else:
                why.append(f"Country mismatch: record is {c['country']}"); best -= 0.12
        if domain and domain.lower().strip() in c["domain"]:
            why.append("Website/domain match"); best = min(1.0, best + 0.06)
        for sub in subsidiaries or []:
            if any(_sim(sub, x["name"]) >= 0.8 for x in c["subsidiaries"]):
                why.append(f"Known subsidiary '{sub}' documented"); best = min(1.0, best + 0.04)
        why.append(f"Official identifier on file: {c['identifiers']['assignee_id']}")
        out.append({
            "entity_id": c["entity_id"], "entity_type": "company", "canonical_name": c["canonical_name"],
            "country": c["country"], "identifiers": c["identifiers"], "aliases": c["aliases"],
            "former_names": c["former_names"], "related_entities": c["subsidiaries"],
            "technology": TECH[c["tech"]]["label"],
            "match_confidence": round(max(0.0, min(best, 0.99)), 2), "match_evidence": why,
            "data_mode": "synthetic", "customer_data": c["customer_data"],
        })
    out.sort(key=lambda x: -x["match_confidence"])
    if not out or out[0]["match_confidence"] < 0.8:
        out.extend(_synthetic_candidates(name, country))
    return out[:6]


def _synthetic_candidates(name: str, country: str | None) -> list[dict]:
    h = int(hashlib.sha256(normalise(name).encode()).hexdigest()[:8], 16)
    techs = list(TECH)
    tech = techs[h % len(techs)]
    clean = name.strip().title() if name.strip().islower() else name.strip()
    base_id = "ent_syn_" + hashlib.sha256(normalise(name).encode()).hexdigest()[:10]
    cands = [{
        "entity_id": base_id, "entity_type": "company", "canonical_name": f"{clean} (synthetic demo)",
        "country": (country or "US").upper(), "identifiers": {"assignee_id": f"SYN-A-{h % 900000 + 100000}"},
        "aliases": [], "former_names": [], "related_entities": [], "technology": TECH[tech]["label"],
        "match_confidence": 0.74,
        "match_evidence": ["Generated demo entity — no live patent-office connector is configured",
                           "All patents, numbers and inputs are FICTIONAL and do not describe the real company of this name",
                           "Portfolio will be SYNTHETIC public-data-only (no customer inputs)"],
        "data_mode": "synthetic", "customer_data": False, "tech_key": tech,
    }, {
        "entity_id": base_id + "_h", "entity_type": "company", "canonical_name": f"{clean} Holdings (synthetic demo)",
        "country": "US", "identifiers": {"assignee_id": f"SYN-A-{(h // 7) % 900000 + 100000}"},
        "aliases": [], "former_names": [], "related_entities": [], "technology": TECH[techs[(h // 3) % len(techs)]]["label"],
        "match_confidence": 0.52,
        "match_evidence": ["Similar assignee name — possibly a different legal entity", "Do not merge without evidence"],
        "data_mode": "synthetic", "customer_data": False, "tech_key": techs[(h // 3) % len(techs)],
    }]
    return cands


def resolve_inventor(name: str, organisation: str | None = None, country: str | None = None,
                     co_inventor: str | None = None) -> list[dict]:
    out = []
    for inv in INVENTORS:
        s = _sim(name, inv["canonical_name"])
        if s < 0.7:
            continue
        why = [f"Inventor name match ({s:.2f})"]
        conf = s * 0.8
        orgs = [a["org"] for a in inv["affiliations"]]
        if organisation:
            if any(_sim(organisation, o) >= 0.6 for o in orgs):
                why.append(f"Affiliation match: {organisation}"); conf += 0.15
            else:
                why.append("Affiliation does not match supplied organisation"); conf -= 0.1
        if country:
            if country.upper() == inv["country"]:
                why.append(f"Country match: {inv['country']}"); conf += 0.04
            else:
                conf -= 0.05
        if co_inventor and any(_sim(co_inventor, c) >= 0.8 for c in inv["co_inventors"]):
            why.append(f"Co-inventor match: {co_inventor}"); conf += 0.08
        why.append("Affiliations: " + "; ".join(f"{a['org']} ({a['from']}–{a['to'] or 'present'})" for a in inv["affiliations"]))
        out.append({
            "entity_id": inv["entity_id"], "entity_type": "inventor", "canonical_name": inv["canonical_name"],
            "country": inv["country"], "affiliations": inv["affiliations"], "co_inventors": inv["co_inventors"],
            "technology": TECH[inv["tech"]]["label"], "match_confidence": round(max(0.0, min(conf, 0.99)), 2),
            "match_evidence": why, "data_mode": "synthetic", "identifiers": {},
        })
    out.sort(key=lambda x: -x["match_confidence"])
    if not out:
        h = int(hashlib.sha256(normalise(name).encode()).hexdigest()[:8], 16)
        tech = list(TECH)[h % len(TECH)]
        out.append({
            "entity_id": "inv_syn_" + hashlib.sha256(normalise(name).encode()).hexdigest()[:10],
            "entity_type": "inventor", "canonical_name": f"{name.strip()} (synthetic demo)", "country": (country or "US").upper(),
            "affiliations": [{"org": organisation or "Unknown employer", "from": 2012, "to": None}],
            "co_inventors": [], "technology": TECH[tech]["label"], "match_confidence": 0.6,
            "match_evidence": ["Generated demo inventor — no live connector configured"], "data_mode": "synthetic",
            "identifiers": {}, "tech_key": tech,
        })
    return out
