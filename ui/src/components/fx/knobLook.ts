// One color (and label, when the editor renames it) per knob, shared by the minimized card,
// the expanded card, and the window that opens on double-click.
import { BAND_COLORS, COLORS } from "./core";

export interface KnobLook { color: string; label?: string }

const V = COLORS.violet2;

/** `${pluginType}.${paramId}` → the look used everywhere that knob appears. */
const LOOK: Record<string, KnobLook> = {
  "s4000eq.output": { color: V, label: "Output" },

  "s4000comp.threshold": { color: COLORS.amber },
  "s4000comp.ratio": { color: V },
  "s4000comp.knee": { color: V },
  "s4000comp.attack": { color: COLORS.green },
  "s4000comp.release": { color: COLORS.green },
  "s4000comp.makeup": { color: COLORS.cyan, label: "Make-up" },
  "s4000comp.scHpf": { color: COLORS.pink, label: "Sidechain HPF" },
  "s4000comp.mix": { color: COLORS.cyan, label: "Dry / wet" },

  "compressor.threshold": { color: COLORS.amber },
  "compressor.ratio": { color: V },
  "compressor.attack": { color: COLORS.green },
  "compressor.release": { color: COLORS.green },
  "compressor.output gain": { color: COLORS.cyan, label: "Output" },
  "compressor.input gain": { color: COLORS.pink, label: "Sidechain gain" },

  "s4000limiter.inputGain": { color: COLORS.orange, label: "Drive" },
  "s4000limiter.ceiling": { color: COLORS.amber },
  "s4000limiter.release": { color: COLORS.green },

  "s4000gate.threshold": { color: COLORS.amber },
  "s4000gate.range": { color: V, label: "Floor" },
  "s4000gate.attack": { color: COLORS.green },
  "s4000gate.hold": { color: COLORS.green },
  "s4000gate.release": { color: COLORS.green },

  "s4000deesser.frequency": { color: COLORS.pink },
  "s4000deesser.threshold": { color: COLORS.amber },
  "s4000deesser.range": { color: COLORS.red, label: "Max reduction" },

  "s4000transient.attack": { color: COLORS.orange },
  "s4000transient.sustain": { color: V },
  "s4000transient.output": { color: COLORS.cyan },

  "s4000tune.speed": { color: COLORS.cyan, label: "Retune speed" },
  "s4000tune.amount": { color: V, label: "Correction amount" },
  "s4000tune.tolerance": { color: COLORS.amber },
  "s4000tune.mix": { color: COLORS.green, label: "Dry / wet" },

  "s4000saturator.drive": { color: COLORS.orange },
  "s4000saturator.tone": { color: COLORS.amber },
  "s4000saturator.output": { color: COLORS.cyan },
  "s4000saturator.mix": { color: COLORS.green, label: "Dry / wet" },

  "s4000crusher.bits": { color: COLORS.green },
  "s4000crusher.downsample": { color: COLORS.cyan, label: "Downsample" },
  "s4000crusher.mix": { color: V, label: "Dry / wet" },
  "s4000crusher.output": { color: COLORS.amber },

  "s4000delay.time": { color: COLORS.cyan, label: "Free time" },
  "s4000delay.feedback": { color: V },
  "s4000delay.lowCut": { color: COLORS.amber, label: "Low cut" },
  "s4000delay.highCut": { color: COLORS.amber, label: "High cut" },
  "s4000delay.mix": { color: COLORS.green, label: "Dry / wet" },

  "s4000doubler.detune": { color: COLORS.pink },
  "s4000doubler.delay": { color: COLORS.cyan },
  "s4000doubler.width": { color: V },
  "s4000doubler.mix": { color: COLORS.green, label: "Double level" },

  "s4000width.width": { color: V },
  "s4000width.bassMono": { color: COLORS.amber, label: "Mono below" },
  "s4000width.output": { color: COLORS.cyan },

  "s4000tremolo.rate": { color: COLORS.cyan },
  "s4000tremolo.depth": { color: V },

  "chorus.depthMs": { color: COLORS.cyan, label: "Depth" },
  "chorus.speedHz": { color: V, label: "Speed" },
  "chorus.width": { color: COLORS.pink, label: "Width" },
  "chorus.mixProportion": { color: COLORS.green, label: "Mix" },

  "reverb.room size": { color: V, label: "Size" },
  "reverb.damping": { color: COLORS.amber },
  "reverb.width": { color: COLORS.cyan },
  "reverb.wet level": { color: COLORS.green, label: "Wet" },
  "reverb.dry level": { color: "#cfd3e6", label: "Dry" },

  "4bandEq.Low-pass freq": { color: BAND_COLORS[0] },
  "4bandEq.Low-pass gain": { color: BAND_COLORS[0] },
  "4bandEq.Low-pass Q": { color: BAND_COLORS[0] },
  "4bandEq.Mid freq 1": { color: BAND_COLORS[1] },
  "4bandEq.Mid gain 1": { color: BAND_COLORS[1] },
  "4bandEq.Mid Q 1": { color: BAND_COLORS[1] },
  "4bandEq.Mid freq 2": { color: BAND_COLORS[2] },
  "4bandEq.Mid gain 2": { color: BAND_COLORS[2] },
  "4bandEq.Mid Q 2": { color: BAND_COLORS[2] },
  "4bandEq.High-pass freq": { color: BAND_COLORS[3] },
  "4bandEq.High-pass gain": { color: BAND_COLORS[3] },
  "4bandEq.High-pass Q": { color: BAND_COLORS[3] },
};

function hashColor(id: string) {
  let h = 0;
  for (const c of id) h = (Math.imul(h, 33) + c.charCodeAt(0)) >>> 0;
  return BAND_COLORS[h % BAND_COLORS.length];
}

/** The same parameter gets the same color in every effect view. Unknown plug-ins hash the parameter id, so a knob never changes color between minimized, expanded, and the open window. */
export function knobLook(type: string | undefined, pid: string): KnobLook {
  if (type === "s4000eq") {
    const band = /^b(\d)(?:freq|gain|q|slope|on|type)$/.exec(pid);
    if (band) return { color: BAND_COLORS[(Number(band[1]) - 1) % BAND_COLORS.length] };
  }
  return LOOK[`${type ?? ""}.${pid}`] ?? { color: hashColor(pid) };
}
