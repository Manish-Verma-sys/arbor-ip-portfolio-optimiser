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


def test_live_pipeline_end_to_end(monkeypatch):
    log = []
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    ai._client_factory = lambda: FakeClient(log)
    try:
        with TestClient(app) as c:
            assert c.get("/v1/ai/status").json()["configured"] is True
            r = c.post("/v1/patent-analyses", json={"numbers": "US9876543B2\nUS1111111B2", "name": "Live test"}, headers=H)
            assert r.status_code == 200, r.text
            sid = r.json()["search_id"]
            for _ in range(100):
                st = c.get(f"/v1/portfolio-searches/{sid}", headers=H).json()
                if st["status"] in ("REVIEW_READY", "PARTIAL", "FAILED"):
                    break
                time.sleep(0.1)
            assert st["status"] == "PARTIAL", st  # second number "not found"
            p = c.get(f"/v1/portfolios/{st['portfolio_id']}", headers=H).json()
            assert p["data_mode"] == "live_ai"
            items = c.get(f"/v1/score-runs/{p['latest_score_run_id']}/results", headers=H).json()["items"]
            assert len(items) == 1
            row = items[0]
            assert row["ratings"]["commercial"] == 1 and row["ratings"]["claim_quality"] == 4
            assert all(v is not None for v in row["ratings"].values())
            assert row["recommendation"] in ("retain", "review", "abandon")
            assert row["cost_5y"] is not None and float(row["cost_5y"]) > 0  # 7.5-yr fee due 2025-07 is past; 11.5-yr 2029-07 within 5y
            d = c.get(f"/v1/patents/{row['patent_asset_id']}", headers=H).json()
            assert d["score"]["dimension_scores"]["licensing"]["basis"] == "ai"
            assert any(e["source_uri"].startswith("https://patents.google.com") for e in d["evidence"])
        # facts call used web_fetch with the Google Patents URL in the user message
        facts_calls = [x for x in log if "Collect the public record" in x["prompt"]]
        assert any("https://patents.google.com/patent/US9876543B2/en" in x["prompt"] for x in facts_calls)
        assert any(t["type"] == "web_fetch_20250910" for t in facts_calls[0]["tools"])
        assert len([x for x in log if "PARAMETER:" in x["prompt"]]) == 7
    finally:
        ai._client_factory = None


def test_not_configured_is_clear(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    with TestClient(app) as c:
        r = c.post("/v1/patent-analyses", json={"numbers": "US9876543B2"}, headers=H)
        assert r.status_code == 409 and "ANTHROPIC_API_KEY" in r.json()["error"]["message"]
