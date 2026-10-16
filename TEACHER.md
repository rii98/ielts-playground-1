# IELTS Writing Playground: teacher guide

A blank space to design how AI marks IELTS Writing. You write the prompt and the rubric,
run them on essays, see what the AI says, and keep improving. Anything beyond that, such
as a nicer feedback screen, your own bands next to the AI's or batch testing, you ask
Claude to build for you.

## Setup (once, about 10 minutes)

1. Install the **Claude** desktop app (https://claude.ai/download) and sign in.
2. On the GitHub page you were sent, click the green **Code** button → **Download ZIP**. Unzip it and
   move the folder into **Documents** (rename it `ielts-playground` if needed).
3. In Claude, open the **Code** tab and choose the `ielts-playground` folder.
4. Type **`/setup`**. Claude installs what's needed and asks you to paste your Ollama key into a file.
5. The playground opens in your browser at **http://localhost:5199**.

Next time, open the folder in Claude and say "start the playground".

## The page

- **Essay** (left): pick a sample or paste your own, then press **Run**.
- **Instructions** (middle): your **Prompt** and **Rubric**. Write `{{RUBRIC}}` in the prompt where the
  rubric should go. **Run** always uses what's in the boxes, even before you save. **Save** keeps a
  version with your note. **History** lets you go back to any version.
- **Output** (right): the AI's answer. **Sent to AI** shows exactly what the AI received.

## Asking Claude for more

Just describe what you want. For example:
- "Make the AI answer in JSON with a band and a comment for each criterion, and show it as cards."
- "Add a box for my own band and show it next to the AI's."
- "Run all the Task 2 samples and show me the bands in a table."
- "Highlight the mistakes the AI quotes inside the essay."
- "Add this essay to the Task 2 samples: …"
- "Undo the last change."
