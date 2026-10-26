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
pytest -q   # 16 tests: formula, outcomes, fee engine, checks, permissions, tenant isolation, scenarios, exports, import
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
