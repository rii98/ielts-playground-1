import { updateRequest } from "./claude.ts";

// `npm run reply -- <id> <working|done|failed> ["what to tell the teacher"] [--flag "a note about the prompt" ...]`
// How Claude reports back on a request from the page. The page shows the status, the reply and any flags.

const [id, status, ...rest] = process.argv.slice(2);
if (!id || !["working", "done", "failed"].includes(status)) {
  console.error('Usage: npm run reply -- <id> <working|done|failed> ["reply"] [--flag "note" ...]');
  process.exit(1);
}
const flags: string[] = [];
const words: string[] = [];
for (let i = 0; i < rest.length; i++) {
  if (rest[i] === "--flag" && rest[i + 1] !== undefined) flags.push(rest[++i]);
  else words.push(rest[i]);
}
updateRequest(Number(id), {
  status: status as "working" | "done" | "failed",
  ...(words.length ? { reply: words.join(" ") } : {}),
  ...(flags.length ? { flags } : {}),
});
console.log(`Request ${id}: ${status}`);
