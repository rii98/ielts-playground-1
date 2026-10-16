import { useState, type CSSProperties, type ReactNode } from "react";
import { format, inline, placeNotes, type Note } from "./Feedback.tsx";

// The "report" template for /feedback (page.template = "report" in structure.json): a band gauge, a card
// per criterion, strengths and priorities, the task, and the essay with numbered, colour-coded annotations
// beside a list of them. Every part is read from the answer through page.report, so other prompts can use it.

export interface ReportSpec {
  title: string;
  /** Top-level number: the overall band. */
  overall: string;
  criteria: { key: string; label: string; short: string; color: string }[];
  /** Field names inside each criterion. */
  band: string;
  suggestions?: string;
  /** Top-level list of strengths ("What you did well"). Without it, the card says how to get it. */
  strengths?: string;
  /** Top-level text: a model answer for the Sample tab. */
  sample?: string;
  annotations: { field: string; quote: string; mistake: string; improvement: string; criterion?: string; label?: string };
}

interface ReportNote extends Note {
  label?: string;
  /** Index into spec.criteria, or -1 if the AI named a criterion we don't know. */
  crit: number;
}

const norm = (t: string) => t.toLowerCase().replace(/&/g, "and").replace(/[^a-z]/g, "");

export function Report({ spec, data, question, essay, createdAt }: { spec: ReportSpec; data: Record<string, any>; question?: string; essay: string; createdAt?: string }) {
  const [filter, setFilter] = useState<number | "all">("all");
  const [view, setView] = useState<"original" | "improved" | "sample">("original");
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [hover, setHover] = useState<number>();

  const overall = Number(data[spec.overall]);
  const bands = spec.criteria.map((c) => Number(data[c.key]?.[spec.band]));
  const a = spec.annotations;
  const notes: ReportNote[] = (Array.isArray(data[a.field]) ? data[a.field] : [])
    .map((n: any) => {
      const name = norm(String(a.criterion ? n?.[a.criterion] ?? "" : ""));
      const crit = spec.criteria.findIndex((c) => name && (norm(c.label) === name || name.includes(norm(c.short)) || norm(c.label).includes(name)));
      return { quote: String(n?.[a.quote] ?? "").trim(), mistake: String(n?.[a.mistake] ?? ""), improvement: String(n?.[a.improvement] ?? ""), label: a.label ? n?.[a.label] : undefined, crit };
    })
    .filter((n: ReportNote) => n.quote);
  const text = essay.trim();
  const { ranges, missing } = placeNotes(text, notes);
  const shown = (i: number) => filter === "all" || notes[i].crit === filter;

  // Priorities: the first suggestion of each criterion, weakest band first.
  const priorities = spec.suggestions
    ? spec.criteria
        .map((c, i) => ({ band: bands[i], tip: (data[c.key]?.[spec.suggestions!] ?? [])[0] }))
        .filter((p) => p.tip)
        .sort((x, y) => (Number.isFinite(x.band) ? x.band : 9) - (Number.isFinite(y.band) ? y.band : 9))
        .map((p) => String(p.tip))
    : [];
  const strengths: string[] = spec.strengths && Array.isArray(data[spec.strengths]) ? data[spec.strengths] : [];
  const sample = spec.sample ? String(data[spec.sample] ?? "") : "";

  const paras: { start: number; text: string }[] = [];
  for (const m of text.matchAll(/[^\n]+(?:\n(?!\s*\n)[^\n]*)*/g)) if (m[0].trim()) paras.push({ start: m.index!, text: m[0] });
  const numberOf = new Map(ranges.map((r, i) => [r.note, i + 1]));

  const renderPara = (p: { start: number; text: string }) => {
    const end = p.start + p.text.length;
    const inside = ranges.filter((r) => r.start >= p.start && r.end <= end && shown(r.note));
    const out: ReactNode[] = [];
    let at = p.start;
    for (const r of inside) {
      if (r.start > at) out.push(text.slice(at, r.start));
      const n = notes[r.note];
      const color = spec.criteria[n.crit]?.color ?? "#888";
      out.push(
        view === "improved" ? (
          <span key={r.start} className="rp-fix" title={`Was: “${text.slice(r.start, r.end)}”`}>
            {n.improvement}
          </span>
        ) : (
          <span
            key={r.start}
            className={`rp-mark ${hover === r.note ? "on" : ""}`}
            style={{ "--c": color } as CSSProperties}
            onMouseEnter={() => setHover(r.note)}
            onMouseLeave={() => setHover(undefined)}
            onClick={() => {
              setOpen((s) => new Set(s).add(r.note));
              document.getElementById(`rp-note-${r.note}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
            }}
          >
            {text.slice(r.start, r.end)}
            <sup>{numberOf.get(r.note)}</sup>
          </span>
        ),
      );
      at = r.end;
    }
    if (at < end) out.push(text.slice(at, end));
    return out;
  };

  const counts = spec.criteria.map((_, i) => ranges.filter((r) => notes[r.note].crit === i).length);
  const listed = ranges.filter((r) => shown(r.note));

  return (
    <div className="report">
      <div className="rp-top">
        <a href="/" className="rp-back">
          ← Back to playground
        </a>
        {createdAt && <span className="rp-when">Marked {new Date(createdAt).toLocaleString()}</span>}
      </div>

      <div className="rp-scores">
        <section className="rp-card rp-gauge-card">
          <h2 className="rp-gauge-title">{spec.title}</h2>
          <Gauge value={overall} />
        </section>
        <div className="rp-crit-grid">
          {spec.criteria.map((c, i) => (
            <section className="rp-card rp-crit" key={c.key}>
              <span className="rp-label">
                <i style={{ background: c.color }} />
                {c.label}
              </span>
              <strong>{Number.isFinite(bands[i]) ? bands[i].toFixed(1) : "–"}</strong>
            </section>
          ))}
        </div>
      </div>

      <div className="rp-two">
        <section className="rp-card rp-list-card">
          <h3 className="rp-label good">What you did well</h3>
          {strengths.length ? (
            <ul>
              {strengths.map((s, i) => (
                <li key={i}>{inline(format(s))}</li>
              ))}
            </ul>
          ) : (
            <p className="rp-empty">Your prompt doesn't ask the AI for strengths yet, so there's nothing to show here.</p>
          )}
        </section>
        <section className="rp-card rp-list-card">
          <h3 className="rp-label bad">Priority improvements</h3>
          {priorities.length ? (
            <ol>
              {priorities.map((p, i) => (
                <li key={i}>{inline(p)}</li>
              ))}
            </ol>
          ) : (
            <p className="rp-empty">No suggestions in this answer.</p>
          )}
        </section>
      </div>

      {question && (
        <section className="rp-card rp-prompt">
          <h3 className="rp-label task">Task prompt</h3>
          {question
            .trim()
            .split(/\n\s*\n/)
            .map((p, i) => (
              <p key={i}>{p}</p>
            ))}
        </section>
      )}

      <div className="rp-controls">
        <div className="rp-chips">
          <button className={filter === "all" ? "on" : ""} onClick={() => setFilter("all")}>
            All <span>{ranges.length}</span>
          </button>
          {spec.criteria.map((c, i) => (
            <button key={c.key} className={filter === i ? "on" : ""} onClick={() => setFilter(filter === i ? "all" : i)}>
              <i style={{ background: c.color }} />
              {c.short} <span>{counts[i]}</span>
            </button>
          ))}
        </div>
        <div className="rp-toggle" role="tablist">
          {(["original", "improved", "sample"] as const).map((v) => (
            <button
              key={v}
              role="tab"
              aria-selected={view === v}
              className={view === v ? "on" : ""}
              disabled={v === "sample" && !sample}
              title={v === "sample" && !sample ? "Your prompt doesn't ask the AI for a sample answer yet" : undefined}
              onClick={() => setView(v)}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      <div className="rp-essay-row">
        <section className="rp-card rp-essay">
          {view === "sample" ? (
            sample
              .trim()
              .split(/\n\s*\n/)
              .map((p, i) => <p key={i}>{inline(p)}</p>)
          ) : (
            paras.map((p, i) => <p key={i}>{renderPara(p)}</p>)
          )}
          {view === "original" && missing.length > 0 && (
            <p className="rp-missing">
              {missing.length} annotation{missing.length === 1 ? " quotes words that aren't" : "s quote words that aren't"} in the essay, so {missing.length === 1 ? "it isn't" : "they aren't"} underlined.
            </p>
          )}
        </section>
        <div className="rp-notes">
          {listed.length === 0 && <p className="rp-empty">No annotations{filter === "all" ? "" : " for this criterion"}.</p>}
          {listed.map((r) => {
            const n = notes[r.note];
            const c = spec.criteria[n.crit];
            const isOpen = open.has(r.note);
            return (
              <section
                id={`rp-note-${r.note}`}
                key={r.note}
                className={`rp-card rp-note ${hover === r.note ? "on" : ""} ${isOpen ? "open" : ""}`}
                onMouseEnter={() => setHover(r.note)}
                onMouseLeave={() => setHover(undefined)}
              >
                <button
                  className="rp-note-head"
                  aria-expanded={isOpen}
                  onClick={() =>
                    setOpen((s) => {
                      const next = new Set(s);
                      if (!next.delete(r.note)) next.add(r.note);
                      return next;
                    })
                  }
                >
                  <span className="rp-num">#{numberOf.get(r.note)}</span>
                  {n.label && (
                    <span className="rp-tag">
                      <span aria-hidden="true">ⓘ</span> {n.label}
                    </span>
                  )}
                  {c && (
                    <span className="rp-crit-tag">
                      <i style={{ background: c.color }} />
                      {c.short}
                    </span>
                  )}
                  <span className="rp-chev" aria-hidden="true">
                    ⌄
                  </span>
                </button>
                <p className="rp-quote">“{text.slice(r.start, r.end)}”</p>
                {isOpen && (
                  <div className="rp-note-body">
                    <p>
                      <b className="bad">✗</b> {inline(n.mistake)}
                    </p>
                    <p>
                      <b className="good">✓</b> {inline(n.improvement)}
                    </p>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** A half-ring of rounded bars, filled up to the score (0–9). */
function Gauge({ value }: { value: number }) {
  const bars = 17;
  const filled = Number.isFinite(value) ? Math.round((value / 9) * bars) : 0;
  return (
    <div className="rp-gauge">
      <svg viewBox="0 0 300 168" aria-hidden="true">
        {Array.from({ length: bars }, (_, i) => {
          const angle = 180 - (i * 180) / (bars - 1);
          const on = i < filled;
          const t = filled > 1 ? i / (filled - 1) : 1;
          // light mint to deep green across the filled bars
          const color = on ? `rgb(${Math.round(134 - 66 * t)} ${Math.round(205 - 76 * t)} ${Math.round(168 - 58 * t)})` : "#e8e8e6";
          return <rect key={i} x={150 + 96} y={152} width={40} height={14} rx={7} fill={color} transform={`rotate(${-angle} 150 159)`} />;
        })}
      </svg>
      <strong>{Number.isFinite(value) ? value.toFixed(1) : "–"}</strong>
      <span className="rp-min">0.0</span>
      <span className="rp-max">9.0</span>
    </div>
  );
}
