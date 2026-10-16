import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

// Small building blocks shared by the page: icons, sounds, toasts, a dialog and a side panel.

// ---------- icons (inline, 20×20, drawn with currentColor) ----------

const PATHS: Record<string, ReactNode> = {
  play: <path d="M7 5.5v9l7.5-4.5z" fill="currentColor" stroke="none" />,
  save: <path d="M5 4h8l3 3v9H4V5a1 1 0 0 1 1-1zm2 0v4h5V4M6.5 16v-4.5h7V16" />,
  history: <path d="M3.5 10a6.5 6.5 0 1 0 2-4.7M3.5 3.5v3h3M10 6.5V10l2.5 1.5" />,
  sparkle: <path d="M10 2.5l1.6 4.3 4.4 1.7-4.4 1.7L10 14.5l-1.6-4.3L4 8.5l4.4-1.7zM15.5 13l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" />,
  external: <path d="M8 4H4.5v11.5H16V12M11 3.5h5.5V9M16.5 3.5 9 11" />,
  close: <path d="M5 5l10 10M15 5 5 15" />,
  check: <path d="M4.5 10.5l3.5 3.5 7.5-8" />,
  alert: <path d="M10 3 2.5 16h15zM10 8v3.5M10 13.8v.2" />,
  info: <path d="M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM10 9v4.5M10 6.5v.2" />,
  sound: <path d="M4 8h3l4-3.5v11L7 12H4zM14 7.5a3.5 3.5 0 0 1 0 5M16 5.5a6.5 6.5 0 0 1 0 9" />,
  mute: <path d="M4 8h3l4-3.5v11L7 12H4zM14 8l4 4M18 8l-4 4" />,
  send: <path d="M3.5 10 16.5 4l-4 12.5-2.5-5.5zM10 11l6.5-7" />,
  doc: <path d="M5.5 3h6l3.5 3.5V17h-9.5zM11.5 3v3.5H15M8 10.5h5M8 13.5h5" />,
  image: <path d="M3.5 4.5h13v11h-13zM3.5 13l4-4 3.5 3.5 2-2 3.5 3.5M12.5 7.5v.2" />,
  flag: <path d="M5 17V3.5M5 4h9l-2 3.5 2 3.5H5" />,
  chevron: <path d="M7 8l3 3 3-3" />,
  wand: <path d="M4 16 13.5 6.5M12 5l3 3M15.5 2.5v2M18 5h-2M15 2.5 14 3.5" />,
  upload: <path d="M10 13V4M6.5 7.5 10 4l3.5 3.5M4 13v3h12v-3" />,
  copy: <path d="M7 7h9v9H7zM4 13V4h9" />,
  clip: <path d="M15.5 9.5 10 15a3.5 3.5 0 0 1-5-5l6-6a2.3 2.3 0 0 1 3.3 3.3l-6 6a1.2 1.2 0 0 1-1.7-1.7L12 6" />,
};

export function Icon({ name, size = 18 }: { name: keyof typeof PATHS | string; size?: number }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}

// ---------- sound (made in the browser, no files) ----------

let audio: AudioContext | undefined;
const MUTE_KEY = "playground:muted";

export function isMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}
export function setMuted(muted: boolean) {
  try {
    localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
  } catch {
    /* private window: the setting just isn't remembered */
  }
}

type Sound = "success" | "save" | "error" | "message" | "tap";
const NOTES: Record<Sound, [number, number, number][]> = {
  // [frequency Hz, start s, length s]
  success: [[659.25, 0, 0.16], [880, 0.09, 0.28]],
  save: [[1046.5, 0, 0.09]],
  error: [[311.13, 0, 0.18], [233.08, 0.12, 0.26]],
  message: [[783.99, 0, 0.12], [1174.66, 0.1, 0.22]],
  tap: [[1318.5, 0, 0.04]],
};

/** A short, quiet chime. Silent when muted or when the browser won't play sound yet. */
export function play(sound: Sound) {
  if (isMuted()) return;
  try {
    audio ??= new AudioContext();
    const now = audio.currentTime;
    for (const [freq, start, length] of NOTES[sound]) {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = sound === "error" ? "triangle" : "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, now + start);
      gain.gain.linearRampToValueAtTime(sound === "tap" ? 0.04 : 0.08, now + start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + start + length);
      osc.connect(gain).connect(audio.destination);
      osc.start(now + start);
      osc.stop(now + start + length + 0.02);
    }
  } catch {
    /* no sound available */
  }
}

// ---------- toasts ----------

type Tone = "success" | "error" | "info" | "claude";
interface Toast {
  id: number;
  tone: Tone;
  title: string;
  body?: string;
}
const ToastContext = createContext<(t: Omit<Toast, "id">) => void>(() => {});
export const useToast = () => useContext(ToastContext);

const TONE_ICON: Record<Tone, string> = { success: "check", error: "alert", info: "info", claude: "sparkle" };
const TONE_SOUND: Record<Tone, Sound> = { success: "success", error: "error", info: "tap", claude: "message" };

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(1);
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const show = useCallback(
    (t: Omit<Toast, "id">) => {
      const id = next.current++;
      setToasts((list) => [...list.slice(-3), { ...t, id }]);
      play(TONE_SOUND[t.tone]);
      setTimeout(() => dismiss(id), t.tone === "error" ? 7000 : t.body ? 5500 : 3200);
    },
    [dismiss],
  );
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tone}`}>
            <span className="toast-icon">
              <Icon name={TONE_ICON[t.tone]} size={16} />
            </span>
            <div className="toast-text">
              <strong>{t.title}</strong>
              {t.body && <p>{t.body}</p>}
            </div>
            <button className="icon-btn" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
              <Icon name="close" size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

// ---------- dialog & side panel ----------

function useEscape(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [open, onClose]);
}

export function Dialog({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  useEscape(open, onClose);
  if (!open) return null;
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title}>
        <div className="dialog-head">
          <h3>{title}</h3>
          <button className="icon-btn" aria-label="Close" onClick={onClose}>
            <Icon name="close" size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Drawer({ open, onClose, title, subtitle, children }: { open: boolean; onClose: () => void; title: ReactNode; subtitle?: ReactNode; children: ReactNode }) {
  useEscape(open, onClose);
  return (
    <div className={`drawer-wrap ${open ? "open" : ""}`} aria-hidden={!open}>
      <div className="drawer-scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label={typeof title === "string" ? title : undefined}>
        <div className="drawer-head">
          <div>
            <h3>{title}</h3>
            {subtitle && <div className="drawer-sub">{subtitle}</div>}
          </div>
          <button className="icon-btn" aria-label="Close" onClick={onClose}>
            <Icon name="close" size={16} />
          </button>
        </div>
        {children}
      </aside>
    </div>
  );
}

/** "just now", "5 min ago", "yesterday 14:02", … */
export function ago(iso: string): string {
  const d = new Date(iso);
  const s = (Date.now() - d.getTime()) / 1000;
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400 && new Date().getDate() === d.getDate()) return `today ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  return d.toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
