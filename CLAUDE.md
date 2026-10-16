# IELTS Writing Playground

This is the teacher's playground. Everything in it is theirs to change: the prompt, the
rubric, the page, the folder layout, even this file. It starts deliberately bare (blank
prompt, blank rubric, plain text output) and is meant to grow in whatever direction the
teacher takes it.

## Who you're helping

An IELTS teacher, not a developer. Talk in plain English, skip the jargon, and don't show
code unless they ask. They know IELTS marking far better than you do; your job is to turn
what they want into working changes quickly. Go ahead and make the change when the request
is clear, and say briefly what you did and what to look at in the browser.

## How it works today

- `npm run dev` starts the page at http://localhost:5199. Keep it running in the background.
  Edits to the page show up immediately, and edits to `server/` apply on the next Run.
- `tasks/<task>/` is one folder per task (`task2`, `task1-academic`, `task1-general`):
  - `task.json` holds the label and whether the task has a chart (`"image": true`)
  - `prompt.md` holds the instructions to the AI. `{{RUBRIC}}` is replaced by `rubric.md`
  - `rubric.md` holds the band descriptors
  - `samples/*.json` holds essays to try: `title`, `question`, `essay`, and `image` for a chart file next to it
- `server/api.ts` builds what is sent to the AI and handles Run, Save and History.
  The message the AI gets is `Question: … Response (N words): …` (`buildPrompt`).
- `server/db.ts` keeps work in progress in `data/playground.db` (SQLite built into Node, git-ignored):
  each task's unsaved prompt/rubric and essay (`drafts`), every Run with its inputs and output
  (`runs`), and the open task (`state`). The page autosaves as you type, so a refresh loses
  nothing. Rows are JSON, so new things can be stored without changing the tables.
- `server/ollama.ts` makes the call to Ollama (`gemma4:31b-cloud`, key in `.env`).
- `/feedback` (`app/Feedback.tsx`) draws the latest Run from `tasks/<task>/structure.json`: the answer's
  shape read from the prompt's intent, plus how to show it. When the teacher says "start listening", the
  `listen` skill watches the page's **Ask Claude** box and Save, and you keep the structure and the
  feedback page up to date. Change the teacher's prompt only when they explicitly ask (with
  `npm run set-prompt`); otherwise flag mistakes instead.
- `app/App.tsx` is the page and `app/styles.css` its look. The output is shown as plain
  text, and indented if it is JSON.
- Saved versions are separate from that: **Save** in the page writes `prompt.md` and `rubric.md` and makes a git commit with the
  teacher's note. **History** lists those commits. When you change those files yourself,
  commit too, so the teacher's history stays complete.

## Things the teacher will probably ask for next

These are examples, not a plan. Build whatever they ask for, in whatever shape they like.
- Ask the AI for structured output (JSON) and draw it as a proper feedback screen
- Show their own band next to the AI's, and save essays with their bands
- Run all the sample essays at once and summarise how close the AI is
- Highlight quoted words in the essay
- Compare two versions of the prompt side by side
- More tasks, or a different prompt per question type

## Good habits

- Keep the Ollama key private: don't print or paste the contents of `.env`. `npm run ping` checks that the key works.
- Commit after each change with a message the teacher can read. Then anything can be undone.
