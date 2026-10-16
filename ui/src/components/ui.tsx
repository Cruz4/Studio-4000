import { Component, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { currentTheme, toggleTheme } from "../theme";
import { clamp, cx, formatDb, parseDb } from "../util";

/** Keeps a crash in one panel from blanking the whole window. */
export class ErrorBoundary extends Component<{ name: string; children: ReactNode; onReset?: () => void; floating?: boolean }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) { console.error(`[${this.props.name}]`, error); }
  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className={cx("crash-card", this.props.floating && "floating")}>
        <b>{this.props.name} hit a problem</b>
        <span className="small faint mono ellipsis" title={error.stack}>{error.message}</span>
        <div className="row">
          <button className="btn sm accent" onClick={() => { this.props.onReset?.(); this.setState({ error: null }); }}>Try again</button>
          <button className="btn sm" onClick={() => location.reload()}>Reload interface</button>
        </div>
      </div>
    );
  }
}

const paths: Record<string, string> = {
  play: "M7 4.5v15l12-7.5z",
  stop: "M6 6h12v12H6z",
  record: "M12 5a7 7 0 1 0 0 14 7 7 0 0 0 0-14z",
  loop: "M17 2l4 4-4 4M3 11v-1a4 4 0 0 1 4-4h14M7 22l-4-4 4-4M21 13v1a4 4 0 0 1-4 4H3",
  metronome: "M9 3h6l4 18H5zM12 15l5-9",
  rewind: "M11 18V6l-8.5 6zM21 18V6l-8.5 6z",
  forward: "M13 6v12l8.5-6zM3 6v12l8.5-6z",
  toStart: "M6 6h2v12H6zM20 6v12L9.5 12z",
  punch: "M4 12h4M16 12h4M8 7v10M16 7v10",
  undo: "M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3",
  redo: "M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3",
  plus: "M12 5v14M5 12h14",
  x: "M6 6l12 12M18 6L6 18",
  mixer: "M6 4v16M12 4v16M18 4v16M4 15h4M10 8h4M16 13h4",
  wave: "M2 12h2l2-6 3 12 3-15 3 18 3-12 2 3h2",
  piano: "M3 4h18v16H3zM8 4v10M13 4v10M18 4v10M8 14v6M13 14v6M18 14v6",
  sparkles: "M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8zM19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9zM5 15l.6 1.4L7 17l-1.4.6L5 19l-.6-1.4L3 17l1.4-.6z",
  bot: "M12 2v3M5 8h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2zM9 13h.01M15 13h.01M9 17h6",
  users: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8",
  folder: "M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  save: "M5 3h11l5 5v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM7 3v5h8V3M7 21v-7h10v7",
  export: "M12 3v12M7 8l5-5 5 5M5 15v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4",
  settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3",
  mic: "M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3zM19 10v2a7 7 0 0 1-14 0v-2M12 19v3",
  micOff: "M2 2l20 20M9 9v3a3 3 0 0 0 5.1 2.1M15 9.3V5a3 3 0 0 0-5.9-.6M17 16.9A7 7 0 0 1 5 12v-2M19 10v2c0 .8-.1 1.5-.4 2.2M12 19v3",
  screen: "M2 4h20v13H2zM8 21h8M12 17v4",
  scissors: "M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM20 4L8.1 15.9M14.5 14.5L20 20M8.1 8.1L12 12",
  copy: "M9 9h11v11H9zM5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1",
  trash: "M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14",
  magnet: "M6 3v8a6 6 0 0 0 12 0V3M6 7h4M14 7h4",
  zoomIn: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3M11 8v6M8 11h6",
  zoomOut: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3M8 11h6",
  automation: "M3 17l5-6 4 3 4-7 5 5",
  power: "M12 2v10M18.4 6.6a9 9 0 1 1-12.8 0",
  chevronDown: "M6 9l6 6 6-6",
  chevronRight: "M9 6l6 6-6 6",
  send: "M22 2L11 13M22 2l-7 20-4-9-9-4z",
  check: "M5 12l5 5L20 7",
  info: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01",
  alert: "M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01",
  link: "M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7",
  window: "M3 4h18v16H3zM3 9h18",
  keyboard: "M2 6h20v12H2zM6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10",
  file: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6",
  plug: "M9 2v6M15 2v6M6 8h12v4a6 6 0 0 1-12 0zM12 18v4",
  layers: "M12 2l10 5-10 5L2 7zM2 17l10 5 10-5M2 12l10 5 10-5",
  wand: "M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8L19 13M17.8 6.2L19 5M3 21l9-9M12.2 6.2L11 5",
  headphones: "M3 18v-6a9 9 0 0 1 18 0v6M21 19a2 2 0 0 1-2 2h-1v-7h3zM3 19a2 2 0 0 0 2 2h1v-7H3z",
  arrowRight: "M5 12h14M12 5l7 7-7 7",
  bolt: "M13 2L3 14h9l-1 8 10-12h-9z",
  speaker: "M11 5L6 9H2v6h4l5 4zM15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14",
  sidebar: "M3 4h18v16H3zM9 4v16",
  chevronLeft: "M15 6l-6 6 6 6",
  menu: "M4 6h16M4 12h16M4 18h16",
  tune: "M4 18c3 0 3-12 6-12s3 12 6 12 3-6 4-6",
  download: "M12 3v12M7 10l5 5 5-5M5 19h14",
};

export function Icon({ name, size = 16, className, fill }: { name: string; size?: number; className?: string; fill?: boolean }) {
  const filled = fill ?? (name === "play" || name === "stop" || name === "record" || name === "rewind" || name === "forward" || name === "toStart" || name === "bolt");
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} fill={filled ? "currentColor" : "none"}
      stroke={filled ? "none" : "currentColor"} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={paths[name] ?? paths.info} />
    </svg>
  );
}

export function Modal({ title, onClose, children, footer, width }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; width?: number }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", k, true);
    return () => window.removeEventListener("keydown", k, true);
  }, [onClose]);
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={width ? { width: `min(${width}px, calc(100vw - 40px))` } : undefined}>
        <div className="modal-head"><h3>{title}</h3><button className="btn ghost icon" onClick={onClose} title="Close"><Icon name="x" /></button></div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { id: T; label: ReactNode; icon?: string }[] }) {
  return (
    <div className="tabs">
      {items.map((i) => (
        <button key={i.id} className={cx("tab", value === i.id && "on")} onClick={() => onChange(i.id)}>
          {i.icon && <Icon name={i.icon} size={14} />}{i.label}
        </button>
      ))}
    </div>
  );
}

/** Vertical-drag helper: calls onMove with the pixel delta since drag start. Shift gives fine control. */
export function startDrag(e: React.PointerEvent | PointerEvent, onMove: (dx: number, dy: number, ev: PointerEvent) => void, onEnd?: (ev: PointerEvent) => void) {
  e.preventDefault();
  const x0 = e.clientX, y0 = e.clientY;
  const move = (ev: PointerEvent) => onMove(ev.clientX - x0, ev.clientY - y0, ev);
  const up = (ev: PointerEvent) => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    onEnd?.(ev);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

export function Knob({ value, onChange, onCommit, size = 34, bipolar, label, title, onReset }: {
  value: number; onChange: (v: number) => void; onCommit?: (v: number) => void; size?: number; bipolar?: boolean; label?: string; title?: string; onReset?: () => void;
}) {
  const v = clamp(value, 0, 1);
  const a0 = -135, a1 = 135;
  const ang = a0 + (a1 - a0) * v;
  const r = size / 2 - 3;
  const pt = (deg: number) => {
    const rad = ((deg - 90) * Math.PI) / 180;
    return [size / 2 + r * Math.cos(rad), size / 2 + r * Math.sin(rad)];
  };
  const arc = (from: number, to: number) => {
    const [x0, y0] = pt(from), [x1, y1] = pt(to);
    return `M${x0},${y0} A${r},${r} 0 ${Math.abs(to - from) > 180 ? 1 : 0} ${to > from ? 1 : 0} ${x1},${y1}`;
  };
  const latest = useRef(v);
  latest.current = v;
  return (
    <div className="col" style={{ alignItems: "center", gap: 2 }} title={title}>
      <svg width={size} height={size} className="knob"
        onDoubleClick={onReset}
        onPointerDown={(e) => {
          const start = latest.current;
          let last = start;
          startDrag(e, (_dx, dy, ev) => { last = clamp(start - dy / (ev.shiftKey ? 600 : 150), 0, 1); onChange(last); }, () => onCommit?.(last));
        }}>
        <path d={arc(a0, a1)} stroke="rgba(255,255,255,.1)" strokeWidth={3} fill="none" strokeLinecap="round" />
        {Math.abs(ang - (bipolar ? 0 : a0)) > 0.5 && (
          <path d={bipolar ? arc(Math.min(0, ang), Math.max(0, ang)) : arc(a0, ang)} stroke="url(#kg)" strokeWidth={3} fill="none" strokeLinecap="round" />
        )}
        <defs><linearGradient id="kg"><stop offset="0" stopColor="#00d1ff" /><stop offset="1" stopColor="#7c5cff" /></linearGradient></defs>
        <circle cx={size / 2} cy={size / 2} r={r - 5} fill="#1f2432" />
        <line x1={size / 2} y1={size / 2} x2={pt(ang)[0] * 0.62 + size / 2 * 0.38} y2={pt(ang)[1] * 0.62 + size / 2 * 0.38} stroke="#fff" strokeWidth={2} strokeLinecap="round" />
      </svg>
      {label && <span className="small dim">{label}</span>}
    </div>
  );
}

/** Click to type a level. Double-click returns it to 0 dB. */
export function DbField({ db, min, max, onChange, digits = 1, className, style }: {
  db: number; min: number; max: number; onChange: (db: number) => void; digits?: number; className?: string; style?: CSSProperties;
}) {
  const [edit, setEdit] = useState<string | null>(null);
  const wait = useRef(0);
  const commit = () => {
    if (edit === null) return;
    const n = parseDb(edit);
    if (n !== null) onChange(clamp(n, min, max));
    setEdit(null);
  };
  if (edit !== null) {
    return <input className={cx("db-field editing", className)} style={style} value={edit} autoFocus
      onChange={(e) => setEdit(e.target.value)}
      onBlur={commit}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") { e.preventDefault(); commit(); } if (e.key === "Escape") setEdit(null); }} />;
  }
  return <button type="button" className={cx("db-field", className)} style={style}
    title="Click to type a dB level. Double-click for 0 dB"
    onClick={() => { window.clearTimeout(wait.current); wait.current = window.setTimeout(() => setEdit(formatDb(db, digits)), 220); }}
    onDoubleClick={(e) => { e.preventDefault(); e.stopPropagation(); window.clearTimeout(wait.current); onChange(0); }}>
    {formatDb(db, digits)}
  </button>;
}

export function ThemeToggle() {
  const [theme, setTheme] = useState(currentTheme);
  const light = theme === "light";
  return (
    <button className={cx("btn sm ghost theme-toggle", light && "on")} title={light ? "Switch to the dark theme" : "Switch to the light theme"}
      onClick={() => { toggleTheme(); setTheme(currentTheme()); }}>
      {light ? "Dark" : "Light"}
    </button>
  );
}

export function Spinner({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ animation: "spin 0.9s linear infinite" }}>
      <style>{"@keyframes spin{to{transform:rotate(360deg)}}"}</style>
      <circle cx="12" cy="12" r="9" stroke="rgba(255,255,255,.15)" strokeWidth="3" fill="none" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="#a08bff" strokeWidth="3" fill="none" strokeLinecap="round" />
    </svg>
  );
}
