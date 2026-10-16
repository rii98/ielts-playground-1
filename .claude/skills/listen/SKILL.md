---
name: listen
description: Start listening to the playground page and look after the feedback page — check each saved prompt, keep the answer's structure in step with it, and make any change the teacher asks for. Use for "start listening", "listen", "keep listening", or when a playground request notification arrives.
---

The teacher evolves the feedback page themselves by asking from the playground page. You do the work.
Talk to them in plain English; no code unless they ask.

## Start

1. If `curl -s -o /dev/null -w "%{http_code}" http://localhost:5199` isn't `200`, start `npm run dev`
   in the background and wait until it answers.
2. Start the Monitor tool on `npm run listen` with `timeout_ms: 1800000` and the description
   "requests from the playground". When it expires, start it again straight away, without asking —
   the page shows "Not listening" while it's down.
3. Tell the teacher, in one or two lines: you're listening; they can type anything about the feedback
   page into **Ask Claude** (bottom of the Instructions column), and when they **Save** a changed prompt
   you'll check it and bring the feedback page up to date. The feedback page is at
   http://localhost:5199/feedback. They can also just tell you things here in the terminal.

## Each request

Every line from `npm run listen` is JSON: `{"id", "task", "kind", "text", "images"?}`.
`images` (up to 4) are full paths to pictures the teacher attached in Ask Claude, such as a design they
like or a screenshot of a problem. Look at each one with the Read tool before acting, and say in your
reply what you took from them.
Reply with `npm run reply -- <id> working` first, and finish with
`npm run reply -- <id> done "<one or two plain sentences for the teacher>" [--flag "<note>" ...]`
(or `failed "<why, plainly>"`). The page shows these next to the request.
Handle requests one at a time, oldest first.

### kind "prompt" — the teacher saved a new prompt (`text` is the prompt)

- **Don't change the prompt here.** Saving is not asking. Flag; the teacher decides.
- Read it for spelling slips and big problems (asks for something contradictory, unclear about the
  answer it wants, forgets something the feedback page relies on). Add each as a short `--flag`;
  quote the words and suggest the fix, e.g. `--flag "'experinced' → 'experienced'"`. Small style
  points aren't worth a flag. No problems, no flags.
- Work out what answer the prompt asks the AI for:
  - **If the prompt already describes the answer's shape** (fields, JSON, "band, mistakes and
    improvements"), mirror it exactly: the teacher's fields, names and kinds of value. If part of it
    looks wrong or missing (criteria not named, an ambiguous field, something the page needs), don't
    invent it: build what's clear, and flag the gap with a suggested fix and a question.
  - **Otherwise** design the shape yourself from the intent (e.g. "one-liner per criterion" → one text
    field per criterion), keeping it as small as the prompt allows.
- **Reuse when you can.** Compare with `schema` in `tasks/<task>/structure.json`: if the change is
  rewording, a typo fix or tone, keep the schema and page as they are. Change them only when what
  the prompt asks for changed (new or removed parts, a different kind of value). See "The structure".
- Always set `builtFor` to the saved prompt, copied exactly from `tasks/<task>/prompt.md`, even if
  nothing else changed. Runs only use the structure while it matches.
- If the schema changed, update the feedback page so the new fields show, in the look it already has.
- Reply saying what the AI is now expected to return and whether the page changed.

### kind "mismatch" — a Run's answer didn't fit the structure (sent by the playground)

`text` lists what was wrong ("The reply wasn't JSON", `Missing "lexical_resource"`) and the prompt.
The teacher sees a loud red notice until you fix it.
- Read the reply: `curl -s "http://localhost:5199/api/feedback?task=<task>"` (`run.output`, `problems`).
- Fix it on our side, **never in the prompt**: clearer `description`s (they're shown to the AI), a
  schema that matches what the prompt really leads the AI to write, fewer or simpler required parts.
  If the prompt itself fights the structure (e.g. it insists on plain prose), say so with a `--flag`
  and suggest wording the teacher could add.
- Check with the same reply if you can: after your change, `structured` in the feedback call
  should no longer be null (the page re-reads the latest Run against the current structure).
- Reply with what was wrong and what you changed, and ask them to Run again.

### kind "change" — the teacher asked for something in the Ask Claude box

- Anything about the feedback page: look, layout, wording, charts, new sections, highlighting, …
  Do what they ask. Use `page` in structure.json when its options cover it; otherwise change
  `app/Feedback.tsx` and the `/feedback` part of `app/styles.css` (new chart, new section, anything).
  Keep the page drawn from structure.json and the AI's answer — don't hard-code one essay's content.
  Keep everything they didn't ask to change, including the theme.
- Charts: inline SVG in Feedback.tsx is fine; no new packages unless there's no other way.
- If it's about what the AI should mark or say but they didn't ask you to edit the prompt, don't: reply
  with the words they could add, and offer to make the change if they ask.
- **Prompt changes, only when explicitly asked** ("change my prompt to…", "fix the spelling in my
  prompt", "add … to the prompt"). See "Changing the prompt" below.
- If it's unclear, make the most sensible reading and say what you chose in the reply.
- "Undo" / "put it back": `git revert` the last feedback-page commit.

### Changing the prompt — only when the teacher explicitly asks

- The prompt is the teacher's. Change it only when they clearly ask, in the Ask Claude box or the
  terminal. A flag you raised is not a request, and neither is a vague "make the marking better".
- Make exactly the change they asked for and nothing else; keep their wording everywhere else.
- Write the whole new prompt to a file in your scratchpad, then save it with
  `npm run set-prompt -- <task> <that file> "<what changed, for History>"`. Never edit `prompt.md`
  directly: this saves it like the page's Save button (a version in History, so it can be undone) and
  shows it in the playground straight away. It also sends you a "prompt" request: handle that as usual
  (structure, `builtFor`, flags).
- Reply quoting what changed: before → after.

### After every change

1. `npx tsc --noEmit -p .` must pass. Fix anything it reports.
2. `curl -s "http://localhost:5199/api/feedback?task=<task>"` must still return a `run`; if the run's
   prompt matches `builtFor`, `structured` should not be null (the answer fits the schema).
3. Commit with a message the teacher can read, e.g. `feedback page: add a chart of the four bands`.
   Only commit the files you changed (`app/`, `tasks/<task>/structure.json`). Prompt changes are
   already committed by `npm run set-prompt`.
4. The page updates itself (it refreshes every 3 seconds), so just tell them to look.

## The structure — `tasks/<task>/structure.json`

- `builtFor`: the exact prompt it was made for.
- `schema`: JSON Schema for the answer the prompt asks for. Mirror the teacher's intent — the same
  criteria, fields and kinds of value, nothing they don't ask for. The top level is an object. Use
  snake_case keys and give every property a `title` in the teacher's words ("Task Response"). The AI's
  answer is matched to it loosely by name (case, spaces and punctuation ignored) by `fit` in
  `server/api.ts`. `number` for bands (0–9 for IELTS), `string` for text, `array` for lists;
  everything the prompt clearly asks for is `required`.
  **It's sent to the AI with every Run**, after the teacher's prompt (never inside it): an added
  instruction built from it (an example of the JSON plus each part's `description`) and Ollama's format
  setting. So write each `description` as an instruction to the AI, in the prompt's spirit
  ("One sarcastic sentence of feedback on Task Response"). For prose-style prompts, use string parts
  and kind `markdown` where a part is long.
  If an answer doesn't fit, nothing is guessed: the teacher sees a loud error and you get a "mismatch".
- `page`: what `app/Feedback.tsx` draws (extend this when you extend the page):
  - `title`, `intro` (optional line under it)
  - `overall`: `{ label, field?, average?, rounding: "ielts" | "none" }` — big summary number: `field` is a
    top-level number the AI gives (e.g. its overall band); `average` averages a field across sections.
    With both, the AI's number is shown and the average is shown under it as a check
  - `chart`: `{ title?, field, max? }` — one bar per section for a number field, under the overall
  - `layout`: `"list"` or `"grid"` (two cards per row)
  - `sections`: `[{ key, title, kind? }]` — one card per top-level schema property, in order
  - `fields`: `[{ key, kind, label? }]` — what to draw inside each section
  - kinds: `circle`, `badge` (top right of the card), `bar`, `text`, `bullets`, `quote`, `table`,
    `markdown` (formatted prose: headings, lists, bold, italics), `cards` (a section whose value is a list:
    one card per item, with `itemTitle`/`itemText` naming the item's fields)
  - `theme`: `{ accent, accentText, background, card, text, muted, line, radius, font }`
    (font: `system`, `serif`, `rounded`, `mono`)
  - `essay`: `{ title?, highlightQuotes? }` — the student's question and essay beside the feedback (sticky
    on wide screens); with `highlightQuotes`, multi-word phrases the feedback quotes are highlighted in it.
    `overall.ring: true` draws the overall number in a progress ring.
    `essay.annotations`: `{ field, quote, mistake, improvement, criterion? }` names a list in the answer;
    each item's `quote` is found in the essay and underlined, and hovering/tapping shows the mistake and
    improvement. Quotes that aren't in the essay are listed under it, so ask for exact, short quotes.
  - `mascot`: `{ emoji, name?, lines: [...] }` — a character beside the title, saying one line at a time
    (clicking it moves on); `meter`: `{ label, caption?, percent? }` — a decorative animated meter;
    `animate`: `true` — cards and prose reveal one by one, quoted words get highlighted
  - `template: "report"` + `report` (see `ReportSpec` in `app/Report.tsx`): a report layout with a band
    gauge, a card per criterion, "What you did well" (`strengths`), priority improvements (each criterion's
    first suggestion, weakest first), the task, criterion filter chips, Original / Improved / Sample views
    (`sample`) and numbered colour-coded annotations (`annotations.label` adds an issue tag). Parts whose
    field the prompt doesn't provide show a short note instead.
  - `css`: extra CSS, every rule starting with `.feedback-page`. Each section card has the class
    `section-<key>`, so one card can be styled on its own.

## Good habits

- Don't print or paste `.env`.
- If the teacher talks to you in the terminal instead of the page, treat it the same way.
