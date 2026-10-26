"""Record-based parameter estimates (no AI needed).

A patent analyst can form a defensible first view of all seven parameters from the public record alone:
claim structure, age-normalised forward citations and who cites, owner behaviour (fees paid, foreign filings,
continuations, self-citations) and remaining term. These estimates are used when the AI assessment is not
available or fails, so the table never shows '?' for a live patent. They are clearly labelled as record
estimates and carry lower confidence than evidence-verified ratings.
"""
from __future__ import annotations

import re
from datetime import date
from typing import Optional

COUNTRY = {"EP": "Europe (EPO)", "JP": "Japan", "CN": "China", "KR": "Korea", "DE": "Germany", "WO": "PCT", "GB": "UK", "FR": "France",
           "CA": "Canada", "AU": "Australia", "IN": "India", "TW": "Taiwan", "BR": "Brazil"}
SUFFIX = re.compile(r",?\s*(llc|inc\.?|corp\.?|corporation|ltd\.?|limited|gmbh|ag|co\.?|company|technology licensing|technologies)$", re.I)


def _d(v) -> Optional[date]:
    try:
        return date.fromisoformat(str(v)[:10]) if v else None
    except ValueError:
        return None


def _clean(name: str) -> str:
    n = (name or "").strip()
    for _ in range(3):
        n = SUFFIX.sub("", n).strip(" ,")
    return n


def _key(name: str) -> str:
    return re.sub(r"[^a-z]", "", _clean(name).lower())[:10]


def _elements(claim: str) -> list[str]:
    body = re.split(r"comprising:?|consisting of:?|including:?", claim, maxsplit=1, flags=re.I)
    body = body[1] if len(body) > 1 else claim
    parts = [p.strip(" ;,.") for p in re.split(r";|\band\s*$", body) if len(p.strip()) > 8]
    return parts


def _claim_kinds(texts: list[str]) -> list[str]:
    kinds = []
    for t in texts:
        tl = t.lower()[:120]
        k = ("method" if re.search(r"\bmethod|process\b", tl) else "computer-readable medium" if re.search(r"medium|program product", tl)
             else "system/apparatus" if re.search(r"system|apparatus|device|assembly|circuit", tl) else "other")
        if k not in kinds:
            kinds.append(k)
    return kinds


def signals(f: dict, as_of: date) -> dict:
    owner = f.get("current_assignee") or f.get("original_assignee") or ""
    ok = _key(owner)
    grant, pub = _d(f.get("grant_date")), _d(f.get("publication_date")) or _d(f.get("grant_date")) or _d(f.get("filing_date"))
    exp = _d(f.get("anticipated_expiration"))
    docs = f.get("citing_documents") or []
    third, self_cites, foreign_script = {}, 0, 0
    for d in docs:
        a = d.get("assignee") or ""
        if not a:
            continue
        if ok and ok in _key(a):
            self_cites += 1
            continue
        if not re.search(r"[A-Za-z]{2}", a):
            # CJK/Hangul assignee names come from foreign family members of the same citing companies;
            # count the citation but do not treat the translated name as a separate company.
            foreign_script += 1
            continue
        third.setdefault(_clean(a), []).append(d)
    recent_cut = date(as_of.year - 5, as_of.month, min(as_of.day, 28))
    recent = [d for d in docs if (_d(d.get("published")) or date(1900, 1, 1)) >= recent_cut]
    recent_third = {}
    for name, ds in third.items():
        rs = [d for d in ds if (_d(d.get("published")) or date(1900, 1, 1)) >= recent_cut]
        if rs:
            recent_third[name] = rs
    n = f.get("forward_citations")
    n = n if isinstance(n, int) else len(docs)
    years_out = max(0.5, (as_of - pub).days / 365.25) if pub else None
    years_left = (exp - as_of).days / 365.25 if exp else None
    fee_years = sorted({e.get("year") for e in (f.get("maintenance_fee_events") or []) if e.get("year")})
    last_fee = max([_d(e.get("date")) for e in (f.get("maintenance_fee_events") or []) if _d(e.get("date"))], default=None)
    foreign = f.get("foreign_family") or []
    countries = sorted({p[:2] for p in foreign})
    claim1 = f.get("claim1_full") or f.get("claim1_summary") or ""
    return {
        "owner": _clean(owner) or "the owner", "title": f.get("title") or "", "cpc": f.get("cpc_main") or "",
        "cpc_desc": f.get("cpc_description") or "", "status": f.get("legal_status"), "grant": grant, "exp": exp,
        "years_left": years_left, "years_out": years_out, "n_cites": n, "rate": (n / years_out) if (years_out and n is not None) else None,
        "third": third, "n_third": len(third), "recent_third": recent_third, "foreign_script": foreign_script, "self_cites": self_cites, "recent": len(recent), "docs": docs,
        "recent_share": (len(recent) / len(docs)) if docs else 0.0, "fee_years": fee_years, "last_fee": last_fee,
        "foreign": foreign, "countries": countries, "continuations": bool(f.get("has_continuations")),
        "continuation_of": f.get("continuation_of"), "indep": f.get("independent_claims"), "total": f.get("total_claims"),
        "c1_words": f.get("claim1_word_count"), "claim1": claim1, "elements": _elements(claim1),
        "kinds": _claim_kinds(f.get("independent_claims_text") or ([claim1] if claim1 else [])),
        "litigation": f.get("litigation_or_licensing_mentions") or [], "url": (f.get("sources") or [""])[0],
    }


def _names(third: dict, k: int = 4) -> str:
    ranked = sorted(third.items(), key=lambda kv: -len(kv[1]))[:k]
    return ", ".join(f"{name} ({len(v)})" for name, v in ranked)


def _example(third: dict) -> str:
    ranked = sorted(third.items(), key=lambda kv: -len(kv[1]))
    for name, docs in ranked:
        d = docs[0]
        if d.get("title"):
            t = d["title"] if len(d["title"]) <= 95 else d["title"][:92].rsplit(" ", 1)[0] + "…"
            return f"{name}'s {d['pub']} “{t}” ({(d.get('published') or '')[:4]})"
    return ""


def _clamp(v: int) -> int:
    return max(0, min(5, v))


def _pack(rating, conf, headline, basis, points, higher, lower, risks, nxt, s):
    return {"rating": _clamp(rating), "confidence": round(conf, 2), "headline": headline, "technical_basis": basis,
            "evidence_points": [p for p in points if p][:5], "why_not_higher": higher, "why_not_lower": lower, "risks": risks,
            "next_step": nxt, "source": "record",
            "evidence": [{"url": s["url"], "title": "Google Patents record", "date": None,
                          "finding": "Bibliographic data, claims, legal events and citing documents read directly from the public record."}] if s["url"] else []}


def _years(v: Optional[float]) -> str:
    return "unknown" if v is None else f"{v:.1f}"


def claim_quality(s: dict) -> dict:
    el, kinds, words, indep = s["elements"], s["kinds"], s["c1_words"] or 0, s["indep"] or 0
    r = 3
    if indep >= 3 and len(kinds) >= 2:
        r += 1
    if el and len(el) <= 4:
        r += 1
    if len(el) >= 8 or words > 250:
        r -= 1
    if indep <= 1:
        r -= 1
    pending = s["status"] == "pending"
    r = min(r, 3 if pending else 4)  # 5 needs prosecution-history / validity evidence
    first = "; ".join(e[:70] for e in el[:3])
    return _pack(r, 0.55,
                 f"{'Layered' if indep >= 3 else 'Limited'} claim set: {indep} independent claim(s) covering {', '.join(kinds) or 'one category'}; claim 1 has ~{len(el)} required elements.",
                 f"Claim 1 ({words} words) requires: {first}{'…' if len(el) > 3 else ''}. Every element must be present for infringement, so fewer elements usually means broader scope.",
                 [f"{indep} independent / {s['total']} total claims; categories: {', '.join(kinds) or 'n/a'} (multiple categories let the owner pursue method users, device makers and software vendors).",
                  f"Claim 1 length {words} words with ~{len(el)} elements" + (" — compact for this art" if words and words < 140 else " — relatively detailed, more design-around routes" if words > 200 else "."),
                  f"Dependent claims add fallback positions, e.g. “{(s.get('dep') or '')[:90]}”" if s.get("dep") else ""],
                 "A 5 needs evidence that the claims survived scrutiny (no narrowing amendments, IPR/re-exam outcomes) — not visible in the record summary.",
                 "Claim 1 is not reduced to a single narrow embodiment and alternative claim categories exist." if indep >= 2 else "The claims still define a concrete technical combination.",
                 "Prosecution history (amendments, examiner rejections) has not been reviewed; validity against prior art is untested.",
                 "Pull the file wrapper in USPTO Patent Center and check what was added to claim 1 to secure allowance.", s)


def competitive(s: dict) -> dict:
    rate, n3 = s["rate"], s["n_third"]
    r = 1 if rate is None else (4 if rate >= 3 else 3 if rate >= 1.5 else 2 if rate >= 0.7 else 1)
    if n3 >= 3:
        r += 1
    if s["n_cites"] == 0:
        r = 1
    names = _names(s["third"])
    return _pack(r, 0.6,
                 f"Cited {s['n_cites']} times in ~{_years(s['years_out'])} years ({rate:.1f}/yr vs ~1/yr typical) by {n3} other companies." if rate is not None else f"Cited {s['n_cites']} times.",
                 f"Later filers had to distinguish their inventions from this patent's approach ({s['cpc_desc'] or s['cpc']}). Citations by companies active in the same products indicate the claimed technique sits in a contested design space.",
                 [f"Third-party citers: {names}." if names else "No third-party citers identified.",
                  f"Example: {_example(s['third'])}." if s["third"] else "",
                  (f"{s['recent']} of {len(s['docs'])} citing documents were published in the last 5 years" + (" — the field is still active." if s["recent_share"] >= 0.4 else ".")) if s["docs"] else "",
                  f"Plus {s['foreign_script']} citation(s) from those companies' Chinese/Japanese/Korean family filings." if s["foreign_script"] else "",
                  f"{s['self_cites']} citation(s) are the owner's own follow-on filings." if s["self_cites"] else ""],
                 "No standards declaration or verified product use found in the record — citations show relevance, not use.",
                 "Citation rate is above what is typical for a patent of this age." if rate and rate >= 1.5 else "Some external citation activity exists.",
                 "Citations can be examiner-added and do not prove infringement or essentiality.",
                 "Read the 2–3 most recent third-party citing patents to see which claim feature they work around.", s)


def commercial(s: dict) -> dict:
    r = 2
    paid_recent = s["last_fee"] and (s["grant"] and s["last_fee"] >= s["grant"]) and (s["fee_years"] and max(s["fee_years"]) >= 8)
    if s["status"] == "active" and s["fee_years"]:
        r += 1
    if len(s["countries"]) >= 3 or s["n_third"] >= 4:
        r += 1
    r = min(r, 3) if not paid_recent else min(r, 4)
    if s["status"] in ("expired", "lapsed", "abandoned"):
        r = 1
    return _pack(r, 0.4,
                 f"Indirect commercial signals: owner {s['owner']} {'has kept paying maintenance fees (' + ', '.join(str(y) + 'th-yr' for y in s['fee_years']) + ')' if s['fee_years'] else 'has no recorded fee payments yet'}"
                 + (f" and filed in {len(s['countries'])} other jurisdictions" if s["countries"] else "") + ".",
                 f"The claims cover {s['title'].lower()[:100]} — applicable to products in {s['cpc_desc'] or s['cpc']}. Product use by the owner is not verified from public product documentation in record-only mode.",
                 [f"Maintenance fees paid at year(s) {', '.join(map(str, s['fee_years']))}: a large owner paying the {max(s['fee_years'])}th-year fee is a signal it still sees business value." if s["fee_years"] else "",
                  f"Foreign family in {', '.join(COUNTRY.get(c, c) for c in s['countries'])} — owners file abroad where they expect to sell products." if s["countries"] else "No foreign family members — protection is US-only.",
                  f"Companies building in this space cite it: {_names(s['third'], 3)}." if s["third"] else ""],
                 "No public product, datasheet or virtual-marking page has been matched to claim 1 (requires AI web research or your product mapping).",
                 "Fee payments and filing breadth show the owner treats it as commercially relevant." if r >= 3 else "Technology area is commercially active.",
                 "Owner behaviour is indirect evidence; the owner may keep patents for defensive reasons only.",
                 f"Search {s['owner']} product pages and virtual-marking lists for the claim-1 feature, or add a product mapping.", s)


def strategic(s: dict) -> dict:
    r = 2
    if s["fee_years"] and max(s["fee_years"]) >= 8:
        r += 1
    if len(s["countries"]) >= 3:
        r += 1
    if s["continuations"] or s["self_cites"] >= 2:
        r += 1
    if s["status"] in ("expired", "lapsed", "abandoned"):
        r = 1
    r = min(r, 4)
    return _pack(r, 0.45,
                 f"Owner investment signals point to {'core/defensive' if r >= 4 else 'meaningful' if r == 3 else 'limited'} strategic value for {s['owner']}.",
                 f"The invention ({s['title'][:90]}) protects a technique in {s['cpc_desc'] or s['cpc']}; its blocking value depends on whether competitors need the claim-1 combination.",
                 [f"Kept alive through the {max(s['fee_years'])}th-year fee." if s["fee_years"] else "",
                  f"International filings: {len(s['foreign'])} family member(s) in {', '.join(COUNTRY.get(c, c) for c in s['countries'])}." if s["foreign"] else "",
                  f"Owner's own later patents cite it {s['self_cites']} time(s) — it underpins follow-on R&D." if s["self_cites"] else "",
                  "Continuation applications claim priority from it — the owner is still building claims on this disclosure." if s["continuations"] else ""],
                 "Business-segment fit and roadmap relevance are not confirmed from company sources in record-only mode.",
                 "Several independent investment signals agree." if r >= 3 else "The patent is in force and maintained.",
                 "Investment signals can reflect portfolio policy rather than this specific patent's importance.",
                 "Confirm the business unit that uses it and whether competitors' products need the claim-1 feature.", s)


def portfolio(s: dict) -> dict:
    r = 3
    if s["self_cites"] >= 2:
        r += 1
    if s["foreign"]:
        r += 1
    if s["continuation_of"]:
        r -= 1
    r = min(r, 5)
    return _pack(r, 0.45,
                 f"{'Foundational' if s['self_cites'] >= 2 else 'Distinct'} asset in {s['owner']}'s portfolio" + (f", anchoring a {len(s['foreign']) + 1}-country family." if s["foreign"] else "."),
                 f"Covers the specific approach in claim 1 rather than the broad field ({s['cpc']}); later owner filings build on it rather than duplicate it." if s["self_cites"] else f"Covers the specific approach in claim 1 within {s['cpc']}.",
                 [f"{s['self_cites']} later {s['owner']} filing(s) cite it as prior art." if s["self_cites"] else "No later owner filings citing it were found in the record.",
                  f"US parent of foreign family members: {', '.join(s['foreign'][:5])}." if s["foreign"] else "",
                  f"It is itself a continuation of {s['continuation_of']} — some subject matter is shared with the parent." if s["continuation_of"] else "Original filing (not a continuation)."],
                 "Overlap with the owner's other live patents in the same subgroup has not been searched.",
                 "No evidence of duplication by another live owner patent.",
                 "A full assignee search may reveal closely related patents that reduce its incremental value.",
                 f"Run a Google Patents search: assignee:“{s['owner']}” CPC {s['cpc'].split('/')[0]} and compare claim 1s.", s)


def licensing(s: dict) -> dict:
    r = 1
    if s["n_third"] >= 2:
        r += 1
    if s["n_third"] >= 4 and s["recent"] >= 3:
        r += 1
    if s["years_left"] and s["years_left"] >= 7:
        r += 1
    if s["litigation"]:
        r += 1
    if s["status"] in ("expired", "lapsed", "abandoned"):
        r = 0
    r = min(r, 4)
    return _pack(r, 0.4,
                 f"{'Credible' if r >= 3 else 'Possible' if r == 2 else 'Weak'} licensing potential: {s['n_third']} other companies work in the same claimed space and {_years(s['years_left'])} years of term remain.",
                 "Licensing value depends on whether third-party products practise every element of claim 1 — the citing companies below are the first places to look, not confirmed infringers.",
                 [f"Candidate licensees / evidence-of-use leads (citing companies): {_names(s['third'], 5)}." if s["third"] else "No third-party citers to use as leads.",
                  f"Most relevant lead: {_example(s['third'])}." if s["third"] else "",
                  f"{_years(s['years_left'])} years until expiry — enough runway for a licensing programme." if s["years_left"] and s["years_left"] >= 7 else f"Only {_years(s['years_left'])} years left — limited licensing runway." if s["years_left"] is not None else "",
                  "Litigation/re-exam events appear in the record." if s["litigation"] else "No litigation or licensing events in the record."],
                 "No confirmed licence, assertion or element-by-element product match (needs claim-chart work).",
                 "Multiple active companies in the claimed space with long remaining term." if r >= 3 else "Some third-party activity exists.",
                 "A citation is not evidence of infringement; validity has not been tested in litigation or IPR.",
                 "Build a claim chart of claim 1 against the most recent product of the top citing company.", s)


def future(s: dict) -> dict:
    yl = s["years_left"]
    if s["status"] in ("expired", "lapsed", "abandoned") or (yl is not None and yl <= 0):
        r = 0
    elif yl is None:
        r = 2
    else:
        r = 4 if yl >= 10 else 3 if yl >= 7 else 2 if yl >= 4 else 1
        if s["recent_share"] >= 0.5 and s["recent"] >= 3:
            r += 1
    return _pack(r, 0.55,
                 f"{_years(yl)} years of term left (expires {s['exp'].isoformat() if s['exp'] else 'unknown'}); {s['recent']} citing filings in the last 5 years.",
                 f"The technique ({s['cpc_desc'] or s['cpc']}) {'is still attracting new filings, suggesting the field is growing' if s['recent_share'] >= 0.5 else 'shows slowing filing activity'}.",
                 [f"Expiry {s['exp'].isoformat()} includes patent term adjustment from the record." if s["exp"] else "",
                  f"{round(s['recent_share'] * 100)}% of citing documents are from the last 5 years." if s["docs"] else "",
                  f"Recent third-party filers: {_names(s['recent_third'], 3)}." if s["recent_third"] else ""],
                 "Market-size and adoption forecasts for this specific technique are not assessed in record-only mode.",
                 "Long remaining term in an active field." if r >= 4 else "Some term remains." if r >= 1 else "",
                 "Adjacent technologies could substitute for the claimed approach before expiry.",
                 "Check analyst forecasts and product roadmaps for the claimed technique.", s)


def estimate(facts: dict, as_of: date) -> dict:
    s = signals(facts, as_of)
    s["dep"] = (facts.get("dependent_claims_text") or [""])[0]
    return {"commercial": commercial(s), "claim_quality": claim_quality(s), "competitive": competitive(s), "strategic": strategic(s),
            "portfolio": portfolio(s), "licensing": licensing(s), "future": future(s)}


def compose(d: dict) -> str:
    """Plain-text rationale from the structured fields (used in exports and the detail page)."""
    parts = [d.get("headline", "")]
    if d.get("technical_basis"):
        parts.append("Technical basis: " + d["technical_basis"])
    pts = [p for p in d.get("evidence_points") or [] if p]
    if pts:
        parts.append("Evidence: " + " ".join("• " + p for p in pts))
    if d.get("why_not_higher"):
        parts.append("Why not higher: " + d["why_not_higher"])
    if d.get("why_not_lower"):
        parts.append("Why not lower: " + d["why_not_lower"])
    if d.get("risks"):
        parts.append("Risks: " + d["risks"])
    if d.get("next_step"):
        parts.append("Next step: " + d["next_step"])
    return " ".join(p for p in parts if p)
