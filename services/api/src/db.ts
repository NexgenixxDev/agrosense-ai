import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
export const now = () => new Date().toISOString();
export const id = () => randomUUID();
export class Store {
  db: DatabaseSync;
  constructor(
    path = process.env.DATABASE_PATH || "../../data/agrosense.sqlite",
  ) {
    if (path !== ":memory:")
      mkdirSync(dirname(resolve(path)), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(
      "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;",
    );
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS migrations(name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)",
    );
    const directory = resolve(__dirname, "../migrations");
    for (const file of readdirSync(directory)
      .filter((f) => f.endsWith(".sql"))
      .sort()) {
      if (!this.one("SELECT name FROM migrations WHERE name=?", file))
        this.tx(() => {
          if (this.one("SELECT name FROM migrations WHERE name=?", file))
            return;
          this.db.exec(readFileSync(resolve(directory, file), "utf8"));
          this.run("INSERT INTO migrations VALUES (?,?)", file, now());
        });
    }
  }
  one(sql: string, ...params: any[]): any {
    return this.db.prepare(sql).get(...params);
  }
  all(sql: string, ...params: any[]): any[] {
    return this.db.prepare(sql).all(...params);
  }
  run(sql: string, ...params: any[]) {
    return this.db.prepare(sql).run(...params);
  }
  tx<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  audit(
    actor: string | null,
    action: string,
    resource: string,
    details: unknown = {},
  ) {
    this.run(
      "INSERT INTO audit VALUES (?,?,?,?,?,?)",
      id(),
      actor,
      action,
      resource,
      JSON.stringify(details),
      now(),
    );
  }
}
