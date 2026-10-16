import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { db, getState } from "./db.ts";
import { ROOT } from "./paths.ts";

// The teacher's Claude Code session (in the terminal, after "start listening") looks after the
// feedback page. The page leaves requests here; `npm run listen` hands each new one to Claude,
// and Claude reports back with POST /api/request-update. See .claude/skills/listen/SKILL.md.
//
// tasks/<task>/structure.json is what Claude keeps up to date from the prompt:
//   builtFor  the prompt it was made for - a Run only uses the structure while that still matches
//   schema    the answer's shape, read from the prompt's intent. Sent to the AI with every Run, after the
//             teacher's prompt (never in it), as an added instruction plus Ollama's format setting.
//   page      how /feedback draws it (app/Feedback.tsx reads it; Claude may also change that code)

export interface Structure {
  builtFor: string;
  schema: object;
  page: unknown;
}

export function readStructure(dir: string): Structure | null {
  const file = join(dir, "structure.json");
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
}

/** The database, with the requests table (made here too, for a dev server opened before it existed). */
function rq() {
  const d = db();
  d.exec("CREATE TABLE IF NOT EXISTS requests (id INTEGER PRIMARY KEY AUTOINCREMENT, task TEXT NOT NULL, created_at TEXT NOT NULL, data TEXT NOT NULL)");
  return d;
}

export interface Request {
  id: number;
  task: string;
  createdAt: string;
  /**
   * "prompt": the teacher saved a new prompt. "change": they asked for something in the Ask Claude box.
   * "mismatch": a Run's answer didn't fit the structure (sent automatically by the playground).
   */
  kind: "prompt" | "change" | "mismatch";
  text: string;
  status: "saving" | "new" | "seen" | "working" | "done" | "failed";
  /** Images attached in Ask Claude (file names in data/attachments). */
  attachments?: string[];
  /** Claude's answer to the teacher, in plain English. */
  reply?: string;
  /** Spelling slips or big problems Claude noticed in the prompt (the prompt itself is left alone). */
  flags?: string[];
}

export function addRequest(task: string, kind: Request["kind"], text: string, images: { type: string; data: string }[] = []): number {
  const r = rq().prepare("INSERT INTO requests (task, created_at, data) VALUES (?, ?, ?)")
    .run(task, new Date().toISOString(), JSON.stringify({ kind, text, status: images.length ? "saving" : "new" }));
  const id = Number(r.lastInsertRowid);
  if (images.length) {
    // Saved next to the database (git-ignored); the request is only "new" once its images are on disk.
    mkdirSync(ATTACHMENTS, { recursive: true });
    const attachments = images.map((img, i) => {
      const file = `req-${id}-${i + 1}.${img.type.split("/")[1].replace("jpeg", "jpg")}`;
      writeFileSync(join(ATTACHMENTS, file), Buffer.from(img.data, "base64"));
      return file;
    });
    const row = rq().prepare("SELECT data FROM requests WHERE id = ?").get(id) as { data: string };
    rq().prepare("UPDATE requests SET data = ? WHERE id = ?").run(JSON.stringify({ ...JSON.parse(row.data), attachments, status: "new" }), id);
  }
  return id;
}

/** Images attached to Ask Claude messages: data/attachments/req-<id>-<n>.<ext>. */
export const ATTACHMENTS = join(ROOT, "data", "attachments");

export function recentRequests(task: string, limit = 6): Request[] {
  const rows = rq().prepare("SELECT id, task, created_at, data FROM requests WHERE task = ? ORDER BY id DESC LIMIT ?").all(task, limit) as {
    id: number;
    task: string;
    created_at: string;
    data: string;
  }[];
  return rows.map((r) => ({ id: r.id, task: r.task, createdAt: r.created_at, ...JSON.parse(r.data) }));
}

/** Requests nobody has picked up yet, oldest first. */
export function newRequests(): Request[] {
  const rows = rq().prepare("SELECT id, task, created_at, data FROM requests WHERE json_extract(data, '$.status') = 'new' ORDER BY id").all() as {
    id: number;
    task: string;
    created_at: string;
    data: string;
  }[];
  return rows.map((r) => ({ id: r.id, task: r.task, createdAt: r.created_at, ...JSON.parse(r.data) }));
}

export function updateRequest(id: number, change: Partial<Pick<Request, "status" | "reply" | "flags">>) {
  const row = rq().prepare("SELECT data FROM requests WHERE id = ?").get(id) as { data: string } | undefined;
  if (!row) throw new Error(`No request ${id}`);
  rq().prepare("UPDATE requests SET data = ? WHERE id = ?").run(JSON.stringify({ ...JSON.parse(row.data), ...change }), id);
}

/** Claude counts as listening if `npm run listen` has checked in within the last 15 seconds. */
export function listening(): boolean {
  const last = getState("listener");
  return !!last && Date.now() - Date.parse(last) < 15_000;
}
