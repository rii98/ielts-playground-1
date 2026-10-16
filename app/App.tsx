import { useEffect, useState } from "react";

// The whole page. Three columns: the essay to mark, the instructions (prompt +
// rubric, editable and saved as versions), and what the AI returned.

interface Task {
  id: string;
  label: string;
  image?: boolean;
}
interface Sample {
  id: string;
  title: string;
  question: string;
  essay: string;
  image?: string;
}
interface Version {
  commit: string;
  date: string;
  note: string;
}
interface Result {
  ok: boolean;
  output?: string;
  error?: string;
  model?: string;
  seconds: number;
  system: string;
  user: string;
}

async function call<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, body === undefined ? undefined : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? res.statusText);
  return json as T;
}

const OWN = "";

export function App() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [taskId, setTaskId] = useState("task2");
  const task = tasks.find((t) => t.id === taskId);

  // essay
  const [samples, setSamples] = useState<Sample[]>([]);
  const [sampleId, setSampleId] = useState(OWN);
  const [question, setQuestion] = useState("");
  const [essay, setEssay] = useState("");
  const [upload, setUpload] = useState<string>();

  // instructions
  const [prompt, setPrompt] = useState("");
  const [rubric, setRubric] = useState("");
  const [saved, setSaved] = useState({ prompt: "", rubric: "" });
  const [editing, setEditing] = useState<"prompt" | "rubric">("prompt");
  const [note, setNote] = useState("");
  const [versions, setVersions] = useState<Version[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [message, setMessage] = useState<string>();

  // output
  const [result, setResult] = useState<Result>();
  const [running, setRunning] = useState(false);
  const [view, setView] = useState<"output" | "sent">("output");
  const [error, setError] = useState<string>();

  const dirty = prompt !== saved.prompt || rubric !== saved.rubric;

  useEffect(() => {
    call<Task[]>("/tasks").then(setTasks).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    setResult(undefined);
    setMessage(undefined);
    setUpload(undefined);
    setShowHistory(false);
    call<{ prompt: string; rubric: string }>(`/task?task=${taskId}`).then((t) => {
      setPrompt(t.prompt);
      setRubric(t.rubric);
      setSaved(t);
    });
    call<Sample[]>(`/samples?task=${taskId}`).then((list) => {
      setSamples(list);
      pick(list[0]);
    });
    loadHistory();
  }, [taskId]);

  function loadHistory() {
    call<Version[]>(`/history?task=${taskId}`).then(setVersions).catch(() => setVersions([]));
  }

  function pick(s: Sample | undefined) {
    setSampleId(s?.id ?? OWN);
    setQuestion(s?.question ?? "");
    setEssay(s?.essay ?? "");
    setUpload(undefined);
  }

  function switchTask(id: string) {
    if (dirty && !window.confirm("You have unsaved changes to the prompt or rubric. Switch anyway and lose them?")) return;
    setTaskId(id);
  }

  async function save() {
    const r = await call<{ versioned: boolean; unchanged?: boolean }>("/save", { task: taskId, prompt, rubric, note });
    setSaved({ prompt, rubric });
    setNote("");
    setMessage(r.unchanged ? "Nothing changed." : r.versioned ? "Saved as a new version." : "Saved.");
    loadHistory();
  }

  async function openVersion(v: Version) {
    const t = await call<{ prompt: string; rubric: string }>(`/version?task=${taskId}&commit=${v.commit}`);
    setPrompt(t.prompt);
    setRubric(t.rubric);
    setShowHistory(false);
    setMessage(`Opened the version “${v.note}”. Save to make it the current one.`);
  }

  async function run() {
    setRunning(true);
    setError(undefined);
    try {
      const sample = samples.find((s) => s.id === sampleId);
      const r = await call<Result>("/run", {
        task: taskId,
        prompt,
        rubric,
        question,
        essay,
        imageBase64: upload,
        sampleImage: upload ? undefined : sample?.image,
      });
      setResult(r);
      setView("output");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  }

  async function chooseImage(file: File | undefined) {
    if (!file) return;
    const url = await new Promise<string>((ok) => {
      const r = new FileReader();
      r.onload = () => ok(String(r.result));
      r.readAsDataURL(file);
    });
    setUpload(url.split(",")[1]);
  }

  const sample = samples.find((s) => s.id === sampleId);
  const imageSrc = upload ? `data:image/*;base64,${upload}` : sample?.image ? `/api/sample-image?task=${taskId}&file=${sample.image}` : undefined;
  const words = essay.trim() ? essay.trim().split(/\s+/).length : 0;

  return (
    <div className="page">
      <header className="top">
        <strong>IELTS Writing Playground</strong>
        <nav>
          {tasks.map((t) => (
            <button key={t.id} className={t.id === taskId ? "on" : ""} onClick={() => switchTask(t.id)}>
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="cols">
        {/* ---------- essay ---------- */}
        <section className="col">
          <h2>Essay</h2>
          <select value={sampleId} onChange={(e) => pick(samples.find((s) => s.id === e.target.value))}>
            {samples.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
            <option value={OWN}>Paste my own…</option>
          </select>
          <label>Question</label>
          <textarea rows={5} value={question} onChange={(e) => setQuestion(e.target.value)} />
          {task?.image && (
            <>
              <label>Chart</label>
              {imageSrc && <img src={imageSrc} alt="Chart" />}
              <input type="file" accept="image/*" onChange={(e) => void chooseImage(e.target.files?.[0])} />
            </>
          )}
          <label>Response · {words} words</label>
          <textarea className="fill" value={essay} onChange={(e) => setEssay(e.target.value)} />
          <button className="primary" disabled={running || !essay.trim()} onClick={() => void run()}>
            {running ? "Marking…" : "Run"}
          </button>
        </section>

        {/* ---------- instructions ---------- */}
        <section className="col">
          <div className="row">
            <h2>Instructions</h2>
            <div className="tabs">
              <button className={editing === "prompt" ? "on" : ""} onClick={() => setEditing("prompt")}>
                Prompt
              </button>
              <button className={editing === "rubric" ? "on" : ""} onClick={() => setEditing("rubric")}>
                Rubric
              </button>
            </div>
          </div>
          <textarea
            className="fill mono"
            value={editing === "prompt" ? prompt : rubric}
            onChange={(e) => (editing === "prompt" ? setPrompt(e.target.value) : setRubric(e.target.value))}
          />
          <p className="hint">
            {unknownSlots(prompt).length > 0
              ? `⚠ ${unknownSlots(prompt).join(", ")} isn't recognised and will be sent as plain text. Use {{RUBRIC}} for the rubric.`
              : rubric.trim() && !hasRubricSlot(prompt)
                ? "⚠ The prompt doesn't contain {{RUBRIC}}, so the rubric isn't sent."
                : editing === "prompt"
                  ? "Write {{RUBRIC}} in the prompt where the rubric should go. Run uses what's here, even before you save."
                  : "The rubric is inserted into the prompt wherever it says {{RUBRIC}}."}
          </p>
          <div className="row">
            <input placeholder="What did you change? (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
            <button className="primary" disabled={!dirty} onClick={() => void save()}>
              {dirty ? "Save" : "Saved"}
            </button>
            <button onClick={() => setShowHistory(!showHistory)}>History ({versions.length})</button>
          </div>
          {message && <p className="hint">{message}</p>}
          {showHistory && (
            <ul className="history">
              {versions.length === 0 && <li className="hint">No saved versions yet.</li>}
              {versions.map((v) => (
                <li key={v.commit}>
                  <button onClick={() => void openVersion(v)}>
                    <span>{v.note}</span>
                    <time>{new Date(v.date).toLocaleString()}</time>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ---------- output ---------- */}
        <section className="col">
          <div className="row">
            <h2>Output</h2>
            <div className="tabs">
              <button className={view === "output" ? "on" : ""} onClick={() => setView("output")}>
                AI answer
              </button>
              <button className={view === "sent" ? "on" : ""} onClick={() => setView("sent")}>
                Sent to AI
              </button>
            </div>
          </div>
          {result && (
            <p className="hint">
              {result.model ?? "—"} · {result.seconds.toFixed(1)}s
            </p>
          )}
          {error && <p className="error">{error}</p>}
          {!result && !error && <p className="hint">Press Run to see what the AI says.</p>}
          {result && view === "output" && (result.ok ? <pre className="fill">{pretty(result.output ?? "")}</pre> : <p className="error">{result.error}</p>)}
          {result && view === "sent" && (
            <pre className="fill">
              {"── Instructions (system) ──\n"}
              {result.system || "(empty)"}
              {"\n\n── Message (user) ──\n"}
              {result.user}
            </pre>
          )}
        </section>
      </main>
    </div>
  );
}

// Same rule as the server: {{RUBRIC}} or {{RUBRICS}}, any letter case.
const isRubricSlot = (slot: string) => /^\{\{\s*rubrics?\s*\}\}$/i.test(slot);
const hasRubricSlot = (text: string) => (text.match(/\{\{[^{}]*\}\}/g) ?? []).some(isRubricSlot);
const unknownSlots = (text: string) => [...new Set((text.match(/\{\{[^{}]*\}\}/g) ?? []).filter((s) => !isRubricSlot(s)))];

/** If the answer is JSON (optionally in a ``` block), indent it; otherwise show it as is. */
function pretty(text: string): string {
  const inner = text.trim().match(/^```(?:json)?\s*([\s\S]*?)```$/i)?.[1] ?? text;
  try {
    return JSON.stringify(JSON.parse(inner), null, 2);
  } catch {
    return text;
  }
}
