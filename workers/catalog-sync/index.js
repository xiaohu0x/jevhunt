import { DurableObject } from 'cloudflare:workers';
import { tick } from './engine.js';

const json = (data, status = 200) => Response.json(data, { status, headers: { 'cache-control': 'no-store' } });
const clock = env => env.CLOCK.get(env.CLOCK.idFromName('catalog-clock'));

export class CatalogClock extends DurableObject {
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
    if (path === '/start') {
      let next = await this.ctx.storage.getAlarm();
      if (next === null || next < Date.now() - 180000) {
        next = Date.now() + 2000;
        await this.ctx.storage.setAlarm(next);
      }
      return json({ scheduled: true, nextAlarm: new Date(next).toISOString() });
    }
    if (path === '/tick') return json(await tick(this.env, 'manual'));
    return json({ error: 'not_found' }, 404);
  }
  async alarm() {
    // Re-arm before external I/O so a transient source failure cannot stop the
    // clock. D1 keeps the retry queue and guards against overlapping work.
    await this.ctx.storage.setAlarm(Date.now() + 60000);
    const result = await tick(this.env, 'alarm');
    console.log(JSON.stringify({ trigger: 'durable-alarm', ...result }));
  }
}

export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(clock(env).fetch('https://clock.internal/start', { method: 'POST' }).then(async response => {
      if (!response.ok) throw new Error('Scheduled wake-up failed');
      await env.DB.prepare("UPDATE catalog_control SET meta=json_set(meta,'$.lastCronWakeAt',?) WHERE id=1")
        .bind(new Date().toISOString()).run();
    }));
  },
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (request.method === 'POST' && path === '/discover') {
      await env.DB.prepare('UPDATE catalog_sources SET next_due_at=0').run();
      await clock(env).fetch('https://clock.internal/start', { method: 'POST' });
      return json({ queued: true, message: 'Discovery queued for the next scheduled tick.' }, 202);
    }
    if (request.method === 'POST' && ['/start', '/tick'].includes(path)) {
      return clock(env).fetch('https://clock.internal' + path, { method: 'POST' });
    }
    return json({ error: 'not_found' }, 404);
  },
};
