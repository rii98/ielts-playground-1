import { putState } from "./db.ts";
import { join } from "node:path";
import { ATTACHMENTS, newRequests, updateRequest } from "./claude.ts";

// `npm run listen` - run by Claude Code (with its Monitor tool) after the teacher says "start listening".
// Every second it tells the page Claude is listening, and prints each new request from the page as one
// line of JSON, which Claude sees as a notification. Requests it has printed are marked "seen".

console.log(JSON.stringify({ listening: true }));
setInterval(() => {
  try {
    putState("listener", new Date().toISOString());
    for (const r of newRequests()) {
      updateRequest(r.id, { status: "seen" });
      const images = (r.attachments ?? []).map((f) => join(ATTACHMENTS, f));
      console.log(JSON.stringify({ id: r.id, task: r.task, kind: r.kind, text: r.text, ...(images.length ? { images } : {}) }));
    }
  } catch (e) {
    console.log(JSON.stringify({ error: (e as Error).message }));
  }
}, 1000);
