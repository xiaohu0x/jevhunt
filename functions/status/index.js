import { onRequestGet as statusData } from "../api/catalog/status.js";
import { htmlResponse } from "../../shared/catalog-view.js";
import { page, esc } from "../../shared/render.js";
export async function onRequestGet(context) {
  const data = await (await statusData(context)).json();
  const meta = data.meta;
  if (!meta) return context.next();
  const age = meta.lastScheduledAt ? Date.now() - Date.parse(meta.lastScheduledAt) : Infinity;
  const body = `<header class="legal__header"><h1>Live catalog status</h1><p>${age < 600000 ? "The scheduled worker is running." : "The scheduled worker has not reported recently."}</p></header>
<dl class="facts"><div><dt>Published repositories</dt><dd>${meta.projectCount}</dd></div><div><dt>Last data update</dt><dd>${esc(meta.publishedAt)}</dd></div><div><dt>Scheduler heartbeat</dt><dd>${esc(meta.lastScheduledAt || "Waiting for the first scheduled run")}</dd></div><div><dt>Ready candidates</dt><dd>${data.candidates?.ready || 0}</dd></div><div><dt>Catalog version</dt><dd><code>${esc(meta.catalogHash)}</code></dd></div></dl>
<p>The Cloudflare worker advances a small batch every minute. Community feeds refresh every six hours; paginated discovery and evidence checks continue between feed updates. Each project records its own check date.</p><h2>Discovery sources</h2><ul>${meta.sources.map(source => `<li>${esc(source.id)}: ${esc(source.status)} · ${esc(source.lastSuccessAt || "pending")}${source.error ? ` · ${esc(source.error)}` : ''}${source.partial ? ' · search results are partial' : ''}</li>`).join("")}</ul>
<h2>Recent worker runs</h2><div class="run-list">${data.runs.map(run => `<p><time>${new Date(run.started_at * 1000).toISOString()}</time> · ${esc(run.status)} · ${esc(run.message || "")}</p>`).join("")}</div><p><a href="/api/catalog/status">Status JSON</a> · <a href="/api/health">Health endpoint</a> · <a href="/build-info.json">Code build</a></p>`;
  return htmlResponse(page({ title: "Live catalog status", description: "Live Cloudflare scheduler health, source checks, update progress and catalog version.", path: "/status/", body }));
}
