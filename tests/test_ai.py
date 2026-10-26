import io
import json
import os
import time
from types import SimpleNamespace as NS

os.environ.setdefault("JOB_STEP_DELAY", "0")

from fastapi.testclient import TestClient  # noqa: E402

from app import ai  # noqa: E402
from app.main import app  # noqa: E402

H = {"X-User-Id": "u_admin"}

FACTS = {
    "publication_number": "US9876543B2", "application_number": "14/123,456", "title": "Adaptive widget controller",
    "abstract": "A controller that adapts widget speed.", "current_assignee": "Example Robotics Inc.",
    "original_assignee": "Example Robotics Inc.", "inventors": ["A. Inventor"], "priority_date": "2014-01-10",
    "filing_date": "2014-01-10", "publication_date": "2015-07-01", "grant_date": "2018-01-23", "kind": "B2",
    "legal_status": "active", "status_detail": "Active", "anticipated_expiration": "2034-03-01",
    "maintenance_fee_events": [{"date": "2021-07-01", "event": "Payment of Maintenance Fee, 4th Year, Large Entity"}],
    "entity_status": "large", "cpc_main": "B25J9/16", "cpc_all": ["B25J9/16"], "independent_claims": 3, "total_claims": 20,
    "claim1_word_count": 110, "claim1_summary": "Controller adjusting widget speed from load sensor.", "forward_citations": 25,
    "top_citing_assignees": ["Rival Corp"], "us_family_members": [], "continuation_of": None, "has_continuations": True,
    "litigation_or_licensing_mentions": [], "sources": ["https://patents.google.com/patent/US9876543B2/en"],
}


class FakeMessages:
    def __init__(self, log):
        self.log = log

    def create(self, **kw):
        prompt = kw["messages"][0]["content"]
        self.log.append({"prompt": prompt, "tools": kw.get("tools"), "system": kw.get("system"), "model": kw.get("model")})
        if "Collect the public record" in prompt:
            if "US1111111B2" in prompt:
                text = "<json>{\"title\": null}</json>"
            else:
                text = "<json>" + json.dumps(FACTS) + "</json>"
        else:
            rating = 1 if "Commercial and product relevance" in prompt else 4
            text = "Researched. <json>" + json.dumps({"rating": rating, "rationale": "Test rationale.", "confidence": 0.8,
                                                      "evidence": [{"url": "https://patents.google.com/patent/US9876543B2/en", "title": "GP",
                                                                    "date": "2026-10-01", "finding": "finding"}]}) + "</json>"
        return NS(content=[NS(type="text", text=text)], stop_reason="end_turn",
                  usage=NS(input_tokens=100, output_tokens=50, server_tool_use=NS(web_search_requests=1)))


class FakeClient:
    def __init__(self, log):
        self.messages = FakeMessages(log)


def test_normalize_numbers():
    assert ai.normalize_number("US 10,123,456 B2") == "US10123456B2"
    assert ai.normalize_number("9876543") == "US9876543"
    assert ai.normalize_number("US2021/0123456 A1") == "US20210123456A1"
    assert ai.normalize_number("RE45,678 E") == "USRE45678E"
    assert ai.normalize_number("EP1234567B1") is None
    valid, rejected = ai.extract_numbers("US10123456B2, 9,876,543\nUS20210123456A1 US7654321B2\nEP1234567B1")
    assert valid == ["US10123456B2", "US9876543", "US20210123456A1", "US7654321B2"]
    assert rejected == ["EP1234567B1"]


def test_numbers_from_xlsx():
    from openpyxl import Workbook
    wb = Workbook()
    ws = wb.active
    ws.append(["patent_number", "note"])
    ws.append(["US10123456B2", "x"])
    ws.append(["US 9,876,543 B2", None])
    buf = io.BytesIO()
    wb.save(buf)
    valid, _ = ai.numbers_from_file("p.xlsx", buf.getvalue())
    assert valid == ["US10123456B2", "US9876543B2"]


def test_prompts_have_rubrics_and_safety():
    from datetime import date
    for dim in ai.DIM_PROMPTS:
        p = ai.build_dim_prompt(dim, "US9876543B2", FACTS, date(2026, 10, 26))
        assert "Rubric:" in p and '"rating"' in p and "US9876543B2" in p or dim in ("claim_quality",)
    assert "UNTRUSTED DATA" in ai.SYSTEM
    assert ai.DIM_PROMPTS["claim_quality"]["tools"] == []


FIXTURE = os.path.join(os.path.dirname(__file__), "fixtures", "US10055028B2.html")


def _fake_fetch(num, timeout=20.0, retries=2):
    from app import google_patents
    if num.startswith("US10055028"):
        return open(FIXTURE, encoding="utf-8").read(), "https://patents.google.com/patent/US10055028B2/en"
    raise google_patents.NotFound(f"https://patents.google.com/patent/{num}/en: HTTP 404")


def test_google_patents_parser_on_real_markup():
    from app import google_patents
    f = google_patents.parse(open(FIXTURE, encoding="utf-8").read(), "US10055028B2")
    assert f["title"].startswith("End of session detection")
    assert f["current_assignee"] == "Google LLC" and f["inventors"] == ["Jason Toff"]
    assert (f["filing_date"], f["grant_date"], f["anticipated_expiration"]) == ("2016-12-05", "2018-08-21", "2037-02-22")
    assert f["legal_status"] == "active" and f["kind"] == "B2" and f["entity_status"] == "large"
    assert [e["year"] for e in f["maintenance_fee_events"]] == [4, 8]
    assert f["total_claims"] == 20 and f["independent_claims"] == 3 and f["claim1_word_count"] > 100
    assert f["forward_citations"] == 5 and "Microsoft Technology Licensing" in f["top_citing_assignees"]
    assert "Google" not in " ".join(f["top_citing_assignees"])  # owner's self-citations excluded
    assert f["cpc_main"] == "G06F3/011" and f["continuation_of"] is None


def test_status_mapping():
    from app.google_patents import _map_status
    assert _map_status("Expired - Fee Related") == "lapsed"
    assert _map_status("Expired - Lifetime") == "expired"
    assert _map_status("Abandoned") == "abandoned"
    assert _map_status("Active") == "active" and _map_status("Pending") == "pending"


def test_key_cleaning_and_info(monkeypatch):
    assert ai.clean_key(' "Bearer sk-ant-api03-abc" \n') == "sk-ant-api03-abc"
    assert ai.clean_key("ANTHROPIC_API_KEY=sk-ant-api03-xyz") == "sk-ant-api03-xyz"
    monkeypatch.setenv("ANTHROPIC_API_KEY", " sk-ant-oat01-" + "x" * 90 + " ")
    info = ai.key_info()
    assert info["had_extra_whitespace_or_quotes"] and "OAuth" in info["type"] and "x" * 20 not in str(info)


def _run_job(c, numbers):
    r = c.post("/v1/patent-analyses", json={"numbers": numbers, "name": "Live test"}, headers=H)
    assert r.status_code == 200, r.text
    sid = r.json()["search_id"]
    for _ in range(150):
        st = c.get(f"/v1/portfolio-searches/{sid}", headers=H).json()
        if st["status"] in ("REVIEW_READY", "PARTIAL", "FAILED"):
            return st
        time.sleep(0.1)
    raise AssertionError("job did not finish")


def test_live_pipeline_with_ai(monkeypatch):
    from app import google_patents
    log = []
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-api03-test")
    monkeypatch.setattr(google_patents, "fetch_html", _fake_fetch)
    ai._client_factory = lambda: FakeClient(log)
    try:
        with TestClient(app) as c:
            st = _run_job(c, "US10055028B2\nUS1111111B2")
            assert st["status"] == "PARTIAL", st  # second number not on Google Patents and Claude fallback returns nothing
            p = c.get(f"/v1/portfolios/{st['portfolio_id']}", headers=H).json()
            assert p["data_mode"] == "live_ai"
            items = c.get(f"/v1/score-runs/{p['latest_score_run_id']}/results", headers=H).json()["items"]
            assert len(items) == 1
            row = items[0]
            assert row["publication_number"] == "US10055028B2" and row["status"] == "active"
            assert row["ratings"]["commercial"] == 1 and row["ratings"]["claim_quality"] == 4
            assert all(v is not None for v in row["ratings"].values())
            assert row["recommendation"] in ("retain", "review", "abandon")
            # fee stages from real fee events: 4th and 8th year paid, 11.5 upcoming
            assert [x["state"] for x in row["fee_stages"]] == ["paid_record", "paid_record", "upcoming"]
            assert row["maintenance_paid"] == "6040.00" and row["remaining_dues"] == "8430.00" and float(row["invested_est"]) > 20000
            d = c.get(f"/v1/patents/{row['patent_asset_id']}", headers=H).json()
            assert d["score"]["dimension_scores"]["licensing"]["basis"] == "ai"
            assert any(e["source_uri"].startswith("https://patents.google.com") for e in d["evidence"])
        assert len([x for x in log if "PARAMETER:" in x["prompt"]]) == 7
        assert all("UNTRUSTED DATA" in x["system"] for x in log if x.get("system"))
    finally:
        ai._client_factory = None


def test_facts_only_without_key(monkeypatch):
    from app import google_patents
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.setattr(google_patents, "fetch_html", _fake_fetch)
    with TestClient(app) as c:
        assert c.get("/v1/ai/status").json()["configured"] is False
        st = _run_job(c, "US 10,055,028 B2")
        assert st["status"] == "REVIEW_READY", st
        p = c.get(f"/v1/portfolios/{st['portfolio_id']}", headers=H).json()
        assert p["data_mode"] == "live_record"
        row = c.get(f"/v1/score-runs/{p['latest_score_run_id']}/results", headers=H).json()["items"][0]
        assert row["ratings"]["claim_quality"] is not None and row["ratings"]["competitive"] is not None
        assert row["ratings"]["commercial"] is None  # needs AI or business inputs - left UNKNOWN, not zero
        assert row["recommendation"] == "review" and row["review_reason"] == "insufficient_evidence"


def test_bad_key_falls_back_to_records(monkeypatch):
    from app import google_patents

    class Rejecting:
        class messages:  # noqa: N801
            @staticmethod
            def create(**kw):
                e = Exception("Error code: 401 - invalid x-api-key")
                e.status_code = 401
                raise e
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-api03-wrong")
    monkeypatch.setattr(google_patents, "fetch_html", _fake_fetch)
    ai._client_factory = lambda: Rejecting()
    try:
        with TestClient(app) as c:
            t = c.post("/v1/ai/test", headers=H).json()
            assert t["ok"] is False and t["status_code"] == 401 and "Re-copy" in t["hint"]
            st = _run_job(c, "US10055028B2")
            assert st["status"] == "REVIEW_READY"
            assert any("AI key check failed" in m["msg"] for m in st["messages"])
    finally:
        ai._client_factory = None


def test_lookup_endpoint(monkeypatch):
    from app import google_patents
    monkeypatch.setattr(google_patents, "fetch_html", _fake_fetch)
    with TestClient(app) as c:
        r = c.get("/v1/patent-lookup/US10055028B2", headers=H).json()
        assert r["current_assignee"] == "Google LLC"
        assert c.get("/v1/patent-lookup/US1111111B2", headers=H).status_code == 404
