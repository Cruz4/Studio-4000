import { useEffect, useRef, useState, type PointerEvent } from "react";
import { KEY_FOR_OFFSET, baseNote, liveTarget, noteOff, noteOn, onSounding, panic, shiftOctave, toggleTyping } from "../keys";
import { useStore } from "../store";
import { cx } from "../util";
import { Icon } from "./ui";

const BLACK = new Set([1, 3, 6, 8, 10]);
const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
export const noteName = (n: number) => `${NAMES[n % 12]}${Math.floor(n / 12) - 1}`;

/** On-screen keyboard: click or drag across keys, or turn on musical typing to play from the computer keyboard. */
export function KeysStrip() {
  const open = useStore((s) => s.keysOpen);
  const typing = useStore((s) => s.typing);
  const octave = useStore((s) => s.octave);
  const velocity = useStore((s) => s.velocity);
  const tracks = useStore((s) => s.project?.tracks ?? []);
  useStore((s) => s.selectedTrack);
  const target = liveTarget();
  const [lit, setLit] = useState<Set<number>>(new Set());
  const pressed = useRef<number | null>(null);

  useEffect(() => onSounding(setLit), []);
  useEffect(() => {
    const up = () => { if (pressed.current !== null) { noteOff(pressed.current); pressed.current = null; } };
    window.addEventListener("pointerup", up);
    return () => window.removeEventListener("pointerup", up);
  }, []);

  if (!open) return null;

  const first = baseNote() - 12;
  const notes = Array.from({ length: 36 + 1 }, (_, i) => first + i).filter((n) => n >= 0 && n <= 127);
  const whites = notes.filter((n) => !BLACK.has(n % 12));
  const typedBase = baseNote();
  const instruments = tracks.filter((t) => t.kind === "instrument");

  const press = (n: number, velocityAt: number) => {
    if (pressed.current !== null && pressed.current !== n) noteOff(pressed.current);
    pressed.current = n;
    noteOn(n, velocityAt);
  };
  const velocityFor = (e: PointerEvent, black: boolean) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const depth = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
    return Math.round(Math.max(20, Math.min(127, (black ? 50 : 40) + depth * 87)));
  };

  const keyProps = (n: number, black: boolean) => ({
    className: cx(black ? "pk black" : "pk white", lit.has(n) && "on", n % 12 === 0 && "c"),
    title: noteName(n),
    onPointerDown: (e: PointerEvent) => { e.preventDefault(); press(n, velocityFor(e, black)); },
    onPointerEnter: (e: PointerEvent) => { if (e.buttons & 1 && pressed.current !== null) press(n, velocityFor(e, black)); },
  });
  const label = (n: number) => {
    const typed = typing ? KEY_FOR_OFFSET[n - typedBase] : undefined;
    return <>{typed && <span className="pk-key">{typed}</span>}{n % 12 === 0 && <span className="pk-name">{noteName(n)}</span>}</>;
  };

  return (
    <div className="keys-strip">
      <div className="keys-controls">
        <div className="row" style={{ gap: 6 }}>
          <button className={cx("btn sm", typing && "primary")} title="Play notes from the computer keyboard (Shift+K)" onClick={() => toggleTyping()}>
            <Icon name="keyboard" size={13} /> {typing ? "Typing on" : "Musical typing"}
          </button>
          <button className="btn sm ghost icon" title="Hide keyboard" onClick={() => { toggleTyping(false); useStore.setState({ keysOpen: false }); }}><Icon name="x" size={12} /></button>
        </div>
        <div className="row" style={{ gap: 4 }}>
          <span className="small faint">Octave</span>
          <button className="btn sm icon" title="Octave down (Z)" onClick={() => shiftOctave(-1)}>−</button>
          <span className="mono small" style={{ width: 26, textAlign: "center" }}>C{octave}</span>
          <button className="btn sm icon" title="Octave up (X)" onClick={() => shiftOctave(1)}>+</button>
          <span className="small faint" style={{ marginLeft: 6 }} title="Velocity for typed notes (C / V)">Vel</span>
          <input type="range" className="slider" style={{ width: 60 }} min={1} max={127} value={velocity}
            onChange={(e) => useStore.setState({ velocity: +e.target.value })} title={`Velocity ${velocity} (C / V)`} />
        </div>
        <div className="row" style={{ gap: 4 }}>
          <Icon name="piano" size={12} />
          {instruments.length ? (
            <select className="input sm grow" value={target?.id ?? ""} title="Which instrument track the keyboard plays. Armed tracks also record it"
              onChange={(e) => useStore.setState({ selectedTrack: e.target.value })}>
              {instruments.map((t) => <option key={t.id} value={t.id}>{t.name}{t.armed ? " ● rec" : ""}</option>)}
            </select>
          ) : <span className="small faint grow">No instrument track yet</span>}
          <button className="btn sm ghost" title="Stop every sounding note" onClick={panic}>Panic</button>
        </div>
      </div>
      <div className="kb-piano" onContextMenu={(e) => e.preventDefault()}>
        <div className="kb-whites">
          {whites.map((n) => <div key={n} {...keyProps(n, false)}>{label(n)}</div>)}
        </div>
        {notes.filter((n) => BLACK.has(n % 12)).map((n) => {
          const leftWhites = whites.filter((w) => w < n).length;
          return <div key={n} {...keyProps(n, true)} style={{ left: `calc(${(leftWhites / whites.length) * 100}% - ${(0.62 / whites.length) * 50}%)`, width: `${(0.62 / whites.length) * 100}%` }}>{label(n)}</div>;
        })}
      </div>
    </div>
  );
}
