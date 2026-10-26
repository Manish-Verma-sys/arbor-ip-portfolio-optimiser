/* Arbor IP — single-page app (no framework). All server data is escaped before rendering. */
"use strict";

const S = { meta: null, me: null, uid: localStorage.getItem("arbor_uid") || "u_ipm", pf: {}, filters: {}, scen: {}, poll: null };
const $ = (q, el = document) => el.querySelector(q);
const $$ = (q, el = document) => [...el.querySelectorAll(q)];
const main = () => $("#main");

const REC_COLORS = {
  strong_retain: "#005376", retain_monitor: "#00A39A", strategic_review: "#D9A46F",
  abandonment_review_candidate: "#B5523B", insufficient_evidence: "#8F9BA3", blocked: "#3D3D3D", not_in_force: "#C6CCD0",
};
const REC_ORDER = ["strong_retain", "retain_monitor", "strategic_review", "abandonment_review_candidate", "insufficient_evidence", "not_in_force", "blocked"];
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
const gatePill = (g) => `<span class="badge gate gate-${esc(g)}">${esc(g)}</span>`;
const statusTxt = (s) => `<span class="status status-${esc(s)}">${esc(s)}</span>`;
const modeBadge = (m) => (m === "synthetic" ? '<span class="badge b-syn" title="Fictional demonstration data">SYNTHETIC DEMO DATA</span>' : m === "imported" ? '<span class="badge b-imp">CUSTOMER IMPORT</span>' : `<span class="badge b-mute">${esc(m)}</span>`);
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
  [/^\/reviews$/, viewReviews],
  [/^\/batch\/([\w-]+)$/, viewBatch],
  [/^\/audit$/, viewAudit],
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
  const [meta, ids] = await Promise.all([api("/v1/meta"), api("/v1/demo-identities")]);
  S.meta = meta;
  $("#disclaimer").textContent = meta.disclaimer;
  $("#footMeta").innerHTML = `v${esc(meta.version)} · ${esc(meta.scoring_version)}<br>Synthetic demo entities are fictional.`;
  const sel = $("#identity");
  sel.innerHTML = ids.map((u) => `<option value="${esc(u.id)}">${esc(u.name)} — ${esc(u.role_label)}${u.tenant_id !== "tenant_demo" ? " (other tenant)" : ""}</option>`).join("");
  if (!ids.find((u) => u.id === S.uid)) S.uid = "u_ipm";
  sel.value = S.uid;
  sel.addEventListener("change", async () => {
    S.uid = sel.value; localStorage.setItem("arbor_uid", S.uid);
    S.me = await api("/v1/me"); toast(`Now acting as ${S.me.name} (${S.me.role_label})`);
    router();
  });
  S.me = await api("/v1/me");
  router();
}

/* ================================================================ HOME */
async function viewHome() {
  const dq = S.meta.demo_queries;
  main().innerHTML = `
  <section class="hero"><div class="wrap hero-grid">
    <div>
      <div class="eyebrow">Patent portfolio optimisation engine</div>
      <h1>Know which patents to keep, review or let go.</h1>
      <p class="lead">Search a company or inventor. Arbor rebuilds the portfolio, groups families, forecasts official and professional costs, and scores seven evidence-based dimensions — then shows exactly why each asset is a retain, monitor, review or abandonment-review candidate.</p>
      <div class="principles" style="margin-top:28px">
        <div class="principle"><b>Unknown is not zero</b><span class="small muted">Missing evidence lowers coverage, never the score.</span></div>
        <div class="principle"><b>Explainable</b><span class="small muted">Every rating links to its source, date and rationale.</span></div>
        <div class="principle"><b>Human decides</b><span class="small muted">Nothing is ever abandoned or paid automatically.</span></div>
      </div>
    </div>
    <div class="search-card" id="searchCard">
      <div class="seg" role="tablist" aria-label="Search type">
        <button role="tab" class="on" data-t="company" aria-selected="true">Company</button>
        <button role="tab" data-t="inventor" aria-selected="false">Inventor</button>
      </div>
      <form id="sf" autocomplete="off">
        <label class="f"><span id="nameLbl">Company or assignee name</span><input class="input input-lg" name="name" required minlength="2" placeholder="e.g. Northwind Medical Technologies" /></label>
        <div class="co">
          <details class="adv"><summary>Disambiguation (optional)</summary>
            <div class="row2">
              <label class="f"><span>Country</span><input class="input" name="country" placeholder="US" maxlength="2" /></label>
              <label class="f"><span>Website / domain</span><input class="input" name="domain" placeholder="example.com" /></label>
            </div>
            <label class="f"><span>Former names (comma-separated)</span><input class="input" name="former_names" placeholder="Northwind Surgical Corp." /></label>
            <label class="f"><span>Known subsidiaries (comma-separated)</span><input class="input" name="known_subsidiaries" placeholder="Cardiolume Systems LLC" /></label>
            <label class="check"><input type="checkbox" name="include_subsidiaries" /> Pre-select documented subsidiaries & acquisitions</label>
          </details>
        </div>
        <div class="inv hide">
          <div class="row2">
            <label class="f"><span>Organisation</span><input class="input" name="organisation" placeholder="Employer" /></label>
            <label class="f"><span>Co-inventor</span><input class="input" name="co_inventor" placeholder="Name" /></label>
          </div>
          <label class="f"><span>Country</span><input class="input" name="icountry" maxlength="2" placeholder="US" /></label>
        </div>
        <div class="btn-row" style="justify-content:space-between">
          <span class="help">US-first · jurisdiction scope: US (+ family counterparts)</span>
          <button class="btn btn-teal" ${can("search") ? "" : "disabled title='Your role cannot start searches'"}>Find entity</button>
        </div>
      </form>
      <div class="divider"></div>
      <div class="small muted" style="margin-bottom:8px">Try a demo entity</div>
      <div class="chips" id="demoChips"></div>
    </div>
  </div>
  <div class="wrap"><div class="steps">
    <div class="step"><span class="n">01</span><b>Resolve</b><span class="small muted">Candidate entities with match evidence; you confirm.</span></div>
    <div class="step"><span class="n">02</span><b>Reconstruct</b><span class="small muted">Applications, grants, families, ownership timeline.</span></div>
    <div class="step"><span class="n">03</span><b>Score & cost</b><span class="small muted">Seven dimensions, coverage, confidence, 3/5-year cost.</span></div>
    <div class="step"><span class="n">04</span><b>Review</b><span class="small muted">Gates, scenarios, review batches, audited decisions.</span></div>
  </div></div></section>
  <section class="wrap page">
    <div class="grid g-side">
      <div class="card"><div class="card-head"><h3>Recent portfolios</h3><a class="btn btn-quiet btn-sm" href="#/portfolios">View all →</a></div><div id="recent">${'<div class="skeleton"></div>'.repeat(3)}</div></div>
      <div class="card">
        <h3>Import your own portfolio</h3>
        <p class="small muted">Upload a CSV of your patents with optional product mappings, strategy tags and licensing history. Unknown fields stay UNKNOWN — they are never treated as zero.</p>
        <form id="impf">
          <label class="f"><span>Portfolio name</span><input class="input" name="name" required placeholder="FY27 renewal review" /></label>
          <label class="f"><span>Owner (legal entity)</span><input class="input" name="owner" required placeholder="Your Company Inc." /></label>
          <div class="row2">
            <label class="f"><span>Entity size</span><select class="input" name="entity_size"><option value="large">Large</option><option value="small">Small</option><option value="micro">Micro</option></select></label>
            <label class="f"><span>CSV file</span><input class="input" type="file" name="file" accept=".csv,text/csv" required /></label>
          </div>
          <div class="btn-row"><button class="btn btn-ocean btn-sm" ${can("search") ? "" : "disabled"}>Import & score</button><button type="button" class="btn btn-quiet btn-sm" id="tpl">Download template</button></div>
        </form>
      </div>
    </div>
  </section>`;
  let type = "company";
  const chips = () => { $("#demoChips").innerHTML = dq[type].map((n) => `<button class="chip" type="button">${esc(n)}</button>`).join(""); };
  chips();
  $$(".seg button").forEach((b) => b.addEventListener("click", () => {
    type = b.dataset.t;
    $$(".seg button").forEach((x) => { x.classList.toggle("on", x === b); x.setAttribute("aria-selected", x === b); });
    $(".co").classList.toggle("hide", type !== "company"); $(".inv").classList.toggle("hide", type !== "inventor");
    $("#nameLbl").textContent = type === "company" ? "Company or assignee name" : "Inventor name";
    $("#sf [name=name]").placeholder = type === "company" ? "e.g. Northwind Medical Technologies" : "e.g. Priya Raman";
    chips();
  }));
  $("#demoChips").addEventListener("click", (e) => { if (e.target.matches(".chip")) { $("#sf [name=name]").value = e.target.textContent; $("#sf [name=name]").focus(); } });
  $("#sf").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const list = (k) => (f.get(k) || "").split(",").map((s) => s.trim()).filter(Boolean);
    const body = { query_type: type, name: f.get("name").trim(), jurisdiction_scope: ["US"] };
    if (type === "company") Object.assign(body, { country: f.get("country") || null, domain: f.get("domain") || null, former_names: list("former_names"), known_subsidiaries: list("known_subsidiaries"), include_subsidiaries: !!f.get("include_subsidiaries") });
    else Object.assign(body, { organisation: f.get("organisation") || null, co_inventor: f.get("co_inventor") || null, country: f.get("icountry") || null });
    try {
      const s = await api("/v1/portfolio-searches", { method: "POST", body, headers: { "Idempotency-Key": idem() } });
      location.hash = `#/search/${s.search_id}`;
    } catch (ex) { toast(ex.message, true); }
  });
  $("#tpl").addEventListener("click", () => download("/v1/templates/portfolio.csv", "portfolio_import_template.csv"));
  $("#impf").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = e.submitter; btn.disabled = true; btn.textContent = "Importing…";
    try {
      const r = await api("/v1/portfolios/import", { method: "POST", body: new FormData(e.target) });
      toast(`Imported ${r.imported} assets${r.warnings.length ? ` with ${r.warnings.length} warning(s)` : ""}`);
      if (r.warnings.length) console.warn(r.warnings);
      location.hash = `#/p/${r.portfolio_id}`;
    } catch (ex) { toast(ex.message, true); btn.disabled = false; btn.textContent = "Import & score"; }
  });
  try {
    const pfs = await api("/v1/portfolios");
    $("#recent").innerHTML = pfs.length ? pfs.slice(0, 5).map(pfRow).join("") : `<div class="empty small">No portfolios yet — search above.</div>`;
  } catch (ex) { $("#recent").innerHTML = `<p class="muted">${esc(ex.message)}</p>`; }
}

function pfRow(p) {
  const s = p.summary || {};
  const ab = (s.by_recommendation || {}).abandonment_review_candidate || 0;
  return `<a href="#/p/${esc(p.portfolio_id)}" style="display:grid;grid-template-columns:1fr auto;gap:8px;padding:12px 4px;border-bottom:1px solid var(--line-2);text-decoration:none;color:inherit">
    <div><div style="font-family:var(--serif);font-size:18px;color:var(--ocean)">${esc(p.name)}</div>
      <div class="small muted">${s.assets ?? "—"} assets · ${s.families ?? "—"} families · ${fmtMoney(s.forward_cost?.["5"])} 5-yr forward cost · ${ab} abandonment-review</div></div>
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
    <div class="eyebrow">Step 2 of 2 · Portfolio discovery</div>
    <h2>${esc(s.confirmed?.entity?.canonical_name || s.name)}</h2>
    <div class="progress" aria-label="Progress"><i style="width:${s.progress}%"></i></div>
    <ol class="stepper">${JOB_STEPS.map(([k, l], i) => `<li class="${done || i < idx ? "done" : i === idx && !fail ? "now" : ""}"><span class="dot">${done || i < idx ? "✓" : ""}</span><span>${esc(l)}</span><span class="muted xsmall" style="margin-left:auto">${esc(k)}</span></li>`).join("")}</ol>
    ${fail ? `<div class="callout callout-bad">${ICON.warn}<div><b>Job failed.</b> ${esc(s.error)} <a href="#/">Retry search</a></div></div>` : ""}
    ${s.status === "PARTIAL" ? `<div class="callout callout-warn">${ICON.warn}<div><b>Partial result.</b> Some sources are unavailable; limitations are shown alongside results.</div></div>` : ""}
    <div class="card" style="margin-top:14px"><h4>Job log</h4><ul class="why-list small">${(s.messages || []).map((m) => `<li><span class="muted">${fmtDT(m.t)}</span> — ${esc(m.msg)}</li>`).join("")}</ul>
    ${s.portfolio_id ? `<a class="btn btn-teal" href="#/p/${esc(s.portfolio_id)}">Open portfolio →</a>` : ""}</div></div>`;
}

/* ================================================================ PORTFOLIO */
async function viewPortfolio(pid, tab = "overview", q) {
  main().innerHTML = loading();
  const p = await api(`/v1/portfolios/${pid}`);
  S.pf = p;
  const runId = q.get("run") || p.latest_score_run_id;
  const tabs = [["overview", "Dashboard"], ["assets", "Assets"], ["families", "Families"], ["scenarios", "Scenarios"], ["reviews", "Reviews"], ["runs", "Score runs"]];
  main().innerHTML = `
  <section class="band"><div class="wrap">
    <div class="eyebrow">${p.query_type === "inventor" ? "Inventor portfolio" : "Company portfolio"} · ${esc(p.ownership_scope.replace(/_/g, " "))}</div>
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
  const fn = { overview: tabOverview, assets: tabAssets, families: tabFamilies, scenarios: tabScenarios, reviews: tabReviews, runs: tabRuns }[tab] || tabOverview;
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
  const attention = rows.filter((r) => r.gate_codes.some((g) => ["IN_GRACE_PERIOD", "DEADLINE_IMMINENT", "STATUS_CONFLICT", "OWNERSHIP_UNRESOLVED"].includes(g)))
    .sort((a, b) => (a.next_deadline || "9999").localeCompare(b.next_deadline || "9999"));
  const insuff = br.insufficient_evidence || 0;
  tb.innerHTML = `
  <div class="kpis">
    ${kpi("Patent assets", s.assets, `${s.families} families`, ICON.doc)}
    ${kpi("In force / pending", `${s.in_force} / ${s.pending}`, `${(br.not_in_force || 0)} not in force`, ICON.fam)}
    ${kpi("Forward cost · 3 yr", fmtMoney(s.forward_cost["3"]), s.unknown_cost_assets ? `${s.unknown_cost_assets} assets UNKNOWN cost` : "official + professional", ICON.coin)}
    ${kpi("Forward cost · 5 yr", fmtMoney(s.forward_cost["5"]), "estimates, not actuals", ICON.coin)}
    ${kpi("Avg data coverage", s.avg_coverage + "%", `avg confidence ${s.avg_confidence}%`, ICON.gauge, s.avg_coverage < 70 ? "warn" : "")}
    ${kpi("Blocked · stale", `${(s.by_gate || {}).BLOCK || 0} · ${s.stale_records}`, "need resolution / recheck", ICON.alert, ((s.by_gate || {}).BLOCK || s.stale_records) ? "alert" : "")}
  </div>
  ${insuff ? `<div class="callout callout-cream" style="margin-top:16px">${ICON.info}<div><b>${insuff} asset(s) have insufficient evidence</b> (coverage below ${run.config.thresholds.coverage_min}% or low confidence). They are not scored as low value. Add product mappings and strategy tags to unlock a recommendation. ${can("inputs") ? `<button class="btn btn-ghost btn-xs" id="ciUp">Upload business inputs</button>` : ""}</div></div>` : ""}
  <div class="grid g2" style="margin-top:18px">
    <div class="card"><div class="card-head"><h3>Recommendations</h3><span class="small muted">${esc(run.config.name)} · ${esc(run.scoring_version)}</span></div>
      <div class="stackbar" role="img" aria-label="Recommendation distribution">${REC_ORDER.filter((k) => br[k]).map((k) => `<span style="width:${(br[k] / total) * 100}%;background:${REC_COLORS[k]}" title="${esc(recLabel(k))}: ${br[k]}"></span>`).join("")}</div>
      <div class="legend">${REC_ORDER.map((k) => `<button data-rec="${k}">${recPill(k)}<b>${br[k] || 0}</b></button>`).join("")}</div>
      <p class="xsmall muted" style="margin-top:10px">Click a category to open the filtered asset list. Recommendations are candidates for human review — never automatic actions.</p></div>
    <div class="card"><div class="card-head"><h3>Forward cost by year</h3><span class="small muted">USD · official fees + configurable professional costs</span></div>${costChart(s.cost_by_year, run.as_of_date)}</div>
  </div>
  <div class="grid g2" style="margin-top:18px">
    <div class="card"><div class="card-head"><h3>Value vs. 5-year cost</h3><span class="small muted">each dot is an asset with a score</span></div>${scatter(rows)}</div>
    <div class="card"><div class="card-head"><h3>Needs attention</h3><span class="small muted">deadlines, grace periods, blocking gates</span></div>
      ${attention.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Asset</th><th>Issue</th><th>Date</th></tr></thead><tbody>${attention.slice(0, 8).map((r) => `<tr><td><a class="pub" href="#/a/${esc(r.patent_asset_id)}">${esc(r.publication_number)}</a><div class="xsmall muted">${esc(r.title.slice(0, 54))}</div></td><td>${r.gate_codes.filter((g) => ["IN_GRACE_PERIOD", "DEADLINE_IMMINENT", "STATUS_CONFLICT", "OWNERSHIP_UNRESOLVED"].includes(g)).map((g) => `<span class="badge ${g.includes("STATUS") || g.includes("OWNERSHIP") ? "b-bad" : "b-warn"}">${esc(g.replace(/_/g, " ").toLowerCase())}</span>`).join(" ")}</td><td class="nowrap small">${fmtDate(r.next_deadline)}${r.next_deadline ? `<div class="xsmall muted">${daysTo(r.next_deadline)} days</div>` : ""}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty small">Nothing urgent.</div>`}</div>
  </div>
  <div class="grid g2" style="margin-top:18px">
    <div class="card"><h3>Sources & freshness</h3>
      <dl class="kv"><dt>Data mode</dt><dd>${modeBadge(p.data_mode)}</dd><dt>Sources</dt><dd>${p.sources.map(esc).join("<br>")}</dd>
      <dt>Unavailable</dt><dd>${p.unavailable_sources.length ? p.unavailable_sources.map((x) => `<span class="badge b-warn">${esc(x)}</span>`).join(" ") : "None"}</dd>
      <dt>Score run</dt><dd class="mono small">${esc(run.score_run_id)} · hash ${esc(run.data_snapshot_hash.slice(0, 12))}</dd><dt>Run at</dt><dd>${fmtDT(run.run_at)}</dd></dl>
      <div class="btn-row" style="margin-top:12px">${can("score") ? `<button class="btn btn-ghost btn-sm" id="refresh">Recheck legal status</button><button class="btn btn-ghost btn-sm" id="rescore">Re-run scoring</button>` : ""}</div></div>
    <div class="card"><h3>Exports</h3><p class="small muted">Every export includes the data date, scoring version, weights, assumptions and the decision-support disclaimer.</p>
      <div class="btn-row">${["csv", "xlsx", "pdf"].map((f) => `<button class="btn btn-ghost btn-sm" data-exp="${f}">${f.toUpperCase()}</button>`).join("")}</div>
      <div class="divider"></div><h4>Business inputs</h4><p class="small muted">Download the pre-filled template, add product mappings, lifecycle, revenue band, strategy and licensing, then upload. Each upload re-scores the portfolio.</p>
      <div class="btn-row"><button class="btn btn-quiet btn-sm" id="ciTpl">Download inputs template</button>${can("inputs") ? `<label class="btn btn-ocean btn-sm">Upload inputs CSV<input type="file" accept=".csv" id="ciFile" hidden></label>` : ""}</div></div>
  </div>`;
  $$(".legend button").forEach((b) => b.addEventListener("click", () => { S.filters[p.portfolio_id] = { recommendation: b.dataset.rec }; location.hash = `#/p/${p.portfolio_id}/assets`; }));
  $$("[data-exp]").forEach((b) => b.addEventListener("click", () => download(`/v1/score-runs/${runId}/export.${b.dataset.exp}`, `export.${b.dataset.exp}`)));
  $$(".scatter-dot").forEach((d) => d.addEventListener("click", () => (location.hash = `#/a/${d.dataset.id}`)));
  $("#refresh")?.addEventListener("click", async (e) => { e.target.disabled = true; try { const r = await api(`/v1/portfolios/${p.portfolio_id}/refresh-status`, { method: "POST" }); toast(`Rechecked ${r.rechecked} records. ${r.note}`); router(); } catch (ex) { toast(ex.message, true); e.target.disabled = false; } });
  $("#rescore")?.addEventListener("click", async (e) => { e.target.disabled = true; try { await api(`/v1/portfolios/${p.portfolio_id}/score-runs`, { method: "POST", body: { cost_horizon_years: [3, 5] }, headers: { "Idempotency-Key": idem() } }); toast("New score run created"); router(); } catch (ex) { toast(ex.message, true); } });
  $("#ciTpl").addEventListener("click", () => download(`/v1/portfolios/${p.portfolio_id}/customer-inputs-template.csv`, "customer_inputs.csv"));
  $("#ciUp")?.addEventListener("click", () => $("#ciFile")?.click());
  $("#ciFile")?.addEventListener("change", async (e) => {
    const fd = new FormData(); fd.append("file", e.target.files[0]);
    try { const r = await api(`/v1/portfolios/${p.portfolio_id}/customer-inputs`, { method: "POST", body: fd }); toast(`Updated ${r.updated} assets; portfolio re-scored.${r.warnings.length ? " " + r.warnings.length + " warning(s)." : ""}`); router(); }
    catch (ex) { toast(ex.message, true); }
  });
}

function kpi(label, val, sub, icon, cls = "") {
  return `<div class="kpi ${cls}"><div><div class="lbl">${esc(label)}</div><div class="val">${val}</div><div class="sub">${esc(sub)}</div></div><div class="ico">${icon}</div></div>`;
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

function scatter(rows) {
  const pts = rows.filter((r) => r.strategic_score !== null && r.cost_5y !== null);
  if (!pts.length) return `<div class="empty small">No assets have both a score and a known cost yet.</div>`;
  const W = 560, H = 260, pl = 46, pb = 34, pt = 10, pr = 14;
  const maxC = Math.max(1000, ...pts.map((r) => Number(r.cost_5y)));
  const x = (c) => pl + (W - pl - pr) * (c / maxC);
  const y = (s) => pt + (H - pt - pb) * (1 - s / 100);
  const bands = [[80, 100, "#005376"], [65, 80, "#00A39A"], [45, 65, "#D9A46F"], [0, 45, "#B5523B"]];
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Score versus five-year cost scatter plot">
    ${bands.map(([a, b, c]) => `<rect x="${pl}" y="${y(b)}" width="${W - pl - pr}" height="${y(a) - y(b)}" fill="${c}" opacity=".06"/>`).join("")}
    ${[0, 45, 65, 80, 100].map((s) => `<line class="axis" x1="${pl}" x2="${W - pr}" y1="${y(s)}" y2="${y(s)}" stroke-dasharray="3 4"/><text x="${pl - 6}" y="${y(s) + 4}" text-anchor="end">${s}</text>`).join("")}
    ${[0, 0.5, 1].map((t) => `<text x="${x(t * maxC)}" y="${H - 14}" text-anchor="middle">$${Math.round((t * maxC) / 1000)}k</text>`).join("")}
    <text x="${(W + pl) / 2}" y="${H - 1}" text-anchor="middle">5-year forward cost →</text>
    <text x="12" y="${H / 2}" transform="rotate(-90 12 ${H / 2})" text-anchor="middle">Strategic value score →</text>
    ${pts.map((r) => `<circle class="scatter-dot" data-id="${esc(r.patent_asset_id)}" cx="${x(Number(r.cost_5y)).toFixed(1)}" cy="${y(r.strategic_score).toFixed(1)}" r="6" fill="${REC_COLORS[r.recommendation]}" stroke="#fff" stroke-width="1.5" style="cursor:pointer"><title>${esc(r.publication_number)} — ${esc(recLabel(r.recommendation))}\nScore ${r.strategic_score} · $${Number(r.cost_5y).toLocaleString()}</title></circle>`).join("")}
  </svg>`;
}

/* ---------------- assets tab */
async function tabAssets(p, runId) {
  const f = (S.filters[p.portfolio_id] = S.filters[p.portfolio_id] || {});
  f.sort = f.sort || "strategic_score"; f.order = f.order || "desc"; f.page = f.page || 1;
  const sel = new Set();
  const tb = $("#tb");
  tb.innerHTML = `<div class="card">
    <div class="filters" id="flt">
      <label>Search<input class="input" name="q" placeholder="Publication, title, owner" value="${esc(f.q || "")}"></label>
      <label>Recommendation<select class="input" name="recommendation"><option value="">All</option>${REC_ORDER.map((k) => `<option value="${k}" ${f.recommendation === k ? "selected" : ""}>${esc(recLabel(k))}</option>`).join("")}</select></label>
      <label>Gate<select class="input" name="gate"><option value="">All</option>${["PASS", "REVIEW", "BLOCK"].map((g) => `<option ${f.gate === g ? "selected" : ""}>${g}</option>`).join("")}</select></label>
      <label>Jurisdiction<select class="input" name="jurisdiction"><option value="">All</option>${["US", "EP", "CN"].map((g) => `<option ${f.jurisdiction === g ? "selected" : ""}>${g}</option>`).join("")}</select></label>
      <label>Status<select class="input" name="status"><option value="">All</option>${["active", "pending", "expired", "lapsed", "abandoned"].map((g) => `<option ${f.status === g ? "selected" : ""}>${g}</option>`).join("")}</select></label>
      <label>Deadline within<select class="input" name="deadline_days"><option value="">Any</option>${[30, 90, 180, 365].map((d) => `<option value="${d}" ${String(f.deadline_days) === String(d) ? "selected" : ""}>${d} days</option>`).join("")}</select></label>
      <label>Min confidence<select class="input" name="min_confidence"><option value="">Any</option>${[50, 70, 85].map((d) => `<option value="${d}" ${String(f.min_confidence) === String(d) ? "selected" : ""}>${d}%</option>`).join("")}</select></label>
      <label>Reviewed<select class="input" name="decided"><option value="">Any</option><option value="no" ${f.decided === "no" ? "selected" : ""}>Not yet</option><option value="yes" ${f.decided === "yes" ? "selected" : ""}>Decided</option></select></label>
      <button class="btn btn-quiet btn-sm" id="clr" type="button">Clear</button>
      <span style="flex:1"></span>
      <div class="btn-row">${["csv", "xlsx", "pdf"].map((x) => `<button class="btn btn-ghost btn-xs" data-exp="${x}" type="button">${x.toUpperCase()}</button>`).join("")}</div>
    </div>
    <div id="tbl"><div class="skeleton"></div></div>
  </div>
  <div class="bulkbar hide" id="bulk"><b id="bulkN">0</b> selected<span class="small" style="opacity:.8">Bulk actions create review batches only — never bulk abandonment.</span><span style="flex:1"></span>
    <button class="btn btn-ghost btn-sm" id="mkBatch" ${can("batch") ? "" : "disabled title='Only IP managers create review batches'"}>Create review batch</button><button class="btn btn-quiet btn-sm" style="color:#fff" id="clrSel">Clear</button></div>`;
  const load = async () => {
    const params = {}; for (const k of ["q", "recommendation", "gate", "jurisdiction", "status", "deadline_days", "min_confidence", "decided"]) if (f[k]) params[k] = f[k];
    const res = await api(`/v1/score-runs/${runId}/results?${new URLSearchParams({ ...params, sort: f.sort, order: f.order, page: f.page, page_size: 50 })}`);
    const th = (k, l, cls = "") => `<th class="${cls}"><button data-sort="${k}">${l} ${f.sort === k ? `<span class="arr">${f.order === "desc" ? "▼" : "▲"}</span>` : ""}</button></th>`;
    $("#tbl").innerHTML = res.items.length ? `<div class="table-wrap"><table class="t"><thead><tr><th><input type="checkbox" id="all" aria-label="Select all on page"></th>
      ${th("publication_number", "Asset")}${th("jurisdiction", "Jur.")}${th("status", "Status")}${th("strategic_score", "Score")}${th("data_coverage", "Coverage", "num")}${th("evidence_confidence", "Confidence", "num")}${th("recommendation", "Recommendation")}<th>Gate</th>${th("cost_5y", "5-yr cost", "num")}${th("next_deadline", "Next deadline")}<th>Review</th></tr></thead>
      <tbody>${res.items.map((r) => `<tr data-id="${esc(r.patent_asset_id)}" class="${sel.has(r.patent_asset_id) ? "sel" : ""}"><td><input type="checkbox" class="rowsel" value="${esc(r.patent_asset_id)}" ${sel.has(r.patent_asset_id) ? "checked" : ""} aria-label="Select ${esc(r.publication_number)}"></td>
        <td class="ttl"><a href="#/a/${esc(r.patent_asset_id)}${runId !== p.latest_score_run_id ? "?run=" + esc(runId) : ""}">${esc(r.title)}</a><div class="pub">${esc(r.publication_number)} <span class="muted xsmall">· ${esc(r.relationship_type)}</span></div></td>
        <td>${esc(r.jurisdiction)}</td><td>${statusTxt(r.status)}</td>
        <td>${r.strategic_score === null ? '<span class="unknown">n/a</span>' : `<div class="scorecell"><b>${r.strategic_score.toFixed(0)}</b><div class="bar" style="width:60px"><i style="width:${r.strategic_score}%"></i></div></div>`}${r.sensitive ? '<div class="xsmall muted" title="Category changes with ±5 weight points">weight-sensitive</div>' : ""}</td>
        <td class="num">${r.data_coverage.toFixed(0)}%</td><td class="num">${r.evidence_confidence.toFixed(0)}%</td>
        <td>${recPill(r.recommendation, r.recommendation_label)}</td><td>${gatePill(r.gate_status)}</td>
        <td class="num">${fmtMoney(r.cost_5y, r.cost_unknown)}</td>
        <td class="nowrap small">${r.next_deadline ? `${fmtDate(r.next_deadline)}<div class="xsmall ${daysTo(r.next_deadline) <= 120 ? "rec-abandonment_review_candidate" : "muted"}">${daysTo(r.next_deadline)} days</div>` : "—"}</td>
        <td class="small">${r.decision ? `<span class="badge b-ocean">${esc(r.decision)}</span>` : '<span class="muted">—</span>'}</td></tr>`).join("")}</tbody></table></div>
      <div class="pager"><span class="muted">${res.total} assets · page ${res.page} of ${Math.max(1, Math.ceil(res.total / res.page_size))}</span><div class="btn-row"><button class="btn btn-ghost btn-xs" id="prev" ${res.page <= 1 ? "disabled" : ""}>← Prev</button><button class="btn btn-ghost btn-xs" id="next" ${res.page * res.page_size >= res.total ? "disabled" : ""}>Next →</button></div></div>`
      : `<div class="empty"><h3>No assets match</h3><p class="small">Adjust or clear the filters.</p></div>`;
    $$("[data-sort]").forEach((b) => b.addEventListener("click", () => { const k = b.dataset.sort; f.order = f.sort === k && f.order === "desc" ? "asc" : "desc"; f.sort = k; load(); }));
    $("#prev")?.addEventListener("click", () => { f.page--; load(); });
    $("#next")?.addEventListener("click", () => { f.page++; load(); });
    $("#all")?.addEventListener("change", (e) => { $$(".rowsel").forEach((c) => { c.checked = e.target.checked; c.dispatchEvent(new Event("change")); }); });
    $$(".rowsel").forEach((c) => c.addEventListener("change", () => { c.checked ? sel.add(c.value) : sel.delete(c.value); c.closest("tr").classList.toggle("sel", c.checked); upd(); }));
  };
  const upd = () => { $("#bulk").classList.toggle("hide", !sel.size); $("#bulkN").textContent = sel.size; };
  let tmr;
  $("#flt").addEventListener("input", (e) => { if (!e.target.name) return; f[e.target.name] = e.target.value; f.page = 1; clearTimeout(tmr); tmr = setTimeout(load, e.target.name === "q" ? 300 : 0); });
  $("#clr").addEventListener("click", () => { S.filters[p.portfolio_id] = {}; tabAssets(p, runId); });
  $$("[data-exp]", tb).forEach((b) => b.addEventListener("click", () => download(`/v1/score-runs/${runId}/export.${b.dataset.exp}${f.recommendation ? "?recommendation=" + f.recommendation : ""}`, "export")));
  $("#clrSel").addEventListener("click", () => { sel.clear(); $$(".rowsel").forEach((c) => { c.checked = false; c.closest("tr").classList.remove("sel"); }); upd(); });
  $("#mkBatch").addEventListener("click", async () => {
    const users = await api("/v1/users");
    modal(`<h3>Create review batch</h3><p class="small muted">${sel.size} asset(s) will be assigned for human review. Reviewers record accept / reject / override / defer with reason codes.</p>
      <form id="bf"><label class="f"><span>Batch name</span><input class="input" name="name" required value="Review — ${new Date().toLocaleDateString("en-GB", { month: "short", year: "numeric" })}"></label>
      <div class="row2"><label class="f"><span>Assign to</span><select class="input" name="assignee_id">${users.filter((u) => ["counsel", "ip_manager"].includes(u.role)).map((u) => `<option value="${esc(u.id)}">${esc(u.name)} — ${esc(u.role_label)}</option>`).join("")}</select></label>
      <label class="f"><span>Due date</span><input class="input" type="date" name="due_date"></label></div>
      <div class="btn-row" style="justify-content:flex-end"><button type="button" class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-teal">Create batch</button></div></form>`);
    $("#bf").addEventListener("submit", async (e) => {
      e.preventDefault(); const fd = new FormData(e.target);
      try { const r = await api("/v1/review-batches", { method: "POST", body: { portfolio_id: p.portfolio_id, name: fd.get("name"), asset_ids: [...sel], assignee_id: fd.get("assignee_id") || null, due_date: fd.get("due_date") || null } });
        closeModal(); toast(`Review batch created with ${r.assets} assets`); location.hash = `#/batch/${r.batch_id}`; } catch (ex) { toast(ex.message, true); }
    });
  });
  await load();
}

/* ---------------- families */
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
  <div class="grid g2"><div><table class="t"><thead><tr><th>Category</th><th class="num">Baseline</th><th class="num">Scenario</th><th class="num">Δ</th></tr></thead><tbody>${keys.map((k) => { const d = (c.scenario_counts[k] || 0) - (c.baseline_counts[k] || 0); return `<tr><td>${recPill(k)}</td><td class="num">${c.baseline_counts[k] || 0}</td><td class="num">${c.scenario_counts[k] || 0}</td><td class="num ${d > 0 ? "delta-up" : d < 0 ? "delta-down" : ""}">${d > 0 ? "+" : ""}${d}</td></tr>`; }).join("")}</tbody></table></div>
  <div class="stack"><div class="metric"><div class="lbl">Assets changing category</div><div class="val">${c.changed.length} <span class="small muted">in ${c.changed_families} families</span></div></div>
  <div class="metric"><div class="lbl">5-yr cost in abandonment-review</div><div class="val">${fmtMoney(c.abandon_review_cost_5y.baseline)} → ${fmtMoney(c.abandon_review_cost_5y.scenario)}</div></div>
  <div class="metric"><div class="lbl">Average coverage</div><div class="val">${c.avg_coverage.baseline}% → ${c.avg_coverage.scenario}%</div></div></div></div>
  ${c.changed.length ? `<h4 style="margin-top:16px">Sensitive assets (category changed)</h4><div class="table-wrap"><table class="t"><thead><tr><th>Asset</th><th>From</th><th>To</th><th class="num">Score</th></tr></thead><tbody>${c.changed.slice(0, 15).map((x) => `<tr><td class="ttl"><a href="#/a/${esc(x.patent_asset_id)}">${esc(x.title)}</a><div class="pub">${esc(x.publication_number)}</div></td><td>${recPill(x.from)}</td><td>${recPill(x.to)}</td><td class="num">${x.score_from ?? "—"} → ${x.score_to ?? "—"}</td></tr>`).join("")}</tbody></table></div>` : ""}
  ${r.budget ? `<div class="divider"></div><div class="card-head"><h4 style="margin:0">Budget shortlist — ${fmtMoney(r.budget.target)} over ${r.budget.horizon_years} years</h4><span class="badge ${r.budget.met ? "b-ok" : "b-warn"}">${r.budget.met ? "Target met" : "Target not met"}: ${fmtMoney(r.budget.identified_savings)}</span></div>
    <p class="xsmall muted">${esc(r.budget.note)}</p>
    ${r.budget.candidates.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Asset</th><th>Recommendation</th><th class="num">Score</th><th class="num">Avoidable cost</th><th>Dependencies</th></tr></thead><tbody>${r.budget.candidates.map((x) => `<tr><td class="ttl"><a href="#/a/${esc(x.patent_asset_id)}">${esc(x.title)}</a><div class="pub">${esc(x.publication_number)}</div></td><td>${recPill(x.recommendation)}</td><td class="num">${x.strategic_score ?? "—"}</td><td class="num">${fmtMoney(r.budget.horizon_years === 3 ? x.cost_3y : x.cost_5y)}</td><td>${x.dependency_warning ? '<span class="badge b-warn">family impact</span>' : '<span class="muted small">none flagged</span>'}</td></tr>`).join("")}</tbody></table></div>` : '<p class="small muted">No eligible candidates (only abandonment-review and strategic-review assets without blocking gates are considered).</p>'}` : ""}`;
}

/* ---------------- reviews tab */
async function tabReviews(p) {
  const [batches, decs] = await Promise.all([api(`/v1/review-batches?portfolio_id=${p.portfolio_id}`), api(`/v1/review-decisions?portfolio_id=${p.portfolio_id}`)]);
  $("#tb").innerHTML = `<div class="grid g2"><div class="card"><h3>Review batches</h3>${batchTable(batches)}</div>
  <div class="card"><h3>Decisions</h3>${decTable(decs)}</div></div>`;
}
function batchTable(b) {
  return b.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Batch</th><th>Progress</th><th>Assignee</th><th>Due</th></tr></thead><tbody>${b.map((x) => `<tr><td><a href="#/batch/${esc(x.batch_id)}"><b>${esc(x.name)}</b></a><div class="xsmall muted">by ${esc(x.created_by)} · ${fmtDT(x.created_at)}</div></td><td style="min-width:120px"><div class="small">${x.decided} / ${x.assets}</div><div class="bar"><i style="width:${(x.decided / x.assets) * 100}%"></i></div></td><td class="small">${esc(x.assignee || "—")}</td><td class="small">${fmtDate(x.due_date)}</td></tr>`).join("")}</tbody></table></div>`
    : `<div class="empty small">No batches. Select assets in the Assets tab to create one.</div>`;
}
function decTable(d) {
  return d.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Asset</th><th>Decision</th><th>Reason</th><th>Reviewer</th></tr></thead><tbody>${d.map((x) => `<tr><td><a class="pub" href="#/a/${esc(x.patent_asset_id)}">${esc(x.publication_number)}</a><div class="xsmall muted">${esc((x.title || "").slice(0, 48))}</div></td><td><span class="badge b-ocean">${esc(x.decision)}</span>${x.override_recommendation ? `<div class="xsmall">→ ${esc(recLabel(x.override_recommendation))}</div>` : ""}<div class="xsmall muted">was: ${esc(recLabel(x.original_recommendation))}</div></td><td class="small">${esc(x.reason_label)}${x.notes ? `<div class="xsmall muted">${esc(x.notes)}</div>` : ""}</td><td class="small">${esc(x.reviewer)}<div class="xsmall muted">${fmtDT(x.created_at)}</div></td></tr>`).join("")}</tbody></table></div>`
    : `<div class="empty small">No decisions recorded yet.</div>`;
}

/* ---------------- runs tab */
async function tabRuns(p) {
  const runs = await api(`/v1/portfolios/${p.portfolio_id}/score-runs`);
  $("#tb").innerHTML = `<div class="card"><div class="card-head"><h3>Score run history</h3>${can("score") ? '<button class="btn btn-teal btn-sm" id="rr">Run scoring now</button>' : ""}</div>
  <p class="small muted">Every run stores the scoring version, a snapshot of weights/thresholds/assumptions and a hash of the input data, so identical inputs reproduce identical scores.</p>
  <div class="table-wrap"><table class="t"><thead><tr><th>Run</th><th>Config</th><th>Data hash</th><th>Recommendations</th><th>5-yr cost</th><th></th></tr></thead><tbody>${runs.map((r) => `<tr><td class="small"><span class="mono">${esc(r.score_run_id)}</span><div class="xsmall muted">${fmtDT(r.run_at)} · ${esc(r.created_by)}</div></td><td class="small">${esc(r.config)} ${r.kind === "scenario" ? '<span class="badge b-warn">scenario</span>' : ""}<div class="xsmall muted">${esc(r.scoring_version)}</div></td><td class="mono xsmall">${esc(r.data_snapshot_hash.slice(0, 16))}</td><td class="xsmall">${Object.entries(r.summary.by_recommendation || {}).map(([k, v]) => `${esc(recLabel(k))}: ${v}`).join("<br>")}</td><td class="num">${fmtMoney(r.summary.forward_cost?.["5"])}</td><td><a class="btn btn-ghost btn-xs" href="#/p/${esc(p.portfolio_id)}/assets?run=${esc(r.score_run_id)}">Open</a></td></tr>`).join("")}</tbody></table></div></div>`;
  $("#rr")?.addEventListener("click", async () => { await api(`/v1/portfolios/${p.portfolio_id}/score-runs`, { method: "POST", body: {}, headers: { "Idempotency-Key": idem() } }); toast("Score run created"); tabRuns(p); });
}

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
      ${gates.length ? `<div class="card"><div class="card-head"><h3>Gates & warnings</h3>${gatePill(sc.gate_status)}</div><ul class="gates">${gates.map((g) => `<li><span class="sev sev-${esc(g.severity)}">${esc(g.severity)}</span><div><b class="small">${esc(g.code.replace(/_/g, " "))}</b><div>${esc(g.message)}</div></div></li>`).join("")}</ul></div>` : ""}
      ${sc ? explainCard(sc) : ""}
      ${sc ? dimsCard(sc, run) : ""}
      ${evidenceCard(d.evidence)}
      ${sc ? costCard(sc.cost, d.cost_actuals, a) : ""}
    </div>
    <div class="stack">
      ${decisionCard(d, sc, run)}
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
      <div class="card"><h3>Audit trail</h3>${d.audit.length ? `<ul class="why-list small">${d.audit.map((e) => `<li><b>${esc(e.action.replace(/_/g, " "))}</b> by ${esc(e.actor)} <span class="muted xsmall">· ${fmtDT(e.timestamp)}${e.before_hash ? ` · ${esc(e.before_hash.slice(0, 8))}→${esc((e.after_hash || "").slice(0, 8))}` : ""}</span></li>`).join("")}</ul>` : '<p class="small muted">No actions on this asset yet.</p>'}</div>
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
  const band = ex.score_band && ex.score_band !== sc.recommendation && sc.strategic_score !== null ? `<div class="xsmall muted">Score band alone would be: ${esc(recLabel(ex.score_band))}</div>` : "";
  return `<div class="card"><div class="score-hero">${ring(sc.strategic_score)}
    <div><div class="small muted">Recommendation</div><div class="rec-big"><i style="background:${REC_COLORS[sc.recommendation]}"></i>${esc(sc.recommendation_label)}</div>${band}
      <p class="small" style="margin:6px 0 0">${esc(ex.required_handling)}</p>
      <div class="metric-row">
        <div class="metric"><div class="lbl">Data coverage</div><div class="val">${sc.data_coverage.toFixed(0)}%</div><div class="bar ${barCls(sc.data_coverage)}"><i style="width:${sc.data_coverage}%"></i></div></div>
        <div class="metric"><div class="lbl">Evidence confidence</div><div class="val">${sc.evidence_confidence.toFixed(0)}%</div><div class="bar ${barCls(sc.evidence_confidence)}"><i style="width:${sc.evidence_confidence}%"></i></div></div>
        <div class="metric"><div class="lbl">Legal / operational gate</div><div class="val">${gatePill(sc.gate_status)}</div></div>
      </div></div></div>
    ${sc.data_coverage < 70 ? `<div class="callout callout-cream" style="margin-top:14px">${ICON.info}<div>A score of ${sc.strategic_score ?? "—"} with ${sc.data_coverage.toFixed(0)}% coverage is <b>not</b> equivalent to the same score with high coverage. Missing dimensions are excluded, not counted as zero.</div></div>` : ""}
    ${(ex.confidence_notes || []).length ? `<p class="xsmall muted" style="margin-top:10px">Confidence adjustments: ${ex.confidence_notes.map(esc).join("; ")}</p>` : ""}
    <p class="xsmall muted" style="margin:10px 0 0">${esc(run.config.name)} · ${esc(run.scoring_version)} · run <span class="mono">${esc(run.id)}</span> · data hash <span class="mono">${esc(run.data_snapshot_hash.slice(0, 12))}</span> · as of ${fmtDate(run.as_of_date)}</p></div>`;
}

function explainCard(sc) {
  const ex = sc.explanation;
  return `<div class="card"><h3>Why this recommendation</h3><div class="grid g2">
    <div><h4>Top positive factors</h4>${ex.positives.length ? `<ul class="why-list plus">${ex.positives.map((x) => `<li>${esc(x.text)}</li>`).join("")}</ul>` : '<p class="small muted">No dimension rated 3 or above.</p>'}</div>
    <div><h4>Top risk / negative factors</h4>${ex.negatives.length ? `<ul class="why-list minus">${ex.negatives.map((x) => `<li>${esc(x.text)}</li>`).join("")}</ul>` : '<p class="small muted">No dimension rated 2 or below.</p>'}</div></div>
    ${ex.missing.length ? `<div class="divider"></div><h4>Missing inputs</h4><ul class="why-list">${ex.missing.map((m) => `<li><b>${esc(m.label)}</b> <span class="muted small">(weight ${m.weight})</span> — ${esc(m.hint)}</li>`).join("")}</ul>` : ""}
    <div class="divider"></div><h4>What could change the result</h4><ul class="why-list">${ex.what_could_change.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>
    ${ex.sensitivity?.length ? `<p class="xsmall muted">Sensitivity: ${ex.sensitivity.map((s) => `${esc(dimLabel(s.dimension))} ${s.delta > 0 ? "+" : ""}${s.delta} → ${esc(recLabel(s.recommendation))}`).join("; ")}</p>` : ""}</div>`;
}

function dimsCard(sc, run) {
  const w = run.config.weights;
  return `<div class="card"><div class="card-head"><h3>Score breakdown</h3><span class="small muted">Rating 0–5 per dimension, or UNKNOWN</span></div>
  <div class="table-wrap"><table class="dims"><thead><tr><th>Dimension</th><th class="num">Weight</th><th>Rating</th><th>Rationale</th><th></th></tr></thead><tbody>
  ${S.meta.dimensions.map((dm) => { const v = sc.dimension_scores[dm.key]; const r = v.rating; return `<tr><td><b>${esc(dm.label)}</b><div class="basis">${esc(v.basis || "no evidence")}${v.basis === "analyst" && v.derived_rating !== null && v.derived_rating !== undefined ? ` · derived was ${v.derived_rating}` : ""}</div></td><td class="num">${Number(w[dm.key]).toFixed(0)}</td>
    <td class="nowrap">${r === null ? '<span class="unknown">UNKNOWN</span>' : `<span class="dots" aria-label="${r} of 5">${[1, 2, 3, 4, 5].map((i) => `<i class="${i <= r ? "on" : ""}"></i>`).join("")}</span> <b>${r}</b>`}</td>
    <td class="small">${esc(v.rationale)}</td><td>${can("inputs") ? `<button class="btn btn-quiet btn-xs" data-dim="${dm.key}">Add input</button>` : ""}</td></tr>`; }).join("")}
  </tbody></table></div><p class="xsmall muted" style="margin-top:8px">Score = 100 × Σ(Wᵢ × Rᵢ/5) ÷ Σ(Wᵢ) over known dimensions. Analyst inputs override derived ratings and are audited.</p></div>`;
}

function evidenceCard(evs) {
  const groups = {};
  evs.forEach((e) => (groups[e.dimension] = groups[e.dimension] || []).push(e));
  return `<div class="card"><div class="card-head"><h3>Evidence</h3><span class="small muted">${evs.length} items · retrieved text is treated as untrusted data</span></div>
  ${Object.keys(groups).length ? S.meta.dimensions.filter((d) => groups[d.key]).map((d) => `<h4 style="margin-top:10px">${esc(d.label)}</h4>${groups[d.key].map((e) => `<div class="ev"><div class="src">${esc(e.source_name)}</div><div class="small">${esc(e.excerpt)}</div><div class="meta">Source date ${fmtDate(e.source_date)} · retrieved ${fmtDT(e.retrieved_at)} · reliability ${Math.round(e.reliability * 100)}% · directness ${Math.round(e.directness * 100)}%${e.polarity ? (e.polarity > 0 ? " · supports value" : " · weighs against") : ""}</div></div>`).join("")}`).join("") : '<p class="small muted">No evidence attached.</p>'}</div>`;
}

function costCard(c, actuals, a) {
  const t3 = c.totals["3"] || {}, t5 = c.totals["5"] || {};
  return `<div class="card"><div class="card-head"><h3>Forward cost</h3><span class="small muted">${esc(c.currency)} · ${esc(c.assumption_version)}</span></div>
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
    <p class="xsmall muted">Solid line: continuation · dashed: foreign counterpart. Each member has its own status, cost and value.</p>
    <table class="t"><tbody>${fam.map((m) => `<tr><td class="pub">${m.id === a.id ? `<b>${esc(m.publication_number)}</b>` : `<a href="#/a/${esc(m.id)}">${esc(m.publication_number)}</a>`}</td><td class="small">${esc(m.relationship_type)}</td><td>${statusTxt(m.status)}</td><td class="num small">${fmtMoney(m.cost_5y)}</td></tr>`).join("")}</tbody></table></div>`;
}

function decisionCard(d, sc, run) {
  const decs = d.decisions;
  const can_ = can("decide");
  return `<div class="card"><h3>Review decision</h3>
  ${sc ? `<p class="small muted">Recording a decision does <b>not</b> abandon, pay or file anything. Final decisions trigger a mandatory status recheck.</p>
  ${can_ ? `<form id="df"><label class="f"><span>Decision</span><select class="input" name="decision">${S.meta.decisions.map((x) => `<option value="${x.key}">${esc(x.label)}</option>`).join("")}</select></label>
    <label class="f ovr hide"><span>Override to</span><select class="input" name="override_recommendation">${REC_ORDER.filter((k) => !["blocked", "insufficient_evidence"].includes(k)).map((k) => `<option value="${k}">${esc(recLabel(k))}</option>`).join("")}</select></label>
    <label class="f"><span>Reason code</span><select class="input" name="reason_code">${S.meta.reason_codes.map((x) => `<option value="${x.key}">${esc(x.label)}</option>`).join("")}</select></label>
    <label class="f"><span>Notes <span class="muted">(required for overrides)</span></span><textarea class="input" name="notes" placeholder="e.g. Confirmed product dependency by portfolio counsel."></textarea></label>
    <button class="btn btn-teal" style="width:100%">Record decision</button></form>`
    : `<div class="callout callout-cream">${ICON.info}<div>Your role (${esc(S.me.role_label)}) can view but not record decisions. Switch identity to Patent counsel or IP manager.</div></div>`}` : ""}
  ${decs.length ? `<div class="divider"></div><h4>History</h4>${decs.map((x) => `<div class="ev"><div class="src">${esc(x.decision)}${x.override_recommendation ? " → " + esc(recLabel(x.override_recommendation)) : ""} · ${esc(x.reason_label)}</div><div class="small">${esc(x.notes)}</div><div class="meta">${esc(x.reviewer)} · ${fmtDT(x.created_at)} · original: ${esc(recLabel(x.original_recommendation))} (${x.original_score ?? "—"}) · status rechecked ${fmtDT(x.freshness_check?.rechecked_at)}</div></div>`).join("")}` : ""}</div>`;
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
async function viewReviews() {
  main().innerHTML = loading();
  const [b, d] = await Promise.all([api("/v1/review-batches"), api("/v1/review-decisions")]);
  main().innerHTML = `<div class="wrap page"><div class="eyebrow">Human-in-the-loop</div><h2>Review queue</h2>
  <p class="muted" style="max-width:760px">Recommendations become decisions only here, with a reason code, notes and an automatic status recheck. Overrides preserve the original score and recommendation.</p>
  <div class="grid g2"><div class="card"><h3>Batches</h3>${batchTable(b)}</div><div class="card"><h3>Recent decisions</h3>${decTable(d.slice(0, 40))}</div></div></div>`;
}

async function viewBatch(bid) {
  main().innerHTML = loading();
  const b = await api(`/v1/review-batches/${bid}`);
  const done = b.items.filter((r) => r.decision).length;
  main().innerHTML = `<div class="wrap page"><div class="crumbs" style="color:var(--ink-2)"><a href="#/reviews">Review queue</a> › batch</div>
  <div class="card-head"><div><h2>${esc(b.name)}</h2><div class="muted small">${done} of ${b.items.length} decided · due ${fmtDate(b.due_date)}</div></div><a class="btn btn-ghost btn-sm" href="#/p/${esc(b.portfolio_id)}">Open portfolio</a></div>
  <div class="progress" style="margin-bottom:16px"><i style="width:${(done / Math.max(1, b.items.length)) * 100}%"></i></div>
  <div class="card"><div class="table-wrap"><table class="t"><thead><tr><th>Asset</th><th>Score</th><th>Coverage</th><th>Recommendation</th><th>Gate</th><th class="num">5-yr cost</th><th>Decision</th><th></th></tr></thead><tbody>
  ${b.items.map((r) => `<tr><td class="ttl"><a href="#/a/${esc(r.patent_asset_id)}">${esc(r.title)}</a><div class="pub">${esc(r.publication_number)}</div></td><td>${r.strategic_score ?? "—"}</td><td>${r.data_coverage.toFixed(0)}%</td><td>${recPill(r.recommendation)}</td><td>${gatePill(r.gate_status)}</td><td class="num">${fmtMoney(r.cost_5y, r.cost_unknown)}</td><td>${r.decision ? `<span class="badge b-ocean">${esc(r.decision)}</span>` : '<span class="badge b-warn">pending</span>'}</td><td><a class="btn btn-ghost btn-xs" href="#/a/${esc(r.patent_asset_id)}">Review →</a></td></tr>`).join("")}</tbody></table></div></div></div>`;
}

/* ================================================================ AUDIT */
async function viewAudit() {
  main().innerHTML = loading();
  const ev = await api("/v1/audit?limit=300");
  const actions = [...new Set(ev.map((e) => e.action))].sort();
  main().innerHTML = `<div class="wrap page"><div class="eyebrow">Governance</div><h2>Audit trail</h2>
  <p class="muted">Searches, entity confirmations, score runs, inputs, overrides, exports and configuration changes — with actor, timestamp and before/after hashes.</p>
  <div class="card"><div class="filters"><label>Action<select class="input" id="af"><option value="">All</option>${actions.map((a) => `<option>${esc(a)}</option>`).join("")}</select></label></div>
  <div class="table-wrap"><table class="t"><thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Object</th><th>Hashes</th><th>Detail</th></tr></thead><tbody id="ab"></tbody></table></div></div></div>`;
  const draw = (f) => { $("#ab").innerHTML = ev.filter((e) => !f || e.action === f).map((e) => `<tr><td class="small nowrap">${fmtDT(e.timestamp)}</td><td class="small">${esc(e.actor)}</td><td><span class="badge b-ocean">${esc(e.action.replace(/_/g, " "))}</span></td><td class="xsmall"><span class="muted">${esc(e.object_type)}</span><br>${e.object_type === "patent_asset" ? `<a class="mono" href="#/a/${esc(e.object_id)}">${esc(e.object_id)}</a>` : e.object_type === "portfolio" ? `<a class="mono" href="#/p/${esc(e.object_id)}">${esc(e.object_id)}</a>` : `<span class="mono">${esc(e.object_id)}</span>`}</td><td class="mono xsmall">${e.before_hash ? esc(e.before_hash.slice(0, 8)) + "→" + esc((e.after_hash || "").slice(0, 8)) : "—"}</td><td class="xsmall" style="max-width:360px;word-break:break-word">${esc(JSON.stringify(e.detail).slice(0, 220))}</td></tr>`).join(""); };
  draw("");
  $("#af").addEventListener("change", (e) => draw(e.target.value));
}

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
      <form id="wf">${m.dimensions.map((d) => `<div class="slider-row"><span>${esc(d.label)}</span><span class="help">${esc(d.missing_hint.slice(0, 40))}…</span><input class="input" style="padding:4px 6px" type="number" min="0" max="100" name="${d.key}" value="${def.weights[d.key]}" ${canW ? "" : "disabled"}></div>`).join("")}
      <div class="row3" style="margin-top:14px">${[["strong_retain", "Strong retain ≥"], ["retain_monitor", "Retain/monitor ≥"], ["strategic_review", "Strategic review ≥"], ["coverage_min", "Min coverage %"], ["confidence_min", "Min confidence %"]].map(([k, l]) => `<label class="f"><span>${l}</span><input class="input" type="number" name="t_${k}" value="${def.thresholds[k]}" ${canW ? "" : "disabled"}></label>`).join("")}
      <label class="f"><span>Deadline warning (days)</span><input class="input" type="number" name="g_deadline_warning_days" value="${def.gates.deadline_warning_days}" ${canW ? "" : "disabled"}></label></div>
      ${canW ? '<button class="btn btn-ocean btn-sm">Save new model version</button>' : '<p class="xsmall muted">Only the tenant administrator can change default weights, thresholds and gates. Use Scenarios to explore alternatives.</p>'}</form></div>
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
    <div class="card"><h3>Roles & permissions</h3><div class="table-wrap"><table class="t"><thead><tr><th>Role</th><th>Permissions</th></tr></thead><tbody>${Object.entries(m.roles).map(([k, r]) => `<tr><td><b>${esc(r.label)}</b>${S.me.role === k ? ' <span class="badge b-teal">you</span>' : ""}</td><td class="xsmall">${r.perms.map(esc).join(", ")}</td></tr>`).join("")}</tbody></table></div></div>
  </div></div>`;
  $("#wf").addEventListener("submit", async (e) => {
    e.preventDefault(); const fd = new FormData(e.target);
    const weights = Object.fromEntries(m.dimensions.map((d) => [d.key, Number(fd.get(d.key))]));
    const thresholds = Object.fromEntries(["strong_retain", "retain_monitor", "strategic_review", "coverage_min", "confidence_min"].map((k) => [k, Number(fd.get("t_" + k))]));
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
