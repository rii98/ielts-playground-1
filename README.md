# ielts-playground

A bare playground where a teacher designs IELTS Writing marking (Task 1 Academic, Task 1 GT,
Task 2) from a blank prompt and rubric, using Ollama `gemma4:31b-cloud`. It's built to be
grown through Claude Code (see `TEACHER.md`, `CLAUDE.md`). Nothing in it comes from the
main app.

```bash
npm install
cp .env.example .env   # add OLLAMA_API_KEY
npm run dev            # http://localhost:5199
```
