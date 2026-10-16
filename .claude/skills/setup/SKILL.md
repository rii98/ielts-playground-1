---
name: setup
description: First-time setup on the teacher's Mac — Node, install, Ollama key, start the playground. Use for "set up", "install", "start the playground", or when the key is missing.
---

Walk the teacher through it one short step at a time; help if a step fails.

1. `node -v`. If Node is missing or older than v22.13, ask them to install the LTS version from
   https://nodejs.org (download the macOS installer, open it, click through) and say "done".
2. `npm install`.
3. If `git status` fails (the folder came as a ZIP), run
   `git init && git add -A && git commit -m "start"` so Save/History and undo work. If macOS
   offers to install "command line developer tools", tell them to click Install and wait.
4. If there's no `.env`: `cp .env.example .env`, then `open -e .env`, and ask them to paste their
   Ollama key right after `OLLAMA_API_KEY=`, save (⌘S), close it and say "done". Don't read the file yourself.
5. `npm run ping`. If it fails, explain plainly and repeat step 4.
6. Start `npm run dev` in the background and tell them the page is at http://localhost:5199,
   with a one-line tour: pick an essay, write a prompt in the middle, press Run.
