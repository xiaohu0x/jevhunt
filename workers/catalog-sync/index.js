import { DurableObject } from 'cloudflare:workers';

const stopped = () => Response.json({ status: 'disabled', message: 'Catalog updates run in the bounded daily GitHub workflow.' }, { status: 410 });

// Retain the class for the existing namespace, but cancel any old recurring alarm.
export class CatalogClock extends DurableObject {
  async fetch() { await this.ctx.storage.deleteAlarm(); return stopped(); }
  async alarm() { await this.ctx.storage.deleteAlarm(); }
}
export default {
  async scheduled() {},
  fetch() { return stopped(); },
};
