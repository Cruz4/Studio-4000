// Which editor each plug-in type opens with.
import type { ReactNode } from "react";
import { CrusherEditor, SaturatorEditor } from "./ColourEditors";
import { COLORS } from "./core";
import type { Fx } from "./core";
import { ClassicCompressorEditor, CompressorEditor, DeEsserEditor, GateEditor, LimiterEditor, TransientEditor } from "./DynamicsEditors";
import { EqEditor } from "./EqEditor";
import { GenericEditor } from "./GenericEditor";
import { ChorusEditor, DelayEditor, DoublerEditor, ReverbEditor, TremoloEditor, WidthEditor } from "./SpaceEditors";
import { TuneEditor } from "./TuneEditor";

export interface EditorEntry { render: (fx: Fx, id: string) => ReactNode; width: number; accent: string; kind: string }

export const EDITORS: Record<string, EditorEntry> = {
  s4000eq: { kind: "EQ", accent: COLORS.violet2, width: 940, render: (fx, id) => <EqEditor fx={fx} pluginId={id} /> },
  "4bandEq": { kind: "EQ", accent: COLORS.violet2, width: 860, render: (fx, id) => <EqEditor fx={fx} pluginId={id} classic /> },
  s4000comp: { kind: "Dynamics", accent: COLORS.amber, width: 900, render: (fx, id) => <CompressorEditor fx={fx} pluginId={id} /> },
  compressor: { kind: "Dynamics", accent: COLORS.amber, width: 780, render: (fx) => <ClassicCompressorEditor fx={fx} /> },
  s4000limiter: { kind: "Dynamics", accent: COLORS.red, width: 720, render: (fx, id) => <LimiterEditor fx={fx} pluginId={id} /> },
  s4000gate: { kind: "Dynamics", accent: COLORS.green, width: 820, render: (fx, id) => <GateEditor fx={fx} pluginId={id} /> },
  s4000deesser: { kind: "Dynamics", accent: COLORS.pink, width: 820, render: (fx, id) => <DeEsserEditor fx={fx} pluginId={id} /> },
  s4000transient: { kind: "Dynamics", accent: COLORS.orange, width: 760, render: (fx, id) => <TransientEditor fx={fx} pluginId={id} /> },
  s4000tune: { kind: "Pitch", accent: COLORS.cyan, width: 940, render: (fx, id) => <TuneEditor fx={fx} pluginId={id} /> },
  s4000saturator: { kind: "Saturation", accent: COLORS.orange, width: 860, render: (fx, id) => <SaturatorEditor fx={fx} pluginId={id} /> },
  s4000crusher: { kind: "Saturation", accent: COLORS.green, width: 760, render: (fx, id) => <CrusherEditor fx={fx} pluginId={id} /> },
  s4000delay: { kind: "Delay", accent: COLORS.cyan, width: 940, render: (fx, id) => <DelayEditor fx={fx} pluginId={id} /> },
  s4000doubler: { kind: "Stereo", accent: COLORS.pink, width: 820, render: (fx, id) => <DoublerEditor fx={fx} pluginId={id} /> },
  s4000width: { kind: "Stereo", accent: COLORS.violet2, width: 860, render: (fx, id) => <WidthEditor fx={fx} pluginId={id} /> },
  s4000tremolo: { kind: "Modulation", accent: COLORS.cyan, width: 860, render: (fx, id) => <TremoloEditor fx={fx} pluginId={id} /> },
  chorus: { kind: "Modulation", accent: COLORS.cyan, width: 640, render: (fx) => <ChorusEditor fx={fx} /> },
  reverb: { kind: "Reverb", accent: COLORS.violet2, width: 860, render: (fx) => <ReverbEditor fx={fx} /> },
};

const SHORT_NAMES: Record<string, string> = {
  s4000eq: "EQ", "4bandEq": "EQ", s4000comp: "Comp", compressor: "Comp", s4000limiter: "Limit", s4000gate: "Gate", s4000deesser: "De-ess",
  s4000transient: "Punch", s4000tune: "Tune", s4000saturator: "Sat", s4000crusher: "Crush", s4000delay: "Delay", s4000doubler: "Double",
  s4000width: "Width", s4000tremolo: "Trem", chorus: "Chorus", reverb: "Verb",
};

/** A few letters for tight spaces like the track headers. */
export const shortName = (p: { type: string; name: string }) => SHORT_NAMES[p.type] ?? p.name.replace(/^(DD|TAL|mda|Airwindows)\s+/i, "").split(/\s+/)[0].slice(0, 9);

export const accentFor = (p: { type: string; synth?: boolean; external?: boolean }) =>
  EDITORS[p.type]?.accent ?? (p.synth ? COLORS.cyan : p.external ? COLORS.amber : COLORS.violet2);

export const GENERIC: EditorEntry = { kind: "Effect", accent: COLORS.violet, width: 680, render: (fx) => <GenericEditor fx={fx} /> };
