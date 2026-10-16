# IELTS Writing Playground: teacher guide

A space to design how AI marks IELTS Writing. You write the prompt and the rubric, run them on
essays, and see the AI's marking, both as raw text and as a finished **feedback page** for the student.
Claude works alongside you in the terminal: it keeps the feedback page in step with your prompt,
and changes the page however you ask.

## Setup (once, about 10 minutes)

1. Install **Claude Code** (https://claude.com/claude-code) and sign in.
2. On the GitHub page you were sent, click the green **Code** button → **Download ZIP**. Unzip it and
   move the folder into **Documents** (rename it `ielts-playground` if needed).
3. Open **Terminal**, then type `cd ~/Documents/ielts-playground` and `claude`.
4. Type **`/setup`**. Claude installs what's needed and asks you to paste your Ollama key into a file.
5. The playground opens in your browser at **http://localhost:5199**.

**Every time after that:** open Terminal, type `cd ~/Documents/ielts-playground` and `claude`, then say
**"start the playground"** and **"start listening"**.

## The playground

- **Essay** (left): pick a sample or paste your own, then press **Run** (or ⌘↵). The word count turns
  amber when the essay is too short.
- **Instructions** (middle): your **Prompt** and **Rubric**. Write `{{RUBRIC}}` in the prompt where the
  rubric should go. **Run** always uses what's in the boxes, even before you save.
  **Save** (⌘S) keeps a version with a note, and **History** lets you go back to any version.
  The chip by Save tells you whether the feedback page is in step with your prompt.
- **Result** (right): the AI's answer. **Sent to AI** shows exactly what the AI received: your prompt,
  the essay, and the answer format Claude added. **Open feedback page** shows the student's view.
- A sound and a small message tell you when marking finishes, a save works or something goes wrong.
  The speaker button at the top turns sounds off.

## The feedback page

At **http://localhost:5199/feedback**, the latest Run is drawn as a report for the student.
For Task 2 that's the band score, a card per criterion, priorities, the task, and the essay with each
mistake underlined. Click a mistake to see what's wrong and how to fix it, and use **Improved** to see
the essay with every fix applied. The page updates by itself after each Run.

## Working with Claude

Say **"start listening"** in the terminal, and the **Ask Claude** button (top right) gets a green light.

- **When you save a new prompt,** Claude reads it and works out what answer it asks for. It updates the
  feedback page to match, or leaves it alone if you only reworded something. Spelling slips and unclear
  parts come back as ⚑ notes. **Run is paused** until Claude has finished, which is usually under a minute.
- **Ask for any change** in the Ask Claude chat: "make the page calm", "show the essay beside the
  feedback", "copy this design". You can attach up to 4 images (📎, paste, or drag them in), for
  example a design you like or a screenshot of a problem.
- **Your prompt is yours.** Claude only edits it when you clearly ask ("fix the spelling in my prompt",
  "add a line asking for…"). Each edit is saved as a version in History, so you can go back.
- **If the AI's answer doesn't fit** what the feedback page expects, you'll see a red message. Claude is
  told automatically and fixes its side. Run again once it's done.
- You can also type requests straight into the terminal. Say **"stop listening"** when you're done.

Some things to ask for:
- "Add a box for my own band and show it next to the AI's."
- "Run all the Task 2 samples and show me the bands in a table."
- "Add this essay to the Task 2 samples: …"
- "Undo the last change."
