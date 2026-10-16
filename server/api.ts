import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chat } from "./ollama.ts";
import { addRun, getDraft, getState, lastRun, putDraft, putState } from "./db.ts";
import { addRequest, ATTACHMENTS, listening, readStructure, recentRequests, updateRequest } from "./claude.ts";
import { ROOT } from "./paths.ts";

// Everything the page asks the server for. Each task is a folder in tasks/:
//   task.json   { "label": "...", "image": true }   (image = the task has a chart)
//   prompt.md   the instructions to the AI ({{RUBRIC}} is replaced by rubric.md)
//   rubric.md   the band descriptors
//   samples/    essays to try: { "title", "question", "essay", "image"? }
//   structure.json  the answer's shape + feedback layout, kept up to date by Claude (see claude.ts)

const TASKS = join(ROOT, "tasks");
const SAFE = /^[\w.-]+$/;

function taskDir(id: string) {
  if (!SAFE.test(id) || !existsSync(join(TASKS, id, "task.json"))) throw new Error(`No task "${id}"`);
  return join(TASKS, id);
}

/** The task id, after checking the task exists. */
function known(id: string) {
  taskDir(id);
  return id;
}

export async function route(path: string, q: URLSearchParams, body: any): Promise<unknown> {
  const id = q.get("task") ?? body?.task ?? "";
  switch (path) {
    case "/tasks":
      return readdirSync(TASKS)
        .filter((d) => existsSync(join(TASKS, d, "task.json")))
        .map((d) => ({ id: d, ...JSON.parse(readFileSync(join(TASKS, d, "task.json"), "utf8")) }));

    case "/task":
      return {
        prompt: readFileSync(join(taskDir(id), "prompt.md"), "utf8"),
        rubric: readFileSync(join(taskDir(id), "rubric.md"), "utf8"),
      };

    case "/samples": {
      const dir = join(taskDir(id), "samples");
      if (!existsSync(dir)) return [];
      return readdirSync(dir)
        .filter((f) => f.endsWith(".json"))
        .sort()
        .map((f) => ({ id: f.slice(0, -5), ...JSON.parse(readFileSync(join(dir, f), "utf8")) }));
    }

    case "/sample-image": {
      const file = q.get("file") ?? "";
      if (!SAFE.test(file)) throw new Error("Bad file name");
      return readFileSync(join(taskDir(id), "samples", file));
    }

    case "/save":
      return save(id, body.prompt, body.rubric, body.note);

    case "/history":
      return history(id);

    case "/version":
      return {
        prompt: git(["show", `${q.get("commit")}:tasks/${id}/prompt.md`]) ?? "",
        rubric: git(["show", `${q.get("commit")}:tasks/${id}/rubric.md`]) ?? "",
      };

    // ---- the teacher's Claude Code session (see claude.ts) ----
    case "/claude":
      return {
        listening: listening(),
        structure: readStructure(taskDir(id)),
        requests: recentRequests(known(id)),
        // So the page notices when Claude saved a new prompt for the teacher.
        savedPrompt: readFileSync(join(taskDir(id), "prompt.md"), "utf8"),
      };

    case "/ask": {
      const images: { type: string; data: string }[] = Array.isArray(body.images) ? body.images : [];
      if (!String(body.text ?? "").trim() && !images.length) throw new Error("Write what you'd like changed first.");
      if (images.length > 4) throw new Error("Attach up to 4 images.");
      for (const img of images) {
        if (!/^image\/(png|jpeg|webp|gif)$/.test(img.type)) throw new Error("Images must be PNG, JPEG, WebP or GIF.");
        if (img.data.length > 8_000_000) throw new Error("Each image must be under 6 MB.");
      }
      return { id: addRequest(known(id), "change", String(body.text ?? "").trim() || "(see the attached image)", images) };
    }

    case "/attachment": {
      const file = q.get("file") ?? "";
      if (!SAFE.test(file)) throw new Error("Bad file name");
      return readFileSync(join(ATTACHMENTS, file));
    }

    case "/request-update":
      updateRequest(Number(body.id), { status: body.status, reply: body.reply, flags: body.flags });
      return { ok: true };

    case "/feedback":
      return feedback(known(id));

    case "/run":
      return run(body);

    // ---- kept in data/playground.db so a refresh loses nothing ----
    case "/draft":
      if (body === undefined) return getDraft(known(id));
      putDraft(known(id), body.draft);
      return { ok: true };

    case "/last-run":
      return lastRun(known(id));

    case "/state":
      if (body === undefined) return { task: getState("task") };
      putState("task", String(body.task));
      return { ok: true };

    default:
      throw new Error(`Unknown request ${path}`);
  }
}

// ---------- running ----------

interface RunInput {
  task: string;
  prompt: string;
  rubric: string;
  question: string;
  essay: string;
  imageBase64?: string;
  sampleImage?: string;
}

/** Where the rubric goes in the prompt: {{RUBRIC}} or {{RUBRICS}}, any letter case. */
const RUBRIC_SLOT = /\{\{\s*rubrics?\s*\}\}/gi;

/** What the AI receives: the prompt (with the rubric dropped in) as instructions, the task + response as the message. */
export function buildPrompt(input: RunInput) {
  const system = input.prompt.replace(RUBRIC_SLOT, () => input.rubric);
  const words = input.essay.trim() ? input.essay.trim().split(/\s+/).length : 0;
  const user = `Question:\n${input.question.trim()}\n\nResponse (${words} words):\n${input.essay.trim()}`;
  return { system, user };
}

/** The layout, if it was made for this exact prompt. A changed prompt runs without one until it's saved. */
function structureFor(id: string, prompt: string) {
  const s = readStructure(taskDir(id));
  return s && s.builtFor.trim() === prompt.trim() ? s : undefined;
}

/**
 * What /feedback shows: the latest Run, fitted to the current structure when that was made for the
 * prompt the Run used (so changes to the structure show without running again), else as it was.
 */
function feedback(id: string) {
  const run = lastRun(id) as any;
  const current = readStructure(taskDir(id));
  if (!run) return { run: null, structure: current };
  if (run.ok && current && run.input?.prompt?.trim() === current.builtFor.trim()) {
    const structured = fitAnswer(current, run.output);
    return { run, structure: current, structured, problems: structured === undefined ? mismatch(current.schema, run.output) : [] };
  }
  return { run, structure: run.structure ?? null, structured: run.structured, problems: run.problems ?? [] };
}

/** The answer fitted to the structure: the reply's JSON matched to the schema, or undefined if it doesn't fit. */
function fitAnswer(structure: { schema: any }, text: string): unknown {
  return fit(structure.schema, answerJson(text));
}

/**
 * Why an answer doesn't fit the structure, in plain words ("The reply wasn't JSON", "Missing \"lexical_resource\"").
 * Empty when it fits. Shown loudly on both pages and handed to Claude to fix.
 */
export function mismatch(schema: any, text: string): string[] {
  const value = answerJson(text);
  if (value === undefined) return ["The reply wasn't JSON, so none of the parts could be found."];
  const out: string[] = [];
  const norm = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, "");
  const walk = (s: any, v: unknown, path: string) => {
    if (s.type === "object") {
      if (!v || typeof v !== "object" || Array.isArray(v)) return void out.push(`${path || "The reply"} should be an object.`);
      for (const [key, sub] of Object.entries<any>(s.properties ?? {})) {
        const names = [norm(key), sub.title ? norm(sub.title) : ""];
        const found = Object.entries(v).find(([k]) => names.includes(norm(k)));
        const here = path ? `${path}.${key}` : key;
        if (!found) {
          if (s.required?.includes(key)) out.push(`Missing "${here}".`);
        } else if (fit(sub, found[1]) === undefined) {
          if (sub.type === "object") walk(sub, found[1], here);
          else out.push(`"${here}" should be ${sub.type === "array" ? "a list" : sub.type === "string" ? "text" : `a ${sub.type}`}.`);
        }
      }
    }
  };
  walk(schema, value, "");
  return out.length || fit(schema, value) !== undefined ? out : ["The reply didn't match the structure."];
}

/**
 * What Claude adds after the teacher's prompt so the AI answers in the structure's shape: an example of
 * the JSON and what each part means (from the schema's titles and descriptions). The prompt itself is untouched.
 */
export function formatInstruction(schema: any): string {
  const example = (s: any): unknown => {
    if (s.type === "object") return Object.fromEntries(Object.entries<any>(s.properties ?? {}).map(([k, v]) => [k, example(v)]));
    if (s.type === "array") return [example(s.items ?? { type: "string" })];
    if (s.type === "number" || s.type === "integer") return s.minimum !== undefined && s.maximum !== undefined ? `<number ${s.minimum}-${s.maximum}>` : "<number>";
    return "<text>";
  };
  const notes: string[] = [];
  const walk = (s: any, path: string) => {
    for (const [k, v] of Object.entries<any>(s.properties ?? {})) {
      const here = path ? `${path}.${k}` : k;
      if (v.description || v.title) notes.push(`- "${here}": ${v.description ?? v.title}`);
      if (v.type === "object") walk(v, here);
      if (v.type === "array" && v.items?.type === "object") walk(v.items, `${here}[]`);
    }
  };
  walk(schema, "");
  const shape = JSON.stringify(example(schema), null, 2).replace(/"<(number[^>]*|text)>"/g, "<$1>");
  return [
    "Answer format: reply with JSON only, with no other text and no code fences, in exactly this shape:",
    shape,
    notes.length ? "What each part means:\n" + notes.join("\n") : "",
    "Everything above about tone, style and content still applies inside each part.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** The schema without our own "x-…" notes, for Ollama's format setting. */
function plainSchema(schema: any): any {
  if (Array.isArray(schema)) return schema.map(plainSchema);
  if (!schema || typeof schema !== "object") return schema;
  return Object.fromEntries(Object.entries(schema).filter(([k]) => !k.startsWith("x-")).map(([k, v]) => [k, plainSchema(v)]));
}


/** The JSON in an answer, with or without a ```json fence around it. */
function answerJson(text: string): unknown {
  const inner = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? text.match(/[{[][\s\S]*[}\]]/)?.[0] ?? text;
  try {
    return JSON.parse(inner);
  } catch {
    return undefined;
  }
}

/**
 * Fits the answer to the structure's schema. Ollama's cloud models don't always follow the schema
 * exactly, so names are matched loosely ("Task Response", "task_response" and "TASK RESPONSE" are the same).
 * Returns undefined if anything required is missing, and the page then shows the plain answer.
 */
function fit(schema: any, value: unknown): unknown {
  const norm = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (schema.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const out: Record<string, unknown> = {};
    for (const [key, sub] of Object.entries<any>(schema.properties ?? {})) {
      const names = [norm(key), sub.title ? norm(sub.title) : ""];
      const found = Object.entries(value).find(([k]) => names.includes(norm(k)));
      const fitted = found ? fit(sub, found[1]) : undefined;
      if (fitted === undefined) {
        if (schema.required?.includes(key)) return undefined;
        continue;
      }
      out[key] = fitted;
    }
    return out;
  }
  if (schema.type === "array") {
    if (!Array.isArray(value)) return typeof value === "string" ? [value] : undefined;
    return value.map((v) => (schema.items ? fit(schema.items, v) : v)).filter((v) => v !== undefined);
  }
  if (schema.type === "number" || schema.type === "integer") {
    const n = Number(value);
    return value === null || value === "" || !Number.isFinite(n) ? undefined : n;
  }
  if (schema.type === "string") return typeof value === "string" ? value : value == null ? undefined : String(value);
  return value;
}

/** Hands Claude a "the answer didn't fit" request — once per prompt until Claude has dealt with it. */
function reportMismatch(task: string, prompt: string, problems: string[]) {
  const open = recentRequests(task).some((r) => r.kind === "mismatch" && !["done", "failed"].includes(r.status));
  if (!open) addRequest(task, "mismatch", `The AI's answer didn't match the structure for this prompt:\n- ${problems.join("\n- ")}\n\nPrompt:\n${prompt}`);
}

async function run(input: RunInput) {
  // Not while Claude is changing the structure or page: the Run would use a half-finished version.
  const busy = recentRequests(known(input.task)).some((r) => r.status === "seen" || r.status === "working" || (r.status === "new" && listening()));
  if (busy) throw new Error("Claude is still working on the structure or feedback page. Run again when it's done.");
  const started = Date.now();
  const { system, user } = buildPrompt(input);
  const shape = structureFor(input.task, input.prompt);
  let image = input.imageBase64;
  if (!image && input.sampleImage && SAFE.test(input.sampleImage))
    image = readFileSync(join(taskDir(input.task), "samples", input.sampleImage)).toString("base64");
  // Claude's structure goes with the teacher's prompt (never into it): an added instruction describing the
  // answer's shape, and the same shape as Ollama's format setting. "Sent to AI" shows each piece.
  const format = shape ? plainSchema(shape.schema) : null;
  const added = shape ? formatInstruction(shape.schema) : null;
  const sent = {
    system,
    added,
    user,
    format,
    image: input.imageBase64 ? { source: "upload" } : image ? { source: "sample", file: input.sampleImage } : null,
  };
  let result;
  try {
    const { text, model } = await chat({ system: added ? `${system}\n\n${added}` : system, user, images: image ? [image] : undefined, format: format ?? undefined });
    const structured = shape ? fitAnswer(shape, text) : undefined;
    // An answer that doesn't fit is a problem for Claude to fix (in the structure, never the prompt): say so loudly.
    const problems = shape && structured === undefined ? mismatch(shape.schema, text) : [];
    if (problems.length) reportMismatch(input.task, input.prompt, problems);
    result = { ok: true, output: text, model, seconds: (Date.now() - started) / 1000, ...sent, structure: shape, structured, problems };
  } catch (err) {
    const message = (err as Error).name === "TimeoutError" ? "The AI took too long to answer. Try again." : (err as Error).message;
    result = { ok: false, error: message, seconds: (Date.now() - started) / 1000, ...sent };
  }
  // Keep every run (inputs too, minus the image bytes) so it survives a refresh.
  const { imageBase64, ...inputs } = input;
  addRun(input.task, { ...result, input: { ...inputs, uploadedImage: !!imageBase64 } });
  return result;
}

// ---------- saving & history (git) ----------

function git(args: string[]): string | null {
  try {
    return execFileSync("git", args, { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString();
  } catch {
    return null;
  }
}

export function save(id: string, prompt: string, rubric: string, note?: string) {
  const dir = taskDir(id);
  // A new prompt goes to Claude, who checks it and brings the structure and feedback page up to date.
  const asked = recentRequests(id).some((r) => r.kind === "prompt" && r.text.trim() === prompt.trim() && r.status !== "failed");
  if (readStructure(dir)?.builtFor.trim() !== prompt.trim() && !asked) addRequest(id, "prompt", prompt);
  writeFileSync(join(dir, "prompt.md"), prompt);
  writeFileSync(join(dir, "rubric.md"), rubric);
  if (git(["rev-parse", "--is-inside-work-tree"]) === null) return { saved: true, versioned: false };

  const files = [`tasks/${id}/prompt.md`, `tasks/${id}/rubric.md`];
  git(["add", ...files]);
  if (git(["diff", "--cached", "--quiet", "--", ...files]) !== null) return { saved: true, versioned: false, unchanged: true };
  const who = git(["config", "user.name"])?.trim() ? [] : ["-c", "user.name=Teacher", "-c", "user.email=teacher@playground.local"];
  const message = `${id}: ${note?.trim() || "edit prompt/rubric"}`;
  const ok = git([...who, "commit", "-m", message, "--", ...files]) !== null;
  return { saved: true, versioned: ok };
}

function history(id: string) {
  taskDir(id);
  const out = git(["log", "--format=%h\t%cI\t%s", "-n", "50", "--", `tasks/${id}/prompt.md`, `tasks/${id}/rubric.md`]);
  if (!out) return [];
  return out
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [commit, date, ...rest] = line.split("\t");
      return { commit, date, note: rest.join("\t").replace(new RegExp(`^${id}: `), "") };
    });
}
