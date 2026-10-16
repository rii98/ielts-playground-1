import { useCallback, useEffect, useRef, useState } from "react";
import { ago, Dialog, Drawer, Icon, isMuted, play, setMuted, ToastProvider, useToast } from "./ui.tsx";

// The whole page: the essay to mark (left), the instructions — prompt + rubric, saved as versions —
// (middle), and what the AI returned (right). History and Ask Claude open as side panels.

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
  /** Set on runs loaded back from the database. */
  createdAt?: string;
  /** The answer format sent with the prompt (null: none). Missing on runs from before it was recorded. */
  format?: Schema | null;
  /** Why the answer didn't fit Claude's structure (empty when it did). Claude is told automatically. */
  problems?: string[];
  /** What Claude added after the prompt: the answer format, as an instruction (null: nothing). */
  added?: string | null;
  /** Claude's structure for the prompt, if there was one that matched when this Run was made. */
  structure?: { schema: Schema } | null;
  /** The chart attached to the message, if any. */
  image?: { source: "sample"; file: string } | { source: "upload" } | null;
}

async function call<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, body === undefined ? undefined : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? res.statusText);
  return json as T;
}

const OWN = "";
const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? "⌘" : "Ctrl";

/** Everything typed for one task — autosaved to the server (data/playground.db) so a refresh loses nothing. */
interface Draft {
  prompt: string;
  rubric: string;
  sampleId: string;
  question: string;
  essay: string;
  upload?: string;
}

export function App() {
  return (
    <ToastProvider>
      <Playground />
    </ToastProvider>
  );
}

function Playground() {
  const toast = useToast();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [taskId, setTaskId] = useState<string>();
  const task = tasks.find((t) => t.id === taskId);
  /** True once the current task's draft has loaded — nothing is autosaved before that. */
  const [ready, setReady] = useState(false);

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
  const [panel, setPanel] = useState<"history" | "claude" | null>(null);
  const [saving, setSaving] = useState(false);

  // output
  const [result, setResult] = useState<Result>();
  const [running, setRunning] = useState(false);
  const [view, setView] = useState<"output" | "sent">("output");

  const [muted, setMutedState] = useState(isMuted);
  const dirty = prompt !== saved.prompt || rubric !== saved.rubric;
  /** The teacher's Claude Code session: is it listening, the structure it keeps, and what it was asked. */
  const [claude, setClaude] = useState<ClaudeState>({ listening: false, structure: null, requests: [] });
  const [ask, setAsk] = useState("");
  const [dragging, setDragging] = useState(false);

  const fail = useCallback((e: unknown) => toast({ tone: "error", title: "Something went wrong", body: (e as Error).message }), [toast]);

  // Open on the task that was open last time.
  useEffect(() => {
    Promise.all([call<Task[]>("/tasks"), call<{ task: string | null }>("/state")])
      .then(([list, state]) => {
        setTasks(list);
        setTaskId(list.some((t) => t.id === state.task) ? state.task! : (list.find((t) => t.id === "task2") ?? list[0])?.id);
      })
      .catch(fail);
  }, []);

  // Load a task: its saved files, its samples, and — if there is one — the unsaved draft and last run.
  useEffect(() => {
    if (!taskId) return;
    let cancelled = false;
    setReady(false);
    setPanel(null);
    void call("/state", { task: taskId });
    Promise.all([
      call<{ prompt: string; rubric: string }>(`/task?task=${taskId}`),
      call<Sample[]>(`/samples?task=${taskId}`),
      call<Draft | null>(`/draft?task=${taskId}`),
      call<Result | null>(`/last-run?task=${taskId}`),
      call<ClaudeState>(`/claude?task=${taskId}`),
    ])
      .then(([files, list, draft, last, shape]) => {
        if (cancelled) return;
        setClaude({ ...shape, task: taskId });
        seen.current = new Map(shape.requests.map((r) => [r.id, r.status]));
        setSaved(files);
        setSamples(list);
        setPrompt(draft?.prompt ?? files.prompt);
        setRubric(draft?.rubric ?? files.rubric);
        if (draft) {
          setSampleId(draft.sampleId);
          setQuestion(draft.question);
          setEssay(draft.essay);
          setUpload(draft.upload);
        } else pick(list[0]);
        setResult(last ?? undefined);
        setReady(true);
      })
      .catch((e) => !cancelled && fail(e));
    loadHistory();
    return () => {
      cancelled = true;
    };
  }, [taskId]);

  // Autosave half a second after typing stops, and immediately when the page is closed or refreshed.
  const latest = useRef<{ task: string; draft: Draft } | undefined>(undefined);
  useEffect(() => {
    if (!ready || !taskId) return;
    const draft = { prompt, rubric, sampleId, question, essay, upload };
    latest.current = { task: taskId, draft };
    const timer = setTimeout(() => {
      void call("/draft", latest.current);
      latest.current = undefined;
    }, 500);
    return () => clearTimeout(timer);
  }, [ready, taskId, prompt, rubric, sampleId, question, essay, upload]);
  useEffect(() => {
    const flush = () => {
      if (latest.current) navigator.sendBeacon("/api/draft", new Blob([JSON.stringify(latest.current)], { type: "application/json" }));
    };
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, []);

  function loadHistory() {
    if (taskId) call<Version[]>(`/history?task=${taskId}`).then(setVersions).catch(() => setVersions([]));
  }

  function pick(s: Sample | undefined) {
    setSampleId(s?.id ?? OWN);
    setQuestion(s?.question ?? "");
    setEssay(s?.essay ?? "");
    setUpload(undefined);
  }

  function switchTask(id: string) {
    if (id === taskId) return;
    // Flush the current task's draft first, so nothing typed in the last half-second is lost.
    if (latest.current) void call("/draft", latest.current);
    latest.current = undefined;
    play("tap");
    setTaskId(id);
  }

  async function save() {
    setSaving(true);
    try {
      const r = await call<{ versioned: boolean; unchanged?: boolean }>("/save", { task: taskId, prompt, rubric, note });
      setSaved({ prompt, rubric });
      setNote("");
      setSaveOpen(false);
      if (r.unchanged) toast({ tone: "info", title: "Nothing changed", body: "This is already the saved version." });
      else
        toast({
          tone: "success",
          title: r.versioned ? "Saved as a new version" : "Saved",
          body: claude.listening ? "Claude is checking the prompt and updating the feedback page." : "Claude will check it when it's listening.",
        });
      loadHistory();
      loadClaude();
    } catch (e) {
      fail(e);
    } finally {
      setSaving(false);
    }
  }
  const [saveOpen, setSaveOpen] = useState(false);

  function loadClaude() {
    const id = taskId;
    if (id) call<ClaudeState>(`/claude?task=${id}`).then((c) => setClaude({ ...c, task: id })).catch(() => {});
  }

  // When Claude saves a prompt change the teacher asked for, show it — unless there are unsaved edits here.
  useEffect(() => {
    const next = claude.savedPrompt;
    if (!ready || claude.task !== taskId || next === undefined || next === saved.prompt) return;
    if (next === prompt) setSaved((s) => ({ ...s, prompt: next })); // our own Save, seen a moment early
    else if (prompt === saved.prompt) {
      setPrompt(next);
      setSaved((s) => ({ ...s, prompt: next }));
      toast({ tone: "claude", title: "Claude updated your prompt", body: "It's in History if you want the old one back." });
      loadHistory();
    } else toast({ tone: "info", title: "Claude saved a new prompt", body: "You have unsaved edits here. Save yours to keep them, or open the latest from History." });
  }, [claude.savedPrompt]);

  // Tell the teacher when Claude finishes something they asked for.
  const seen = useRef(new Map<number, ClaudeRequest["status"]>());
  useEffect(() => {
    if (claude.task !== taskId) return;
    for (const r of claude.requests) {
      const before = seen.current.get(r.id);
      if (before && before !== r.status && (r.status === "done" || r.status === "failed"))
        toast({
          tone: r.status === "done" ? "claude" : "error",
          title: r.status === "done" ? (r.kind === "prompt" ? "Claude checked your prompt" : r.kind === "mismatch" ? "Claude fixed the structure" : "Claude made your change") : "Claude couldn't do that",
          body: r.reply,
        });
      seen.current.set(r.id, r.status);
    }
  }, [claude]);

  async function askClaude() {
    if (!ask.trim() && !attached.length) return;
    const text = ask;
    const images = attached;
    try {
      setAsk("");
      setAttached([]);
      await call("/ask", { task: taskId, text, images: images.map(({ type, data }) => ({ type, data })) });
      play("tap");
      loadClaude();
    } catch (e) {
      setAsk(text);
      setAttached(images);
      fail(e);
    }
  }

  // Images for Ask Claude: up to 4, from the 📎 button, pasting or dropping.
  const [attached, setAttached] = useState<Attachment[]>([]);
  async function attach(files: Iterable<File>) {
    const images = [...files].filter((f) => /^image\/(png|jpeg|webp|gif)$/.test(f.type));
    if (!images.length) return toast({ tone: "info", title: "Only images can be attached", body: "PNG, JPEG, WebP or GIF." });
    const room = 4 - attached.length;
    if (images.length > room) toast({ tone: "info", title: "Up to 4 images", body: room ? `Added the first ${room}.` : "Remove one to add another." });
    const tooBig = images.filter((f) => f.size > 6_000_000);
    if (tooBig.length) toast({ tone: "error", title: "Image too large", body: `${tooBig.map((f) => f.name).join(", ")} is over 6 MB.` });
    const read = await Promise.all(
      images
        .filter((f) => f.size <= 6_000_000)
        .slice(0, room)
        .map(
          (f) =>
            new Promise<Attachment>((ok) => {
              const r = new FileReader();
              r.onload = () => ok({ type: f.type, data: String(r.result).split(",")[1], url: String(r.result), name: f.name || "pasted image" });
              r.readAsDataURL(f);
            }),
        ),
    );
    if (read.length) {
      play("tap");
      setAttached((a) => [...a, ...read].slice(0, 4));
    }
  }

  // Keep an eye on Claude: whether it's listening and how its requests are going.
  useEffect(() => {
    const timer = setInterval(loadClaude, 3000);
    return () => clearInterval(timer);
  }, [taskId]);

  async function openVersion(v: Version) {
    try {
      const t = await call<{ prompt: string; rubric: string }>(`/version?task=${taskId}&commit=${v.commit}`);
      setPrompt(t.prompt);
      setRubric(t.rubric);
      setPanel(null);
      toast({ tone: "info", title: `Opened “${v.note}”`, body: "Save to make it the current version." });
    } catch (e) {
      fail(e);
    }
  }

  async function run() {
    if (running || !essay.trim()) return;
    if (claudeBusy) {
      toast({ tone: "info", title: "Claude is still working", body: "Run is paused until Claude finishes, so it uses the updated structure." });
      return;
    }
    setRunning(true);
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
      if (r.ok && r.problems?.length)
        toast({ tone: "error", title: "The answer didn't match Claude's structure", body: `${r.problems[0]} ${claude.listening ? "Claude has been asked to fix it." : "Claude will fix it when it's listening."}` });
      else if (r.ok) toast({ tone: "success", title: "Marked", body: `${r.model} answered in ${r.seconds.toFixed(1)}s.` });
      else toast({ tone: "error", title: "The AI didn't answer", body: r.error });
    } catch (e) {
      fail(e);
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

  // Keyboard: ⌘↵ runs, ⌘S saves.
  const keys = useRef({ run, open: () => dirty && setSaveOpen(true) });
  keys.current = { run, open: () => (dirty ? setSaveOpen(true) : toast({ tone: "info", title: "Already saved" })) };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key === "Enter") {
        e.preventDefault();
        void keys.current.run();
      } else if (e.key.toLowerCase() === "s") {
        e.preventDefault();
        keys.current.open();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function toggleSound() {
    setMuted(!muted);
    setMutedState(!muted);
    if (muted) setTimeout(() => play("tap"), 0);
  }

  const sample = samples.find((s) => s.id === sampleId);
  const imageSrc = upload ? `data:image/*;base64,${upload}` : sample?.image ? `/api/sample-image?task=${taskId}&file=${sample.image}` : undefined;
  const words = essay.trim() ? essay.trim().split(/\s+/).length : 0;
  const minWords = taskId?.startsWith("task1") ? 150 : 250;
  const active = claude.requests.filter((r) => !["done", "failed"].includes(r.status)).length;
  /** Claude is changing the structure or page right now, so a Run would use a half-finished version. */
  const claudeBusy = isClaudeBusy(claude);
  const slotWarning =
    unknownSlots(prompt).length > 0
      ? `${unknownSlots(prompt).join(", ")} isn't recognised and will be sent as plain text. Use {{RUBRIC}} for the rubric.`
      : rubric.trim() && !hasRubricSlot(prompt)
        ? "The prompt doesn't contain {{RUBRIC}}, so the rubric isn't sent."
        : undefined;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden="true">
            <Icon name="doc" size={16} />
          </span>
          <span>IELTS Playground</span>
        </div>
        <nav className="segmented" aria-label="Task">
          {tasks.map((t) => (
            <button key={t.id} className={t.id === taskId ? "on" : ""} onClick={() => switchTask(t.id)}>
              {t.label}
            </button>
          ))}
        </nav>
        <div className="top-actions">
          <button className="icon-btn" onClick={toggleSound} aria-label={muted ? "Turn sound on" : "Turn sound off"} title={muted ? "Sound off" : "Sound on"}>
            <Icon name={muted ? "mute" : "sound"} />
          </button>
          <a className="btn ghost hide-sm" href="/feedback" target="_blank" rel="noreferrer">
            Feedback page <Icon name="external" size={15} />
          </a>
          <button
            className={`ask-btn ${active ? "busy" : ""}`}
            onClick={() => setPanel("claude")}
            title={claude.listening ? "Claude is listening in the terminal" : "Claude isn't listening. Tell it “start listening” in the terminal."}
          >
            <Icon name="sparkle" size={16} />
            <span className="ask-label">Ask Claude</span>
            {active > 0 ? <span className="badge-count">{active}</span> : <span className={`status-dot ${claude.listening ? "on" : ""}`} aria-label={claude.listening ? "listening" : "not listening"} />}
          </button>
        </div>
      </header>

      <main className="workspace">
        {/* ---------- essay ---------- */}
        <section className="panel">
          <div className="panel-head">
            <h2>Essay</h2>
            <div className="select-wrap">
              <select value={sampleId} onChange={(e) => pick(samples.find((s) => s.id === e.target.value))} aria-label="Sample essay">
                {samples.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title}
                  </option>
                ))}
                <option value={OWN}>Paste my own…</option>
              </select>
              <Icon name="chevron" size={16} />
            </div>
          </div>
          <div className="panel-body">
            <div className="field-block">
              <label htmlFor="question">Question</label>
              <textarea id="question" className="soft question" rows={5} value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Paste the task question…" />
            </div>
            {task?.image && (
              <div className="field-block">
                <label>Chart</label>
                {imageSrc ? <img className="chart" src={imageSrc} alt="Chart for this task" /> : <div className="empty-mini">No chart yet</div>}
                <label className="btn ghost small upload">
                  <Icon name="upload" size={15} /> {imageSrc ? "Replace chart" : "Upload chart"}
                  <input type="file" accept="image/*" hidden onChange={(e) => void chooseImage(e.target.files?.[0])} />
                </label>
              </div>
            )}
            <div className="field-block grow">
              <div className="label-row">
                <label htmlFor="essay">Response</label>
                <span className={`count ${words === 0 ? "" : words < minWords ? "warn" : "ok"}`} title={`IELTS asks for at least ${minWords} words`}>
                  {words} / {minWords} words
                </span>
              </div>
              <textarea id="essay" className="soft essay" value={essay} onChange={(e) => setEssay(e.target.value)} placeholder="Paste the student's response…" />
            </div>
          </div>
          <div className="panel-foot">
            <button
              className="btn primary wide"
              disabled={running || claudeBusy || !essay.trim()}
              onClick={() => void run()}
              title={claudeBusy ? "Claude is updating the structure or feedback page. Run unlocks when it's done." : undefined}
            >
              {running || claudeBusy ? <span className="spinner" /> : <Icon name="play" />}
              {running ? "Marking…" : claudeBusy ? "Waiting for Claude…" : "Run"}
              {!running && !claudeBusy && <kbd>{MOD} ↵</kbd>}
            </button>
          </div>
        </section>

        {/* ---------- instructions ---------- */}
        <section className="panel">
          <div className="panel-head">
            <h2>Instructions</h2>
            <div className="tabs" role="tablist">
              <button role="tab" aria-selected={editing === "prompt"} className={editing === "prompt" ? "on" : ""} onClick={() => setEditing("prompt")}>
                Prompt
              </button>
              <button role="tab" aria-selected={editing === "rubric"} className={editing === "rubric" ? "on" : ""} onClick={() => setEditing("rubric")}>
                Rubric
              </button>
            </div>
          </div>
          <div className="panel-body">
            <div className="editor">
              <textarea
                className="code"
                spellCheck={editing === "prompt"}
                value={editing === "prompt" ? prompt : rubric}
                placeholder={editing === "prompt" ? "Tell the AI how to mark. Write {{RUBRIC}} where the rubric should go." : "Paste the band descriptors…"}
                onChange={(e) => (editing === "prompt" ? setPrompt(e.target.value) : setRubric(e.target.value))}
              />
              <div className="editor-foot">
                <span className="muted small">
                  {editing === "prompt" ? "Run uses what's here, even before you save." : "Inserted wherever the prompt says {{RUBRIC}}."}
                </span>
                <span className="muted small">{(editing === "prompt" ? prompt : rubric).length} chars</span>
              </div>
            </div>
            {slotWarning && (
              <div className="callout warn">
                <Icon name="alert" size={16} />
                <span>{slotWarning}</span>
              </div>
            )}
          </div>
          <div className="panel-foot split">
            <SyncChip claude={claude} prompt={prompt} saved={saved.prompt} dirty={dirty} onOpen={() => setPanel("claude")} />
            <div className="foot-actions">
              <button className="btn ghost" onClick={() => setPanel("history")}>
                <Icon name="history" size={16} /> History
                {versions.length > 0 && <span className="badge-count">{versions.length}</span>}
              </button>
              <button className="btn primary" disabled={!dirty} onClick={() => setSaveOpen(true)} title={`Save (${MOD} S)`}>
                <Icon name={dirty ? "save" : "check"} size={16} /> {dirty ? "Save" : "Saved"}
              </button>
            </div>
          </div>
        </section>

        {/* ---------- output ---------- */}
        <section className="panel">
          <div className="panel-head">
            <h2>Result</h2>
            <div className="tabs" role="tablist">
              <button role="tab" aria-selected={view === "output"} className={view === "output" ? "on" : ""} onClick={() => setView("output")}>
                Answer
              </button>
              <button role="tab" aria-selected={view === "sent"} className={view === "sent" ? "on" : ""} onClick={() => setView("sent")}>
                Sent to AI
              </button>
            </div>
          </div>
          <div className="panel-body">
            {result && !running && (
              <div className="meta">
                <span className={`chip ${result.ok ? "good" : "bad"}`}>
                  <Icon name={result.ok ? "check" : "alert"} size={14} /> {result.ok ? "Answered" : "Failed"}
                </span>
                {result.model && <span className="chip">{result.model}</span>}
                <span className="chip">{result.seconds.toFixed(1)}s</span>
                {result.createdAt && <span className="chip">{ago(result.createdAt)}</span>}
              </div>
            )}
            {running ? (
              <div className="skeleton" aria-label="Marking">
                <span style={{ width: "40%" }} />
                <span style={{ width: "92%" }} />
                <span style={{ width: "86%" }} />
                <span style={{ width: "64%" }} />
                <span style={{ width: "90%" }} />
                <span style={{ width: "52%" }} />
                <p className="muted small">The AI is reading the essay…</p>
              </div>
            ) : !result ? (
              <div className="empty">
                <div className="empty-art">
                  <Icon name="wand" size={26} />
                </div>
                <h3>No marking yet</h3>
                <p>Pick an essay, write your prompt, then press Run.</p>
                <kbd>{MOD} ↵</kbd>
              </div>
            ) : view === "output" ? (
              result.ok ? (
                <>
                  {result.problems && result.problems.length > 0 && <MismatchCallout problems={result.problems} listening={claude.listening} />}
                  <Code text={pretty(result.output ?? "")} />
                </>
              ) : (
                <div className="callout bad">
                  <Icon name="alert" size={16} />
                  <span>{result.error}</span>
                </div>
              )
            ) : (
              <div className="sent">
                <div className="sent-block">
                  <span className="overline">Your prompt · system</span>
                  <Code text={result.system || "(empty)"} />
                </div>
                <div className="sent-block">
                  <span className="overline">Message · user</span>
                  <Code text={result.user} />
                  {result.image && (
                    <div className="attachment">
                      {result.image.source === "sample" ? (
                        <img src={`/api/sample-image?task=${taskId}&file=${result.image.file}`} alt="Chart sent with the message" />
                      ) : upload ? (
                        <img src={`data:image/*;base64,${upload}`} alt="Chart sent with the message" />
                      ) : (
                        <span className="attachment-missing">
                          <Icon name="image" size={20} />
                        </span>
                      )}
                      <span>
                        <strong>Chart attached</strong>
                        <span className="muted small">{result.image.source === "sample" ? `From the sample (${result.image.file})` : upload ? "The chart you uploaded" : "An uploaded chart (not kept after the Run)"}</span>
                      </span>
                    </div>
                  )}
                </div>
                <FormatBlock format={result.format} structure={result.structure} added={result.added} />
              </div>
            )}
          </div>
          {result?.ok && !running && (
            <div className="panel-foot">
              <a className="btn secondary wide" href="/feedback" target="_blank" rel="noreferrer">
                <Icon name="sparkle" size={16} /> Open feedback page <Icon name="external" size={15} />
              </a>
            </div>
          )}
        </section>
      </main>


      <Dialog open={saveOpen} onClose={() => setSaveOpen(false)} title="Save a new version">
        <form
          className="dialog-body"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <label htmlFor="note">What did you change?</label>
          <input id="note" autoFocus value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. ask for one tip per criterion" />
          <p className="muted small">It appears in History, so you can go back to any version.{claude.listening && " Claude will check the new prompt and update the feedback page."}</p>
          <div className="dialog-actions">
            <button type="button" className="btn ghost" onClick={() => setSaveOpen(false)}>
              Cancel
            </button>
            <button type="submit" className="btn primary" disabled={saving}>
              {saving ? <span className="spinner" /> : <Icon name="save" size={16} />} Save version
            </button>
          </div>
        </form>
      </Dialog>

      <Drawer open={panel === "history"} onClose={() => setPanel(null)} title="History" subtitle={`${versions.length} saved version${versions.length === 1 ? "" : "s"} of ${task?.label ?? "this task"}`}>
        <div className="drawer-body">
          {versions.length === 0 ? (
            <div className="empty small">
              <Icon name="history" size={22} />
              <p>No saved versions yet. Press Save to keep one.</p>
            </div>
          ) : (
            <ol className="timeline">
              {versions.map((v, i) => (
                <li key={v.commit}>
                  <button onClick={() => void openVersion(v)}>
                    <span className="t-note">
                      {v.note}
                      {i === 0 && <span className="chip good tiny">Current</span>}
                    </span>
                    <time className="muted small">{ago(v.date)}</time>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </div>
      </Drawer>

      <Drawer
        open={panel === "claude"}
        onClose={() => setPanel(null)}
        title={
          <span className="claude-title">
            <Icon name="sparkle" size={16} /> Ask Claude
          </span>
        }
        subtitle={
          <span className={`listen-line ${claude.listening ? "on" : ""}`}>
            <span className="dot" /> {claude.listening ? "Listening in the terminal" : "Not listening — tell Claude “start listening” in the terminal"}
          </span>
        }
      >
        <ClaudeThread requests={claude.requests} />
        <form
          className={`composer ${dragging ? "dragging" : ""}`}
          onSubmit={(e) => {
            e.preventDefault();
            void askClaude();
          }}
          onDragOver={(e) => {
            if ([...e.dataTransfer.types].includes("Files")) {
              e.preventDefault();
              setDragging(true);
            }
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            void attach(e.dataTransfer.files);
          }}
        >
          {attached.length > 0 && (
            <div className="thumbs">
              {attached.map((a, i) => (
                <div className="thumb" key={i} title={a.name}>
                  <img src={a.url} alt={a.name} />
                  <button type="button" aria-label={`Remove ${a.name}`} onClick={() => setAttached((list) => list.filter((_, j) => j !== i))}>
                    <Icon name="close" size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <textarea
            rows={3}
            value={ask}
            onPaste={(e) => {
              const files = [...e.clipboardData.files];
              if (files.some((f) => f.type.startsWith("image/"))) {
                e.preventDefault();
                void attach(files);
              }
            }}
            onChange={(e) => setAsk(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void askClaude();
              }
            }}
            placeholder="Ask for any change to the feedback page — “add a chart of the bands”. Claude only edits your prompt if you ask."
          />
          <div className="composer-foot">
            <label className={`icon-btn ${attached.length >= 4 ? "disabled" : ""}`} title="Attach images (up to 4) — or paste / drop them">
              <Icon name="clip" size={17} />
              <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden disabled={attached.length >= 4} onChange={(e) => { void attach(e.target.files ?? []); e.target.value = ""; }} />
            </label>
            <span className="muted small grow">{dragging ? "Drop images to attach" : "↵ to send · ⇧↵ new line · paste or drop images"}</span>
            <button className="btn primary small" type="submit" disabled={!ask.trim() && !attached.length}>
              <Icon name="send" size={15} /> Send
            </button>
          </div>
        </form>
      </Drawer>
    </div>
  );
}

type Schema = { type?: string; title?: string; properties?: Record<string, Schema>; items?: Schema; required?: string[] };

/**
 * Claude's structure for this Run: what was added after the teacher's prompt so the AI answers in that
 * shape (the instruction, plus the same shape as Ollama's format setting). Older Runs recorded less.
 */
function FormatBlock({ format, structure, added }: { format: Schema | null | undefined; structure: Result["structure"]; added: string | null | undefined }) {
  const schema = format ?? structure?.schema;
  return (
    <div className="sent-block">
      <span className="overline">Added by Claude · answer format</span>
      {!schema ? (
        <p className="muted small format-none">
          Nothing was added: Claude hadn't made a structure for this prompt yet, so the AI got your prompt on its own. Save the prompt, let Claude update it, then Run again.
        </p>
      ) : (
        <>
          {added ? (
            <Code text={added} />
          ) : (
            <p className="muted small format-none">This Run is from before Claude's instruction was added; only the shape below may have been sent.</p>
          )}
          <details className="format">
            <summary>
              <Icon name="chevron" size={16} />
              <span>{describe(schema)}</span>
              {format && <span className="chip tiny good">Ollama format setting</span>}
            </summary>
            <Code text={JSON.stringify(schema, null, 2)} />
          </details>
          <p className="muted small">
            Sent after your prompt, never inside it. Claude writes it from what your prompt asks for, so the answer comes back in parts the feedback page can show. If the AI ignores it, the page still picks the parts out of the text.
          </p>
        </>
      )}
    </div>
  );
}

/** "4 sections × band, mistakes, improvements" — a schema in a few words. */
function describe(schema: Schema): string {
  const name = (key: string, s: Schema) => (s.title ?? key.replace(/_/g, " ")).toLowerCase();
  const entries = Object.entries(schema.properties ?? {});
  if (!entries.length) return schema.type === "array" ? "A list" : "A single value";
  const inner = entries.map(([, s]) => Object.entries(s.properties ?? {}).map(([k, v]) => name(k, v)).join(", "));
  if (entries.length > 1 && inner[0] && inner.every((x) => x === inner[0])) return `${entries.length} sections × ${inner[0]}`;
  return entries.map(([k, s], i) => (inner[i] ? `${name(k, s)} (${inner[i]})` : name(k, s))).join(" · ");
}

/** Loud on purpose: the answer didn't fit the structure, so the feedback page can't show it properly. */
function MismatchCallout({ problems, listening }: { problems: string[]; listening: boolean }) {
  return (
    <div className="callout bad loud" role="alert">
      <Icon name="alert" size={18} />
      <div>
        <strong>The answer didn't match Claude's structure</strong>
        <ul>
          {problems.map((p, i) => (
            <li key={i}>{p}</li>
          ))}
        </ul>
        <span className="small">
          {listening ? "Claude has been asked to fix the structure (your prompt stays as it is). Run again once it's done." : "Claude will be asked to fix it as soon as it's listening. Tell it “start listening” in the terminal."}
        </span>
      </div>
    </div>
  );
}

function Code({ text }: { text: string }) {
  const toast = useToast();
  return (
    <div className="code-view">
      <button
        className="icon-btn copy"
        aria-label="Copy"
        title="Copy"
        onClick={() =>
          navigator.clipboard.writeText(text).then(
            () => toast({ tone: "info", title: "Copied" }),
            () => toast({ tone: "error", title: "Couldn't copy" }),
          )
        }
      >
        <Icon name="copy" size={15} />
      </button>
      <pre>{text}</pre>
    </div>
  );
}

interface ClaudeRequest {
  id: number;
  createdAt: string;
  kind: "prompt" | "change" | "mismatch";
  text: string;
  status: "saving" | "new" | "seen" | "working" | "done" | "failed";
  attachments?: string[];
  reply?: string;
  flags?: string[];
}
interface Attachment {
  type: string;
  data: string;
  url: string;
  name: string;
}
interface ClaudeState {
  task?: string;
  /** prompt.md as saved on disk (changes when Claude saves a prompt change the teacher asked for). */
  savedPrompt?: string;
  listening: boolean;
  structure: { builtFor: string } | null;
  requests: ClaudeRequest[];
}

/** Busy = Claude has picked up a request and hasn't finished. A request still waiting for Claude to listen doesn't count. */
function isClaudeBusy(c: ClaudeState): boolean {
  return c.requests.some((r) => r.status === "seen" || r.status === "working" || (r.status === "new" && c.listening));
}

const same = (a?: string, b?: string) => a !== undefined && b !== undefined && a.trim() === b.trim();

/** Does the feedback page follow this prompt yet? One chip next to Save. */
function SyncChip({ claude, prompt, saved, dirty, onOpen }: { claude: ClaudeState; prompt: string; saved: string; dirty: boolean; onOpen: () => void }) {
  if (dirty || !same(prompt, saved))
    return (
      <span className="chip warn" title="Runs use this text now. Save so Claude can update the feedback page to match.">
        <span className="dot" /> Unsaved changes
      </span>
    );
  if (claude.structure && same(claude.structure.builtFor, prompt))
    return (
      <span className="chip good" title="The feedback page is built for this prompt.">
        <Icon name="check" size={14} /> Feedback page in sync
      </span>
    );
  const pending = claude.requests.some((r) => r.kind === "prompt" && same(r.text, prompt) && !["done", "failed"].includes(r.status));
  return (
    <button className={`chip ${pending ? "pending" : ""}`} onClick={onOpen} title="Open Ask Claude">
      <span className="dot" /> {pending ? "Claude is updating the page…" : "Feedback page out of date"}
    </button>
  );
}

const STATUS: Record<ClaudeRequest["status"], string> = {
  saving: "Sending…",
  new: "Waiting",
  seen: "Received",
  working: "Working…",
  done: "Done",
  failed: "Couldn't do it",
};

/** The conversation with Claude, oldest first, like a chat. */
function ClaudeThread({ requests }: { requests: ClaudeRequest[] }) {
  const end = useRef<HTMLDivElement>(null);
  const last = requests[0];
  useEffect(() => {
    // Braces matter: newer browsers return a promise from scrollIntoView, and React treats a returned value as clean-up.
    end.current?.scrollIntoView({ block: "end" });
  }, [requests.length, last?.status]);
  if (requests.length === 0)
    return (
      <div className="drawer-body">
        <div className="empty small">
          <Icon name="sparkle" size={22} />
          <p>Ask for anything on the feedback page: a chart, a friendlier tone, a new layout. When you save a new prompt, Claude checks it here too.</p>
        </div>
      </div>
    );
  return (
    <div className="drawer-body thread">
      {[...requests].reverse().map((r) => (
        <div key={r.id} className="exchange">
          <div className="bubble me">
            {r.kind === "prompt" ? (
              <>
                <span className="overline">Saved a new prompt</span>
                <p className="clamp">{r.text}</p>
              </>
            ) : r.kind === "mismatch" ? (
              <>
                <span className="overline">Sent automatically</span>
                <p>The AI's answer didn't match the structure. {r.text.split("\n").filter((l) => l.startsWith("- ")).map((l) => l.slice(2)).join(" ")}</p>
              </>
            ) : (
              <>
                {r.attachments && r.attachments.length > 0 && (
                  <div className="bubble-images">
                    {r.attachments.map((f) => (
                      <a key={f} href={`/api/attachment?file=${f}`} target="_blank" rel="noreferrer">
                        <img src={`/api/attachment?file=${f}`} alt="Attached image" />
                      </a>
                    ))}
                  </div>
                )}
                {r.text !== "(see the attached image)" && <p>{r.text}</p>}
              </>
            )}
            <time>{ago(r.createdAt)}</time>
          </div>
          <div className={`bubble claude ${r.status}`}>
            <span className="who">
              <Icon name="sparkle" size={13} /> Claude <span className={`status ${r.status}`}>{STATUS[r.status]}</span>
            </span>
            {r.reply ? <p>{r.reply}</p> : r.status === "failed" ? <p>Something went wrong.</p> : <span className="typing"><i /><i /><i /></span>}
            {r.flags && r.flags.length > 0 && (
              <ul className="flags">
                {r.flags.map((f, i) => (
                  <li key={i}>
                    <Icon name="flag" size={13} /> {f}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ))}
      <div ref={end} />
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
