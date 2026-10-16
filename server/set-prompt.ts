import { readFileSync } from "node:fs";
import { join } from "node:path";
import { save } from "./api.ts";
import { getDraft, putDraft } from "./db.ts";
import { ROOT } from "./paths.ts";

// `npm run set-prompt -- <task> <file with the new prompt> "what changed"`
// Only for when the teacher has explicitly asked Claude to change their prompt. Saves it exactly like
// the page's Save button (prompt.md + a version in History, so it can be undone) and updates the
// page's autosaved copy, so the playground shows the new prompt straight away.

const [task, file, ...note] = process.argv.slice(2);
if (!task || !file) {
  console.error('Usage: npm run set-prompt -- <task> <file with the new prompt> "what changed"');
  process.exit(1);
}
const prompt = readFileSync(file, "utf8");
const rubric = readFileSync(join(ROOT, "tasks", task, "rubric.md"), "utf8");
const result = save(task, prompt, rubric, note.join(" ") || "Claude: prompt change the teacher asked for");
const draft = getDraft(task) as Record<string, unknown> | null;
if (draft) putDraft(task, { ...draft, prompt });
console.log(result.versioned ? "Saved as a new version." : result.unchanged ? "The prompt was already the same." : "Saved.");
