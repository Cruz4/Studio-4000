import { usePad } from "../gamepad/pad";
import { useStore } from "../store";
import { cx } from "../util";
import { Icon, Modal } from "./ui";

const XBOX: Record<string, string> = { a: "A", b: "B", x: "X", y: "Y", lb: "LB", rb: "RB", lt: "LT", rt: "RT", back: "View", start: "Menu", l3: "L3", r3: "R3" };
const PS: Record<string, string> = { a: "Cross", b: "Circle", x: "Square", y: "Triangle", lb: "L1", rb: "R1", lt: "L2", rt: "R2", back: "Create", start: "Options", l3: "L3", r3: "R3" };

function names(ps: boolean) {
  return ps ? PS : XBOX;
}

const MAP: { title: string; rows: [string, string][] }[] = [
  { title: "Everywhere", rows: [
    ["A B X Y", "The four actions shown on screen for this page"],
    ["Hold LB", "Tool wheel. Aim with the left stick, release to choose. Release centred to cancel"],
    ["Hold RB", "Places wheel: Tracks, Mixer, Editor, Effects, Browser, Smart Mix, Assistant, Keyboard"],
    ["Tap LB / RB", "Next tool, or the previous and next panel"],
    ["Hold LT", "Edit layer: the face buttons change"],
    ["Hold RT", "Record layer, or a note when an instrument is selected"],
    ["Left stick", "Scrub, scroll, or ride the control under the pointer"],
    ["Right stick", "Zoom, pan, velocity, or the page's second control"],
    ["D-pad", "Move the selection. LT makes the step smaller, or a semitone"],
    ["L3 / R3", "Loop / metronome. On the mixer, L3 resets the fader"],
    ["View", "Undo. LT+View is redo"],
    ["Menu", "Command palette. LT+Menu pastes on the tracks page"],
    ["View+Menu", "This map"],
  ] },
  { title: "Tracks", rows: [
    ["A / B", "Play or stop. B again returns to the start"],
    ["X / Y", "Split at the playhead / arm the track"],
    ["LT + A B X Y", "Duplicate, delete, cut, copy"],
    ["RT + A B X Y", "Record, punch, count-in, loop the selection"],
    ["RT + A on an instrument", "Hold a note. Right stick picks the pitch, RT pressure is velocity. RT+R3 records"],
    ["LT + D-pad", "Nudge the selected clips"],
    ["LB wheel", "Move, Time, Split, Slip, Erase"],
  ] },
  { title: "Mixer", rows: [
    ["D-pad", "Previous or next strip, including the master"],
    ["Left stick", "Fader. LT is a fine ride. RT+left stick is pan, RT+right stick is the first send"],
    ["A B X Y", "Solo, mute, arm, open effects"],
    ["L3", "Reset the fader to 0 dB"],
    ["LB wheel", "Reset, effects on/off, solo, mute, arm, open effects"],
  ] },
  { title: "Editor", rows: [
    ["A B X Y", "Draw a note, delete, quantize, select all"],
    ["D-pad", "Move the selected notes. LT jumps an octave or a bar"],
    ["Right stick", "Note length and velocity"],
    ["LB wheel", "Draw, move, length, velocity, quantize"],
    ["Audio clip", "A normalizes, B mutes, X reverses. Left stick is gain, right stick is pan"],
  ] },
  { title: "Effects and plug-ins", rows: [
    ["D-pad", "Previous or next insert"],
    ["A B X Y", "Open, bypass, remove, add"],
    ["Inside a window", "D-pad moves the focus ring. Left stick turns the knob. LT is fine"],
    ["A / Y / X / B", "Toggle a switch, reset the knob, flip editor and parameter list, close"],
    ["LB / RB", "Previous or next open plug-in window"],
  ] },
  { title: "Browser, welcome, dialogs", rows: [
    ["Browser", "D-pad moves the list, A adds it, B hides the browser. LB and RB change tabs"],
    ["Welcome", "D-pad picks a template, A creates it, X opens a project, Y opens audio settings. Left stick sets the tempo"],
    ["Any dialog", "D-pad and the left stick move the highlight, A activates, B closes"],
    ["LT + LB / RB", "Previous or next settings tab"],
    ["Assistant", "D-pad and A use the buttons. The message field stays on the keyboard"],
  ] },
];

function Wheel() {
  const wheel = usePad((s) => s.wheel);
  if (!wheel) return null;
  const count = Math.max(1, wheel.items.length);
  return (
    <div className="pad-wheel" role="dialog" aria-label={wheel.title}>
      <div className="pad-wheel-core"><b>{wheel.title}</b><span>Release to choose</span></div>
      {wheel.items.map((item, i) => {
        const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
        return (
          <div key={item.id} className={cx("pad-wedge", wheel.index === i && "on")}
            style={{ transform: `translate(-50%, -50%) translate(${Math.cos(angle) * 112}px, ${Math.sin(angle) * 112}px)` }}>
            {item.label}
          </div>
        );
      })}
    </div>
  );
}

function Legend() {
  const legend = usePad((s) => s.legend);
  const layer = usePad((s) => s.layer);
  const title = usePad((s) => s.regionLabel);
  const ps = usePad((s) => s.playstation);
  const wheel = usePad((s) => s.wheel);
  const connected = usePad((s) => s.connected);
  if (!connected || wheel || (!legend.a && !legend.b && !legend.x && !legend.y)) return null;
  const n = names(ps);
  const faces: { id: string; label?: string; tone: string }[] = [
    { id: n.y, label: legend.y, tone: "y" },
    { id: n.x, label: legend.x, tone: "x" },
    { id: n.b, label: legend.b, tone: "b" },
    { id: n.a, label: legend.a, tone: "a" },
  ];
  return (
    <div className={cx("pad-legend", layer !== "bare" && "hot")}>
      <b>{title}</b>
      {faces.filter((face) => face.label).map((face) => (
        <span key={face.tone} className="pad-face"><i className={face.tone}>{face.id}</i>{face.label}</span>
      ))}
      {legend.hint && <span className="faint">{legend.hint}</span>}
    </div>
  );
}

export function PadPill({ floating = false }: { floating?: boolean }) {
  const connected = usePad((s) => s.connected);
  const enabled = usePad((s) => s.enabled);
  const label = usePad((s) => s.regionLabel);
  if (!connected) return null;
  return (
    <button className={cx("pad-pill", floating && "floating")} onClick={() => usePad.setState({ mapOpen: true })} title="Controller map">
      <Icon name="gamepad" size={12} /> {enabled ? (label || "Controller") : "Controller off"}
    </button>
  );
}

export function ControllerHud() {
  const mapOpen = usePad((s) => s.mapOpen);
  const project = useStore((s) => s.project);
  const ps = usePad((s) => s.playstation);
  const n = names(ps);
  return (
    <>
      <Wheel />
      <Legend />
      {!project && <PadPill floating />}
      {mapOpen && (
        <Modal title="Controller" onClose={() => usePad.setState({ mapOpen: false })} width={860}>
          <p className="small dim" style={{ marginTop: 0 }}>
            A USB pad uses the standard layout. {n.a}, {n.b}, {n.x} and {n.y} follow the page.
            Hold {n.lb} for that page's tools and aim with the left stick. Hold {n.rb} to move somewhere else.
            {n.back}+{n.start} opens this map. Text fields stay on the keyboard.
          </p>
          <div className="pad-map">
            {MAP.map((group) => (
              <div key={group.title} className="col" style={{ gap: 4 }}>
                <span className="section-title">{group.title}</span>
                {group.rows.map(([key, text]) => (
                  <div key={key} className="row small"><span className="kbd">{key}</span><span className="grow dim">{text}</span></div>
                ))}
              </div>
            ))}
          </div>
        </Modal>
      )}
    </>
  );
}
