export interface Param {
  id: string;
  name: string;
  value: number;
  norm: number;
  text: string;
  min: number;
  max: number;
  automated: boolean;
  /** Default value, when the plug-in reports one. */
  def?: number;
  /** Present for stepped parameters (key, scale, wave shape…): shown as a list instead of a slider. */
  options?: { value: number; norm: number; label: string }[];
}

export interface Plugin {
  id: string;
  type: string;
  name: string;
  vendor: string;
  enabled: boolean;
  external: boolean;
  synth: boolean;
  loaded: boolean;
  hasEditor: boolean;
  numParams: number;
  params: Param[];
  canSidechain: boolean;
  sidechain: string | null;
  uid?: string;
}

export interface Send {
  id: string;
  bus: number;
  busName: string;
  gainDb: number;
  enabled: boolean;
}

export type Note = [pitch: number, startSec: number, lenSec: number, velocity: number, beat: number, lengthBeats: number];

export interface Clip {
  id: string;
  name: string;
  kind: "audio" | "midi" | "other";
  start: number;
  end: number;
  offset: number;
  colour: string;
  muted: boolean;
  speed: number;
  looping: boolean;
  file?: string;
  sourceLength?: number;
  channels?: number;
  gainDb?: number;
  pan?: number;
  fadeIn?: number;
  fadeOut?: number;
  pitch?: number;
  reversed?: boolean;
  autoTempo?: boolean;
  takes?: { count: number; current: number; names?: string[] };
  notes?: Note[];
}

export interface AutomationLane {
  pluginId: string;
  paramId: string;
  name: string;
  min: number;
  max: number;
  points: [number, number, number][];
}

export type TrackKind = "audio" | "instrument" | "return" | "group";

export interface Track {
  id: string;
  name: string;
  kind: TrackKind;
  colour: string;
  mute: boolean;
  solo: boolean;
  parent: string | null;
  automationMode: "read" | "touch" | "latch" | "write";
  automation: AutomationLane[];
  plugins: Plugin[];
  sends: Send[];
  returnBus?: number;
  volumeDb?: number;
  pan?: number;
  volumePluginId?: string;
  output?: string;
  input?: string;
  armed?: boolean;
  monitor?: "auto" | "on" | "off";
  /** The track's input is passing through its effects right now (monitor on, or armed with monitor auto). */
  live?: boolean;
  clips: Clip[];
}

export interface Project {
  name: string;
  file: string;
  dir: string;
  length: number;
  bpm: number;
  timeSig: [number, number];
  tempos: { beat: number; time: number; bpm: number }[];
  markers: { id: string; number: number; name: string; time: number; colour: string }[];
  tracks: Track[];
  master: { plugins: Plugin[]; volumeDb?: number; pan?: number; volumePluginId?: string };
  buses: { bus: number; name: string }[];
  click: boolean;
  clickRecordOnly: boolean;
  clickGainDb: number;
  countIn: "none" | "oneBar" | "twoBars" | "oneBeat" | "twoBeats";
  punch: boolean;
  loop: [number, number];
  looping: boolean;
  canUndo: boolean;
  canRedo: boolean;
  undoName: string;
  redoName: string;
  modified: boolean;
  sampleRate: number;
}

export interface Tick {
  t: number;
  playing: boolean;
  recording: boolean;
  looping: boolean;
  loop: [number, number];
  meters: Record<string, [number, number]>;
  master?: [number, number];
  lufs?: { m: number; s: number; i: number; peak: number };
  cpu: number;
}

export interface CatalogueEntry {
  id: string;
  name: string;
  vendor: string;
  category: string;
  synth: boolean;
  format: string;
  version?: string;
}

export interface PlanCall {
  method: string;
  params: Record<string, unknown>;
}

export interface Plan {
  summary: string;
  details?: unknown[];
  steps?: { title: string; summary: string; details: unknown[] }[];
  calls: PlanCall[];
  applied?: boolean;
}

export interface HealthIssue {
  level: "ok" | "info" | "warning" | "error";
  message: string;
  trackId?: string;
  fix?: string;
}

export interface Analysis {
  tracks: { id: string; name: string; role: string; lufs?: number; peakDb?: number; lra?: number; activeSeconds?: number; hasAudio: boolean }[];
  master?: { lufs: number; peakDb: number; lra: number; correlation: number; lowEndRatio: number };
  issues: HealthIssue[];
}

export interface AppInfo {
  version: string;
  /** Commit of this copy, from version.json beside the exe. Empty on a local build. */
  commit?: string;
  projectsDir: string;
  dataDir: string;
  hasProject: boolean;
  recent: { file: string; name: string; modified: string }[];
  onboarded: boolean;
}
