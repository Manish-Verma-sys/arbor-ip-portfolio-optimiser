"""Direct reader for public Google Patents records (patents.google.com).

The server fetches the patent page itself and parses its structured (schema.org itemprop) markup, so
bibliographic data, legal status, expiry, maintenance-fee events, claims, citations and family are taken
verbatim from the record - deterministic and free. Claude is then only used for the seven judgement
parameters (see ai.py).
"""
from __future__ import annotations

import re
import time
import urllib.error
import urllib.request
from collections import Counter
from typing import Optional

from bs4 import BeautifulSoup

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/126.0 Safari/537.36 PortfolioMaintenanceCalculator/1.2")
BASE = "https://patents.google.com/patent/{}/en"

STATUS_MAP = [
    (r"expired\s*-\s*fee", "lapsed"), (r"fee related", "lapsed"), (r"lapse", "lapsed"), (r"ceased", "lapsed"),
    (r"expired\s*-\s*lifetime", "expired"), (r"^expired", "expired"),
    (r"abandon", "abandoned"), (r"withdrawn", "withdrawn"), (r"pending", "pending"),
    (r"active", "active"), (r"in force", "active"),
]


class NotFound(Exception):
    pass


def candidate_ids(num: str) -> list[str]:
    """Google Patents needs the kind code; try likely ones when the user omitted it."""
    if re.search(r"(B1|B2|B3|E|S|S1|A1|A2|A9|P2|P3)$", num) or re.match(r"^US\d{5,7}A$", num):
        return [num]
    if re.match(r"^US20\d{9}$", num):
        return [num + "A1", num + "A9", num + "A2"]
    if num.startswith("USRE"):
        return [num + "E"]
    if num.startswith("USD"):
        return [num + "S", num + "S1"]
    digits = re.sub(r"\D", "", num)
    return [num + "B2", num + "B1"] + ([num + "A"] if len(digits) <= 7 else [])


def fetch_html(num: str, timeout: float = 20.0, retries: int = 2) -> tuple[str, str]:
    last = None
    for pid in candidate_ids(num):
        url = BASE.format(pid)
        for attempt in range(retries + 1):
            try:
                req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "en-US,en;q=0.9",
                                                           "Accept": "text/html,application/xhtml+xml"})
                with urllib.request.urlopen(req, timeout=timeout) as r:
                    html = r.read().decode("utf-8", errors="replace")
                if 'itemprop="publicationNumber"' in html or "itemprop=publicationNumber" in html:
                    return html, url
                last = f"{url}: page has no patent data"
                break
            except urllib.error.HTTPError as e:
                last = f"{url}: HTTP {e.code}"
                if e.code == 404:
                    break
                if e.code in (429, 503) and attempt < retries:
                    time.sleep(2 + 3 * attempt)
                    continue
                break
            except (urllib.error.URLError, TimeoutError, OSError) as e:
                last = f"{url}: {type(e).__name__}"
                if attempt < retries:
                    time.sleep(1.5)
                    continue
    raise NotFound(last or "not found")


def _txt(el) -> str:
    if el is None:
        return ""
    if el.has_attr("datetime"):
        return el["datetime"].strip()
    if el.name == "meta" and el.has_attr("content"):
        return el["content"].strip()
    return re.sub(r"\s+", " ", el.get_text(" ", strip=True)).strip()


def _first(soup, sel) -> str:
    return _txt(soup.select_one(sel))


def _map_status(raw: str) -> str:
    r = (raw or "").strip().lower()
    for pat, val in STATUS_MAP:
        if re.search(pat, r):
            return val
    return "unknown"


def parse(html: str, requested: str = "") -> dict:
    soup = BeautifulSoup(html, "html.parser")
    pub = _first(soup, 'dd[itemprop="publicationNumber"]') or requested
    title = _first(soup, 'span[itemprop="title"]') or _txt(soup.select_one('meta[name="DC.title"]'))
    kind = _txt(soup.select_one('meta[itemprop="kindCode"]'))
    grant = None
    for m in soup.select('meta[name="DC.date"]'):
        if (m.get("scheme") or "").lower() == "issue":
            grant = m.get("content", "").strip()[:10]
    if re.match(r"^US20\d{9}", pub or "") or kind in ("A1", "A2", "A9"):
        grant = None  # published applications have no grant date

    ls = soup.select_one('dd[itemprop="legalStatusIfi"]')
    status_raw = _txt(ls.select_one('[itemprop="status"]')) if ls else ""
    status_raw = status_raw or _first(soup, '[itemprop="ifiStatus"]') or _first(soup, 'span[itemprop="status"]')
    expiry = (_txt(ls.select_one('[itemprop="expiration"]')) if ls else "") or _first(soup, '[itemprop="ifiExpiration"]') \
        or _first(soup, 'time[itemprop="expiration"]')

    events = []
    for e in soup.select('[itemprop="events"]'):
        events.append({"date": _txt(e.select_one('[itemprop="date"]'))[:10], "title": _txt(e.select_one('[itemprop="title"]')),
                       "type": _txt(e.select_one('[itemprop="type"]'))})
    if not expiry:
        for e in events:
            if re.search(r"(adjusted|anticipated) expiration", e["title"], re.I):
                expiry = e["date"]

    legal = []
    fee_events = []
    entity = "unknown"
    for row in soup.select('tr[itemprop="legalEvents"]'):
        attrs = {}
        for p in row.select('[itemprop="attributes"]'):
            attrs[_txt(p.select_one('[itemprop="label"]'))] = _txt(p.select_one('[itemprop="value"]'))
        ev = {"date": _txt(row.select_one('[itemprop="date"]'))[:10], "code": _txt(row.select_one('[itemprop="code"]')),
              "title": _txt(row.select_one('[itemprop="title"]')), "text": attrs.get("Free format text", "")}
        legal.append(ev)
        blob = (ev["title"] + " " + ev["text"]).upper()
        if ev["code"].upper() in ("MAFP", "FPAY", "M1551", "M1552", "M1553") or "MAINTENANCE FEE" in blob and "PAYMENT" in blob:
            year = attrs.get("Year of fee payment")
            year = int(year) if year and year.strip().isdigit() else None
            fee_events.append({"date": ev["date"], "event": ev["text"] or ev["title"], "year": year})
        m = re.search(r"ENTITY STATUS OF PATENT OWNER:\s*(LARGE|SMALL|MICRO)", blob) or re.search(r"\b(LARGE|SMALL|MICRO) ENTITY\b", blob)
        if m:
            entity = m.group(1).lower()

    cpcs = []
    for ul in soup.select('ul[itemprop="classifications"]'):
        lis = ul.select('li[itemprop="classifications"]')
        if not lis:
            continue
        leaf = lis[-1]
        code = _txt(leaf.select_one('[itemprop="Code"]'))
        if code and "/" in code:
            first = bool(leaf.select_one('meta[itemprop="FirstCode"]'))
            cpcs.append((0 if first else 1, code, _txt(leaf.select_one('[itemprop="Description"]'))))
    cpcs_sorted = [c for c in sorted(cpcs, key=lambda c: c[0])]
    seen = set()
    cpc_all = [c[1] for c in cpcs_sorted if not (c[1] in seen or seen.add(c[1]))][:8]

    claims_sec = soup.select_one('section[itemprop="claims"]')
    total_claims = indep = claim1_words = None
    claim1 = ""
    if claims_sec:
        cnt = _first(claims_sec, '[itemprop="count"]')
        total_claims = int(cnt) if cnt.isdigit() else None
        nodes = claims_sec.select('div[id^="CLM-"]')
        if nodes:
            indep = 0
            for n in nodes:
                parent_cls = n.parent.get("class", []) if n.parent else []
                is_dep = "claim-dependent" in parent_cls or n.select_one("claim-ref") is not None
                if not is_dep:
                    indep += 1
            total_claims = total_claims or len(nodes)
            claim1 = _txt(nodes[0])
        else:
            items = claims_sec.select("claim, .claim")
            if items:
                total_claims = total_claims or len(items)
                indep = sum(1 for c in items if c.select_one("claim-ref") is None)
                claim1 = _txt(items[0])
        claim1 = re.sub(r"^\s*1\s*\.\s*", "", claim1)
        claim1_words = len(claim1.split()) if claim1 else None

    def _rows(prop):
        out = []
        for r in soup.select(f'tr[itemprop="{prop}"]'):
            out.append({"pub": _txt(r.select_one('[itemprop="publicationNumber"]')) or _txt(r.select_one('[itemprop="representativePublication"]')),
                        "assignee": _txt(r.select_one('[itemprop="assigneeOriginal"]')), "app": _txt(r.select_one('[itemprop="applicationNumber"]')),
                        "priority": _txt(r.select_one('[itemprop="priorityDate"]')), "filing": _txt(r.select_one('[itemprop="filingDate"]'))})
        return out

    fwd = _rows("forwardReferencesOrig") + _rows("forwardReferencesFamily")
    owner = _first(soup, 'dd[itemprop="assigneeCurrent"]') or None
    orig_owner = _first(soup, 'dd[itemprop="assigneeOriginal"]') or None
    owner_key = re.sub(r"[^a-z]", "", (owner or orig_owner or "").lower())[:8]
    citers = Counter()
    for r in fwd:
        a = r["assignee"]
        if a and (not owner_key or owner_key not in re.sub(r"[^a-z]", "", a.lower())):
            citers[re.sub(r",?\s*(llc|inc\.?|corp\.?|ltd\.?)$", "", a, flags=re.I).strip()] += 1

    prio = _rows("priorityApps")
    claiming = _rows("appsClaimingPriority")
    app_no = _first(soup, 'dd[itemprop="applicationNumber"]')
    us_family = sorted({r["pub"] for r in prio + claiming if r["pub"].startswith("US") and r["pub"] != pub})
    parents = [r for r in prio if r["app"] and r["app"] != app_no and r["app"].startswith("US")
               and not re.match(r"US6[0-3]/", r["app"]) and r["pub"] and r["pub"] != pub]
    continuation_of = sorted(parents, key=lambda r: r["filing"] or "9999")[0]["pub"] if parents else None
    has_cont = any(r["pub"] != pub and r["pub"].startswith("US") and (r["filing"] or "") > (_first(soup, 'time[itemprop="filingDate"]') or "")
                   for r in claiming)

    mentions = [f"{e['date']}: {e['title']} {e['text']}".strip() for e in legal
                if re.search(r"litigat|lawsuit|inter partes|\bIPR\b|reexam|certificate of correction", e["title"] + " " + e["text"], re.I)]
    abstract = _first(soup, 'section[itemprop="abstract"] div.abstract') or _first(soup, 'section[itemprop="abstract"]')
    words = abstract.split()
    return {
        "publication_number": pub, "application_number": app_no or None, "title": title.strip(),
        "abstract": " ".join(words[:70]) + ("…" if len(words) > 70 else ""),
        "current_assignee": owner, "original_assignee": orig_owner,
        "inventors": [_txt(x) for x in soup.select('dd[itemprop="inventor"]')][:12],
        "priority_date": _first(soup, 'time[itemprop="priorityDate"]')[:10] or None,
        "filing_date": _first(soup, 'time[itemprop="filingDate"]')[:10] or None,
        "publication_date": _first(soup, 'time[itemprop="publicationDate"]')[:10] or None,
        "grant_date": grant, "kind": kind or None,
        "legal_status": _map_status(status_raw), "status_detail": status_raw or None,
        "anticipated_expiration": (expiry or "")[:10] or None,
        "maintenance_fee_events": fee_events, "entity_status": entity,
        "cpc_main": cpc_all[0] if cpc_all else None, "cpc_all": cpc_all,
        "cpc_description": cpcs_sorted[0][2] if cpcs_sorted else None,
        "independent_claims": indep, "total_claims": total_claims, "claim1_word_count": claim1_words,
        "claim1_summary": " ".join(claim1.split()[:45]) + ("…" if claim1 and len(claim1.split()) > 45 else ""),
        "forward_citations": len(fwd), "top_citing_assignees": [a for a, _ in citers.most_common(6)],
        "us_family_members": us_family, "continuation_of": continuation_of, "has_continuations": has_cont,
        "litigation_or_licensing_mentions": mentions[:5], "legal_events": legal[-25:], "events": events[-25:],
        "sources": [], "source": "google_patents",
    }


def lookup(num: str) -> dict:
    html, url = fetch_html(num)
    facts = parse(html, num)
    facts["sources"] = [url]
    return facts
