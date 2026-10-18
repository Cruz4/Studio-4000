// Guest headphone mix: a click generated here, locked to the host playhead.
// The full mix over screen-share arrives late; this click does not wait for that.
import { useCollab } from "./collab";
import { live, onTick, useStore } from "./store";

export type ListenMode = "click" | "mix";

let ctx: AudioContext | null = null;
let lastBeat = -1;
let unsub: (() => void) | null = null;

function audio() {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function tickClick(accent: boolean) {
  const ac = audio();
  const now = ac.currentTime;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = "square";
  osc.frequency.value = accent ? 1320 : 880;
  gain.gain.setValueAtTime(accent ? 0.22 : 0.12, now);
  gain.gain.exponentialRampToValueAtTime(0.0008, now + 0.04);
  osc.connect(gain).connect(ac.destination);
  osc.start(now);
  osc.stop(now + 0.05);
}

function onTransport() {
  const collab = useCollab.getState();
  if (collab.status !== "live" || collab.role !== "guest" || collab.listenMode !== "click") {
    lastBeat = -1;
    return;
  }
  const project = useStore.getState().project;
  if (!project || !live.tick.playing) {
    lastBeat = -1;
    return;
  }
  if (!project.click && !live.tick.recording) return;
  const bpm = project.bpm || 120;
  const [num] = project.timeSig ?? [4, 4];
  const beat = Math.floor((live.tick.t * bpm) / 60 + 1e-6);
  if (beat === lastBeat) return;
  if (lastBeat >= 0 && beat > lastBeat + 8) {
    lastBeat = beat;
    return;
  }
  for (let b = lastBeat < 0 ? beat : lastBeat + 1; b <= beat; b++) tickClick(b % num === 0);
  lastBeat = beat;
}

export function startCueListen() {
  if (unsub) return;
  unsub = onTick(() => onTransport());
}

export function setListenMode(mode: ListenMode) {
  useCollab.setState({ listenMode: mode });
  if (mode === "click") void audio().resume();
}
