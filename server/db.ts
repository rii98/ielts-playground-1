import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ROOT } from "./paths.ts";

// Work in progress and past runs, kept in data/playground.db so a refresh loses nothing.
// (Saved prompt/rubric versions live in tasks/ + git; this is everything around them.)
// Rows hold JSON, so new fields can be stored without changing the tables.
//
//   drafts  one row per task: unsaved prompt/rubric + the essay being worked on
//   runs    every Run: what was sent and what came back
//   state   small page settings, e.g. the open task
//   requests  what the teacher asked Claude from the page (see requests.ts)

const g = globalThis as { __playgroundDb?: DatabaseSync };

export function db(): DatabaseSync {
  // One connection for the whole dev server, even when this file is reloaded.
  if (!g.__playgroundDb) {
    mkdirSync(join(ROOT, "data"), { recursive: true });
    const d = new DatabaseSync(join(ROOT, "data", "playground.db"));
    d.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS drafts (task TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS runs (id INTEGER PRIMARY KEY AUTOINCREMENT, task TEXT NOT NULL, created_at TEXT NOT NULL, data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS runs_by_task ON runs (task, id);
      CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS requests (id INTEGER PRIMARY KEY AUTOINCREMENT, task TEXT NOT NULL, created_at TEXT NOT NULL, data TEXT NOT NULL);
    `);
    g.__playgroundDb = d;
  }
  return g.__playgroundDb;
}

const now = () => new Date().toISOString();

export function getDraft(task: string): unknown {
  const row = db().prepare("SELECT data FROM drafts WHERE task = ?").get(task) as { data: string } | undefined;
  return row ? JSON.parse(row.data) : null;
}

export function putDraft(task: string, draft: unknown): void {
  db()
    .prepare("INSERT INTO drafts (task, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(task) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at")
    .run(task, JSON.stringify(draft), now());
}

export function addRun(task: string, run: unknown): number {
  const r = db().prepare("INSERT INTO runs (task, created_at, data) VALUES (?, ?, ?)").run(task, now(), JSON.stringify(run));
  return Number(r.lastInsertRowid);
}

export function lastRun(task: string): unknown {
  const row = db().prepare("SELECT id, created_at, data FROM runs WHERE task = ? ORDER BY id DESC LIMIT 1").get(task) as
    | { id: number; created_at: string; data: string }
    | undefined;
  return row ? { id: row.id, createdAt: row.created_at, ...JSON.parse(row.data) } : null;
}

export function getState(key: string): string | null {
  const row = db().prepare("SELECT value FROM state WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function putState(key: string, value: string): void {
  db().prepare("INSERT INTO state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}
