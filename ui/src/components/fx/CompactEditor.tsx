// The minimized effect card: a few controls and no graphs, for built-in effects and any other plug-in.
import type { Param } from "../../types";
import { Knob, Pick, Toggle } from "./core";
import type { Fx } from "./core";
import { knobLook } from "./knobLook";

/** The controls worth keeping when the card is small. Anything else waits for the open card. */
const PRIMARY: Record<string, string[]> = {
  s4000eq: ["b2gain", "b4gain", "b6gain", "output"],
  "4bandEq": ["Low-pass gain", "Mid gain 1", "Mid gain 2", "High-pass gain"],
  s4000comp: ["threshold", "ratio", "attack", "release"],
  compressor: ["threshold", "ratio", "attack", "release", "output gain"],
  s4000limiter: ["inputGain", "ceiling", "release"],
  s4000gate: ["threshold", "range", "attack", "release"],
  s4000deesser: ["frequency", "threshold", "range"],
  s4000transient: ["attack", "sustain", "output"],
  s4000tune: ["speed", "amount", "tolerance", "mix"],
  s4000saturator: ["drive", "tone", "output", "mix"],
  s4000crusher: ["bits", "downsample", "mix", "output"],
  s4000delay: ["feedback", "mix", "time"],
  s4000doubler: ["detune", "delay", "width", "mix"],
  s4000width: ["width", "bassMono", "output"],
  s4000tremolo: ["rate", "depth"],
  chorus: ["speedHz", "depthMs", "width", "mixProportion"],
  reverb: ["room size", "damping", "wet level", "dry level"],
};

function prefer(params: Param[]) {
  const knobs = params.filter((p) => !p.options?.length);
  const switches = params.filter((p) => p.options && p.options.length <= 8);
  return [...knobs, ...switches].slice(0, 6);
}

export function CompactEditor({ fx, type }: { fx: Fx; type?: string }) {
  const named = PRIMARY[type ?? ""] ?? [];
  const picked = named.map((id) => fx.get(id)).filter((p): p is Param => !!p);
  const params = (picked.length ? picked : prefer(fx.params)).slice(0, 6);
  if (!params.length) return <span className="small faint">{fx.ready ? "No controls on this plug-in." : "Loading…"}</span>;
  return (
    <div className="fx-compact">
      {params.map((p) => {
        const look = knobLook(type, p.id);
        return p.options?.length === 2 ? <Toggle key={p.id} fx={fx} pid={p.id} />
          : p.options?.length ? <Pick key={p.id} fx={fx} pid={p.id} />
            : <Knob key={p.id} fx={fx} pid={p.id} size={40} color={look.color} label={look.label} />;
      })}
    </div>
  );
}
