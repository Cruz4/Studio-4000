import { create } from "zustand";
import { on, rpc } from "./bridge";
import type { AppInfo, CatalogueEntry, PlanCall, Project, Tick } from "./types";

export type BottomTab = "effects" | "mixer" | "editor" | "smart";
export type SidePanel = "assistant" | "collab" | null;
export type Grid = "bar" | "beat" | "1/8" | "1/16" | "off";
export type ArrangeTool = "move" | "time" | "split" | "slip" | "erase";

export interface Toast {
  id: number;
  level: "info" | "success" | "warning" | "error";
  title?: string;
  message: string;
  action?: { label: string; run: () => void };
}

export interface Approval {
  requestId: number;
  client: string;
  label: string;
  calls: PlanCall[];
}

export interface RenderState {
  job: number;
  state: "rendering" | "done";
  label?: string;
  step?: number;
  steps?: number;
  progress?: number;
  files?: string[];
  errors?: string;
}

interface State {
  info: AppInfo | null;
  project: Project | null;
  transport: { playing: boolean; recording: boolean };
  pxPerSec: number;
  grid: Grid;
  tool: ArrangeTool;
  timeFormat: "bars" | "time";
  selectedTrack: string | null;
  selectedClips: string[];
  editorClip: string | null;
  automationOpen: Record<string, string | null>;
  bottom: BottomTab | null;
  bottomHeight: number;
  browserOpen: boolean;
  side: SidePanel;
  paletteOpen: boolean;
  settingsOpen: string | null;
  exportOpen: boolean;
  shortcutsOpen: boolean;
  guideOpen: boolean;
  aboutOpen: boolean;
  historyOpen: boolean;
  toasts: Toast[];
  approvals: Approval[];
  render: RenderState | null;
  catalogue: CatalogueEntry[];
  scanning: { state: string; current?: string; progress?: number } | null;
  agentActivity: { client: string; method: string; ok: boolean; time: number }[];
  recovery: string | null;
  /** Main area: the track list (arrangement) or the full-page mixer. */
  view: "tracks" | "mixer";
  /** Effect slot highlighted for delete and other actions. A click selects; a double-click opens. */
  selectedPlugin: string | null;
  /** Every effect window currently open. Clicking the page does not close them. */
  openPlugins: string[];
  /** Bumped per effect when its window is opened again, so that window can flash. */
  pluginPings: Record<string, number>;
  /** Screen rectangle of the slot that opened each effect; the window is placed so it doesn't cover it. */
  pluginAnchors: Record<string, { left: number; top: number; right: number; bottom: number }>;
  picker: { trackId: string; synth?: boolean } | null;
  browserTab: BrowserTab;
  devices: Devices | null;
  /** On-screen keyboard strip, and whether the computer keyboard plays notes. */
  keysOpen: boolean;
  typing: boolean;
  octave: number;
  velocity: number;
  set: (s: Partial<State>) => void;
}

export type BrowserTab = "fx" | "inst" | "media" | "chains";

export interface Devices {
  audioInputs: string[];
  midiInputs: { name: string; virtual: boolean }[];
  outputs: string[];
  masterOutput?: string;
}

export const useStore = create<State>((set) => ({
  info: null,
  project: null,
  transport: { playing: false, recording: false },
  pxPerSec: 48,
  grid: "beat",
  tool: "move",
  timeFormat: "bars",
  selectedTrack: null,
  selectedClips: [],
  editorClip: null,
  automationOpen: {},
  bottom: "effects",
  bottomHeight: 340,
  browserOpen: true,
  side: null,
  paletteOpen: false,
  settingsOpen: null,
  exportOpen: false,
  shortcutsOpen: false,
  guideOpen: false,
  aboutOpen: false,
  historyOpen: false,
  toasts: [],
  approvals: [],
  render: null,
  catalogue: [],
  scanning: null,
  agentActivity: [],
  recovery: null,
  view: "tracks",
  selectedPlugin: null,
  openPlugins: [],
  pluginPings: {},
  pluginAnchors: {},
  picker: null,
  browserTab: "fx",
  devices: null,
  keysOpen: false,
  typing: false,
  octave: 4,
  velocity: 100,
  set: (s) => set(s),
}));

export async function loadDevices() {
  interface Raw { waveInputs?: { name: string; enabled: boolean }[]; midiInputs?: { name: string; enabled: boolean; virtual?: boolean }[];
    waveOutputs?: { name: string; enabled: boolean }[]; masterOutput?: string; output?: string }
  const d = await rpc<Raw>("devices.get");
  const devices: Devices = {
    audioInputs: (d.waveInputs ?? []).filter((w) => w.enabled).map((w) => w.name),
    midiInputs: (d.midiInputs ?? []).filter((m) => m.enabled).map((m) => ({ name: m.name, virtual: !!m.virtual })),
    outputs: (d.waveOutputs ?? []).filter((w) => w.enabled).map((w) => w.name),
    masterOutput: d.masterOutput,
  };
  useStore.setState({ devices });
  return devices;
}

/** High-rate playback state kept outside React; components read it in animation frames. */
export const live: { tick: Tick } = {
  tick: { t: 0, playing: false, recording: false, looping: false, loop: [0, 0], meters: {}, cpu: 0 },
};

const tickListeners = new Set<(t: Tick) => void>();

export function onTick(fn: (t: Tick) => void) {
  tickListeners.add(fn);
  return () => tickListeners.delete(fn);
}

let toastId = 0;

export function toast(message: string, level: Toast["level"] = "info", extra: Partial<Toast> = {}) {
  const id = ++toastId;
  useStore.setState((s) => ({ toasts: [...s.toasts.slice(-4), { id, level, message, ...extra }] }));
  setTimeout(() => useStore.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), level === "error" ? 7000 : 4000);
}

export async function refreshInfo() {
  const info = await rpc<AppInfo>("app.info");
  useStore.setState({ info });
  return info;
}

export async function refreshProject() {
  const project = await rpc<Project | null>("project.get").catch(() => null);
  useStore.setState({ project });
}

export async function loadCatalogue() {
  const r = await rpc<{ plugins: CatalogueEntry[] }>("plugins.list");
  useStore.setState({ catalogue: r.plugins });
}

/** Highlights an effect so Delete and the other slot actions apply to it, without opening its window. */
export function selectPlugin(id: string | null) {
  useStore.setState({ selectedPlugin: id, ...(id ? { selectedClips: [] } : {}) });
}

/** Opens an effect window beside the slot that asked for it. Other open windows stay open. */
export function openPlugin(id: string, from?: Element | null) {
  const r = from?.getBoundingClientRect();
  useStore.setState((s) => ({
    selectedPlugin: id,
    selectedClips: [],
    openPlugins: s.openPlugins.includes(id) ? s.openPlugins : [...s.openPlugins, id],
    pluginPings: { ...s.pluginPings, [id]: (s.pluginPings[id] ?? 0) + 1 },
    pluginAnchors: r ? { ...s.pluginAnchors, [id]: { left: r.left, top: r.top, right: r.right, bottom: r.bottom } } : s.pluginAnchors,
  }));
}

export function closePlugin(id: string) {
  useStore.setState((s) => ({
    openPlugins: s.openPlugins.filter((x) => x !== id),
    selectedPlugin: s.selectedPlugin === id ? null : s.selectedPlugin,
  }));
}

export async function act(method: string, params: Record<string, unknown> = {}) {
  try {
    return await rpc(method, params);
  } catch (e) {
    toast((e as Error).message, "error");
    return undefined;
  }
}

export function initEvents() {
  on("project", (p: Project | null) => {
    const s = useStore.getState();
    const ids = new Set(p?.tracks.flatMap((t) => t.clips.map((c) => c.id)) ?? []);
    const pluginIds = new Set([
      ...(p?.tracks.flatMap((t) => t.plugins.map((pl) => pl.id)) ?? []),
      ...(p?.master.plugins.map((pl) => pl.id) ?? []),
    ]);
    useStore.setState({
      project: p,
      selectedClips: s.selectedClips.filter((id) => ids.has(id)),
      editorClip: s.editorClip && ids.has(s.editorClip) ? s.editorClip : null,
      openPlugins: s.openPlugins.filter((id) => pluginIds.has(id)),
      selectedPlugin: s.selectedPlugin && pluginIds.has(s.selectedPlugin) ? s.selectedPlugin : null,
    });
  });

  on("tick", (t: Tick) => {
    live.tick = t;
    const tr = useStore.getState().transport;
    if (tr.playing !== t.playing || tr.recording !== t.recording)
      useStore.setState({ transport: { playing: t.playing, recording: t.recording } });
    tickListeners.forEach((fn) => fn(t));
  });

  on("toast", (t: { level?: Toast["level"]; title?: string; message: string }) => toast(t.message, t.level ?? "info", { title: t.title }));
  on("saved", () => useStore.setState((s) => (s.project ? { project: { ...s.project, modified: false } } : {})));
  on("recovery", (r: { file: string }) => useStore.setState({ recovery: r.file }));

  on("render", (r: RenderState) => {
    useStore.setState({ render: r });
    if (r.state === "done") {
      if (r.errors) toast(r.errors, "error", { title: "Export problems" });
      else toast(`Exported ${r.files?.length ?? 0} file(s)`, "success", {
        action: r.files?.[0] ? { label: "Show", run: () => rpc("project.reveal", { file: r.files![0] }) } : undefined,
      });
      setTimeout(() => useStore.setState((s) => (s.render?.job === r.job ? { render: null } : {})), 2500);
    }
  });

  on("archive", (r: { ok: boolean; file: string }) =>
    r.ok ? toast("Project archived", "success", { action: { label: "Show", run: () => rpc("project.reveal", { file: r.file }) } })
         : toast("Archiving failed", "error"));

  on("pluginScan", (s: { state: string; current?: string; progress?: number; found?: number; failed?: string[] }) => {
    useStore.setState({ scanning: s.state === "done" ? null : s });
    if (s.state === "done") {
      loadCatalogue();
      toast(`Plug-in scan finished: ${s.found} available${s.failed?.length ? `, ${s.failed.length} blocked` : ""}`, "success");
    }
  });

  on("agent.approval", (a: Approval) => useStore.setState((s) => ({ approvals: [...s.approvals, a] })));
  on("agent.approvalClosed", (a: { requestId: number }) =>
    useStore.setState((s) => ({ approvals: s.approvals.filter((x) => x.requestId !== a.requestId) })));
  on("agent.activity", (a: { client: string; method: string; ok: boolean }) =>
    useStore.setState((s) => ({ agentActivity: [...s.agentActivity.slice(-30), { ...a, time: Date.now() }] })));
}
