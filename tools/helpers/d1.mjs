import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
export function database() {
  const db = new DatabaseSync(":memory:");
  const migrations = new URL("../../migrations/", import.meta.url);
  for (const path of readdirSync(migrations).filter(p => p.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(path, migrations), "utf8"));
  return { db, prepare(sql) {
    let values = [];
    return { bind(...args) { values = args; return this; },
      async first() { return db.prepare(sql).get(...values) || null; },
      async all() { return { results: db.prepare(sql).all(...values) }; },
      async run() {
        const stmt = db.prepare(sql);
        if (stmt.columns().length) return { success: true, results: stmt.all(...values), meta: { changes: 0 } };
        return { success: true, results: [], meta: stmt.run(...values) };
      },
    };
  }, async batch(statements) {
    db.exec("BEGIN");
    try { const results = []; for (const statement of statements) results.push(await statement.run()); db.exec("COMMIT"); return results; }
    catch (error) { db.exec("ROLLBACK"); throw error; }
  } };
}
