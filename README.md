# Portfolio Maintenance Calculator

A decision-support web app that tells IP teams, for every patent, whether to **Retain**, **Review** or **Abandon** (or that it is **Not in force – review family**) — with the score, each parameter's rating, the cost of keeping it and the reason.

> **Decision support only.** Scores are not legal advice or a valuation. The system never abandons, pays or files anything; every consequential action needs an authorised person.

It implements the *Patent Portfolio Optimisation Engine — System Design & Product Requirements v1.0* specification.

## What it does

| Area | Implementation |
|---|---|
| Search & entity resolution (FR-01/02) | Company or inventor search, name normalisation, fuzzy + alias + former-name matching, candidate list with confidence and match evidence; user must confirm. Similar-name and common-inventor-name traps are included. |
| Portfolio reconstruction (FR-03/04/05) | Applications, grants, continuations, EP/CN counterparts, families, ownership timeline separating inventor / original applicant / recorded assignee / current owner. |
| Seven-dimension scoring (FR-07) | Ratings 0–5 or **UNKNOWN**; `Score = 100 × Σ(Wᵢ·Rᵢ/5) ÷ Σ(Wᵢ)` over known dimensions; data coverage and evidence confidence computed separately. |
| Cost engine (FR-08) | Deterministic USPTO maintenance fees from versioned schedules (Oct 2020 and Jan 2025), grace-period surcharges, entity size, plus configurable professional costs; non-US is UNKNOWN rather than zero; actual (sunk) costs shown separately. |
| Outcomes & checks (FR-09/10) | Four outcomes only: **Retain** (score ≥ 65), **Review** (45–64, or a reason to check first), **Abandon** (< 45), **Not in force – review family**. Review always carries one reason: borderline value, needs more evidence (coverage < 70% / confidence < 50%), data conflict (ownership/status), pending application, legal obligation, or family dependency. Low scores on pending, obligated or parent-of-continuation assets never become Abandon. |
| Explainability (FR-11) | Top positive and negative factors, missing inputs, what could change the result, weight sensitivity, evidence with source/date/reliability, scoring version and data hash. |
| Scenarios & budget (FR-12) | Weight/threshold sliders with live preview, saved scenario runs that never overwrite the default model, budget-target shortlist (for review only). |
| Explainability in the UI | Assets table shows each of the 7 parameter ratings (0–5 or ?) with its weight, the scoring model and thresholds in use, and ⓘ help on every column, KPI and section. |
| Exports (FR-15) | CSV, XLSX and PDF with data date, scoring version, weights, assumptions and disclaimer. |
| API extras | Review-decision, audit and role endpoints remain in the API (spec FR-13/14) but are not shown in the simplified UI. Tenant isolation, escaped rendering, idempotency keys and correlation IDs are kept. |


## Asset table money & fee columns

- **Est. invested to date** — attorney drafting/filing, USPTO filing fees, office-action responses, issue fee and maintenance fees already paid (official amounts from versioned USPTO schedules; professional costs are configurable assumptions).
- **Fees paid** and **Remaining dues to expiry** — maintenance fees already paid, and everything still payable until the patent expires.
- **3.5 / 7.5 / 11.5-yr fee status** — from grant date, today and legal status, and for live patents the actual fee-payment events on the register (Paid ✓, Due now, Grace, Upcoming, Not paid, —).
- **Legal status** — Active / Pending / Expired / Lapsed / Abandoned with expiry date.

## Two pathways

1. **By company** (demo data) — find the owner and rebuild its US portfolio. Filters: filing date range, legal status (active, pending, expired, lapsed, abandoned) and publication type (active, dead, pending). Every parameter is filled in the demo data.
2. **By patent numbers** (live) — type one or more US patent/application numbers, or import an Excel/CSV list (every cell is scanned). Each patent is analysed live with the Claude API:

| Step | Prompt | Tools |
|---|---|---|
| Facts | The server reads the Google Patents record directly and parses its structured markup (`app/google_patents.py`): dates, legal status, expiry incl. term adjustment, maintenance-fee payment events, entity size, CPC, independent claims, claim-1 length, forward citations and citing assignees, family. Claude's web fetch is only a fallback if the direct read fails | none (direct HTTP) |
| Commercial | Current products of the owner practising the claims; virtual patent marking pages | web search |
| Claim quality | Breadth and robustness from the claim facts only | none |
| Competitive | Citations vs. age/field norms, competitor citations, standards relevance | web search |
| Strategic | Is the technology in the owner's core segments; continuing investment; blocking value | web search |
| Portfolio | Overlap with the owner's other patents in the same CPC / family | web search |
| Licensing | Litigation, IPR, licensing programmes, third-party use | web search |
| Future | Remaining term and market outlook | web search |

Each parameter prompt has its own 0–5 rubric and returns `{rating, rationale, confidence, evidence[]}` with source URLs. Fetched web content is treated as untrusted data. Fees, the weighted score and the outcome are then computed deterministically by `costs.py` and `scoring.py`. Prompts live in `app/ai.py`.

Without `ANTHROPIC_API_KEY` the patent pathway still works in record-only mode (commercial, strategic and licensing stay unknown). `POST /v1/ai/test` checks the key.

Configuration: `ANTHROPIC_API_KEY` (optional, enables AI ratings), `ANTHROPIC_MODEL` (default `claude-sonnet-5-5`). Up to 20 patents per run; roughly one minute per patent.

## Data

No licensed patent-data provider is configured, so the app ships with:

* **Synthetic demo data** — deterministic, fictional portfolios (publication numbers carry an `S` marker, e.g. `US-S1045823-B2`, so they cannot be confused with real patents). Demo entities: *Northwind Medical Technologies*, *Helixon Semiconductor*, *Aurora Wireless*, *Bluegate Software*, *Verdant Energy Storage*; inventors *Priya Raman*, *Daniel Okafor*, *Mei-Lin Chen*. Any other name generates a public-data-only synthetic portfolio (expect *insufficient evidence* until business inputs are added — by design).
* **CSV import** — bring your own portfolio (`/v1/templates/portfolio.csv`), and upload business inputs (product mappings, strategy, licensing) per portfolio.

A live USPTO/EPO/aggregator connector plugs in behind the same pipeline once data licences are confirmed (spec §18).

## Run locally

```bash
pip install -r requirements.txt
uvicorn app.main:app --reload
# open http://localhost:8000
pytest -q   # 26 tests (Google Patents parser tested on real page markup; Claude calls faked): formula, outcomes, fee engine, checks, permissions, tenant isolation, scenarios, exports, import
```

Environment variables: `DATABASE_URL` (Postgres; default SQLite), `SQLITE_PATH`, `JOB_STEP_DELAY` (seconds per discovery stage, default 0.6).

## Deploy

`render.yaml` defines a free Render web service. On the free plan the filesystem is ephemeral, so the SQLite database (reviews, audit, scenarios) resets on redeploy or restart and the demo portfolio is re-seeded; set `DATABASE_URL` to a Render Postgres instance for durable state.

## Structure

```
app/
  main.py        API (REST, spec §10), auth/roles, jobs, exports, static hosting
  scoring.py     dimensions, formula, confidence, gates, explanations, sensitivity
  costs.py       versioned fee schedules and forward-cost forecasting
  entity.py      entity resolution
  synthetic.py   deterministic demo portfolio generator (includes spec §13.3 test cases)
  pipeline.py    persistence, score runs, scenarios, budget shortlist, CSV import
  exports.py     CSV / XLSX / PDF
static/          single-page web app (vanilla JS, no build step)
tests/           pytest suite
```
