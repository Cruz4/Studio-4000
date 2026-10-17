// Live sessions: the host's engine is the single source of truth. Guests mirror its project and meters,
// send edits back as RPC calls, and everyone shares voice, screen, chat and notes.
import * as Y from "yjs";
import { create } from "zustand";
import { emit, localRpc, on, rpc, setNativeEventFilter, setRpcOverride } from "./bridge";
import { refreshProject, toast, useStore } from "./store";
import type { Project } from "./types";

export interface Peer { id: string; name: string; role: "host" | "guest"; colour: string }
export interface ChatLine { from: string; name: string; text: string; time: number }

interface CollabState {
  status: "idle" | "connecting" | "live" | "error";
  error: string | null;
  role: "host" | "guest" | null;
  room: string;
  /** Code the host sends, including the address of this computer. */
  invite: string;
  server: string;
  me: Peer | null;
  peers: Peer[];
  allowGuestEdits: boolean;
  micOn: boolean;
  sharing: boolean;
  streams: Record<string, MediaStream>;
  localScreen: MediaStream | null;
  chat: ChatLine[];
  notes: string;
  activity: { name: string; method: string; time: number }[];
  /** Where each other person is looking: timeline position under their pointer and their selected track. */
  presence: Record<string, { hover: number | null; track: string | null }>;
}

export const useCollab = create<CollabState>(() => ({
  status: "idle", error: null, role: null, room: "", invite: "", server: "", me: null, peers: [], allowGuestEdits: true,
  micOn: false, sharing: false, streams: {}, localScreen: null, chat: [], notes: "", activity: [], presence: {},
}));

let myHover: number | null = null;
let presenceTimer = 0;
function sendPresence() {
  if (presenceTimer) return;
  presenceTimer = window.setTimeout(() => {
    presenceTimer = 0;
    send({ kind: "presence", hover: myHover, track: useStore.getState().selectedTrack });
  }, 80);
}

/** Shares the timeline position under the local pointer (null when it leaves) with everyone in the session. */
export function reportHover(time: number | null) {
  if (useCollab.getState().status !== "live" || myHover === time) return;
  myHover = time;
  sendPresence();
}

const COLOURS = ["#ff6b8b", "#21e6a5", "#ffc857", "#00d1ff", "#a08bff", "#ff8a3d"];

/** Methods guests may never call on the host. */
const GUEST_BLOCKED = /^(settings\.|agent\.|devices\.|plugins\.(setPaths|block|unblock)|project\.(new|open|recover|reveal|saveCopy)|plugin\.(openEditor|closeEditor)|app\.describe)/;
/** Methods a guest always runs locally. */
const GUEST_LOCAL = /^(settings\.|devices\.|agent\.|app\.info$)/;

let ws: WebSocket | null = null;
let doc: Y.Doc | null = null;
let unsubs: (() => void)[] = [];
const pcs = new Map<string, { pc: RTCPeerConnection; makingOffer: boolean; ignoreOffer: boolean; polite: boolean }>();
let mic: MediaStream | null = null;
let rpcSeq = 0;
const pendingRpc = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: number }>();
let lastTickSent = 0;
let iceServers: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

const b64 = (u: Uint8Array) => { let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

function send(data: unknown, target = "*") {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "to", target, data }));
}

export function randomRoom() {
  const a = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => a[b % a.length]).join("");
}

/** A blank address, or this computer, means Studio 4000 should host the connection itself. */
export function isBuiltInServer(server: string) {
  return /^(wss?:\/\/)?(localhost|127\.0\.0\.1)(:\d+)?\/?$/i.test(server.trim()) || server.trim() === "";
}

/** A pasted code is either the room, or room@address from the host. */
export function parseJoinCode(raw: string): { room: string; server?: string } {
  const text = raw.trim();
  const at = text.lastIndexOf("@");
  if (at > 0 && at < text.length - 1) {
    const room = text.slice(0, at).trim().toUpperCase();
    let host = text.slice(at + 1).trim();
    if (!/^wss?:\/\//i.test(host)) host = `ws://${host}`;
    return { room, server: host };
  }
  return { room: text.toUpperCase() };
}

export async function startSession(opts: { server: string; room: string; name: string; role: "host" | "guest"; password?: string; turn?: string; invite?: string }) {
  await leaveSession();
  if (opts.turn) {
    try { iceServers = [{ urls: "stun:stun.l.google.com:19302" }, ...JSON.parse(opts.turn)]; } catch { /* keep defaults */ }
  }
  useCollab.setState({ status: "connecting", error: null, role: opts.role, room: opts.room.toUpperCase(), invite: opts.invite ?? "", server: opts.server, chat: [], notes: "", peers: [], activity: [] });

  doc = new Y.Doc();
  const chat = doc.getArray<ChatLine>("chat");
  const notes = doc.getText("notes");
  chat.observe(() => useCollab.setState({ chat: chat.toArray() }));
  notes.observe(() => useCollab.setState({ notes: notes.toString() }));
  doc.on("update", (update: Uint8Array, origin: unknown) => { if (origin !== "remote") send({ kind: "yjs", update: b64(update) }); });

  return new Promise<void>((resolve, reject) => {
    let socket: WebSocket;
    try { socket = new WebSocket(opts.server); } catch (e) { useCollab.setState({ status: "error", error: (e as Error).message }); return reject(e); }
    ws = socket;
    const fail = (msg: string) => { useCollab.setState({ status: "error", error: msg }); reject(new Error(msg)); };
    socket.onerror = () => fail(`Couldn't reach the session server at ${opts.server}`);
    socket.onclose = () => {
      if (ws === socket) {
        const was = useCollab.getState().status;
        teardown();
        useCollab.setState({ status: was === "live" ? "idle" : "error", error: was === "live" ? null : useCollab.getState().error });
        if (was === "live") toast("The session ended", "warning");
      }
    };
    socket.onopen = () => socket.send(JSON.stringify({ type: "join", room: opts.room.toUpperCase(), name: opts.name, role: opts.role, password: opts.password ?? "" }));
    socket.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === "error") return fail(msg.message);
      if (msg.type === "welcome") {
        const me: Peer = { id: msg.id, name: opts.name, role: opts.role, colour: COLOURS[msg.index % COLOURS.length] };
        useCollab.setState({ status: "live", me });
        if (opts.role === "host") becomeHost(); else becomeGuest();
        unsubs.push(useStore.subscribe((s, prev) => { if (s.selectedTrack !== prev.selectedTrack) sendPresence(); }));
        resolve();
      }
      if (msg.type === "peers") onPeers(msg.peers);
      if (msg.type === "from") onData(msg.from, msg.data);
    };
  });
}

export function leaveSession() {
  useCollab.setState({ status: "idle", error: null });
  const socket = ws;
  ws = null;
  if (socket) {
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
    try { socket.close(); } catch { /* already closed */ }
  }
  try { teardown(); } catch { /* the panel is already closed */ }
}

function teardown() {
  const wasGuest = useCollab.getState().role === "guest";
  unsubs.forEach((u) => u());
  unsubs = [];
  for (const { pc } of pcs.values()) pc.close();
  pcs.clear();
  mic?.getTracks().forEach((t) => t.stop());
  mic = null;
  useCollab.getState().localScreen?.getTracks().forEach((t) => t.stop());
  for (const p of pendingRpc.values()) { clearTimeout(p.timer); p.reject(new Error("The session ended")); }
  pendingRpc.clear();
  doc?.destroy();
  doc = null;
  setRpcOverride(null);
  setNativeEventFilter(null);
  useCollab.setState({ role: null, me: null, peers: [], invite: "", streams: {}, localScreen: null, micOn: false, sharing: false, presence: {} });
  myHover = null;
  if (wasGuest) refreshProject();
}

/* ------------------------------------------------------------------ host */

function becomeHost() {
  unsubs.push(on("project", (p: Project | null) => send({ kind: "project", project: p })));
  unsubs.push(on("tick", (t: unknown) => {
    const now = performance.now();
    if (now - lastTickSent < 66) return;
    lastTickSent = now;
    send({ kind: "tick", tick: t });
  }));
  for (const type of ["toast", "render", "saved"]) unsubs.push(on(type, (payload: unknown) => send({ kind: "event", type, payload })));
}

async function handleGuestRpc(from: string, id: number, method: string, params: Record<string, unknown>) {
  const peer = useCollab.getState().peers.find((p) => p.id === from);
  const reply = (ok: boolean, result?: unknown, error?: string) => send({ kind: "rpcResult", id, ok, result, error }, from);
  if (GUEST_BLOCKED.test(method)) return reply(false, undefined, "The host doesn't share that");
  const st = useCollab.getState();
  const reads = /^(project\.get|media\.(peaks|info|list|readFile)|plugins\.list|plugin\.(params|get)|chain\.list|ai\.|smart\.analyze|app\.info)/.test(method);
  if (!st.allowGuestEdits && !reads) return reply(false, undefined, "The host has made this session view-only");
  try {
    const result = await localRpc(method, params, "collab");
    reply(true, result);
    if (!reads && !/^transport\./.test(method)) {
      useCollab.setState((s) => ({ activity: [...s.activity.slice(-40), { name: peer?.name ?? "Guest", method, time: Date.now() }] }));
    }
  } catch (e) {
    reply(false, undefined, (e as Error).message);
  }
}

/* ------------------------------------------------------------------ guest */

function becomeGuest() {
  setNativeEventFilter((type) => !["project", "tick", "saved", "render", "recovery"].includes(type));
  setRpcOverride((method, params) => {
    if (GUEST_LOCAL.test(method)) return null;
    return new Promise((resolve, reject) => {
      const id = ++rpcSeq;
      const timer = window.setTimeout(() => { pendingRpc.delete(id); reject(new Error("The host didn't answer")); }, 60000);
      pendingRpc.set(id, { resolve, reject, timer });
      const host = useCollab.getState().peers.find((p) => p.role === "host");
      send({ kind: "rpc", id, method, params }, host?.id ?? "*");
    });
  });
  send({ kind: "hello" });
}

/* ------------------------------------------------------------------ messages */

function onPeers(list: { id: string; name: string; role: "host" | "guest"; index: number }[]) {
  const me = useCollab.getState().me;
  const peers = list.map((p) => ({ id: p.id, name: p.name, role: p.role, colour: COLOURS[p.index % COLOURS.length] }));
  const before = new Set(useCollab.getState().peers.map((p) => p.id));
  useCollab.setState((s) => ({ peers, presence: Object.fromEntries(Object.entries(s.presence).filter(([id]) => peers.some((p) => p.id === id))) }));
  if (before.size < peers.length) sendPresence();
  for (const p of peers) {
    if (p.id === me?.id || pcs.has(p.id)) continue;
    connectPeer(p.id);
    if (!before.has(p.id) && before.size) toast(`${p.name} joined`, "info");
  }
  for (const id of [...pcs.keys()]) {
    if (!peers.some((p) => p.id === id)) {
      pcs.get(id)!.pc.close();
      pcs.delete(id);
      useCollab.setState((s) => { const streams = { ...s.streams }; delete streams[id]; return { streams }; });
    }
  }
  if (useCollab.getState().role === "guest" && !peers.some((p) => p.role === "host")) toast("The host left the session", "warning");
}

function onData(from: string, d: any) {
  const role = useCollab.getState().role;
  switch (d.kind) {
    case "hello":
      if (role === "host") {
        send({ kind: "project", project: useStore.getState().project }, from);
        if (doc) send({ kind: "yjs", update: b64(Y.encodeStateAsUpdate(doc)) }, from);
      }
      break;
    case "project":
      if (role === "guest") emit("project", d.project);
      break;
    case "tick":
      if (role === "guest") emit("tick", d.tick);
      break;
    case "event":
      if (role === "guest") emit(d.type, d.payload);
      break;
    case "rpc":
      if (role === "host") handleGuestRpc(from, d.id, d.method, d.params ?? {});
      break;
    case "rpcResult": {
      const p = pendingRpc.get(d.id);
      if (!p) break;
      pendingRpc.delete(d.id);
      clearTimeout(p.timer);
      if (d.ok) p.resolve(d.result); else p.reject(new Error(d.error ?? "Failed on the host"));
      break;
    }
    case "yjs":
      if (doc) Y.applyUpdate(doc, unb64(d.update), "remote");
      break;
    case "rtc":
      onSignal(from, d);
      break;
    case "presence":
      useCollab.setState((s) => ({ presence: { ...s.presence, [from]: { hover: typeof d.hover === "number" ? d.hover : null, track: typeof d.track === "string" ? d.track : null } } }));
      break;
  }
}

/* ------------------------------------------------------------------ WebRTC */

function connectPeer(id: string) {
  const me = useCollab.getState().me!;
  const pc = new RTCPeerConnection({ iceServers });
  const entry = { pc, makingOffer: false, ignoreOffer: false, polite: me.id > id };
  pcs.set(id, entry);

  pc.onicecandidate = (e) => e.candidate && send({ kind: "rtc", candidate: e.candidate.toJSON() }, id);
  pc.onnegotiationneeded = async () => {
    try {
      entry.makingOffer = true;
      await pc.setLocalDescription();
      send({ kind: "rtc", sdp: pc.localDescription }, id);
    } catch (e) {
      console.warn(e);
    } finally {
      entry.makingOffer = false;
    }
  };
  pc.ontrack = (e) => {
    const stream = e.streams[0] ?? new MediaStream([e.track]);
    useCollab.setState((s) => ({ streams: { ...s.streams, [id]: stream } }));
    e.track.onended = () => useCollab.setState((s) => ({ streams: { ...s.streams } }));
  };
  for (const t of mic?.getTracks() ?? []) pc.addTrack(t, mic!);
  const screen = useCollab.getState().localScreen;
  for (const t of screen?.getTracks() ?? []) pc.addTrack(t, screen!);
  // Always open a channel so negotiation starts even before anyone shares media.
  pc.createDataChannel("s3");
}

async function onSignal(from: string, d: { sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit }) {
  if (!pcs.has(from)) connectPeer(from);
  const entry = pcs.get(from)!;
  const { pc } = entry;
  try {
    if (d.sdp) {
      const collision = d.sdp.type === "offer" && (entry.makingOffer || pc.signalingState !== "stable");
      entry.ignoreOffer = !entry.polite && collision;
      if (entry.ignoreOffer) return;
      await pc.setRemoteDescription(d.sdp);
      if (d.sdp.type === "offer") {
        await pc.setLocalDescription();
        send({ kind: "rtc", sdp: pc.localDescription }, from);
      }
    } else if (d.candidate) {
      try { await pc.addIceCandidate(d.candidate); } catch (e) { if (!entry.ignoreOffer) throw e; }
    }
  } catch (e) {
    console.warn("WebRTC", e);
  }
}

function addStreamToAll(stream: MediaStream) {
  for (const { pc } of pcs.values()) for (const t of stream.getTracks()) pc.addTrack(t, stream);
}

function removeStreamFromAll(stream: MediaStream) {
  for (const { pc } of pcs.values()) for (const s of pc.getSenders()) if (s.track && stream.getTracks().includes(s.track)) pc.removeTrack(s);
}

export async function toggleMic() {
  if (mic) {
    removeStreamFromAll(mic);
    mic.getTracks().forEach((t) => t.stop());
    mic = null;
    useCollab.setState({ micOn: false });
    return;
  }
  try {
    mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    addStreamToAll(mic);
    useCollab.setState({ micOn: true });
  } catch (e) {
    toast(`Microphone unavailable: ${(e as Error).message}`, "error");
  }
}

export async function toggleScreen() {
  const cur = useCollab.getState().localScreen;
  if (cur) {
    removeStreamFromAll(cur);
    cur.getTracks().forEach((t) => t.stop());
    useCollab.setState({ localScreen: null, sharing: false });
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: true });
    stream.getVideoTracks()[0].onended = () => { if (useCollab.getState().localScreen === stream) toggleScreen(); };
    addStreamToAll(stream);
    useCollab.setState({ localScreen: stream, sharing: true });
  } catch (e) {
    if ((e as Error).name !== "NotAllowedError") toast(`Screen sharing failed: ${(e as Error).message}`, "error");
  }
}

/* ------------------------------------------------------------------ chat, notes, files */

export function sendChat(text: string) {
  const me = useCollab.getState().me;
  if (!doc || !me || !text.trim()) return;
  doc.getArray<ChatLine>("chat").push([{ from: me.id, name: me.name, text: text.trim(), time: Date.now() }]);
}

/** The single changed span between two strings, so concurrent edits elsewhere in the text survive the merge. */
export function textEdit(cur: string, next: string) {
  let start = 0;
  while (start < cur.length && start < next.length && cur[start] === next[start]) start++;
  let endCur = cur.length, endNext = next.length;
  while (endCur > start && endNext > start && cur[endCur - 1] === next[endNext - 1]) { endCur--; endNext--; }
  return { index: start, remove: endCur - start, insert: next.slice(start, endNext) };
}

export function applyTextEdit(t: Y.Text, next: string) {
  const { index, remove, insert } = textEdit(t.toString(), next);
  if (!remove && !insert) return;
  t.doc!.transact(() => {
    if (remove) t.delete(index, remove);
    if (insert) t.insert(index, insert);
  });
}

export function setNotes(next: string) {
  if (doc) applyTextEdit(doc.getText("notes"), next);
}

/** Downloads a project file from the host (guests) or saves a copy (host). */
export async function downloadFile(file: string, name: string, onProgress?: (f: number) => void) {
  const chunks: Uint8Array[] = [];
  let offset = 0, total = 1;
  while (offset < total) {
    const r = await rpc<{ data: string; total: number }>("media.readFile", { file, offset, length: 1024 * 1024 });
    const bytes = unb64(r.data);
    chunks.push(bytes);
    total = r.total;
    offset += bytes.length;
    onProgress?.(offset / total);
    if (!bytes.length) break;
  }
  const blob = new Blob(chunks as BlobPart[]);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
