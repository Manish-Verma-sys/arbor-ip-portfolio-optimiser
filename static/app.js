/* Portfolio Maintenance Calculator — single-page app (no framework). All server data is escaped before rendering. */
"use strict";

const S = { meta: null, me: null, uid: "u_admin", pf: {}, filters: {}, scen: {}, poll: null };
const $ = (q, el = document) => el.querySelector(q);
const $$ = (q, el = document) => [...el.querySelectorAll(q)];
const main = () => $("#main");

const REC_COLORS = { retain: "#00A39A", review: "#D9A46F", abandon: "#B5523B", not_in_force: "#B8C0C5" };
const REC_ORDER = ["retain", "review", "abandon", "not_in_force"];
const REC_SHORT = {
  retain: "Keep paying fees — value justifies cost",
  review: "Needs a human look before the next fee",
  abandon: "Low value for its cost — candidate to let lapse",
  not_in_force: "Already expired / lapsed — check family",
};
const REASON_SHORT = {
  borderline_value: "Borderline value", insufficient_evidence: "Needs more evidence", data_conflict: "Data conflict",
  pending_application: "Pending application", obligation: "Legal obligation", family_dependency: "Family dependency",
};
const DIM_SHORT = { commercial: "Commercial", claim_quality: "Claims", competitive: "Competitive", strategic: "Strategic",
  portfolio: "Portfolio", licensing: "Licensing", future: "Future" };
const DIM_HELP = {
  commercial: "Is the patent used in a product today? Rated from your product mapping: product lifecycle, revenue band and confirmed use.",
  claim_quality: "How strong and broad the claims are: number of independent claims, length of claim 1, narrowing during prosecution and RCEs.",
  competitive: "Market relevance: forward citations compared with similar patents, citations by competitors and standards relevance (needs at least 2 signals).",
  strategic: "Your business strategy tag (core / defensive / non-core) plus freedom-to-operate and roadmap relevance.",
  portfolio: "How unique the patent is in your portfolio: other live patents in the same technology, and family dependencies.",
  licensing: "Licensing history and evidence-of-use leads that suggest licensing or enforcement potential.",
  future: "Growth of patent filings in this technology area and how many years of term remain.",
};
const GLOSS = {
  score: "Value score (0–100): the weighted average of the 7 parameter ratings, using only parameters that have evidence. Higher means more worth keeping.",
  rating: "Each parameter is rated 0–5 (0 = evidence of very low relevance, 5 = critical). '?' means UNKNOWN — not enough evidence; it is left out of the score, not counted as zero.",
  coverage: "Data coverage: the share of the scoring weight that has enough evidence. 75% means parameters worth 75 of the 100 weight points were rated. Below the minimum (default 70%) the outcome is Review – needs more evidence.",
  confidence: "Evidence confidence: how reliable, recent and direct the evidence is (official registers score high, unverified leads low). Below the minimum (default 50%) the outcome is Review.",
  outcome: "Retain: score at or above the retain threshold (default 65) — keep paying fees. Review: borderline score (45–64) or something needs checking first (missing evidence, data conflict, pending application, legal obligation). Abandon: score below 45 — low value for its cost; candidate to let lapse after confirmation. Not in force: already expired, lapsed or abandoned.",
  checks: "Automatic checks on ownership, legal status, fee deadlines and obligations. PASS = nothing found. REVIEW = something to verify (e.g. fee due soon). BLOCK = ownership or legal-status conflict that must be fixed before relying on the outcome.",
  cost5: "Forward cost over the next 5 years: official USPTO maintenance fees (19 Jan 2025 schedule, by entity size) plus estimated annuity-service / attorney costs. UNKNOWN for non-US members because no fee schedule is configured for them.",
  cost3: "Forward cost over the next 3 years: official USPTO maintenance fees plus estimated professional costs.",
  deadline: "Next maintenance-fee due date (3.5, 7.5 or 11.5 years after grant). The fee window opens 6 months earlier; a 6-month grace period follows with a surcharge, after which the patent lapses.",
  status: "Legal status: active (in force), pending (application not yet granted), expired (end of term), lapsed (fee not paid), abandoned.",
  asset: "Publication number, title and relationship in the family: original filing, continuation (US follow-on application) or foreign counterpart (same invention in another country).",
  jurisdiction: "Patent office: US (USPTO), EP (European Patent Office) or CN (China).",
  weight: "Weight: how much each parameter counts in the score. All weights add up to 100.",
  families: "A patent family is the set of applications that share a priority filing — the same invention filed as continuations or in other countries.",
  inforce: "In force = granted and active. Pending = applications still being examined.",
  coverage_kpi: "Average data coverage across all assets, and average evidence confidence. Add business inputs to raise both.",
  issues: "Assets with a blocking data issue (ownership or status conflict) · assets whose legal status has not been rechecked recently.",
  model: "The scoring model is the set of parameter weights and thresholds used to turn ratings into a score and an outcome. Change it on the Scoring model page, or try alternatives in Scenarios without changing the default.",
  attention: "Assets with a fee due within the warning window, a fee in its grace period, or a data conflict to resolve.",
  costyear: "Total forecast spend per calendar year: official fees plus estimated professional costs.",
  money: "Money columns in US dollars. 'Est. invested to date' is sunk cost; 'Fees paid' is official maintenance fees already paid; 'Remaining dues to expiry' is what it will still cost to keep the patent in force until it expires.",
  invested: "Estimated amount already spent on this patent: attorney drafting & filing, USPTO filing/search/examination fees, office-action responses, issue fee and maintenance fees paid so far. Official fees use USPTO schedules; professional costs use the assumptions on the Scoring model & costs page.",
  feespaid: "USPTO maintenance fees already paid (3.5, 7.5 and 11.5-year fees), using the fee schedule in force on each due date and the entity size.",
  remaining: "Total still to pay to keep the patent in force until it expires: remaining USPTO maintenance fees (plus surcharge if in grace) and annuity-service costs. For pending applications it also includes estimated prosecution and the issue fee. $0 when nothing is left or the patent is no longer in force.",
  feestatus: "Status of each USPTO maintenance fee, worked out from the grant date, today's date and the legal status — and, for live patents, the actual fee-payment events on the register. Paid ✓ = on record or inferred; Due now = 6-month payment window open; Grace = surcharge period; Not paid = patent lapsed at that stage; — = not applicable.",
  fee35: "Fee due 3.5 years after grant (window opens at 3 years; 6-month grace period with surcharge until 4 years).",
  fee75: "Fee due 7.5 years after grant (window opens at 7 years; grace period until 8 years).",
  fee115: "Fee due 11.5 years after grant (window opens at 11 years; grace period until 12 years). It is the last US maintenance fee.",
  legalstatus: "Legal status from the patent register: Active (in force), Pending (application under examination), Expired (end of 20-year term), Lapsed (a maintenance fee was not paid), Abandoned. The expiry shown includes any patent-term adjustment where known.",
  scatter: "Each dot is an asset: further right = more expensive to keep, higher = more valuable. Bottom-right dots are the strongest candidates to drop.",
};
function tip(key, text) {
  const t = text || GLOSS[key] || DIM_HELP[key] || "";
  return `<button type="button" class="ibtn" data-tip="${esc(t)}" aria-label="What does this mean? ${esc(t)}">i</button>`;
}
function initTips() {
  const box = document.createElement("div");
  box.id = "tipbox"; box.setAttribute("role", "tooltip"); box.hidden = true;
  document.body.appendChild(box);
  let pinned = null;
  const show = (el) => {
    box.textContent = el.dataset.tip; box.hidden = false;
    const r = el.getBoundingClientRect(); const bw = Math.min(320, window.innerWidth - 24);
    box.style.maxWidth = bw + "px";
    let left = Math.min(Math.max(12, r.left + r.width / 2 - bw / 2), window.innerWidth - bw - 12);
    box.style.left = left + window.scrollX + "px";
    const below = r.bottom + 8 + box.offsetHeight < window.innerHeight;
    box.style.top = (below ? r.bottom + 8 : r.top - box.offsetHeight - 8) + window.scrollY + "px";
  };
  const hide = () => { if (!pinned) box.hidden = true; };
  document.addEventListener("mouseover", (e) => { const b = e.target.closest(".ibtn"); if (b) show(b); });
  document.addEventListener("mouseout", (e) => { if (e.target.closest(".ibtn")) hide(); });
  document.addEventListener("focusin", (e) => { const b = e.target.closest(".ibtn"); if (b) show(b); });
  document.addEventListener("focusout", (e) => { if (e.target.closest(".ibtn")) { pinned = null; hide(); } });
  document.addEventListener("click", (e) => {
    const b = e.target.closest(".ibtn");
    if (b) { e.preventDefault(); e.stopPropagation(); pinned = pinned === b ? null : b; pinned ? show(b) : (box.hidden = true); return; }
    if (pinned) { pinned = null; box.hidden = true; }
  }, true);
  window.addEventListener("scroll", () => { if (!pinned) box.hidden = true; }, { passive: true });
  window.addEventListener("hashchange", () => { pinned = null; box.hidden = true; });
  window.addEventListener("resize", () => { pinned = null; box.hidden = true; });
}
const JOB_STEPS = [["CREATED", "Entity confirmed"], ["DISCOVERING", "Discovering applications & grants"], ["NORMALISING", "De-duplicating & grouping families"],
  ["ENRICHING", "Attaching evidence, status & costs"], ["SCORING", "Scoring, gates & recommendations"], ["REVIEW_READY", "Ready for review"]];

function esc(v) {
  if (v === null || v === undefined) return "";
  return String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
const can = (p) => !!(S.me && S.me.perms.includes(p));
const recLabel = (k) => (S.meta?.recommendations.find((r) => r.key === k) || { label: k }).label;
const dimLabel = (k) => (S.meta?.dimensions.find((d) => d.key === k) || { label: k }).label;
const fmtMoney = (v, unknown) => (unknown ? '<span class="unknown">UNKNOWN</span>' : v === null || v === undefined || v === "" ? "—" : "$" + Number(v).toLocaleString("en-US", { maximumFractionDigits: 0 }));
const fmtDate = (d) => (d ? new Date(d.length <= 10 ? d + "T00:00:00" : d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—");
const fmtDT = (d) => (d ? new Date(d.endsWith("Z") ? d : d + "Z").toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
const daysTo = (d) => (d ? Math.round((new Date(d + "T00:00:00") - new Date(new Date().toDateString())) / 86400000) : null);
const recPill = (k, lbl) => `<span class="rec rec-${esc(k)}"><i aria-hidden="true"></i>${esc(lbl || recLabel(k))}</span>`;
const recCell = (r) => `${recPill(r.recommendation)}${r.review_reason ? `<div class="xsmall reason">${esc(REASON_SHORT[r.review_reason] || r.review_reason)}</div>` : ""}`;
const FEE_CHIP = {
  paid_record: ["Paid", "fc-paid", "Paid — recorded on the USPTO register"], paid: ["Paid", "fc-paid2", "Paid — inferred: the patent stayed in force past this fee's grace period"],
  due_now: ["Due now", "fc-due", "Payment window is open"], in_grace: ["Grace", "fc-grace", "In the 6-month grace period — surcharge applies"],
  upcoming: ["Upcoming", "fc-up", "Not yet due"], not_paid: ["Not paid", "fc-unpaid", "Not paid — the patent lapsed at this stage"],
  not_applicable: ["—", "fc-na", "Not applicable"], unknown: ["?", "fc-na", "Unknown"],
};
function feeChip(st) {
  if (!st) return '<span class="fc fc-na">—</span>';
  const [lbl, cls, help] = FEE_CHIP[st.state] || ["?", "fc-na", st.label];
  const sub = ["upcoming", "due_now", "in_grace"].includes(st.state) && st.due_date ? `<div class="xsmall muted">${fmtDate(st.due_date)}</div><div class="xsmall muted">${fmtMoney(st.amount)}</div>`
    : ["paid", "paid_record"].includes(st.state) ? `<div class="xsmall muted">${fmtMoney(st.amount)}</div>` : "";
  return `<span class="fc ${cls}" title="${esc(st.label || help)}${st.due_date ? " · due " + esc(st.due_date) : ""}">${st.state === "paid_record" ? "✓ " : st.state === "paid" ? "✓ " : ""}${lbl}</span>${sub}`;
}
const LEGAL = { active: ["Active", "ls-active"], pending: ["Pending", "ls-pending"], expired: ["Expired", "ls-dead"], lapsed: ["Lapsed", "ls-dead"],
  abandoned: ["Abandoned", "ls-dead"], withdrawn: ["Withdrawn", "ls-dead"], unknown: ["Unknown", "ls-dead"] };
const legalCell = (r) => { const [l, c] = LEGAL[r.status] || [r.status, "ls-dead"];
  return `<span class="ls ${c}">${esc(l)}</span>${r.status_detail && r.status_detail.toLowerCase() !== l.toLowerCase() ? `<div class="xsmall muted">${esc(r.status_detail)}</div>` : r.status === "lapsed" ? '<div class="xsmall muted">fee not paid</div>' : r.status === "expired" ? '<div class="xsmall muted">end of term</div>' : ""}${r.expiry_estimate && ["active", "pending"].includes(r.status) ? `<div class="xsmall muted">expires ${fmtDate(r.expiry_estimate)}</div>` : ""}`; };
const ratingChip = (v, detail = {}) => { const why = (detail.rationale || (v === null || v === undefined ? "No evidence-backed rating is available yet." : "No detailed rationale was returned for this rating.")); const basis = detail.basis ? ` Basis: ${detail.basis}.` : ""; const conf = Number.isFinite(Number(detail.confidence)) ? ` Confidence: ${Math.round(Number(detail.confidence) * 100)}%.` : ""; const ev = detail.evidence_count ? ` Evidence items: ${detail.evidence_count}.` : ""; const title = `${v === null || v === undefined ? "UNKNOWN" : `Rating ${v}/5`}. ${why}${basis}${conf}${ev} Hover for rationale; use evidence and analyst review before decisions.`; return v === null || v === undefined ? `<span class="rt rt-u" title="${esc(title)}" tabindex="0" aria-label="${esc(title)}">?</span>` : `<span class="rt rt-${v}" title="${esc(title)}" tabindex="0" aria-label="${esc(title)}">${v}</span>`; };
const gatePill = (g) => `<span class="badge gate gate-${esc(g)}">${esc(g)}</span>`;
const statusTxt = (s) => `<span class="status status-${esc(s)}">${esc(s)}</span>`;
const modeBadge = (m) => (m === "synthetic" ? '<span class="badge b-syn" title="Fictional demonstration data">SYNTHETIC DEMO DATA</span>'
  : m === "live_ai" ? '<span class="badge b-live" title="Real public patent records, assessed by Claude">LIVE DATA · AI-ASSESSED</span>'
  : m === "live_record" ? '<span class="badge b-live" title="Real public patent records (no AI ratings)">LIVE DATA · RECORD ONLY</span>'
  : m === "imported" ? '<span class="badge b-imp">CUSTOMER IMPORT</span>' : `<span class="badge b-mute">${esc(m)}</span>`);

/* Multi-select dropdown: msel(name, [[value,label]...], selectedArray, allLabel) — read with mselValue(el) */
function msel(name, options, selected = [], allLabel = "All") {
  const sel = new Set(selected || []);
  const label = !sel.size ? allLabel : sel.size === 1 ? (options.find((o) => o[0] === [...sel][0]) || [0, [...sel][0]])[1] : `${sel.size} selected`;
  return `<details class="msel" data-name="${esc(name)}"><summary><span class="msel-label">${esc(label)}</span></summary>
    <div class="msel-pop" role="listbox" aria-multiselectable="true">
      ${options.map(([v, l]) => `<label class="msel-opt"><input type="checkbox" value="${esc(v)}" ${sel.has(v) ? "checked" : ""}> <span>${esc(l)}</span></label>`).join("")}
      <div class="msel-foot"><button type="button" class="btn btn-quiet btn-xs" data-msel-clear>Clear</button><button type="button" class="btn btn-quiet btn-xs" data-msel-all>All</button></div>
    </div></details>`;
}
const mselValue = (el) => $$("input:checked", el).map((i) => i.value);
function bindMsel(root, onChange) {
  $$(".msel", root).forEach((d) => {
    const opts = $$("input", d).map((i) => [i.value, i.nextElementSibling.textContent]);
    const all = d.closest("[data-all-label]")?.dataset.allLabel;
    const refresh = () => {
      const v = mselValue(d);
      $(".msel-label", d).textContent = !v.length ? (d.dataset.allLabel || "All") : v.length === 1 ? opts.find((o) => o[0] === v[0])[1] : `${v.length} selected`;
      onChange && onChange(d.dataset.name, v);
    };
    d.addEventListener("change", refresh);
    $("[data-msel-clear]", d).addEventListener("click", () => { $$("input", d).forEach((i) => (i.checked = false)); refresh(); });
    $("[data-msel-all]", d).addEventListener("click", () => { $$("input", d).forEach((i) => (i.checked = true)); refresh(); });
  });
}
document.addEventListener("click", (e) => { $$("details.msel[open]").forEach((d) => { if (!d.contains(e.target)) d.open = false; }); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") $$("details.msel[open]").forEach((d) => { d.open = false; $("summary", d).focus(); }); });
const barCls = (v) => (v < 50 ? "vlow" : v < 70 ? "low" : "");

const ICON = {
  doc: '<svg viewBox="0 0 24 24"><path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h6"/></svg>',
  fam: '<svg viewBox="0 0 24 24"><circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="12" cy="18" r="2.5"/><path d="M6 8.5v2a3 3 0 003 3h6a3 3 0 003-3v-2M12 13.5v2"/></svg>',
  coin: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M14.5 9.5c-.5-1-1.5-1.5-2.5-1.5-1.5 0-2.5.8-2.5 2s1 1.6 2.5 2 2.5.8 2.5 2-1 2-2.5 2c-1.2 0-2.2-.6-2.6-1.6M12 6.5v1.5M12 16v1.5"/></svg>',
  shield: '<svg viewBox="0 0 24 24"><path d="M12 3l7 3v6c0 4-3 7.5-7 9-4-1.5-7-5-7-9V6z"/><path d="M9 12l2 2 4-4"/></svg>',
  alert: '<svg viewBox="0 0 24 24"><path d="M12 3l9 16H3z"/><path d="M12 10v4M12 17v.5"/></svg>',
  gauge: '<svg viewBox="0 0 24 24"><path d="M4 16a8 8 0 1116 0"/><path d="M12 16l4-5"/></svg>',
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="#005376" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.5v.5"/></svg>',
  warn: '<svg viewBox="0 0 24 24" fill="none" stroke="#8a5a10" stroke-width="1.8"><path d="M12 3l9 16H3z"/><path d="M12 10v4M12 17v.5"/></svg>',
};

/* ---------------------------------------------------------------- api */
async function api(path, opts = {}) {
  const headers = { "X-User-Id": S.uid, ...(opts.headers || {}) };
  let body = opts.body;
  if (body && !(body instanceof FormData) && typeof body !== "string") { headers["Content-Type"] = "application/json"; body = JSON.stringify(body); }
  const res = await fetch(path, { ...opts, headers, body });
  const ct = res.headers.get("content-type") || "";
  const data = ct.includes("json") ? await res.json() : await res.text();
  if (!res.ok) {
    const msg = data?.error?.message || (Array.isArray(data?.detail) ? data.detail.map((d) => `${d.loc?.slice(-1)[0]}: ${d.msg}`).join("; ") : data?.detail) || `Request failed (${res.status})`;
    const e = new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
    e.status = res.status;
    throw e;
  }
  return data;
}
const idem = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()));

function toast(msg, err) {
  const t = document.createElement("div");
  t.className = "toast" + (err ? " err" : "");
  t.textContent = msg;
  $("#toasts").appendChild(t);
  setTimeout(() => t.remove(), err ? 7000 : 4200);
}
function modal(html) {
  $("#modalBody").innerHTML = html;
  $("#modal").hidden = false;
  setTimeout(() => $("#modalBody input, #modalBody select, #modalBody textarea")?.focus(), 30);
}
function closeModal() { $("#modal").hidden = true; $("#modalBody").innerHTML = ""; }
$("#modal").addEventListener("click", (e) => { if (e.target.id === "modal" || e.target.hasAttribute("data-close")) closeModal(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#modal").hidden) closeModal(); });
async function download(path, fallbackName) {
  try {
    const res = await fetch(path, { headers: { "X-User-Id": S.uid } });
    if (!res.ok) throw new Error((await res.json()).error?.message || "Export failed");
    const blob = await res.blob();
    const cd = res.headers.get("content-disposition") || "";
    const name = (cd.match(/filename=([^;]+)/) || [])[1] || fallbackName;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  } catch (ex) { toast(ex.message, true); }
}
const loading = (msg = "Loading…") => `<div class="wrap page"><div class="card"><div class="skeleton" style="width:40%"></div><div class="skeleton" style="margin-top:12px"></div><div class="skeleton" style="margin-top:12px;width:70%"></div><p class="muted small" style="margin-top:12px">${esc(msg)}</p></div></div>`;
const errorView = (ex) => `<div class="wrap page"><div class="card empty"><h3>Something went wrong</h3><p>${esc(ex.message)}</p><a class="btn btn-ghost" href="#/portfolios">Back to portfolios</a></div></div>`;

/* ---------------------------------------------------------------- router */
const routes = [
  [/^\/?$/, viewHome],
  [/^\/portfolios$/, viewPortfolios],
  [/^\/search\/([\w-]+)$/, viewSearch],
  [/^\/p\/([\w-]+)(?:\/(\w+))?$/, viewPortfolio],
  [/^\/a\/([\w-]+)$/, viewAsset],
  [/^\/settings$/, viewSettings],
];
function parseHash() {
  const h = location.hash.replace(/^#/, "") || "/";
  const [path, qs] = h.split("?");
  return { path, q: new URLSearchParams(qs || "") };
}
async function router() {
  clearInterval(S.poll);
  const { path, q } = parseHash();
  $$(".nav a").forEach((a) => a.classList.toggle("active", path.startsWith("/" + a.dataset.nav) || (a.dataset.nav === "portfolios" && /^\/(p|a)\//.test(path))));
  $("#nav").classList.remove("open");
  for (const [re, fn] of routes) {
    const m = path.match(re);
    if (m) {
      try { await fn(...m.slice(1), q); } catch (ex) { console.error(ex); main().innerHTML = errorView(ex); }
      main().focus({ preventScroll: true });
      return;
    }
  }
  main().innerHTML = errorView(new Error("Page not found"));
}
window.addEventListener("hashchange", () => { router(); window.scrollTo(0, 0); });

/* ---------------------------------------------------------------- boot */
async function boot() {
  $("#navToggle").addEventListener("click", (e) => { const n = $("#nav"); n.classList.toggle("open"); e.currentTarget.setAttribute("aria-expanded", n.classList.contains("open")); });
  initTips();
  const meta = await api("/v1/meta");
  S.meta = meta;
  $("#disclaimer").textContent = meta.disclaimer;
  $("#footMeta").innerHTML = `v${esc(meta.version)} · ${esc(meta.scoring_version)}<br>Company-search demo data is fictional.`;
  S.me = await api("/v1/me");
  router();
}

/* ================================================================ HOME */
async function viewHome() {
  const aiStatus = await api("/v1/ai/status").catch(() => ({ configured: false }));
  const dq = S.meta.demo_queries.company;
  main().innerHTML = `
  <section class="hero"><div class="wrap hero-grid">
    <div>
      <div class="eyebrow">Patent maintenance decisions</div>
      <h1>Know which patents to keep, review or let go.</h1>
      <p class="lead">Start from a company or from a list of patent numbers. The calculator scores seven value parameters, forecasts USPTO maintenance fees and tells you for each patent whether to <b>Retain</b>, <b>Review</b> or <b>Abandon</b> — and why.</p>
      <div class="paths">
        <div class="path"><b>1 · By company</b><span>Find the owner, rebuild its US portfolio, filter by filing date, legal status and publication type. <em>Demo data.</em></span></div>
        <div class="path"><b>2 · By patent numbers</b><span>Type one or more US patent numbers or import an Excel/CSV list. Each patent is analysed live from public records.</span></div>
      </div>
    </div>
    <div class="search-card" id="searchCard">
      <div class="seg" role="tablist" aria-label="Choose a pathway">
        <button role="tab" class="on" data-t="company" aria-selected="true">By company</button>
        <button role="tab" data-t="patents" aria-selected="false">By patent numbers</button>
      </div>

      <form id="sf" autocomplete="off" class="pane" data-pane="company">
        <label class="f"><span>Company or assignee name</span><input class="input input-lg" name="name" required minlength="2" placeholder="e.g. Northwind Medical Technologies" /></label>
        <div class="row2">
          <label class="f"><span>Filing date from ${tip(null, "Only include patents and applications filed on or after this date.")}</span><input class="input" type="date" name="filing_from" /></label>
          <label class="f"><span>Filing date to</span><input class="input" type="date" name="filing_to" /></label>
        </div>
        <div class="row2">
          <div class="f"><span class="flabel">Legal status ${tip("status")}</span>${msel("legal_status", [["active", "Active"], ["pending", "Pending"], ["expired", "Expired"], ["lapsed", "Lapsed (fee not paid)"], ["abandoned", "Abandoned"]], [], "Any status")}</div>
          <div class="f"><span class="flabel">Publication type ${tip(null, "Active = granted and in force. Dead = expired, lapsed or abandoned. Pending = application not yet granted.")}</span>${msel("publication_types", [["active", "Active"], ["dead", "Dead"], ["pending", "Pending"]], [], "Any type")}</div>
        </div>
        <details class="adv"><summary>More options</summary>
          <div class="row2">
            <label class="f"><span>Country</span><input class="input" name="country" placeholder="US" maxlength="2" /></label>
            <label class="f"><span>Website / domain</span><input class="input" name="domain" placeholder="example.com" /></label>
          </div>
          <label class="f"><span>Former names (comma-separated)</span><input class="input" name="former_names" placeholder="Northwind Surgical Corp." /></label>
          <label class="check"><input type="checkbox" name="include_subsidiaries" /> Include documented subsidiaries & acquisitions</label>
        </details>
        <div class="btn-row" style="justify-content:space-between">
          <span class="help">US patents only · demo data</span>
          <button class="btn btn-teal">Find company</button>
        </div>
        <div class="divider"></div>
        <div class="small muted" style="margin-bottom:8px">Try a demo company</div>
        <div class="chips">${dq.map((n) => `<button class="chip" type="button">${esc(n)}</button>`).join("")}</div>
      </form>

      <form id="pf" autocomplete="off" class="pane hide" data-pane="patents">
        <div class="callout ${aiStatus.configured ? "callout-ocean" : "callout-warn"} small" style="margin-bottom:12px">${aiStatus.configured ? ICON.info : ICON.warn}<div>
          Each patent is read <b>directly from Google Patents</b> (dates, legal status, fee payments, claims, citations, family).
          ${aiStatus.configured ? `The 7 parameters are then researched by <b>${esc(aiStatus.model)}</b> (~1 min per patent, up to ${aiStatus.max_patents} per run).` : `<b>No API key is set</b>, so only record-based parameters are rated; commercial, strategic and licensing stay unknown.`}
          <div class="btn-row" style="margin-top:6px"><span class="xsmall muted" id="keyInfo">${aiStatus.key && aiStatus.key.present ? `API key: ${esc(aiStatus.key.type)}${aiStatus.key.had_extra_whitespace_or_quotes ? " (extra spaces/quotes removed)" : ""}` : "API key: not set"}</span>${aiStatus.configured ? '<button type="button" class="btn btn-ghost btn-xs" id="testKey">Test API key</button>' : ""}</div></div></div>
        <label class="f"><span>US patent numbers ${tip(null, "One or more US patent or application numbers, separated by new lines, commas or spaces. Formats like US10123456B2, 10,123,456, US 9,876,543 B2 or US20210123456A1 all work.")}</span>
          <textarea class="input" name="numbers" rows="5" placeholder="US10123456B2&#10;US 9,876,543 B2&#10;US20210123456A1"></textarea></label>
        <div class="row2">
          <label class="f"><span>…or import Excel / CSV ${tip(null, "Any .xlsx or .csv file — every cell is scanned for US patent numbers. Download the template for the expected layout.")}</span><input class="input" type="file" name="file" accept=".xlsx,.xlsm,.csv,text/csv" /></label>
          <label class="f"><span>USPTO entity size ${tip(null, "Drives the official maintenance-fee amounts: small entity pays 40% and micro 20% of the large-entity fee. 'From record' uses the size shown in the patent's fee events.")}</span><select class="input" name="entity_size"><option value="auto">From record</option><option value="large">Large</option><option value="small">Small</option><option value="micro">Micro</option></select></label>
        </div>
        <label class="f"><span>Analysis name (optional)</span><input class="input" name="name" placeholder="e.g. Q1 renewal list" /></label>
        <div id="preview" class="small"></div>
        <div class="btn-row" style="justify-content:space-between;margin-top:6px">
          <button type="button" class="btn btn-quiet btn-sm" id="tplX">Download Excel template</button>
          <div class="btn-row"><button type="button" class="btn btn-ghost btn-sm" id="checkList">Check list</button><button class="btn btn-teal">Analyse patents</button></div>
        </div>
      </form>
    </div>
  </div>
  <div class="wrap"><div class="steps">
    <div class="step"><span class="n">01</span><b>Find</b><span class="small muted">A company's US portfolio, or your own list of patent numbers.</span></div>
    <div class="step"><span class="n">02</span><b>Read the record</b><span class="small muted">Dates, legal status, fee events, claims, citations, family.</span></div>
    <div class="step"><span class="n">03</span><b>Score & cost</b><span class="small muted">Seven parameters rated 0–5, USPTO fees over 3 and 5 years.</span></div>
    <div class="step"><span class="n">04</span><b>Decide</b><span class="small muted">Retain, Review or Abandon — with reasons and sources.</span></div>
  </div></div></section>
  <section class="wrap page">
    <div class="card"><div class="card-head"><h3>Recent analyses</h3><a class="btn btn-quiet btn-sm" href="#/portfolios">View all →</a></div><div id="recent">${'<div class="skeleton"></div>'.repeat(3)}</div></div>
  </section>`;
  bindMsel($("#sf"));
  $$(".seg button").forEach((b) => b.addEventListener("click", () => {
    $$(".seg button").forEach((x) => { x.classList.toggle("on", x === b); x.setAttribute("aria-selected", x === b); });
    $$(".pane").forEach((p) => p.classList.toggle("hide", p.dataset.pane !== b.dataset.t));
  }));
  $(".chips").addEventListener("click", (e) => { if (e.target.matches(".chip")) { $("#sf [name=name]").value = e.target.textContent; $("#sf [name=name]").focus(); } });
  $("#sf").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const list = (k) => (f.get(k) || "").split(",").map((x) => x.trim()).filter(Boolean);
    const body = { query_type: "company", name: f.get("name").trim(), jurisdiction_scope: ["US"], country: f.get("country") || null, domain: f.get("domain") || null,
      former_names: list("former_names"), include_subsidiaries: !!f.get("include_subsidiaries"),
      filing_from: f.get("filing_from") || null, filing_to: f.get("filing_to") || null,
      legal_status: mselValue($("#sf .msel[data-name=legal_status]")), publication_types: mselValue($("#sf .msel[data-name=publication_types]")) };
    if (body.filing_from && body.filing_to && body.filing_from > body.filing_to) { toast("'Filing date from' is after 'to'", true); return; }
    try { const s = await api("/v1/portfolio-searches", { method: "POST", body, headers: { "Idempotency-Key": idem() } }); location.hash = `#/search/${s.search_id}`; }
    catch (ex) { toast(ex.message, true); }
  });
  const pform = $("#pf");
  const check = async () => {
    const fd = new FormData(); const file = pform.file.files[0];
    if (file) fd.append("file", file); else fd.append("numbers", pform.numbers.value);
    const r = await api("/v1/patent-analyses/parse", { method: "POST", body: fd });
    $("#preview").innerHTML = r.valid.length || r.rejected.length ? `<div class="callout ${r.valid.length > r.max ? "callout-warn" : "callout-cream"}" style="margin:4px 0 8px">${ICON.info}<div><b>${r.valid.length}</b> US patent number(s) recognised${r.valid.length > r.max ? ` — the limit is ${r.max} per run` : ""}: <span class="mono xsmall">${r.valid.slice(0, 20).map(esc).join(", ")}${r.valid.length > 20 ? "…" : ""}</span>${r.rejected.length ? `<div class="xsmall" style="margin-top:4px">Not recognised (non-US or invalid): ${r.rejected.slice(0, 8).map(esc).join(", ")}</div>` : ""}</div></div>` : `<p class="muted">No patent numbers entered yet.</p>`;
    return r;
  };
  $("#checkList").addEventListener("click", () => check().catch((ex) => toast(ex.message, true)));
  $("#testKey")?.addEventListener("click", async (e) => {
    e.target.disabled = true; e.target.textContent = "Testing…";
    try { const r = await api("/v1/ai/test", { method: "POST" });
      $("#keyInfo").innerHTML = r.ok ? `<span class="ls ls-active">✓ API key works</span> (${esc(r.model)})` : `<span class="ls ls-dead">✗ Key not working${r.status_code ? " (" + r.status_code + ")" : ""}</span> — ${esc(r.hint || r.error || "")}`;
    } catch (ex) { toast(ex.message, true); }
    e.target.disabled = false; e.target.textContent = "Test API key";
  });
  pform.file.addEventListener("change", () => check().catch((ex) => toast(ex.message, true)));
  $("#tplX").addEventListener("click", () => download("/v1/templates/patent-numbers.xlsx", "patent_numbers_template.xlsx"));
  pform.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = e.submitter; btn.disabled = true; btn.textContent = "Starting…";
    try {
      const file = pform.file.files[0];
      let s;
      if (file) {
        const fd = new FormData(); fd.append("file", file); fd.append("name", pform.name.value); fd.append("entity_size", pform.entity_size.value);
        s = await api("/v1/patent-analyses/upload", { method: "POST", body: fd });
      } else {
        s = await api("/v1/patent-analyses", { method: "POST", body: { numbers: pform.numbers.value, name: pform.name.value || null, entity_size: pform.entity_size.value } });
      }
      location.hash = `#/search/${s.search_id}`;
    } catch (ex) { toast(ex.message, true); btn.disabled = false; btn.textContent = "Analyse patents"; }
  });
  try {
    const pfs = await api("/v1/portfolios");
    $("#recent").innerHTML = pfs.length ? pfs.slice(0, 6).map(pfRow).join("") : `<div class="empty small">Nothing yet — start above.</div>`;
  } catch (ex) { $("#recent").innerHTML = `<p class="muted">${esc(ex.message)}</p>`; }
}

function pfRow(p) {
  const s = p.summary || {};
  const br = s.by_recommendation || {};
  return `<a href="#/p/${esc(p.portfolio_id)}" style="display:grid;grid-template-columns:1fr auto;gap:8px;padding:12px 4px;border-bottom:1px solid var(--line-2);text-decoration:none;color:inherit">
    <div><div style="font-family:var(--serif);font-size:18px;color:var(--ocean)">${esc(p.name)}</div>
      <div class="small muted">${s.assets ?? "—"} assets · ${s.families ?? "—"} families · ${fmtMoney(s.forward_cost?.["5"])} 5-yr cost · <span class="rec-retain">${br.retain || 0} retain</span> · ${br.review || 0} review · <span class="rec-abandon">${br.abandon || 0} abandon</span></div></div>
    <div class="right">${modeBadge(p.data_mode)}${p.provisional ? ' <span class="badge b-warn">PROVISIONAL</span>' : ""}<div class="xsmall muted" style="margin-top:4px">${fmtDT(p.latest_run_at)}</div></div></a>`;
}

/* ================================================================ PORTFOLIO LIST */
async function viewPortfolios() {
  main().innerHTML = loading();
  const pfs = await api("/v1/portfolios");
  main().innerHTML = `<div class="wrap page">
    <div class="card-head"><div><div class="eyebrow">Workspace · ${esc(S.me.tenant.name)}</div><h2>Portfolios</h2></div><a class="btn btn-teal" href="#/">New search or import</a></div>
    <div class="card">${pfs.length ? pfs.map(pfRow).join("") : `<div class="empty"><h3>No portfolios in this tenant</h3><p>Start with a company or inventor search.</p></div>`}</div></div>`;
}

/* ================================================================ SEARCH / ENTITY CONFIRMATION */
async function viewSearch(sid) {
  main().innerHTML = loading("Resolving entity…");
  const s = await api(`/v1/portfolio-searches/${sid}`);
  if (s.status === "ENTITY_REVIEW_REQUIRED") return renderCandidates(s);
  renderProgress(s);
  if (!["REVIEW_READY", "PARTIAL", "FAILED"].includes(s.status)) {
    S.poll = setInterval(async () => {
      try {
        const n = await api(`/v1/portfolio-searches/${sid}`);
        renderProgress(n);
        if (["REVIEW_READY", "PARTIAL", "FAILED"].includes(n.status)) {
          clearInterval(S.poll);
          if (n.portfolio_id) setTimeout(() => { if (location.hash.includes(sid)) location.hash = `#/p/${n.portfolio_id}`; }, 1100);
        }
      } catch (ex) { clearInterval(S.poll); toast(ex.message, true); }
    }, 650);
  }
}

function renderCandidates(s) {
  const c = s.candidates;
  const top = c[0];
  const ambiguous = c.length > 1 && c[1].match_confidence >= top.match_confidence - 0.15;
  const needs = !top || top.match_confidence < 0.85 || ambiguous;
  const inv = s.query_type === "inventor";
  main().innerHTML = `<div class="wrap page" style="max-width:980px">
    <div class="eyebrow">Step 1 of 2 · Entity resolution</div>
    <h2>Confirm the ${inv ? "inventor" : "entity"} for “${esc(s.name)}”</h2>
    <div class="callout ${needs ? "callout-warn" : "callout-ocean"}" style="margin:10px 0 18px">${needs ? ICON.warn : ICON.info}
      <div>${needs ? `<b>Confirmation required.</b> ${ambiguous ? "Several candidates have similar match confidence." : "Top match is below the 0.85 auto-confidence threshold."} Ambiguous entities are never merged silently.` : "High-confidence match. Please still confirm the ownership scope before discovery."}</div></div>
    <form id="cf" class="stack">
      <div class="grid" style="gap:10px">${c.map((x, i) => candCard(x, i === 0)).join("")}</div>
      <div class="card" id="scopeCard"></div>
      <div class="btn-row" style="justify-content:flex-end"><a class="btn btn-ghost" href="#/">Cancel</a><button class="btn btn-teal" ${can("search") ? "" : "disabled"}>Confirm & discover portfolio</button></div>
    </form></div>`;
  const scope = () => {
    const id = $("input[name=entity]:checked").value;
    const ent = c.find((x) => x.entity_id === id);
    $$(".cand").forEach((el) => el.classList.toggle("on", el.dataset.id === id));
    if (!inv) {
      const rel = ent.related_entities || [];
      $("#scopeCard").innerHTML = `<h3>Ownership scope</h3>
        <label class="check"><input type="radio" name="scope" value="current_owner"> Current owner only</label>
        <label class="check"><input type="radio" name="scope" value="current_and_historical_assignees" checked> Current and historical assignees (former names, acquisitions)</label>
        ${rel.length ? `<div class="divider"></div><div class="small" style="font-weight:500;margin-bottom:4px">Related entities</div>${rel.map((r) => `<label class="check"><input type="checkbox" name="rel" value="${esc(r.name)}" ${s.params.include_subsidiaries ? "checked" : ""}> ${esc(r.name)} <span class="muted small">(${esc(r.relation)})</span></label>`).join("")}` : ""}
        <div class="divider"></div>
        <div class="row2"><label class="f"><span>USPTO entity size (drives fees)</span><select class="input" name="esize"><option value="large">Large entity</option><option value="small">Small entity</option><option value="micro">Micro entity</option></select></label><div class="help" style="align-self:center">Entity size changes official maintenance fees (small = 40%, micro = 20% of large under the Jan 2025 schedule).</div></div>`;
    } else {
      const affs = ent.affiliations || [];
      $("#scopeCard").innerHTML = `<h3>Ownership scope</h3><p class="small muted">Inventor association is separate from ownership. Choose whose portfolio this is.</p>
        <label class="check"><input type="radio" name="iscope" value="__all" checked> All inventor-associated records (inventor-centric analysis)</label>
        ${affs.map((a) => `<label class="check"><input type="radio" name="iscope" value="${esc(a.org)}"> Owned by ${esc(a.org)} <span class="muted small">(${esc(a.from)}–${esc(a.to || "present")})</span></label>`).join("")}
        <label class="check" style="margin-top:10px"><input type="checkbox" name="icentric"> I confirm inventor-centric analysis is intended (otherwise scores are labelled <b>provisional</b>)</label>`;
    }
  };
  $$("input[name=entity]").forEach((r) => r.addEventListener("change", scope));
  $$(".cand").forEach((el) => el.addEventListener("click", (e) => { if (e.target.tagName !== "INPUT") { $("input", el).checked = true; scope(); } }));
  scope();
  $("#cf").addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = $("input[name=entity]:checked").value;
    let body = { entity_id: id };
    if (!inv) body = { ...body, ownership_scope: $("input[name=scope]:checked").value, include_related_entities: $$("input[name=rel]:checked").map((x) => x.value), entity_size: $("select[name=esize]").value };
    else {
      const v = $("input[name=iscope]:checked").value;
      body = { ...body, ownership_scope: v === "__all" ? "inventor_associated" : "specific_owner", owner_filter: v === "__all" ? null : v, inventor_centric_confirmed: !!$("input[name=icentric]").checked };
    }
    try { await api(`/v1/portfolio-searches/${s.search_id}/confirm-entity`, { method: "POST", body }); viewSearch(s.search_id); }
    catch (ex) { toast(ex.message, true); }
  });
}

function candCard(x, checked) {
  const pct = Math.round(x.match_confidence * 100);
  return `<label class="cand ${checked ? "on" : ""}" data-id="${esc(x.entity_id)}">
    <input type="radio" name="entity" value="${esc(x.entity_id)}" ${checked ? "checked" : ""} style="margin-top:6px;accent-color:var(--teal)">
    <div><h4>${esc(x.canonical_name)}</h4>
      <div class="pill-list">${x.country ? `<span class="badge b-ocean">${esc(x.country)}</span>` : ""}<span class="badge b-mute">${esc(x.technology || "")}</span>${x.identifiers?.assignee_id ? `<span class="badge b-mute mono">${esc(x.identifiers.assignee_id)}</span>` : ""}${x.data_mode === "synthetic" ? '<span class="badge b-syn">SYNTHETIC</span>' : ""}${x.customer_data ? '<span class="badge b-teal">customer inputs on file</span>' : ""}</div>
      <ul>${x.match_evidence.map((m) => `<li>${esc(m)}</li>`).join("")}</ul></div>
    <div class="cand-conf"><div class="small muted">Match confidence</div><div style="font-size:22px;color:var(--ocean);font-weight:500">${pct}%</div><div class="bar ${barCls(pct)}"><i style="width:${pct}%"></i></div></div></label>`;
}

function renderProgress(s) {
  const idx = JOB_STEPS.findIndex((x) => x[0] === s.status);
  const fail = s.status === "FAILED";
  const done = ["REVIEW_READY", "PARTIAL"].includes(s.status);
  main().innerHTML = `<div class="wrap page" style="max-width:760px">
    <div class="eyebrow">${s.query_type === "patents" ? "Live patent analysis" : "Step 2 of 2 · Portfolio discovery"}</div>
    <h2>${esc(s.confirmed?.entity?.canonical_name || s.name)}</h2>
    <div class="progress" aria-label="Progress"><i style="width:${s.progress}%"></i></div>
    <ol class="stepper">${JOB_STEPS.map(([k, l], i) => `<li class="${done || i < idx ? "done" : i === idx && !fail ? "now" : ""}"><span class="dot">${done || i < idx ? "✓" : ""}</span><span>${esc(l)}</span><span class="muted xsmall" style="margin-left:auto">${esc(k)}</span></li>`).join("")}</ol>
    ${fail ? `<div class="callout callout-bad">${ICON.warn}<div><b>Job failed.</b> ${esc(s.error)} <a href="#/">Retry search</a></div></div>` : ""}
    ${s.status === "PARTIAL" ? `<div class="callout callout-warn">${ICON.warn}<div><b>Partial result.</b> Some sources are unavailable; limitations are shown alongside results.</div></div>` : ""}
    <div class="card" style="margin-top:14px"><h4>Job log</h4><ul class="why-list small">${(s.messages || []).slice(-40).map((m) => `<li><span class="muted">${fmtDT(m.t)}</span> — ${esc(m.msg)}</li>`).join("")}</ul>${s.query_type === "patents" && !["REVIEW_READY", "PARTIAL", "FAILED"].includes(s.status) ? '<p class="xsmall muted">Each patent takes roughly a minute: one call reads the record, then seven parameter assessments run in parallel. You can leave this page — results appear under Portfolios when finished.</p>' : ""}
    ${s.portfolio_id ? `<a class="btn btn-teal" href="#/p/${esc(s.portfolio_id)}">Open portfolio →</a>` : ""}</div></div>`;
}

/* ================================================================ PORTFOLIO */
async function viewPortfolio(pid, tab = "overview", q) {
  main().innerHTML = loading();
  const p = await api(`/v1/portfolios/${pid}`);
  S.pf = p;
  const runId = q.get("run") || p.latest_score_run_id;
  const tabs = [["overview", "Dashboard"], ["assets", "Assets"], ["families", "Families"], ["scenarios", "Scenarios"]];
  main().innerHTML = `
  <section class="band"><div class="wrap">
    <div class="eyebrow">${p.query_type === "patents" ? "Patent list · live analysis" : p.query_type === "inventor" ? "Inventor portfolio" : "Company portfolio"} · US</div>
    <h1>${esc(p.name)}</h1>
    <div class="meta"><span>${modeBadge(p.data_mode)}</span>${p.provisional ? '<span class="badge b-warn">PROVISIONAL — owner not confirmed</span>' : ""}<span>Data as of <b>${fmtDate(p.as_of_date)}</b></span><span>Status refreshed ${fmtDT(p.refreshed_at)}</span><span>Entity size: ${esc(p.entity_size)}</span>${runId !== p.latest_score_run_id ? `<span class="badge b-warn">Viewing scenario run ${esc(runId)}</span>` : ""}</div>
  </div></section>
  <div class="wrap band-wrap">
    <nav class="tabs" aria-label="Portfolio sections">${tabs.map(([k, l]) => `<a href="#/p/${esc(pid)}/${k}${runId !== p.latest_score_run_id ? "?run=" + esc(runId) : ""}" class="${tab === k ? "on" : ""}">${l}</a>`).join("")}</nav>
    <div class="tab-body" id="tb"></div>
  </div><div style="height:30px"></div>`;
  if (p.provisional) {
    $("#tb").insertAdjacentHTML("beforebegin", `<div class="callout callout-warn" style="margin-top:14px">${ICON.warn}<div><b>Scores are provisional.</b> This inventor view mixes owners. Choose a specific owner from a new search, or confirm that inventor-centric analysis is intended. ${can("search") ? `<button class="btn btn-ghost btn-xs" id="confInv">Confirm inventor-centric analysis</button>` : ""}</div></div>`);
    $("#confInv")?.addEventListener("click", async () => { await api(`/v1/portfolios/${pid}/confirm-inventor-scope`, { method: "POST", body: { inventor_centric_confirmed: true } }); router(); });
  }
  const fn = { overview: tabOverview, assets: tabAssets, families: tabFamilies, scenarios: tabScenarios }[tab] || tabOverview;
  await fn(p, runId, q);
}

async function fetchRows(runId, params = {}) {
  const qs = new URLSearchParams({ page_size: 500, ...params });
  return api(`/v1/score-runs/${runId}/results?${qs}`);
}

async function tabOverview(p, runId) {
  const tb = $("#tb");
  tb.innerHTML = '<div class="skeleton"></div>';
  const [run, res] = await Promise.all([api(`/v1/score-runs/${runId}`), fetchRows(runId)]);
  const s = run.summary;
  const rows = res.items;
  const br = s.by_recommendation || {};
  const total = rows.length || 1;
  const thr = run.config.thresholds;
  const reasons = {};
  rows.filter((r) => r.recommendation === "review").forEach((r) => (reasons[r.review_reason] = (reasons[r.review_reason] || 0) + 1));
  const costOf = (k) => rows.filter((r) => r.recommendation === k).reduce((a, r) => a + Number(r.cost_5y || 0), 0);
  const attention = rows.filter((r) => r.gate_codes.some((g) => ["IN_GRACE_PERIOD", "DEADLINE_IMMINENT", "STATUS_CONFLICT", "OWNERSHIP_UNRESOLVED"].includes(g)))
    .sort((a, b) => (a.next_deadline || "9999").localeCompare(b.next_deadline || "9999"));
  const needEv = reasons.insufficient_evidence || 0;
  tb.innerHTML = `
  <div class="outcomes">${REC_ORDER.map((k) => `<div class="outcome oc-${k}" data-rec="${k}" role="button" tabindex="0" aria-label="Show ${esc(recLabel(k))} assets">
      <div class="oc-top"><span class="oc-name">${esc(recLabel(k))}</span>${tip(null, (S.meta.recommendations.find((x) => x.key === k) || {}).handling)}</div>
      <div class="oc-n">${br[k] || 0}<span> of ${rows.length}</span></div>
      <div class="oc-desc">${esc(REC_SHORT[k])}</div>
      <div class="oc-cost">${k === "not_in_force" ? "&nbsp;" : `5-yr cost ${fmtMoney(costOf(k))}`}</div></div>`).join("")}</div>
  <div class="stackbar" role="img" aria-label="Outcome distribution" style="margin-top:14px">${REC_ORDER.filter((k) => br[k]).map((k) => `<span style="width:${(br[k] / total) * 100}%;background:${REC_COLORS[k]}" title="${esc(recLabel(k))}: ${br[k]}"></span>`).join("")}</div>
  ${br.review ? `<div class="card" style="margin-top:4px"><div class="card-head"><h3>Why assets are in Review ${tip(null, "Review always has one reason. Fix the reason and the asset moves to Retain or Abandon.")}</h3><span class="small muted">Retain ≥ ${thr.retain} · Review ${thr.review}–${thr.retain - 1} · Abandon &lt; ${thr.review}</span></div>
    <div class="reasons">${Object.entries(reasons).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<button class="reason-row" data-reason="${esc(k)}"><b>${v}</b><span>${esc((S.meta.review_reasons || {})[k] || k)}</span></button>`).join("")}</div>
    ${needEv && can("inputs") ? `<div class="btn-row" style="margin-top:10px"><button class="btn btn-ghost btn-xs" id="ciUp">Upload business inputs to resolve “needs more evidence”</button></div>` : ""}</div>` : ""}
  <div class="kpis" style="margin-top:18px">
    ${kpi("Patent assets", s.assets, `${s.families} families`, ICON.doc, "", "families")}
    ${kpi("In force / pending", `${s.in_force} / ${s.pending}`, `${(br.not_in_force || 0)} not in force`, ICON.fam, "", "inforce")}
    ${kpi("Forward cost · 3 yr", fmtMoney(s.forward_cost["3"]), s.unknown_cost_assets ? `${s.unknown_cost_assets} assets UNKNOWN cost` : "official + professional", ICON.coin, "", "cost3")}
    ${kpi("Forward cost · 5 yr", fmtMoney(s.forward_cost["5"]), "estimates, not actuals", ICON.coin, "", "cost5")}
    ${kpi("Avg data coverage", s.avg_coverage + "%", `avg confidence ${s.avg_confidence}%`, ICON.gauge, s.avg_coverage < thr.coverage_min ? "warn" : "", "coverage_kpi")}
    ${kpi("Data issues · stale", `${(s.by_gate || {}).BLOCK || 0} · ${s.stale_records}`, "conflicts · status rechecks", ICON.alert, ((s.by_gate || {}).BLOCK || s.stale_records) ? "alert" : "", "issues")}
  </div>
  <div class="grid g2" style="margin-top:18px">
    <div class="card"><div class="card-head"><h3>Value vs. 5-year cost ${tip("scatter")}</h3><span class="small muted">click a dot to open</span></div>${scatter(rows, thr)}
      <div class="legend-inline">${REC_ORDER.map((k) => recPill(k)).join("")}</div></div>
    <div class="card"><div class="card-head"><h3>Forward cost by year ${tip("costyear")}</h3><span class="small muted">USD</span></div>${costChart(s.cost_by_year, run.as_of_date)}</div>
  </div>
  <div class="grid g2" style="margin-top:18px">
    <div class="card"><div class="card-head"><h3>Needs attention ${tip("attention")}</h3><span class="small muted">deadlines & data issues</span></div>
      ${attention.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Asset</th><th>Issue</th><th>Date</th></tr></thead><tbody>${attention.slice(0, 8).map((r) => `<tr><td><a class="pub" href="#/a/${esc(r.patent_asset_id)}">${esc(r.publication_number)}</a><div class="xsmall muted">${esc(r.title.slice(0, 54))}</div></td><td>${r.gate_codes.filter((g) => ["IN_GRACE_PERIOD", "DEADLINE_IMMINENT", "STATUS_CONFLICT", "OWNERSHIP_UNRESOLVED"].includes(g)).map((g) => `<span class="badge ${g.includes("STATUS") || g.includes("OWNERSHIP") ? "b-bad" : "b-warn"}">${esc(g.replace(/_/g, " ").toLowerCase())}</span>`).join(" ")}</td><td class="nowrap small">${fmtDate(r.next_deadline)}${r.next_deadline ? `<div class="xsmall muted">${daysTo(r.next_deadline)} days</div>` : ""}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty small">Nothing urgent.</div>`}</div>
    <div class="card"><h3>Data & exports</h3>
      <dl class="kv"><dt>Data mode</dt><dd>${modeBadge(p.data_mode)}</dd><dt>Sources</dt><dd>${p.sources.map(esc).join("<br>")}</dd>
      <dt>Not connected</dt><dd>${p.unavailable_sources.length ? p.unavailable_sources.map((x) => `<span class="badge b-warn">${esc(x)}</span>`).join(" ") : "None"}</dd>
      <dt>Scored</dt><dd>${fmtDT(run.run_at)} · ${esc(run.config.name)}</dd></dl>
      <div class="btn-row" style="margin-top:12px">${["csv", "xlsx", "pdf"].map((f) => `<button class="btn btn-ghost btn-sm" data-exp="${f}">Export ${f.toUpperCase()}</button>`).join("")}${can("score") ? `<button class="btn btn-quiet btn-sm" id="refresh">Recheck legal status</button>` : ""}</div>
      <div class="divider"></div><h4>Business inputs ${tip(null, "Product mappings, lifecycle, revenue band, strategy tag and licensing history can't be found in public data. Download the pre-filled template, fill it in and upload it — the portfolio is re-scored immediately.")}</h4>
      <div class="btn-row"><button class="btn btn-quiet btn-sm" id="ciTpl">Download inputs template</button>${can("inputs") ? `<label class="btn btn-ocean btn-sm">Upload inputs CSV<input type="file" accept=".csv" id="ciFile" hidden></label>` : ""}</div></div>
  </div>`;
  $$(".outcome").forEach((b) => {
    const go = (e) => { if (e.target.closest(".ibtn")) return; S.filters[p.portfolio_id] = { recommendation: [b.dataset.rec] }; location.hash = `#/p/${p.portfolio_id}/assets`; };
    b.addEventListener("click", go);
    b.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(e); } });
  });
  $$(".reason-row").forEach((b) => b.addEventListener("click", () => { S.filters[p.portfolio_id] = { recommendation: ["review"], reason: [b.dataset.reason] }; location.hash = `#/p/${p.portfolio_id}/assets`; }));
  $$("[data-exp]").forEach((b) => b.addEventListener("click", () => download(`/v1/score-runs/${runId}/export.${b.dataset.exp}`, `export.${b.dataset.exp}`)));
  $$(".scatter-dot").forEach((d) => d.addEventListener("click", () => (location.hash = `#/a/${d.dataset.id}`)));
  $("#refresh")?.addEventListener("click", async (e) => { e.target.disabled = true; try { const r = await api(`/v1/portfolios/${p.portfolio_id}/refresh-status`, { method: "POST" }); toast(`Rechecked ${r.rechecked} records. ${r.note}`); router(); } catch (ex) { toast(ex.message, true); e.target.disabled = false; } });
  $("#ciTpl").addEventListener("click", () => download(`/v1/portfolios/${p.portfolio_id}/customer-inputs-template.csv`, "customer_inputs.csv"));
  $("#ciUp")?.addEventListener("click", () => $("#ciFile")?.click());
  $("#ciFile")?.addEventListener("change", async (e) => {
    const fd = new FormData(); fd.append("file", e.target.files[0]);
    try { const r = await api(`/v1/portfolios/${p.portfolio_id}/customer-inputs`, { method: "POST", body: fd }); toast(`Updated ${r.updated} assets; portfolio re-scored.${r.warnings.length ? " " + r.warnings.length + " warning(s)." : ""}`); router(); }
    catch (ex) { toast(ex.message, true); }
  });
}

function kpi(label, val, sub, icon, cls = "", tipKey = null) {
  return `<div class="kpi ${cls}"><div><div class="lbl">${esc(label)} ${tipKey ? tip(tipKey) : ""}</div><div class="val">${val}</div><div class="sub">${esc(sub)}</div></div><div class="ico">${icon}</div></div>`;
}

function costChart(byYear, asOf) {
  const y0 = Number((asOf || "").slice(0, 4)) || new Date().getFullYear();
  const years = Array.from({ length: 7 }, (_, i) => String(y0 + i));
  const vals = years.map((y) => Number(byYear[y] || 0));
  const max = Math.max(1000, ...vals);
  const W = 560, H = 230, pl = 52, pb = 26, pt = 12, bw = (W - pl - 10) / years.length;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max);
  const palette = ["#00A39A", "#12A5C4", "#4DB6E6", "#2F80C9", "#005376", "#0B7EA3", "#00A39A"];
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Forward cost by year">
    ${ticks.map((t) => { const y = pt + (H - pb - pt) * (1 - t / max); return `<line class="axis" x1="${pl}" x2="${W}" y1="${y}" y2="${y}" stroke-dasharray="${t ? "3 4" : ""}"/><text x="${pl - 6}" y="${y + 4}" text-anchor="end">$${t >= 1000 ? Math.round(t / 1000) + "k" : t}</text>`; }).join("")}
    ${years.map((y, i) => { const h = (H - pb - pt) * (vals[i] / max); const x = pl + i * bw + bw * 0.18; return `<rect x="${x}" y="${H - pb - h}" width="${bw * 0.64}" height="${Math.max(h, 0)}" rx="4" fill="${palette[i]}"><title>${y}: $${vals[i].toLocaleString()}</title></rect><text x="${x + bw * 0.32}" y="${H - 8}" text-anchor="middle">${y}</text>${vals[i] ? `<text x="${x + bw * 0.32}" y="${H - pb - h - 4}" text-anchor="middle" style="fill:#005376;font-weight:500">${vals[i] >= 1000 ? "$" + (vals[i] / 1000).toFixed(1) + "k" : "$" + vals[i]}</text>` : ""}`; }).join("")}
  </svg>`;
}

function scatter(rows, thr = { retain: 65, review: 45 }) {
  const pts = rows.filter((r) => r.strategic_score !== null && r.cost_5y !== null);
  if (!pts.length) return `<div class="empty small">No assets have both a score and a known cost yet.</div>`;
  const W = 560, H = 260, pl = 46, pb = 34, pt = 10, pr = 14;
  const maxC = Math.max(1000, ...pts.map((r) => Number(r.cost_5y)));
  const x = (c) => pl + (W - pl - pr) * (c / maxC);
  const y = (s) => pt + (H - pt - pb) * (1 - s / 100);
  const bands = [[thr.retain, 100, "#00A39A"], [thr.review, thr.retain, "#D9A46F"], [0, thr.review, "#B5523B"]];
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Score versus five-year cost scatter plot">
    ${bands.map(([a, b, c]) => `<rect x="${pl}" y="${y(b)}" width="${W - pl - pr}" height="${y(a) - y(b)}" fill="${c}" opacity=".06"/>`).join("")}
    ${[0, thr.review, thr.retain, 100].map((s) => `<line class="axis" x1="${pl}" x2="${W - pr}" y1="${y(s)}" y2="${y(s)}" stroke-dasharray="3 4"/><text x="${pl - 6}" y="${y(s) + 4}" text-anchor="end">${s}</text>`).join("")}
    ${[0, 0.5, 1].map((t) => `<text x="${x(t * maxC)}" y="${H - 14}" text-anchor="middle">$${Math.round((t * maxC) / 1000)}k</text>`).join("")}
    <text x="${(W + pl) / 2}" y="${H - 1}" text-anchor="middle">5-year forward cost →</text>
    <text x="12" y="${H / 2}" transform="rotate(-90 12 ${H / 2})" text-anchor="middle">Value score →</text>
    <text x="${W - pr - 4}" y="${y(thr.retain) - 5}" text-anchor="end" style="fill:#00756e">Retain</text><text x="${W - pr - 4}" y="${y(thr.review) - 5}" text-anchor="end" style="fill:#8a5a10">Review</text><text x="${W - pr - 4}" y="${y(0) - 5}" text-anchor="end" style="fill:#8e3a27">Abandon</text>
    ${pts.map((r) => `<circle class="scatter-dot" data-id="${esc(r.patent_asset_id)}" cx="${x(Number(r.cost_5y)).toFixed(1)}" cy="${y(r.strategic_score).toFixed(1)}" r="6" fill="${REC_COLORS[r.recommendation]}" stroke="#fff" stroke-width="1.5" style="cursor:pointer"><title>${esc(r.publication_number)} — ${esc(recLabel(r.recommendation))}\nScore ${r.strategic_score} · $${Number(r.cost_5y).toLocaleString()}</title></circle>`).join("")}
  </svg>`;
}

/* ---------------- assets tab */
async function tabAssets(p, runId) {
  const f = (S.filters[p.portfolio_id] = S.filters[p.portfolio_id] || {});
  f.sort = f.sort || "strategic_score"; f.order = f.order || "desc"; f.page = f.page || 1;
  const tb = $("#tb");
  tb.innerHTML = `<div class="card model-card" id="modelCard"><div class="skeleton"></div></div>
  <div class="card" style="margin-top:16px">
    <div class="filters" id="flt">
      <label>Search<input class="input" name="q" placeholder="Publication, title, owner" value="${esc(f.q || "")}"></label>
      <div class="flt"><span>Outcome</span>${msel("recommendation", REC_ORDER.map((k) => [k, recLabel(k)]), f.recommendation, "All outcomes")}</div>
      <div class="flt"><span>Review reason</span>${msel("reason", Object.entries(REASON_SHORT), f.reason, "Any reason")}</div>
      <div class="flt"><span>Status</span>${msel("status", [["active", "Active"], ["pending", "Pending"], ["expired", "Expired"], ["lapsed", "Lapsed"], ["abandoned", "Abandoned"]], f.status, "Any status")}</div>
      <div class="flt"><span>Next fee due</span>${msel("due", [["0-90", "Within 90 days"], ["91-180", "91–180 days"], ["181-365", "181–365 days"], ["366-1095", "1–3 years"], ["1096-99999", "Later than 3 years"], ["none", "No fee due"]], f.due, "Any time")}</div>
      <div class="flt"><span>Checks</span>${msel("gate", [["PASS", "PASS"], ["REVIEW", "REVIEW"], ["BLOCK", "BLOCK"]], f.gate, "Any")}</div>
      <button class="btn btn-quiet btn-sm" id="clr" type="button">Clear</button>
      <span style="flex:1"></span>
      <div class="btn-row">${["csv", "xlsx", "pdf"].map((x) => `<button class="btn btn-ghost btn-xs" data-exp="${x}" type="button">${x.toUpperCase()}</button>`).join("")}</div>
    </div>
    <div id="tbl"><div class="skeleton"></div></div>
  </div>`;
  const dims = S.meta.dimensions;
  let modelDrawn = false;
  const drawModel = (cfg) => {
    if (modelDrawn) return; modelDrawn = true;
    const w = cfg.weights, t = cfg.thresholds;
    $("#modelCard").innerHTML = `<div class="card-head"><h3>Scoring model in use ${tip("model")}</h3><span class="small muted">${esc(cfg.name)} · v${esc(cfg.version)} ${cfg.kind === "scenario" ? '<span class="badge b-warn">scenario</span>' : ""} · <a href="#/settings">change</a></span></div>
      <div class="weights">${dims.map((d) => `<div class="wt"><div class="wt-top"><span>${esc(d.label)}</span>${tip(d.key)}</div><div class="wt-val">${Number(w[d.key]).toFixed(0)}<small>/100</small></div><div class="bar"><i style="width:${Number(w[d.key]) * 2}%"></i></div></div>`).join("")}</div>`;
  };
  let cache = null;
  const inDue = (r, ranges) => ranges.some((rg) => {
    if (rg === "none") return !r.next_deadline;
    if (!r.next_deadline) return false;
    const [lo, hi] = rg.split("-").map(Number); const d = daysTo(r.next_deadline); return d >= lo && d <= hi;
  });
  const load = async () => {
    if (!cache) cache = await api(`/v1/score-runs/${runId}/results?${new URLSearchParams({ page_size: 500 })}`);
    const res = cache;
    drawModel(res.config);
    const has = (k) => Array.isArray(f[k]) && f[k].length;
    const q = (f.q || "").toLowerCase();
    let items = res.items.filter((r) => (!q || (r.publication_number + " " + r.title + " " + (r.current_owner || "")).toLowerCase().includes(q))
      && (!has("recommendation") || f.recommendation.includes(r.recommendation)) && (!has("reason") || f.reason.includes(r.review_reason))
      && (!has("status") || f.status.includes(r.status)) && (!has("gate") || f.gate.includes(r.gate_status)) && (!has("due") || inDue(r, f.due)));
    const key = f.sort, dir = f.order === "asc" ? 1 : -1;
    const val = (r) => (["cost_5y", "invested_est", "maintenance_paid", "remaining_dues"].includes(key) ? (r[key] === null || r[key] === undefined ? null : Number(r[key])) : key.startsWith("dim:") ? r.ratings?.[key.slice(4)] : r[key]);
    items = items.slice().sort((x, y) => { const a = val(x), b = val(y); if (a === null || a === undefined) return 1; if (b === null || b === undefined) return -1; return (a > b ? 1 : a < b ? -1 : 0) * dir; });
    const total = items.length, ps = 50, pages = Math.max(1, Math.ceil(total / ps));
    if (f.page > pages) f.page = pages;
    const pageItems = items.slice((f.page - 1) * ps, f.page * ps);
    const th = (k, l, cls = "", tk = null) => `<th class="${cls}"><span class="thw"><button data-sort="${k}">${l} ${f.sort === k ? `<span class="arr">${f.order === "desc" ? "▼" : "▲"}</span>` : ""}</button>${tk ? tip(tk) : ""}</span></th>`;
    $("#tbl").innerHTML = items.length ? `<div class="table-wrap"><table class="t assets-t"><thead>
      <tr><th colspan="4"></th><th colspan="${dims.length}" class="grp">Parameter ratings (0–5) ${tip("rating")}</th><th colspan="2"></th><th colspan="3" class="grp grp-cost">Cost to date &amp; to go (USD) ${tip("money")}</th><th colspan="3" class="grp grp-fee">Maintenance fee status ${tip("feestatus")}</th><th colspan="2"></th></tr>
      <tr>${th("publication_number", "Publication no.", "stick", null)}${th("title", "Title", "", "asset")}${th("status", "Legal status", "", "legalstatus")}${th("strategic_score", "Score", "", "score")}
      ${dims.map((d) => `<th class="dimh"><span class="thw"><button data-sort="dim:${d.key}">${esc(DIM_SHORT[d.key])} ${f.sort === "dim:" + d.key ? `<span class="arr">${f.order === "desc" ? "▼" : "▲"}</span>` : ""}</button>${tip(d.key, d.label + ": " + DIM_HELP[d.key])}</span></th>`).join("")}
      ${th("recommendation", "Outcome", "", "outcome")}<th><span class="thw">Checks ${tip("checks")}</span></th>
      ${th("invested_est", "Est. invested to date", "num", "invested")}${th("maintenance_paid", "Fees paid", "num", "feespaid")}${th("remaining_dues", "Remaining dues to expiry", "num", "remaining")}
      <th class="center">3.5-yr ${tip("fee35")}</th><th class="center">7.5-yr ${tip("fee75")}</th><th class="center">11.5-yr ${tip("fee115")}</th>
      ${th("next_deadline", "Next fee due", "", "deadline")}${th("data_coverage", "Coverage", "num", "coverage")}</tr></thead>
      <tbody>${pageItems.map((r) => `<tr data-id="${esc(r.patent_asset_id)}">
        <td class="nowrap stick"><a class="pub" href="#/a/${esc(r.patent_asset_id)}${runId !== p.latest_score_run_id ? "?run=" + esc(runId) : ""}">${esc(r.publication_number)}</a>${r.relationship_type !== "original" ? `<div class="xsmall muted">${esc(r.relationship_type)}</div>` : ""}</td>
        <td class="ttl"><a href="#/a/${esc(r.patent_asset_id)}${runId !== p.latest_score_run_id ? "?run=" + esc(runId) : ""}">${esc(r.title)}</a></td>
        <td class="nowrap">${legalCell(r)}</td>
        <td>${r.strategic_score === null ? '<span class="unknown">n/a</span>' : `<div class="scorecell"><b>${r.strategic_score.toFixed(0)}</b><div class="bar" style="width:48px"><i style="width:${r.strategic_score}%"></i></div></div>`}</td>
        ${dims.map((d) => `<td class="center">${ratingChip(r.ratings?.[d.key], r.dimension_details?.[d.key] || {})}</td>`).join("")}
        <td>${recCell(r)}</td><td>${gatePill(r.gate_status)}</td>
        <td class="num">${fmtMoney(r.invested_est)}</td>
        <td class="num">${fmtMoney(r.maintenance_paid)}</td>
        <td class="num"><b>${fmtMoney(r.remaining_dues, r.cost_unknown)}</b></td>
        ${["3.5", "7.5", "11.5"].map((st) => `<td class="center">${feeChip((r.fee_stages || []).find((x) => x.stage === st))}</td>`).join("")}
        <td class="nowrap small">${r.next_deadline ? `${fmtDate(r.next_deadline)}<div class="xsmall ${daysTo(r.next_deadline) <= 120 ? "rec-abandon" : "muted"}">${daysTo(r.next_deadline)} days</div>` : "—"}</td>
        <td class="num" title="Evidence confidence ${r.evidence_confidence.toFixed(0)}%">${r.data_coverage.toFixed(0)}%</td></tr>`).join("")}</tbody></table></div>
      <div class="pager"><span class="muted">${total} assets · page ${f.page} of ${pages}</span><div class="btn-row"><button class="btn btn-ghost btn-xs" id="prev" ${f.page <= 1 ? "disabled" : ""}>← Prev</button><button class="btn btn-ghost btn-xs" id="next" ${f.page >= pages ? "disabled" : ""}>Next →</button></div></div>`
      : `<div class="empty"><h3>No assets match</h3><p class="small">Adjust or clear the filters.</p></div>`;
    $$("[data-sort]").forEach((b) => b.addEventListener("click", () => { const k = b.dataset.sort; f.order = f.sort === k && f.order === "desc" ? "asc" : "desc"; f.sort = k; load(); }));
    $("#prev")?.addEventListener("click", () => { f.page--; load(); });
    $("#next")?.addEventListener("click", () => { f.page++; load(); });
  };
  let tmr;
  $("#flt").addEventListener("input", (e) => { if (e.target.name !== "q") return; f.q = e.target.value; f.page = 1; clearTimeout(tmr); tmr = setTimeout(load, 250); });
  bindMsel($("#flt"), (name, v) => { f[name] = v; f.page = 1; load(); });
  $("#clr").addEventListener("click", () => { S.filters[p.portfolio_id] = {}; tabAssets(p, runId); });
  $$("[data-exp]", tb).forEach((b) => b.addEventListener("click", () => download(`/v1/score-runs/${runId}/export.${b.dataset.exp}${Array.isArray(f.recommendation) && f.recommendation.length ? "?recommendation=" + f.recommendation.join(",") : ""}`, "export")));
  await load();
}

async function tabFamilies(p, runId) {
  const [fams, res] = await Promise.all([api(`/v1/portfolios/${p.portfolio_id}/families`), fetchRows(runId)]);
  const by = Object.fromEntries(res.items.map((r) => [r.patent_asset_id, r]));
  $("#tb").innerHTML = `<div class="callout callout-ocean" style="margin-bottom:14px">${ICON.info}<div>Family members can differ in status, scope, cost and value. Abandoning one member does not automatically end family protection — check each family before deciding.</div></div>
  <div class="grid g2">${fams.map((f) => {
    const live = f.members.filter((m) => ["active", "pending"].includes(m.status)).length;
    const cost = f.members.reduce((a, m) => a + Number(by[m.id]?.cost_5y || 0), 0);
    return `<div class="card"><div class="card-head"><div><div class="xsmall muted mono">${esc(f.provider_family_id)}</div><h4 style="font-family:var(--serif);font-weight:400;color:var(--ocean);font-size:18px;margin:2px 0">${esc(by[f.members[0]?.id]?.title || "Family")}</h4></div><div class="right small"><b>${live}</b> of ${f.members.length} live<br><span class="muted">5-yr ${fmtMoney(cost)}</span></div></div>
    <table class="t"><tbody>${f.members.map((m) => { const r = by[m.id] || {}; return `<tr><td class="pub"><a href="#/a/${esc(m.id)}">${esc(m.publication_number)}</a></td><td class="small">${esc(m.relationship_type)}</td><td>${statusTxt(m.status)}</td><td>${r.recommendation ? recPill(r.recommendation) : ""}</td><td class="num small">${r.strategic_score ?? "—"}</td></tr>`; }).join("")}</tbody></table></div>`;
  }).join("")}</div>`;
}

/* ---------------- scenarios */
async function tabScenarios(p) {
  const cfgs = await api("/v1/scoring-configs");
  const def = cfgs.find((c) => c.kind === "default");
  const st = (S.scen[p.portfolio_id] = S.scen[p.portfolio_id] || { weights: { ...def.weights }, coverage_min: def.thresholds.coverage_min, budget: "", horizon: "5", name: "" });
  const saved = await api(`/v1/portfolios/${p.portfolio_id}/scenarios`);
  $("#tb").innerHTML = `<div class="grid g-side">
    <div class="stack"><div class="card" id="impact"><div class="empty small">Adjust weights or set a budget target to preview impact.</div></div>
      <div class="card"><h3>Saved scenarios</h3>${saved.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Name</th><th>Weights</th><th>Changed</th><th>By / when</th><th></th></tr></thead><tbody>${saved.map((c) => `<tr><td><b>${esc(c.name)}</b></td><td class="xsmall">${Object.entries(c.weights).map(([k, v]) => `${esc(dimLabel(k).split(" ")[0])} ${Number(v).toFixed(0)}`).join(" · ")}</td><td>${c.summary?.changed ?? "—"}</td><td class="xsmall muted">${esc(c.created_by)}<br>${fmtDT(c.created_at)}</td><td>${c.score_run_id ? `<a class="btn btn-ghost btn-xs" href="#/p/${esc(p.portfolio_id)}/assets?run=${esc(c.score_run_id)}">View results</a>` : ""}</td></tr>`).join("")}</tbody></table></div>` : `<p class="small muted">None yet. Saving records the assumptions and a reproducible score run without touching the default model.</p>`}</div></div>
    <div class="card"><h3>Scenario builder</h3><p class="small muted">Changes here never overwrite the default model (${esc(def.name)}, v${def.version}).</p>
      <div id="sliders">${S.meta.dimensions.map((d) => `<div class="slider-row"><label for="w_${d.key}">${esc(d.label)}</label><input type="range" min="0" max="50" step="1" id="w_${d.key}" data-k="${d.key}" value="${st.weights[d.key]}"><input class="input" style="padding:4px 6px" type="number" min="0" max="100" data-n="${d.key}" value="${st.weights[d.key]}" aria-label="${esc(d.label)} weight"></div>`).join("")}</div>
      <div class="btn-row" style="justify-content:space-between;margin:10px 0"><span>Total: <span id="wsum"></span></span><div class="btn-row"><button class="btn btn-quiet btn-xs" id="norm">Normalise to 100</button><button class="btn btn-quiet btn-xs" id="reset">Reset</button></div></div>
      <div class="divider"></div>
      <label class="f"><span>Coverage threshold for a normal recommendation: <b id="covv">${st.coverage_min}%</b></span><input type="range" min="40" max="100" step="5" id="cov" value="${st.coverage_min}"></label>
      <div class="row2"><label class="f"><span>Budget savings target (USD)</span><input class="input" type="number" min="0" step="1000" id="bud" value="${esc(st.budget)}" placeholder="e.g. 25000"></label>
      <label class="f"><span>Horizon</span><select class="input" id="hz"><option value="3" ${st.horizon === "3" ? "selected" : ""}>3 years</option><option value="5" ${st.horizon === "5" ? "selected" : ""}>5 years</option></select></label></div>
      <div class="divider"></div>
      <label class="f"><span>Scenario name</span><input class="input" id="sname" value="${esc(st.name)}" placeholder="e.g. Commercial-led FY27"></label>
      <button class="btn btn-teal" id="save" ${can("scenario") ? "" : "disabled title='Your role cannot save scenarios'"}>Save scenario & create run</button></div></div>`;
  const sum = () => Object.values(st.weights).reduce((a, b) => a + Number(b), 0);
  const showSum = () => { const s = sum(); $("#wsum").innerHTML = `<span class="${Math.abs(s - 100) < 0.01 ? "sum-ok" : "sum-bad"}">${s.toFixed(0)} / 100</span>`; };
  let tmr;
  const preview = () => { clearTimeout(tmr); tmr = setTimeout(async () => {
    if (Math.abs(sum() - 100) > 0.01) { $("#impact").innerHTML = `<div class="empty small">Weights must sum to 100 to preview (currently ${sum().toFixed(0)}).</div>`; return; }
    try {
      const r = await api(`/v1/portfolios/${p.portfolio_id}/scenario-preview`, { method: "POST", body: body() });
      $("#impact").innerHTML = impactHtml(r, false);
    } catch (ex) { $("#impact").innerHTML = `<p class="muted">${esc(ex.message)}</p>`; }
  }, 350); };
  const body = () => ({ name: st.name || "Preview", weights: st.weights, thresholds: { coverage_min: Number(st.coverage_min) }, budget_target: st.budget ? Number(st.budget) : null, budget_horizon: Number(st.horizon) });
  $("#sliders").addEventListener("input", (e) => {
    const k = e.target.dataset.k || e.target.dataset.n; if (!k) return;
    st.weights[k] = Number(e.target.value) || 0;
    $(`#w_${k}`).value = st.weights[k]; $(`[data-n=${k}]`).value = st.weights[k];
    showSum(); preview();
  });
  $("#norm").addEventListener("click", () => {
    const s = sum() || 1; const keys = Object.keys(st.weights);
    keys.forEach((k) => (st.weights[k] = Math.round((st.weights[k] / s) * 100)));
    const diff = 100 - sum(); const big = keys.sort((a, b) => st.weights[b] - st.weights[a])[0]; st.weights[big] += diff;
    keys.forEach((k) => { $(`#w_${k}`).value = st.weights[k]; $(`[data-n=${k}]`).value = st.weights[k]; }); showSum(); preview();
  });
  $("#reset").addEventListener("click", () => { delete S.scen[p.portfolio_id]; tabScenarios(p); });
  $("#cov").addEventListener("input", (e) => { st.coverage_min = e.target.value; $("#covv").textContent = e.target.value + "%"; preview(); });
  $("#bud").addEventListener("input", (e) => { st.budget = e.target.value; preview(); });
  $("#hz").addEventListener("change", (e) => { st.horizon = e.target.value; preview(); });
  $("#sname").addEventListener("input", (e) => (st.name = e.target.value));
  $("#save").addEventListener("click", async (e) => {
    if (!st.name.trim()) { toast("Name the scenario first", true); $("#sname").focus(); return; }
    e.target.disabled = true;
    try { const r = await api(`/v1/portfolios/${p.portfolio_id}/scenarios`, { method: "POST", body: body() }); toast(`Scenario saved — ${r.comparison.changed.length} asset(s) change category`); tabScenarios(p); setTimeout(() => ($("#impact").innerHTML = impactHtml(r, true)), 50); }
    catch (ex) { toast(ex.message, true); e.target.disabled = false; }
  });
  showSum(); preview();
}

function impactHtml(r, saved) {
  const c = r.comparison;
  const keys = REC_ORDER.filter((k) => c.baseline_counts[k] || c.scenario_counts[k]);
  return `<div class="card-head"><h3>Impact vs. baseline</h3>${saved ? '<span class="badge b-ok">Saved</span>' : '<span class="badge b-mute">Preview — not saved</span>'}</div>
  <div class="grid g2"><div class="table-wrap"><table class="t"><thead><tr><th>Outcome</th><th class="num">Baseline</th><th class="num">Scenario</th><th class="num">Δ</th></tr></thead><tbody>${keys.map((k) => { const d = (c.scenario_counts[k] || 0) - (c.baseline_counts[k] || 0); return `<tr><td>${recPill(k)}</td><td class="num">${c.baseline_counts[k] || 0}</td><td class="num">${c.scenario_counts[k] || 0}</td><td class="num ${d > 0 ? "delta-up" : d < 0 ? "delta-down" : ""}">${d > 0 ? "+" : ""}${d}</td></tr>`; }).join("")}</tbody></table></div>
  <div class="stack"><div class="metric"><div class="lbl">Assets changing category</div><div class="val">${c.changed.length} <span class="small muted">in ${c.changed_families} families</span></div></div>
  <div class="metric"><div class="lbl">5-yr cost in abandonment-review</div><div class="val">${fmtMoney(c.abandon_review_cost_5y.baseline)} → ${fmtMoney(c.abandon_review_cost_5y.scenario)}</div></div>
  <div class="metric"><div class="lbl">Average coverage</div><div class="val">${c.avg_coverage.baseline}% → ${c.avg_coverage.scenario}%</div></div></div></div>
  ${c.changed.length ? `<h4 style="margin-top:16px">Sensitive assets (category changed)</h4><div class="table-wrap"><table class="t"><thead><tr><th>Asset</th><th>From</th><th>To</th><th class="num">Score</th></tr></thead><tbody>${c.changed.slice(0, 15).map((x) => `<tr><td class="ttl"><a href="#/a/${esc(x.patent_asset_id)}">${esc(x.title)}</a><div class="pub">${esc(x.publication_number)}</div></td><td>${recPill(x.from)}</td><td>${recPill(x.to)}</td><td class="num">${x.score_from ?? "—"} → ${x.score_to ?? "—"}</td></tr>`).join("")}</tbody></table></div>` : ""}
  ${r.budget ? `<div class="divider"></div><div class="card-head"><h4 style="margin:0">Budget shortlist — ${fmtMoney(r.budget.target)} over ${r.budget.horizon_years} years</h4><span class="badge ${r.budget.met ? "b-ok" : "b-warn"}">${r.budget.met ? "Target met" : "Target not met"}: ${fmtMoney(r.budget.identified_savings)}</span></div>
    <p class="xsmall muted">${esc(r.budget.note)}</p>
    ${r.budget.candidates.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Asset</th><th>Recommendation</th><th class="num">Score</th><th class="num">Avoidable cost</th><th>Dependencies</th></tr></thead><tbody>${r.budget.candidates.map((x) => `<tr><td class="ttl"><a href="#/a/${esc(x.patent_asset_id)}">${esc(x.title)}</a><div class="pub">${esc(x.publication_number)}</div></td><td>${recPill(x.recommendation)}</td><td class="num">${x.strategic_score ?? "—"}</td><td class="num">${fmtMoney(r.budget.horizon_years === 3 ? x.cost_3y : x.cost_5y)}</td><td>${x.dependency_warning ? '<span class="badge b-warn">family impact</span>' : '<span class="muted small">none flagged</span>'}</td></tr>`).join("")}</tbody></table></div>` : '<p class="small muted">No eligible candidates (only abandonment-review and strategic-review assets without blocking gates are considered).</p>'}` : ""}`;
}

/* ---------------- reviews tab */








/* ================================================================ ASSET DETAIL */
async function viewAsset(aid, q) {
  main().innerHTML = loading();
  const runParam = q.get("run");
  const d = await api(`/v1/patents/${aid}${runParam ? "?score_run_id=" + encodeURIComponent(runParam) : ""}`);
  const a = d.asset, sc = d.score, run = d.score_run;
  const gates = sc?.gate_reasons || [];
  const codes = gates.map((g) => g.code);
  main().innerHTML = `
  <section class="band"><div class="wrap">
    <div class="crumbs"><a href="#/p/${esc(d.portfolio.id)}">${esc(d.portfolio.name)}</a> › <a href="#/p/${esc(d.portfolio.id)}/assets">Assets</a> › ${esc(a.publication_number)}</div>
    <h1 style="max-width:980px">${esc(a.title)}</h1>
    <div class="meta"><span class="mono">${esc(a.publication_number)}</span><span>${esc(a.jurisdiction)} · ${esc(a.kind_code)}</span><span>Status: <b>${esc(a.status)}</b></span><span>${esc(a.relationship_type)}</span><span>${esc(a.cpc)} · ${esc(a.technology)}</span>${modeBadge(d.portfolio.data_mode)}${runParam ? '<span class="badge b-warn">scenario run</span>' : ""}</div>
  </div></section>
  <div class="wrap band-wrap"><div class="grid g-side">
    <div class="stack">
      ${sc ? recCard(sc, run, d) : '<div class="card">No score in this run.</div>'}
      ${gates.length ? `<div class="card"><div class="card-head"><h3>Checks & warnings ${tip("checks")}</h3>${gatePill(sc.gate_status)}</div><ul class="gates">${gates.map((g) => `<li><span class="sev sev-${esc(g.severity)}">${esc(g.severity)}</span><div><b class="small">${esc(g.code.replace(/_/g, " "))}</b><div>${esc(g.message)}</div></div></li>`).join("")}</ul></div>` : ""}
      ${sc ? explainCard(sc) : ""}
      ${sc ? dimsCard(sc, run) : ""}
      ${evidenceCard(d.evidence)}
      ${sc ? costCard(sc.cost, d.cost_actuals, a) : ""}
    </div>
    <div class="stack">
      ${(codes.includes("STATUS_CONFLICT") || codes.includes("OWNERSHIP_UNRESOLVED") || codes.includes("STALE_STATUS") || codes.includes("DEADLINE_IMMINENT") || codes.includes("IN_GRACE_PERIOD")) ? resolveCard(a, codes) : ""}
      ${inputsCard(a)}
      ${familyCard(d.family, a)}
      <div class="card"><h3>Ownership</h3><p class="xsmall muted">Inventor, original applicant, recorded assignee and current legal owner are tracked separately.</p>
        <ul class="timeline">${d.ownership_events.map((e) => `<li class="role-${esc(e.role)}"><b>${esc(e.assignee)}</b> <span class="badge b-mute">${esc(e.role.replace(/_/g, " "))}</span><div class="small">${esc(e.event_type)} · ${fmtDate(e.effective_date)}</div><div class="xsmall muted">${esc(e.source_id)} · confidence ${Math.round(e.confidence * 100)}%</div></li>`).join("")}</ul>
        ${a.ownership_issue ? `<div class="callout callout-bad">${ICON.warn}<div>${esc(a.ownership_issue)}</div></div>` : ""}</div>
      <div class="card"><h3>Legal status history</h3><table class="t"><thead><tr><th>Status</th><th>Source</th><th>Retrieved</th></tr></thead><tbody>${d.status_snapshots.map((s) => `<tr><td>${statusTxt(s.status)}</td><td class="xsmall">${esc(s.source_id)}</td><td class="xsmall nowrap">${fmtDT(s.retrieved_at)}</td></tr>`).join("")}</tbody></table>
        <p class="xsmall muted" style="margin-top:8px">Last checked ${fmtDT(a.last_status_check)}. Critical status and deadlines are rechecked before any final decision.</p></div>
      <div class="card"><h3>Bibliographic data</h3><dl class="kv">
        <dt>Application</dt><dd class="mono small">${esc(a.application_number)}</dd><dt>Priority date</dt><dd>${fmtDate(a.priority_date)}</dd><dt>Filing date</dt><dd>${fmtDate(a.filing_date)}</dd>
        <dt>Grant date</dt><dd>${fmtDate(a.grant_date)}</dd><dt>Expiry (estimate)</dt><dd>${fmtDate(a.expiry_estimate)} <div class="xsmall muted">20 yrs from earliest non-provisional filing; PTA/PTE not applied</div></dd>
        <dt>Inventors</dt><dd>${(a.inventors || []).map(esc).join(", ") || "—"}</dd><dt>Original applicant</dt><dd>${esc(a.original_applicant)}</dd><dt>Current owner</dt><dd>${a.current_owner ? esc(a.current_owner) : '<span class="unknown">UNVERIFIED</span>'}</dd>
        <dt>Entity size</dt><dd>${esc(a.entity_size)}</dd><dt>Data as of</dt><dd>${fmtDT(a.data_as_of)}</dd></dl>
        ${a.abstract ? `<div class="divider"></div><p class="small muted">${esc(a.abstract)}</p>` : ""}</div>
    </div></div></div>`;
  bindAsset(d);
}

function ring(score) {
  const r = 60, c = 2 * Math.PI * r, v = score ?? 0;
  return `<div class="ring"><svg viewBox="0 0 140 140"><circle cx="70" cy="70" r="${r}" stroke="#e9eef0" stroke-width="12" fill="none"/><circle cx="70" cy="70" r="${r}" stroke="url(#rg)" stroke-width="12" fill="none" stroke-linecap="round" stroke-dasharray="${(c * v) / 100} ${c}"/><defs><linearGradient id="rg"><stop offset="0" stop-color="#00A39A"/><stop offset="1" stop-color="#005376"/></linearGradient></defs></svg>
  <div class="lbl"><div><b>${score === null || score === undefined ? "—" : Math.round(score)}</b><small>value score<br>out of 100</small></div></div></div>`;
}

function recCard(sc, run, d) {
  const ex = sc.explanation;
  const t = run.config.thresholds;
  return `<div class="card"><div class="score-hero">${ring(sc.strategic_score)}
    <div><div class="small muted">Outcome ${tip("outcome")}</div><div class="rec-big"><i style="background:${REC_COLORS[sc.recommendation]}"></i>${esc(sc.recommendation_label)}</div>
      ${ex.review_reason_label ? `<div class="reason-big">Why review: ${esc(ex.review_reason_label)}</div>` : ""}
      <p class="small" style="margin:6px 0 0">${esc(ex.required_handling)}</p>
      <div class="metric-row">
        <div class="metric"><div class="lbl">Data coverage ${tip("coverage")}</div><div class="val">${sc.data_coverage.toFixed(0)}%</div><div class="bar ${barCls(sc.data_coverage)}"><i style="width:${sc.data_coverage}%"></i></div></div>
        <div class="metric"><div class="lbl">Evidence confidence ${tip("confidence")}</div><div class="val">${sc.evidence_confidence.toFixed(0)}%</div><div class="bar ${barCls(sc.evidence_confidence)}"><i style="width:${sc.evidence_confidence}%"></i></div></div>
        <div class="metric"><div class="lbl">Checks ${tip("checks")}</div><div class="val">${gatePill(sc.gate_status)}</div></div>
      </div></div></div>
    ${sc.data_coverage < t.coverage_min ? `<div class="callout callout-cream" style="margin-top:12px">${ICON.info}<div>Only ${sc.data_coverage.toFixed(0)}% of the scoring weight has evidence, so this patent can't be confidently called Retain or Abandon yet. Missing parameters are left out, not counted as zero — add the inputs listed below.</div></div>` : ""}
    ${(ex.confidence_notes || []).length ? `<p class="xsmall muted" style="margin-top:10px">Confidence adjustments: ${ex.confidence_notes.map(esc).join("; ")}</p>` : ""}
    <p class="xsmall muted" style="margin:10px 0 0">${esc(run.config.name)} · ${esc(run.scoring_version)} · data as of ${fmtDate(run.as_of_date)}</p></div>`;
}

function explainCard(sc) {
  const ex = sc.explanation;
  return `<div class="card"><h3>Why this outcome</h3><div class="grid g2">
    <div><h4>Top positive factors</h4>${ex.positives.length ? `<ul class="why-list plus">${ex.positives.map((x) => `<li>${esc(x.text)}</li>`).join("")}</ul>` : '<p class="small muted">No parameter rated 3 or above.</p>'}</div>
    <div><h4>Top risk / negative factors</h4>${ex.negatives.length ? `<ul class="why-list minus">${ex.negatives.map((x) => `<li>${esc(x.text)}</li>`).join("")}</ul>` : '<p class="small muted">No parameter rated 2 or below.</p>'}</div></div>
    ${ex.missing.length ? `<div class="divider"></div><h4>Missing inputs</h4><ul class="why-list">${ex.missing.map((m) => `<li><b>${esc(m.label)}</b> <span class="muted small">(weight ${m.weight})</span> — ${esc(m.hint)}</li>`).join("")}</ul>` : ""}
    <div class="divider"></div><h4>What could change the result</h4><ul class="why-list">${ex.what_could_change.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>
    ${ex.sensitivity?.length ? `<p class="xsmall muted">Sensitivity: ${ex.sensitivity.map((s) => `${esc(dimLabel(s.dimension))} ${s.delta > 0 ? "+" : ""}${s.delta} → ${esc(recLabel(s.recommendation))}`).join("; ")}</p>` : ""}</div>`;
}

function dimsCard(sc, run) {
  const w = run.config.weights;
  return `<div class="card"><div class="card-head"><h3>Score breakdown by parameter ${tip("rating")}</h3><span class="small muted">Rating 0–5 per parameter, or UNKNOWN</span></div>
  <div class="table-wrap"><table class="dims"><thead><tr><th>Parameter</th><th class="num">Weight ${tip("weight")}</th><th>Rating</th><th class="num">Points</th><th>Why</th><th></th></tr></thead><tbody>
  ${S.meta.dimensions.map((dm) => { const v = sc.dimension_scores[dm.key]; const r = v.rating; return `<tr><td><b>${esc(dm.label)}</b> ${tip(dm.key)}<div class="basis">${esc(v.basis || "no evidence")}${v.basis === "analyst" && v.derived_rating !== null && v.derived_rating !== undefined ? ` · derived was ${v.derived_rating}` : ""}</div></td><td class="num">${Number(w[dm.key]).toFixed(0)}</td>
    <td class="nowrap">${r === null ? '<span class="unknown">UNKNOWN</span>' : `<span class="dots" aria-label="${r} of 5">${[1, 2, 3, 4, 5].map((i) => `<i class="${i <= r ? "on" : ""}"></i>`).join("")}</span> <b>${r}</b>`}</td>
    <td class="num small">${r === null ? "—" : ((Number(w[dm.key]) * r) / 5).toFixed(1) + " / " + Number(w[dm.key]).toFixed(0)}</td><td class="small">${esc(v.rationale)}</td><td>${can("inputs") ? `<button class="btn btn-quiet btn-xs" data-dim="${dm.key}">Add input</button>` : ""}</td></tr>`; }).join("")}
  </tbody></table></div></div>`;
}

function evidenceCard(evs) {
  const groups = {};
  evs.forEach((e) => (groups[e.dimension] = groups[e.dimension] || []).push(e));
  return `<div class="card"><div class="card-head"><h3>Evidence</h3><span class="small muted">${evs.length} items · retrieved text is treated as untrusted data</span></div>
  ${Object.keys(groups).length ? S.meta.dimensions.filter((d) => groups[d.key]).map((d) => `<h4 style="margin-top:10px">${esc(d.label)}</h4>${groups[d.key].map((e) => `<div class="ev"><div class="src">${/^https?:\/\//.test(e.source_uri || "") ? `<a href="${esc(e.source_uri)}" target="_blank" rel="noopener noreferrer">${esc(e.source_name)} ↗</a>` : esc(e.source_name)}</div><div class="small">${esc(e.excerpt)}</div><div class="meta">Source date ${fmtDate(e.source_date)} · retrieved ${fmtDT(e.retrieved_at)} · reliability ${Math.round(e.reliability * 100)}% · directness ${Math.round(e.directness * 100)}%${e.polarity ? (e.polarity > 0 ? " · supports value" : " · weighs against") : ""}</div></div>`).join("")}`).join("") : '<p class="small muted">No evidence attached.</p>'}</div>`;
}

function costCard(c, actuals, a) {
  const t3 = c.totals["3"] || {}, t5 = c.totals["5"] || {};
  const inv = c.invested || { total: null, breakdown: [] };
  const stages = c.fee_stages || [];
  return `<div class="card"><div class="card-head"><h3>Costs &amp; maintenance fees ${tip("money")}</h3><span class="small muted">${esc(c.currency)} · ${esc(c.assumption_version)}</span></div>
  <div class="metric-row" style="margin-top:0">
    <div class="metric"><div class="lbl">Est. invested to date ${tip("invested")}</div><div class="val">${fmtMoney(inv.total)}</div></div>
    <div class="metric"><div class="lbl">Maintenance fees paid ${tip("feespaid")}</div><div class="val">${fmtMoney(c.maintenance_paid)}</div></div>
    <div class="metric"><div class="lbl">Remaining dues to expiry ${tip("remaining")}</div><div class="val">${fmtMoney(c.remaining_to_expiry, c.unknown)}</div></div>
  </div>
  <h4 style="margin-top:16px">Maintenance fee status ${tip("feestatus")}</h4>
  <div class="table-wrap"><table class="t"><thead><tr><th>Fee</th><th>Due date</th><th>Status</th><th class="num">Official fee</th></tr></thead><tbody>
  ${stages.map((x) => `<tr><td><b>${esc(x.stage)}-year</b></td><td class="small">${x.due_date ? fmtDate(x.due_date) : "—"}${x.grace_end ? `<div class="xsmall muted">grace until ${fmtDate(x.grace_end)}</div>` : ""}</td><td>${feeChip(x).split("<div")[0]}<div class="xsmall muted">${esc(x.label || "")}</div></td><td class="num">${x.state === "not_applicable" ? "—" : fmtMoney(x.amount)}${x.schedule_version ? `<div class="xsmall muted">${esc(x.schedule_version)}</div>` : ""}</td></tr>`).join("")}
  </tbody></table></div>
  ${inv.breakdown && inv.breakdown.length ? `<details class="adv" style="margin-top:10px"><summary>How “invested to date” is estimated</summary><table class="t"><tbody>${inv.breakdown.map((b) => `<tr><td class="small">${esc(b.label)}<div class="xsmall muted">${esc(b.basis)}</div></td><td class="num">${fmtMoney(b.amount)}</td></tr>`).join("")}<tr><td><b>Total</b></td><td class="num"><b>${fmtMoney(inv.total)}</b></td></tr></tbody></table><p class="xsmall muted">${esc(inv.note || "")}</p></details>` : ""}
  <div class="divider"></div><h4>Forward cost (next 3 and 5 years)</h4>
  <div class="costsplit">${[["3-year", t3], ["5-year", t5]].map(([l, t]) => `<div class="metric"><div class="lbl">${l} forward cost</div><div class="val">${fmtMoney(t.total, c.unknown)}</div><div class="xsmall muted">Official ${fmtMoney(t.official)}${Number(t.surcharge) ? ` (incl. ${fmtMoney(t.surcharge)} surcharge)` : ""} · professional ${fmtMoney(t.professional)} (estimate)</div></div>`).join("")}</div>
  ${c.items.length ? `<div class="table-wrap" style="margin-top:12px"><table class="t"><thead><tr><th>Item</th><th>Date</th><th class="num">Official</th><th class="num">Professional</th><th>Basis</th></tr></thead><tbody>${c.items.map((i) => `<tr><td class="small">${esc(i.label)}${i.state === "in_grace" ? ' <span class="badge b-bad">grace period</span>' : i.state === "payable_now" ? ' <span class="badge b-warn">window open</span>' : ""}${i.schedule_version ? `<div class="xsmall muted">${esc(i.schedule_version)}</div>` : ""}</td><td class="small nowrap">${fmtDate(i.date)}</td><td class="num">${fmtMoney(Number(i.official_fee || 0) + Number(i.surcharge || 0))}</td><td class="num">${fmtMoney(i.professional_fee)}</td><td><span class="badge ${i.basis === "official_schedule" ? "b-ocean" : "b-mute"}">${i.basis === "official_schedule" ? "official schedule" : "estimate"}</span></td></tr>`).join("")}</tbody></table></div>` : ""}
  ${c.notes.length ? `<ul class="why-list small" style="margin-top:10px">${c.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : ""}
  <div class="divider"></div><h4>Actual costs (customer records, sunk)</h4>
  ${actuals.length ? `<table class="t"><tbody>${actuals.map((x) => `<tr><td class="small">${esc(x.category)}<div class="xsmall muted">${esc(x.source_id)}</div></td><td class="small">${fmtDate(x.incurred_on)}</td><td class="num">${fmtMoney(x.amount)}</td></tr>`).join("")}</tbody></table><p class="xsmall muted">Historical spend is shown for context only and is never added to forward cost.</p>` : '<p class="small muted">No invoices or annuity records supplied.</p>'}</div>`;
}

function familyCard(fam, a) {
  const root = fam.find((m) => m.relationship_type === "original") || fam[0];
  const others = fam.filter((m) => m !== root);
  const H = Math.max(70, 26 + others.length * 46), W = 360;
  const node = (m, x, y) => `<g transform="translate(${x},${y})"><rect width="170" height="36" rx="9" fill="${m.id === a.id ? "#e6f6f4" : "#fff"}" stroke="${m.id === a.id ? "#00A39A" : "#cfd8dc"}" stroke-width="${m.id === a.id ? 2 : 1}"/><text x="10" y="15" fill="#005376" style="font-family:ui-monospace,monospace;font-size:10.5px">${esc(m.publication_number)}</text><text x="10" y="29" fill="#5d6870">${esc(m.jurisdiction)} · ${esc(m.status)}${m.recommendation ? " · " + esc((recLabel(m.recommendation) || "").split(" ")[0]) : ""}</text></g>`;
  const svg = `<svg class="chart famtree" viewBox="0 0 ${W} ${H}" role="img" aria-label="Family tree">${others.map((m, i) => { const y = 10 + i * 46; return `<path d="M175 ${H / 2} C 190 ${H / 2}, 175 ${y + 18}, 188 ${y + 18}" stroke="${m.relationship_type === "continuation" ? "#00A39A" : "#9fb3bc"}" stroke-dasharray="${m.relationship_type === "continuation" ? "" : "4 3"}" fill="none"/>${node(m, 188, y)}`; }).join("")}${node(root, 2, H / 2 - 18)}</svg>`;
  return `<div class="card"><div class="card-head"><h3>Family</h3><span class="small muted">${fam.length} member(s)</span></div>${svg}
    <p class="xsmall muted">Solid line: continuation. Each member has its own status, cost and value.</p>
    <table class="t"><tbody>${fam.map((m) => `<tr><td class="pub">${m.id === a.id ? `<b>${esc(m.publication_number)}</b>` : `<a href="#/a/${esc(m.id)}">${esc(m.publication_number)}</a>`}</td><td class="small">${esc(m.relationship_type)}</td><td>${statusTxt(m.status)}</td><td class="num small">${fmtMoney(m.cost_5y)}</td></tr>`).join("")}</tbody></table></div>`;
}



function resolveCard(a, codes) {
  if (!can("resolve") && !can("score")) return "";
  return `<div class="card" style="border:1px solid #f1d6a5"><h3>Resolve data issues</h3>
  ${codes.includes("STATUS_CONFLICT") && can("resolve") ? `<form id="rsf"><h4>Conflicting legal status</h4><p class="small muted">Confirm against the official register.</p><div class="row2"><label class="f"><span>Authoritative status</span><select class="input" name="status">${["active", "lapsed", "expired", "pending", "abandoned"].map((s) => `<option>${s}</option>`).join("")}</select></label><label class="f"><span>Source checked</span><input class="input" name="source" required value="USPTO Patent Center"></label></div><label class="f"><span>Note</span><input class="input" name="note" required placeholder="e.g. 7.5-yr fee payment recorded 12 Aug"></label><button class="btn btn-ocean btn-sm">Resolve status</button></form><div class="divider"></div>` : ""}
  ${codes.includes("OWNERSHIP_UNRESOLVED") && can("resolve") ? `<form id="rof"><h4>Ownership unresolved</h4><label class="f"><span>Current legal owner</span><input class="input" name="current_owner" required value="${esc(a.current_owner || "")}"></label><label class="f"><span>Evidence (e.g. recorded assignment reel/frame, merger certificate)</span><input class="input" name="evidence" required></label><label class="f"><span>Effective date</span><input class="input" type="date" name="effective_date"></label><button class="btn btn-ocean btn-sm">Confirm ownership</button></form><div class="divider"></div>` : ""}
  ${can("score") ? `<button class="btn btn-ghost btn-sm" id="rchk">Recheck legal status & deadlines now</button>` : ""}</div>`;
}

function inputsCard(a) {
  const ci = a.customer_inputs || {};
  const maps = a.product_mappings;
  const ed = can("inputs");
  return `<div class="card"><div class="card-head"><h3>Business inputs</h3>${maps === null ? '<span class="badge b-syn">mapping not supplied</span>' : ""}</div>
  <p class="xsmall muted">Commercial and strategic value can't be inferred from public data. These inputs are tenant-confidential.</p>
  <form id="cif"><div id="maps">${(maps || []).map((m, i) => mapRow(m, i, ed)).join("")}</div>
  ${ed ? `<div class="btn-row" style="margin:6px 0 10px"><button type="button" class="btn btn-quiet btn-xs" id="addMap">+ Add product</button>${maps !== null ? '<button type="button" class="btn btn-quiet btn-xs" id="noProd">Confirm no product uses this</button>' : ""}</div>` : ""}
  ${maps && maps.length === 0 ? '<p class="small"><span class="badge b-mute">Customer confirmed: no current product</span></p>' : ""}
  <div class="row2"><label class="f"><span>Strategy tag</span><select class="input" name="strategic_priority" ${ed ? "" : "disabled"}><option value="">Unknown</option>${["core", "defensive", "non_core"].map((x) => `<option value="${x}" ${ci.strategic_priority === x ? "selected" : ""}>${x.replace("_", "-")}</option>`).join("")}</select></label>
  <label class="f"><span>Roadmap relevance</span><select class="input" name="roadmap_relevance" ${ed ? "" : "disabled"}><option value="">Unknown</option>${["high", "medium", "low"].map((x) => `<option ${ci.roadmap_relevance === x ? "selected" : ""}>${x}</option>`).join("")}</select></label></div>
  <div class="row2"><label class="f"><span>Licensing history</span><select class="input" name="licensing_history" ${ed ? "" : "disabled"}><option value="">Unknown</option>${["licensed", "offered", "none"].map((x) => `<option ${(a.signals || {}).licensing_history === x ? "selected" : ""}>${x}</option>`).join("")}</select></label>
  <label class="check" style="align-self:center"><input type="checkbox" name="fto_relevance" ${ci.fto_relevance ? "checked" : ""} ${ed ? "" : "disabled"}> FTO / blocking relevance</label></div>
  ${ed ? '<button class="btn btn-ocean btn-sm">Save inputs & re-score</button>' : ""}</form></div>`;
}
function mapRow(m, i, ed) {
  const dis = ed ? "" : "disabled";
  return `<div class="row3 maprow" style="grid-template-columns:1.4fr 1fr 1fr auto;align-items:end"><label class="f"><span>Product</span><input class="input" name="product" value="${esc(m.product || "")}" ${dis}></label>
  <label class="f"><span>Lifecycle</span><select class="input" name="lifecycle" ${dis}>${["growth", "mature", "sunset", "discontinued"].map((x) => `<option ${m.lifecycle === x ? "selected" : ""}>${x}</option>`).join("")}</select></label>
  <label class="f"><span>Revenue</span><select class="input" name="revenue_band" ${dis}>${["high", "medium", "low"].map((x) => `<option ${m.revenue_band === x ? "selected" : ""}>${x}</option>`).join("")}</select></label>
  ${ed ? '<button type="button" class="btn btn-quiet btn-xs rmMap" style="margin-bottom:14px" aria-label="Remove">✕</button>' : "<span></span>"}</div>`;
}

function bindAsset(d) {
  const a = d.asset, run = d.score_run, sc = d.score;
  const reload = () => viewAsset(a.id, new URLSearchParams());
  $("#df")?.addEventListener("change", (e) => { if (e.target.name === "decision") $(".ovr").classList.toggle("hide", e.target.value !== "override"); });
  $("#df")?.addEventListener("submit", async (e) => {
    e.preventDefault(); const fd = new FormData(e.target);
    const body = { score_run_id: run.id, decision: fd.get("decision"), reason_code: fd.get("reason_code"), notes: fd.get("notes") };
    if (body.decision === "override") body.override_recommendation = fd.get("override_recommendation");
    try { const r = await api(`/v1/patents/${a.id}/review-decisions`, { method: "POST", body, headers: { "Idempotency-Key": idem() } }); toast(r.note); reload(); }
    catch (ex) { toast(ex.message, true); }
  });
  $$("[data-dim]").forEach((b) => b.addEventListener("click", () => {
    const k = b.dataset.dim; const v = sc.dimension_scores[k];
    modal(`<h3>${esc(dimLabel(k))}</h3><p class="small muted">Current: ${v.rating === null ? "UNKNOWN" : v.rating + "/5"} (${esc(v.basis || "no evidence")}). Your input overrides the derived rating, is attributed to you, and triggers a re-score.</p>
      <form id="dif"><label class="f"><span>Rating</span><select class="input" name="rating"><option value="">UNKNOWN — insufficient evidence</option>${[0, 1, 2, 3, 4, 5].map((i) => `<option value="${i}">${i} — ${["very low relevance", "weak relevance", "some relevance", "clear relevance", "strong relevance", "critical relevance"][i]}</option>`).join("")}</select></label>
      <label class="f"><span>Rationale (required)</span><textarea class="input" name="rationale" required minlength="5"></textarea></label>
      <label class="f"><span>Evidence source</span><input class="input" name="source" placeholder="e.g. BU review 14 Oct, product spec v3"></label>
      <div class="btn-row" style="justify-content:flex-end"><button type="button" class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-teal">Save & re-score</button></div></form>`);
    $("#dif").addEventListener("submit", async (e) => {
      e.preventDefault(); const fd = new FormData(e.target);
      try { await api(`/v1/patents/${a.id}/dimension-inputs`, { method: "POST", body: { dimension: k, rating: fd.get("rating") === "" ? null : Number(fd.get("rating")), rationale: fd.get("rationale"), source: fd.get("source") } }); closeModal(); toast("Input saved; portfolio re-scored"); reload(); }
      catch (ex) { toast(ex.message, true); }
    });
  }));
  $("#rsf")?.addEventListener("submit", async (e) => { e.preventDefault(); const fd = Object.fromEntries(new FormData(e.target)); try { await api(`/v1/patents/${a.id}/resolve-status`, { method: "POST", body: fd }); toast("Status resolved; re-scored"); reload(); } catch (ex) { toast(ex.message, true); } });
  $("#rof")?.addEventListener("submit", async (e) => { e.preventDefault(); const fd = Object.fromEntries(new FormData(e.target)); if (!fd.effective_date) delete fd.effective_date; try { await api(`/v1/patents/${a.id}/resolve-ownership`, { method: "POST", body: fd }); toast("Ownership confirmed; re-scored"); reload(); } catch (ex) { toast(ex.message, true); } });
  $("#rchk")?.addEventListener("click", async () => { try { const r = await api(`/v1/patents/${a.id}/recheck-status`, { method: "POST" }); toast(`Status rechecked: ${r.status}${r.conflict_remaining ? " — conflict still needs resolution" : ""}`); reload(); } catch (ex) { toast(ex.message, true); } });
  $("#addMap")?.addEventListener("click", () => $("#maps").insertAdjacentHTML("beforeend", mapRow({ lifecycle: "mature", revenue_band: "medium" }, 0, true)));
  $("#maps")?.addEventListener("click", (e) => { if (e.target.matches(".rmMap")) e.target.closest(".maprow").remove(); });
  $("#noProd")?.addEventListener("click", () => { $("#maps").innerHTML = ""; toast("Mapping cleared — save to confirm no product uses this patent"); });
  $("#cif")?.addEventListener("submit", async (e) => {
    e.preventDefault(); const fd = new FormData(e.target);
    const maps = $$(".maprow").map((r) => ({ product: $("[name=product]", r).value.trim(), lifecycle: $("[name=lifecycle]", r).value, revenue_band: $("[name=revenue_band]", r).value, confirmed_use: true })).filter((m) => m.product);
    const body = { product_mappings: maps };
    if (a.product_mappings === null && !maps.length) delete body.product_mappings;
    for (const k of ["strategic_priority", "roadmap_relevance", "licensing_history"]) if (fd.get(k)) body[k] = fd.get(k);
    body.fto_relevance = !!fd.get("fto_relevance");
    try { await api(`/v1/patents/${a.id}/customer-inputs`, { method: "PUT", body }); toast("Inputs saved; portfolio re-scored"); reload(); }
    catch (ex) { toast(ex.message, true); }
  });
}

/* ================================================================ REVIEW QUEUE */




/* ================================================================ AUDIT */


/* ================================================================ SETTINGS */
async function viewSettings() {
  main().innerHTML = loading();
  const cfgs = await api("/v1/scoring-configs");
  const def = cfgs.find((c) => c.kind === "default");
  const m = S.meta;
  const canW = can("weights_config"), canC = can("cost_config");
  const ca = def.cost_assumptions;
  main().innerHTML = `<div class="wrap page"><div class="eyebrow">Configuration</div><h2>Model, gates & cost assumptions</h2>
  <p class="muted" style="max-width:800px">Weights are initial product hypotheses, configurable and versioned — not scientifically validated until calibrated on expert-reviewed portfolios. Every change is audited and creates a new version.</p>
  <div class="grid g2">
    <div class="card"><div class="card-head"><h3>Default scoring model</h3><span class="badge b-ocean">${esc(def.name)} · v${def.version}</span></div>
      <form id="wf">${m.dimensions.map((d) => `<div class="slider-row"><span>${esc(d.label)} ${tip(d.key)}</span><span class="help">${esc(DIM_HELP[d.key].slice(0, 60))}…</span><input class="input" style="padding:4px 6px" type="number" min="0" max="100" name="${d.key}" value="${def.weights[d.key]}" ${canW ? "" : "disabled"}></div>`).join("")}
      <div class="row3" style="margin-top:14px">${[["retain", "Retain if score ≥"], ["review", "Review if score ≥ (below = Abandon)"], ["coverage_min", "Min coverage %"], ["confidence_min", "Min confidence %"]].map(([k, l]) => `<label class="f"><span>${l}</span><input class="input" type="number" name="t_${k}" value="${def.thresholds[k]}" ${canW ? "" : "disabled"}></label>`).join("")}
      <label class="f"><span>Deadline warning (days)</span><input class="input" type="number" name="g_deadline_warning_days" value="${def.gates.deadline_warning_days}" ${canW ? "" : "disabled"}></label></div>
      ${canW ? '<button class="btn btn-ocean btn-sm">Save new model version</button>' : '<p class="xsmall muted">Your role cannot change the default model. Use Scenarios to explore alternatives.</p>'}</form></div>
    <div class="card"><div class="card-head"><h3>Cost assumptions</h3><span class="badge b-mute">${esc(ca.assumption_version)}</span></div>
      <form id="cf2"><div class="row2">
        <label class="f"><span>Annuity service fee per payment (USD)</span><input class="input" type="number" name="annuity_service_fee_per_payment" value="${esc(ca.annuity_service_fee_per_payment)}" ${canC ? "" : "disabled"}></label>
        <label class="f"><span>Office-action response cost (USD)</span><input class="input" type="number" name="office_action_response_cost" value="${esc(ca.office_action_response_cost)}" ${canC ? "" : "disabled"}></label>
        <label class="f"><span>Issue fee, large entity (USD)</span><input class="input" type="number" name="issue_fee_large" value="${esc(ca.issue_fee_large)}" ${canC ? "" : "disabled"}></label>
        <label class="f"><span>Issue-fee preparation (USD)</span><input class="input" type="number" name="issue_fee_prep_cost" value="${esc(ca.issue_fee_prep_cost)}" ${canC ? "" : "disabled"}></label>
        <label class="f"><span>Months to grant (pending)</span><input class="input" type="number" name="expected_months_to_grant" value="${esc(ca.expected_months_to_grant)}" ${canC ? "" : "disabled"}></label>
        <label class="f"><span>Non-US member flat annual estimate</span><input class="input" type="number" name="foreign_member_annual_estimate" value="${esc(ca.foreign_member_annual_estimate ?? "")}" placeholder="blank = UNKNOWN" ${canC ? "" : "disabled"}></label>
      </div>${canC ? '<button class="btn btn-ocean btn-sm">Save assumptions</button>' : '<p class="xsmall muted">Finance partners and administrators can edit cost assumptions.</p>'}</form>
      <div class="divider"></div><h4>Official fee schedules (US)</h4>
      <div class="table-wrap"><table class="t"><thead><tr><th>Version</th><th>Effective</th><th class="num">3.5 yr</th><th class="num">7.5 yr</th><th class="num">11.5 yr</th><th class="num">Grace surcharge</th></tr></thead><tbody>${m.fee_schedules.map((f) => ["large", "small", "micro"].map((e, i) => `<tr><td class="small">${i ? "" : `<b>${esc(f.version)}</b>`}<div class="xsmall muted">${esc(e)} entity</div></td><td class="small">${i ? "" : fmtDate(f.effective_from)}</td><td class="num">${fmtMoney(f.maintenance["3.5"][e])}</td><td class="num">${fmtMoney(f.maintenance["7.5"][e])}</td><td class="num">${fmtMoney(f.maintenance["11.5"][e])}</td><td class="num">${fmtMoney(f.grace_surcharge[e])}</td></tr>`).join("")).join("")}</tbody></table></div>
      <p class="xsmall muted">Fees are applied by the schedule in force on the payment date. Verify against the USPTO fee schedule before relying on figures.</p></div>
  </div>
  <div class="grid g2" style="margin-top:18px">
    <div class="card"><h3>Data connectors</h3><table class="t"><tbody>${m.connectors.map((c) => `<tr><td><b>${esc(c.name)}</b><div class="xsmall muted">${esc(c.note)}</div></td><td>${c.status === "active" ? '<span class="badge b-ok">active</span>' : '<span class="badge b-warn">not configured</span>'}</td></tr>`).join("")}</tbody></table></div>
  </div></div>`;
  $("#wf").addEventListener("submit", async (e) => {
    e.preventDefault(); const fd = new FormData(e.target);
    const weights = Object.fromEntries(m.dimensions.map((d) => [d.key, Number(fd.get(d.key))]));
    const thresholds = Object.fromEntries(["retain", "review", "coverage_min", "confidence_min"].map((k) => [k, Number(fd.get("t_" + k))]));
    try { await api("/v1/scoring-configs/default", { method: "PUT", body: { weights, thresholds, gates: { deadline_warning_days: Number(fd.get("g_deadline_warning_days")) } } }); toast("New default model version saved. Re-run scoring on portfolios to apply."); viewSettings(); }
    catch (ex) { toast(ex.message, true); }
  });
  $("#cf2").addEventListener("submit", async (e) => {
    e.preventDefault(); const fd = new FormData(e.target); const body = {};
    for (const [k, v] of fd.entries()) body[k] = v === "" ? null : ["expected_months_to_grant"].includes(k) ? Number(v) : String(v);
    try { await api("/v1/scoring-configs/default", { method: "PUT", body: { cost_assumptions: body } }); toast("Cost assumptions saved as a new version"); viewSettings(); }
    catch (ex) { toast(ex.message, true); }
  });
}

boot().catch((ex) => { main().innerHTML = errorView(ex); });
