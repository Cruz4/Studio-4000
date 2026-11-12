import { act } from "../store";
import { cx } from "../util";

export function MonoButton({ id, on }: { id: string; on?: boolean }) {
  return <button className={cx("toggle sum-mono", on && "on")} aria-pressed={!!on}
    title={on ? "Sum to Mono is on. Click to restore stereo playback." : "Sum to Mono: check playback with left and right averaged together. Recording format stays unchanged."}
    onClick={(e) => { e.stopPropagation(); void act(id === "master" ? "master.set" : "track.set", { id, sumToMono: !on }); }}>
    Mono
  </button>;
}
