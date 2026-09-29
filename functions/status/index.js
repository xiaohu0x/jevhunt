import { onRequestGet as statusData } from "../api/catalog/status.js";
import { htmlResponse } from "../../shared/catalog-view.js";
import { page, esc } from "../../shared/render.js";
export async function onRequestGet(context) {
  const data = await (await statusData(context)).json();
  const meta = data.meta;
  if (!meta) return context.next();
  const age = meta.lastScheduledAt ? Date.now() - Date.parse(meta.lastScheduledAt) : Infinity;
  const discovery = data.discovery;
  const communitySources = meta.sources.filter(source => !source.id.startsWith("github-search-"));
  const checked = data.evidence;
  const oldest = checked?.oldest_checked_at ? new Date(checked.oldest_checked_at * 1000).toISOString() : "Not yet checked";
  const body = `<header class="legal__header"><h1>Live catalog status</h1><p>${age < 600000 ? "The scheduled worker is running." : "The scheduled worker has not reported recently."}</p></header>
<dl class="facts"><div><dt>Published repositories</dt><dd>${meta.projectCount}</dd></div><div><dt>Last catalog publication</dt><dd>${esc(meta.publishedAt)}</dd></div><div><dt>Scheduler heartbeat</dt><dd>${esc(meta.lastScheduledAt || "Waiting for the first scheduled run")}</dd></div><div><dt>Ready candidates</dt><dd>${data.candidates?.ready || 0}</dd></div><div><dt>Catalog version</dt><dd><code>${esc(meta.catalogHash)}</code></dd></div></dl>
<p>The worker advances small batches. The last publication records a catalog change, not a completed scan of every repository. Scheduler health and discovery coverage are reported separately.</p>
<h2>GitHub search discovery: ${esc(discovery.discoveryStatus)}</h2><p>${esc(discovery.coverageNote)}</p>
<p>${discovery.configuredQueries} configured queries · ${discovery.completedQueries} have a recorded completed pass · ${discovery.failedQueries} degraded · ${discovery.partialQueries} reported partial results.</p>
<ul>${discovery.queries.map(source => `<li><strong>${esc(source.id)}: ${esc(source.status)}</strong><br/><code>${esc(source.query)}</code><br/>Last completed pass: ${esc(source.lastCompleteAt || "Not completed for this query")}; last successful page: ${esc(source.lastPageAt || "None")}; remaining windows: ${source.windowsRemaining ?? "Pending reset"}.${source.queryChanged ? " Query changed; previous progress does not apply." : ""}${source.partial ? " GitHub returned partial results." : ""}${source.error ? ` ${esc(source.error)}` : ""}</li>`).join("")}</ul>
<h2>Repository check coverage</h2><p>${checked?.checked24h || 0} of ${checked?.total || 0} active repositories checked in the last 24 hours; ${checked?.checked72h || 0} in the last 72 hours. Oldest check: ${esc(oldest)}.</p>
<h2>Supplementary community sources</h2><ul>${communitySources.map(source => `<li>${esc(source.id)}: ${esc(source.status)} · ${esc(source.lastSuccessAt || "pending")}${source.error ? ` · ${esc(source.error)}` : ""}</li>`).join("")}</ul>
<h2>Recent worker runs</h2><div class="run-list">${data.runs.map(run => `<p><time>${new Date(run.started_at * 1000).toISOString()}</time> · ${esc(run.status)} · ${esc(run.message || "")}</p>`).join("")}</div><p><a href="/api/catalog/status">Status JSON</a> · <a href="/api/health">Health endpoint</a> · <a href="/build-info.json">Code build</a></p>`;
  return htmlResponse(page({ title: "Live catalog status", description: "Live Cloudflare scheduler health, source checks, update progress and catalog version.", path: "/status/", body }));
}
