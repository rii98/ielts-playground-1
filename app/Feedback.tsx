import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { play } from "./ui.tsx";
import { Report, type ReportSpec } from "./Report.tsx";

// The /feedback page: the latest Run for the open task, drawn from the task's structure.json.
// Claude (listening in the terminal) keeps the structure in step with the teacher's prompt, and
// changes this page — the layout options below, or the code itself — when the teacher asks.
// It refreshes every few seconds, so new Runs and changes show without reloading.

type Kind = "circle" | "badge" | "bar" | "text" | "bullets" | "quote" | "table" | "markdown" | "cards";
interface PageSpec {
  title: string;
  intro?: string;
  /**
   * The big summary number. `field`: a top-level number in the answer (e.g. the AI's own overall band).
   * `average`: a number field averaged across the sections. With both, the average is shown as a check.
   */
  overall?: { label: string; field?: string; average?: string; rounding?: "ielts" | "none"; ring?: boolean };
  /** A bar chart comparing one number field across the sections, under the overall band. */
  chart?: { title?: string; field: string; max?: number };
  layout?: "list" | "grid";
  /** kind "cards": the section's value is a list, and each item gets its own card (title + text from these fields). */
  sections: { key: string; title: string; kind?: Kind; itemTitle?: string; itemText?: string }[];
  fields: { key: string; kind: Kind; label?: string }[];
  theme?: Partial<Record<"accent" | "accentText" | "background" | "card" | "text" | "muted" | "line", string>> & { radius?: number; font?: string };
  css?: string;
  /** "report": draw the page with the report layout (app/Report.tsx), configured by `report`. */
  template?: "report";
  report?: ReportSpec;
  /** Show the student's essay beside the feedback, with phrases the feedback quotes highlighted. */
  essay?: {
    title?: string;
    /** Highlight multi-word phrases the feedback quotes. */
    highlightQuotes?: boolean;
    /** Underline mistakes from a list in the answer; hovering one shows what's wrong and the improvement. */
    annotations?: { field: string; quote: string; mistake: string; improvement: string; criterion?: string };
  };
  /** A character at the top who "says" one line at a time; clicking it moves to the next line. */
  mascot?: { emoji: string; name?: string; lines: string[] };
  /** A decorative meter under the header, e.g. { label: "Sarcasm level", caption: "Dangerously high" }. */
  meter?: { label: string; caption?: string; percent?: number };
  /** Reveal the answer piece by piece, and highlight quoted words, when the page opens. */
  animate?: boolean;
}
interface Structure {
  builtFor: string;
  schema: any;
  page: PageSpec;
}
interface Run {
  ok: boolean;
  output?: string;
  error?: string;
  createdAt?: string;
  /** What was marked: the question and the student's essay. */
  input?: { question?: string; essay?: string };
}

export function FeedbackPage() {
  const [data, setData] = useState<{ run: Run | null; structure: Structure | null; structured?: Record<string, unknown>; problems?: string[] }>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    const load = () =>
      fetch("/api/state")
        .then((r) => r.json())
        .then((s: { task: string | null }) => fetch(`/api/feedback?task=${s.task ?? "task2"}`))
        .then((r) => r.json())
        .then((d) => {
          if (d.error) throw new Error(d.error);
          setData(d);
          setError(undefined);
        })
        .catch((e) => setError(e.message));
    load();
    const timer = setInterval(load, 3000);
    return () => clearInterval(timer);
  }, []);

  const run = data?.run;
  const structure = data?.structure ?? undefined;
  const page = structure && upgrade(structure.page);
  const showEssay = !!(page?.essay && run?.ok && run.input?.essay?.trim());
  const theme = { ...DEFAULT_THEME, ...page?.theme };
  const style = {
    "--fb-accent": theme.accent,
    "--fb-accent-text": theme.accentText,
    "--fb-bg": theme.background,
    "--fb-card": theme.card,
    "--fb-text": theme.text,
    "--fb-muted": theme.muted,
    "--fb-line": theme.line,
    "--fb-radius": `${theme.radius}px`,
    "--fb-font": FONTS[theme.font ?? "system"] ?? FONTS.system,
  } as CSSProperties;

  if (page?.template === "report" && page.report && run?.ok && data?.structured && run.input?.essay)
    return (
      <div className="feedback-page report-page">
        {page.css && <style>{page.css.replace(/<\/?style/gi, "").replace(/@import[^;]*;?/gi, "")}</style>}
        <Report spec={page.report} data={data.structured as Record<string, any>} question={run.input.question} essay={run.input.essay} createdAt={run.createdAt} />
      </div>
    );

  return (
    <div className={`feedback-page ${page?.animate ? "animate" : ""}`} style={page ? style : undefined}>
      {page?.css && <style>{page.css.replace(/<\/?style/gi, "").replace(/@import[^;]*;?/gi, "")}</style>}
      <div className={`feedback-inner ${showEssay ? "with-essay" : ""}`}>
        <header>
          <a href="/">← Back to playground</a>
          {page?.mascot ? (
            <Mascot mascot={page.mascot} title={page.title} intro={page.intro} />
          ) : (
            <>
              <h1>{page?.title ?? "Feedback"}</h1>
              {page?.intro && <p className="intro">{page.intro}</p>}
            </>
          )}
          {run?.createdAt && <p className="hint">Marked {new Date(run.createdAt).toLocaleString()}</p>}
          {page?.meter && run?.ok && <Meter meter={page.meter} />}
        </header>
        <div className="fb-body">
        {showEssay && (
          <EssayPanel
            title={page!.essay!.title ?? "Student's essay"}
            question={run!.input!.question}
            essay={run!.input!.essay!}
            quotes={page!.essay!.highlightQuotes && data?.structured ? quotesIn(data.structured, page!, run!.input!.essay!) : new Map()}
            notes={page!.essay!.annotations && data?.structured ? readNotes(data.structured, page!.essay!.annotations) : []}
          />
        )}
        <div className="fb-main">
        {error && <p className="error">{error}</p>}
        {data && run === null && <p className="hint">No run yet. Press Run in the playground first.</p>}
        {run && !run.ok && <p className="error">{run.error}</p>}
        {run?.ok &&
          (page && data?.structured ? (
            <Structured page={page} schema={structure!.schema} data={data.structured} />
          ) : (
            <>
              {page ? (
                <div className="mismatch" role="alert">
                  <strong>⚠ The AI's answer didn't match Claude's structure, so this page can't show it properly.</strong>
                  {data?.problems && data.problems.length > 0 && (
                    <ul>
                      {data.problems.map((p, i) => (
                        <li key={i}>{p}</li>
                      ))}
                    </ul>
                  )}
                  <span>Claude has been asked to fix the structure. Your prompt stays as it is. Run again once it's done. The raw answer is below.</span>
                </div>
              ) : (
                <p className="hint">Claude hasn't set up the feedback page for this prompt yet. Save the prompt and wait for Claude, then Run again. The raw answer is below.</p>
              )}
              <pre>{run.output}</pre>
            </>
          ))}
        </div>
        </div>
      </div>
    </div>
  );
}

/** Phrases the feedback quotes ('like this') that really are in the essay, with the sections that quote them. */
function quotesIn(data: Record<string, unknown>, page: PageSpec, essay: string): Map<string, string[]> {
  const found = new Map<string, string[]>();
  const lower = essay.toLowerCase();
  for (const section of page.sections) {
    const texts: string[] = [];
    const collect = (v: unknown) => {
      if (typeof v === "string") texts.push(v);
      else if (Array.isArray(v)) v.forEach(collect);
      else if (v && typeof v === "object") Object.values(v).forEach(collect);
    };
    collect(data[section.key]);
    for (const t of texts)
      for (const m of t.matchAll(/(?:^|[\s(])['‘"“]([^'’"”‘“]{3,120}?)['’"”](?=[\s,.;:!?)]|$)/g)) {
        const q = m[1].trim().replace(/[.,]$/, "");
        // Phrases only: a single quoted word ("money") would light up all over the essay.
        if (q.split(/\s+/).length < 2 || !lower.includes(q.toLowerCase())) continue;
        const key = q.toLowerCase();
        const who = found.get(key) ?? [];
        if (!who.includes(section.title)) who.push(section.title);
        found.set(key, who);
      }
  }
  return found;
}

export interface Note {
  quote: string;
  mistake: string;
  improvement: string;
  criterion?: string;
}

function readNotes(data: Record<string, unknown>, a: NonNullable<NonNullable<PageSpec["essay"]>["annotations"]>): Note[] {
  const list = data[a.field];
  if (!Array.isArray(list)) return [];
  return list
    .map((n: any) => ({ quote: String(n?.[a.quote] ?? "").trim(), mistake: String(n?.[a.mistake] ?? ""), improvement: String(n?.[a.improvement] ?? ""), criterion: a.criterion ? n?.[a.criterion] : undefined }))
    .filter((n) => n.quote);
}

/** Where each note's quote is in the essay (first match, no overlaps), ignoring case, curly quotes and spacing. */
export function placeNotes(essay: string, notes: Note[]) {
  const simple = (t: string) => t.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
  const hay = simple(essay);
  const ranges: { start: number; end: number; note: number }[] = [];
  const missing: number[] = [];
  notes.forEach((n, i) => {
    const words = simple(n.quote).replace(/^["'“‘]+|["'”’.,]+$/g, "").trim().split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const re = new RegExp(words.join("\\s+"), "g");
    let m: RegExpExecArray | null;
    let placed = false;
    while ((m = re.exec(hay))) {
      const start = m.index;
      const end = start + m[0].length;
      if (!ranges.some((r) => start < r.end && end > r.start)) {
        ranges.push({ start, end, note: i });
        placed = true;
        break;
      }
      if (!m[0].length) re.lastIndex++;
    }
    if (!placed) missing.push(i);
  });
  return { ranges: ranges.sort((a, b) => a.start - b.start), missing };
}

function EssayPanel({ title, question, essay, quotes, notes }: { title: string; question?: string; essay: string; quotes: Map<string, string[]>; notes: Note[] }) {
  const text = essay.trim();
  const words = text ? text.split(/\s+/).length : 0;
  const [tip, setTip] = useState<{ note: number; x: number; y: number; above: boolean }>();
  const { ranges, missing } = notes.length ? placeNotes(text, notes) : { ranges: [], missing: [] };

  const show = (note: number, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const above = r.bottom + 190 > window.innerHeight;
    setTip({ note, x: Math.min(Math.max(r.left + r.width / 2, 170), window.innerWidth - 170), y: above ? r.top - 8 : r.bottom + 8, above });
  };

  // Plain quote highlighting, used when there are no annotations.
  const pattern =
    !notes.length && quotes.size
      ? new RegExp(`(${[...quotes.keys()].sort((a, b) => b.length - a.length).map((q) => q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi")
      : null;
  const markQuotes = (t: string) =>
    pattern
      ? t.split(pattern).map((part, i) => {
          const who = quotes.get(part.toLowerCase());
          return who ? (
            <mark key={i} title={`Mentioned in: ${who.join(", ")}`}>
              {part}
            </mark>
          ) : (
            part
          );
        })
      : t;

  // Paragraphs with their place in the essay, so annotation ranges can be cut out of them.
  const paras: { start: number; text: string }[] = [];
  for (const m of text.matchAll(/[^\n]+(?:\n(?!\s*\n)[^\n]*)*/g)) if (m[0].trim()) paras.push({ start: m.index!, text: m[0] });
  const annotate = (p: { start: number; text: string }) => {
    const end = p.start + p.text.length;
    const inside = ranges.filter((r) => r.start >= p.start && r.end <= end);
    if (!inside.length) return markQuotes(p.text);
    const out: ReactNode[] = [];
    let at = p.start;
    for (const r of inside) {
      if (r.start > at) out.push(text.slice(at, r.start));
      const n = notes[r.note];
      out.push(
        <mark
          key={r.start}
          className={`note ${tip?.note === r.note ? "on" : ""}`}
          tabIndex={0}
          aria-label={`${n.mistake} Better: ${n.improvement}`}
          onMouseEnter={(e) => show(r.note, e.currentTarget)}
          onMouseLeave={() => setTip(undefined)}
          onFocus={(e) => show(r.note, e.currentTarget)}
          onBlur={() => setTip(undefined)}
          onClick={(e) => (tip?.note === r.note ? setTip(undefined) : show(r.note, e.currentTarget))}
        >
          {text.slice(r.start, r.end)}
        </mark>,
      );
      at = r.end;
    }
    if (at < end) out.push(text.slice(at, end));
    return out;
  };

  const shown = tip && notes[tip.note];
  return (
    <aside className="essay-panel" onScroll={() => setTip(undefined)}>
      <div className="essay-head">
        <h2>{title}</h2>
        <span className="essay-count">{words} words</span>
      </div>
      {notes.length > 0 ? (
        <p className="essay-legend">
          <mark className="note">{ranges.length} mistake{ranges.length === 1 ? "" : "s"}</mark> underlined. Hover or tap one to see what's wrong and how to fix it.
        </p>
      ) : (
        quotes.size > 0 && (
          <p className="essay-legend">
            <mark>Highlighted</mark> words are phrases the examiner quotes in the feedback. Hover one to see which criterion mentions it.
          </p>
        )
      )}
      {question && <p className="essay-question">{question.trim()}</p>}
      <div className="essay-text">
        {paras.map((p, i) => (
          <p key={i}>{annotate(p)}</p>
        ))}
      </div>
      {missing.length > 0 && (
        <div className="notes-missing">
          <strong>{missing.length} note{missing.length === 1 ? "" : "s"} quote words that aren't in the essay</strong>
          <ul>
            {missing.map((i) => (
              <li key={i}>
                “{notes[i].quote}”: {notes[i].mistake} <em>Better: {notes[i].improvement}</em>
              </li>
            ))}
          </ul>
        </div>
      )}
      {shown && (
        <div className={`note-tip ${tip!.above ? "above" : ""}`} style={{ left: tip!.x, top: tip!.y }} role="tooltip">
          {shown.criterion && <span className="note-tag">{shown.criterion}</span>}
          <p className="note-mistake">
            <span>✗</span> {shown.mistake}
          </p>
          <p className="note-better">
            <span>✓</span> {shown.improvement}
          </p>
        </div>
      )}
    </aside>
  );
}

function Mascot({ mascot, title, intro }: { mascot: NonNullable<PageSpec["mascot"]>; title: string; intro?: string }) {
  const [line, setLine] = useState(0);
  const [poke, setPoke] = useState(0);
  // A new remark every few seconds.
  useEffect(() => {
    if (mascot.lines.length < 2) return;
    const timer = setInterval(() => setLine((l) => (l + 1) % mascot.lines.length), 5000);
    return () => clearInterval(timer);
  }, [mascot.lines.length]);
  return (
    <div className="mascot-hero">
      <button
        className="mascot"
        key={poke}
        aria-label={`${mascot.name ?? "The examiner"}: next remark`}
        onClick={() => {
          setLine((l) => (l + 1) % Math.max(1, mascot.lines.length));
          setPoke((p) => p + 1);
          play("tap");
        }}
      >
        <span>{mascot.emoji}</span>
      </button>
      <div className="mascot-text">
        <h1>{title}</h1>
        {intro && <p className="intro">{intro}</p>}
        {mascot.lines.length > 0 && (
          <p className="speech" key={line}>
            {mascot.name && <strong>{mascot.name}: </strong>}
            {mascot.lines[line % mascot.lines.length]}
          </p>
        )}
      </div>
    </div>
  );
}

function Meter({ meter }: { meter: NonNullable<PageSpec["meter"]> }) {
  const pct = Math.max(0, Math.min(100, meter.percent ?? 97));
  return (
    <div className="meter" style={{ "--pct": `${pct}%` } as CSSProperties}>
      <div className="meter-top">
        <span>{meter.label}</span>
        {meter.caption && <strong>{meter.caption}</strong>}
      </div>
      <div className="meter-track">
        <span />
      </div>
    </div>
  );
}

const DEFAULT_THEME = { accent: "#2f5bd3", accentText: "#ffffff", background: "#fafafa", card: "#ffffff", text: "#1d1d1f", muted: "#6e6e73", line: "#e2e2e5", radius: 8, font: "system" };
const FONTS: Record<string, string> = {
  system: "system-ui, -apple-system, sans-serif",
  serif: "Georgia, 'Times New Roman', serif",
  rounded: "ui-rounded, 'SF Pro Rounded', system-ui, sans-serif",
  mono: "ui-monospace, Menlo, monospace",
};

/** Layouts made before fields were a list ({ band: "circle", feedback: "paragraph" }) still draw. */
function upgrade(page: any): PageSpec {
  if (Array.isArray(page.fields)) return page;
  return { ...page, fields: Object.entries(page.fields ?? {}).map(([key, kind]) => ({ key, kind: kind === "paragraph" ? "text" : kind })) };
}

function Structured({ page, schema, data }: { page: PageSpec; schema: any; data: Record<string, unknown> }) {
  const sections = page.sections.filter((s) => data[s.key] !== undefined);
  const scores = page.overall?.average ? sections.map((s) => Number((data[s.key] as any)?.[page.overall!.average!])).filter(Number.isFinite) : [];
  const given = page.overall?.field !== undefined ? Number(data[page.overall.field]) : NaN;
  const avg = scores.length ? average(scores, page.overall?.rounding) : NaN;
  const big = Number.isFinite(given) ? given : avg;
  return (
    <div className={`feedback ${page.layout === "grid" ? "grid" : ""}`}>
      {page.overall && Number.isFinite(big) && (
        <div className="overall">
          <span>
            {page.overall.label}
            {Number.isFinite(given) && Number.isFinite(avg) && (
              <small className={`overall-check ${avg === given ? "" : "off"}`}>
                {avg === given ? `Matches the average of the ${scores.length} criteria` : `The ${scores.length} criteria average to ${format(avg)}`}
              </small>
            )}
          </span>
          <strong className={page.overall.ring ? "ring" : ""} style={{ "--pct": `${Math.max(0, Math.min(100, (big / 9) * 100))}%` } as CSSProperties}>
            {format(big)}
          </strong>
        </div>
      )}
      {page.chart && <Chart chart={page.chart} sections={sections} data={data} />}
      {sections.map((s) => {
        const value = data[s.key];
        const sub = schema?.properties?.[s.key];
        if (s.kind === "cards" && Array.isArray(value))
          return (value as Record<string, unknown>[]).map((item, i) => (
            <div className={`criterion section-${s.key} item`} key={`${s.key}-${i}`}>
              <h3>{format(item?.[s.itemTitle ?? "name"]) || s.title}</h3>
              <p>{format(item?.[s.itemText ?? "text"])}</p>
            </div>
          ));
        if (!value || typeof value !== "object" || Array.isArray(value))
          return (
            <div className={`criterion section-${s.key}`} key={s.key}>
              <h3>{s.title}</h3>
              <Value kind={s.kind ?? (Array.isArray(value) ? "bullets" : "text")} value={value} max={sub?.maximum} />
            </div>
          );
        const values = value as Record<string, unknown>;
        const fields = page.fields.filter((f) => values[f.key] !== undefined);
        const top = fields.filter((f) => f.kind === "circle" || f.kind === "badge");
        return (
          <div className={`criterion section-${s.key}`} key={s.key}>
            <div className="row">
              <h3>{s.title}</h3>
              <div className="tops">
                {top.map((f) => (
                  <Value key={f.key} kind={f.kind} value={values[f.key]} label={f.label} />
                ))}
              </div>
            </div>
            {fields
              .filter((f) => !top.includes(f))
              .map((f) => (
                <div key={f.key} className={`field field-${f.key}`}>
                  <Value kind={f.kind} value={values[f.key]} label={f.label} max={sub?.properties?.[f.key]?.maximum} />
                </div>
              ))}
          </div>
        );
      })}
    </div>
  );
}

/** One bar per section, scaled to the field's maximum (9 for bands). */
function Chart({ chart, sections, data }: { chart: NonNullable<PageSpec["chart"]>; sections: PageSpec["sections"]; data: Record<string, unknown> }) {
  const rows = sections
    .map((s) => ({ title: s.title, value: Number((data[s.key] as any)?.[chart.field]) }))
    .filter((r) => Number.isFinite(r.value));
  if (!rows.length) return null;
  const max = chart.max ?? 9;
  return (
    <div className="criterion chart">
      {chart.title && <h3>{chart.title}</h3>}
      {rows.map((r) => (
        <div className="chart-row" key={r.title}>
          <span className="chart-label">{r.title}</span>
          <div className="bar">
            <span style={{ width: `${Math.max(0, Math.min(100, (r.value / max) * 100))}%` }} />
          </div>
          <span className="chart-value">{format(r.value)}</span>
        </div>
      ))}
    </div>
  );
}

function Value({ kind, value, label, max }: { kind: Kind; value: unknown; label?: string; max?: number }) {
  const caption = label && kind !== "circle" && kind !== "badge" ? <span className="field-label">{label}</span> : null;
  switch (kind) {
    case "circle":
      return (
        <span className="band" title={label}>
          {format(value)}
        </span>
      );
    case "badge":
      return <span className="badge">{label ? `${label}: ${format(value)}` : format(value)}</span>;
    case "bar": {
      const n = Number(value);
      const pct = Number.isFinite(n) ? Math.max(0, Math.min(100, (n / (max ?? 9)) * 100)) : 0;
      return (
        <div>
          {caption}
          <div className="bar" title={format(value)}>
            <span style={{ width: `${pct}%` }} />
          </div>
        </div>
      );
    }
    case "bullets":
      return (
        <div>
          {caption}
          <ul>
            {(Array.isArray(value) ? value : [value]).map((v, i) => (
              <li key={i}>{inline(format(v))}</li>
            ))}
          </ul>
        </div>
      );
    case "quote":
      return (
        <div>
          {caption}
          <blockquote>{format(value)}</blockquote>
        </div>
      );
    case "table": {
      const rows = (Array.isArray(value) ? value : [value]).filter((r) => r && typeof r === "object") as Record<string, unknown>[];
      const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
      return (
        <div>
          {caption}
          <table>
            <thead>
              <tr>{cols.map((c) => <th key={c}>{c.replace(/_/g, " ")}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>{cols.map((c) => <td key={c}>{format(r[c])}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    case "markdown":
      return (
        <div className="prose">
          {caption}
          <Markdown text={format(value)} />
        </div>
      );
    default:
      return (
        <div>
          {caption}
          <p>{inline(format(value))}</p>
        </div>
      );
  }
}

/** Just enough Markdown for an AI's prose answer: headings, lists, quotes, rules, **bold**, *italic*, `code`. */
function Markdown({ text }: { text: string }) {
  const blocks = text.replace(/\r/g, "").split(/\n{2,}/);
  return (
    <>
      {blocks.map((block, i) => {
        const lines = block.split("\n").filter((l) => l.trim());
        if (!lines.length) return null;
        const heading = lines[0].match(/^(#{1,6})\s+(.*)$/);
        if (heading && lines.length === 1) return <h4 key={i}>{inline(heading[2])}</h4>;
        if (lines.every((l) => /^\s*([-*•]|\d+[.)])\s+/.test(l))) {
          const ordered = /^\s*\d/.test(lines[0]);
          const items = lines.map((l, j) => <li key={j}>{inline(l.replace(/^\s*([-*•]|\d+[.)])\s+/, ""))}</li>);
          return ordered ? <ol key={i}>{items}</ol> : <ul key={i}>{items}</ul>;
        }
        if (lines.every((l) => l.startsWith(">"))) return <blockquote key={i}>{inline(lines.map((l) => l.replace(/^>\s?/, "")).join(" "))}</blockquote>;
        if (lines.length === 1 && /^\s*([-*_])\1{2,}\s*$/.test(lines[0])) return <hr key={i} />;
        return (
          <p key={i}>
            {lines.map((l, j) => {
              const h = l.match(/^#{1,6}\s+(.*)$/);
              return (
                <span key={j}>
                  {j > 0 && <br />}
                  {h ? <strong>{inline(h[1])}</strong> : inline(l)}
                </span>
              );
            })}
          </p>
        );
      })}
    </>
  );
}

export function inline(text: string) {
  return text.split(/(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|_[^_\s][^_]*_|`[^`]+`)/g).map((part, i) => {
    if (/^\*\*.*\*\*$/.test(part)) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (/^(\*|_).*(\*|_)$/.test(part) && part.length > 2) return <em key={i}>{part.slice(1, -1)}</em>;
    if (/^`.*`$/.test(part)) return <code key={i}>{part.slice(1, -1)}</code>;
    return part;
  });
}

/** Bands keep one decimal (6.0); everything else is shown as it is. */
export function format(v: unknown): string {
  if (typeof v === "number") return Number.isInteger(v * 2) ? v.toFixed(1) : String(v);
  if (v && typeof v === "object") return Object.values(v).map(format).join(" — ");
  return v == null ? "—" : String(v);
}

/** "ielts": to the nearest half band, with .25 going up to .5 and .75 up to the next band. */
function average(scores: number[], rounding?: string): number {
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  return rounding === "none" ? Math.round(avg * 10) / 10 : Math.floor(avg * 2 + 0.5) / 2;
}
