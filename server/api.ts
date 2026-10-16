import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chat } from "./ollama.ts";
import { ROOT } from "./paths.ts";

// Everything the page asks the server for. Each task is a folder in tasks/:
//   task.json   { "label": "...", "image": true }   (image = the task has a chart)
//   prompt.md   the instructions to the AI ({{RUBRIC}} is replaced by rubric.md)
//   rubric.md   the band descriptors
//   samples/    essays to try: { "title", "question", "essay", "image"? }

const TASKS = join(ROOT, "tasks");
const SAFE = /^[\w.-]+$/;

function taskDir(id: string) {
  if (!SAFE.test(id) || !existsSync(join(TASKS, id, "task.json"))) throw new Error(`No task "${id}"`);
  return join(TASKS, id);
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

    case "/run":
      return run(body);

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

/** What the AI receives: the prompt (with the rubric dropped in) as instructions, the task + response as the message. */
export function buildPrompt(input: RunInput) {
  const system = input.prompt.replaceAll("{{RUBRIC}}", input.rubric);
  const words = input.essay.trim() ? input.essay.trim().split(/\s+/).length : 0;
  const user = `Question:\n${input.question.trim()}\n\nResponse (${words} words):\n${input.essay.trim()}`;
  return { system, user };
}

async function run(input: RunInput) {
  const started = Date.now();
  const { system, user } = buildPrompt(input);
  let image = input.imageBase64;
  if (!image && input.sampleImage && SAFE.test(input.sampleImage))
    image = readFileSync(join(taskDir(input.task), "samples", input.sampleImage)).toString("base64");
  try {
    const { text, model } = await chat({ system, user, images: image ? [image] : undefined });
    return { ok: true, output: text, model, seconds: (Date.now() - started) / 1000, system, user };
  } catch (err) {
    const message = (err as Error).name === "TimeoutError" ? "The AI took too long to answer. Try again." : (err as Error).message;
    return { ok: false, error: message, seconds: (Date.now() - started) / 1000, system, user };
  }
}

// ---------- saving & history (git) ----------

function git(args: string[]): string | null {
  try {
    return execFileSync("git", args, { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString();
  } catch {
    return null;
  }
}

function save(id: string, prompt: string, rubric: string, note?: string) {
  const dir = taskDir(id);
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
