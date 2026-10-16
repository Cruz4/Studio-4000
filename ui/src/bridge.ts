// Talks to the native engine through JUCE's WebView2 interop, or to an in-browser mock during UI development.
import { createMock } from "./mock";

type Listener = (payload: any) => void;

interface JuceBackend {
  emitEvent(id: string, payload: unknown): void;
  addEventListener(id: string, fn: (payload: any) => void): unknown;
}

declare global {
  interface Window {
    __JUCE__?: { backend: JuceBackend; initialisationData: Record<string, unknown> };
  }
}

const listeners = new Map<string, Set<Listener>>();
let nativeCall: (name: string, ...args: unknown[]) => Promise<any>;

export const isNative = typeof window !== "undefined" && !!window.__JUCE__;

function emitLocal(type: string, payload: unknown) {
  listeners.get(type)?.forEach((fn) => fn(payload));
  listeners.get("*")?.forEach((fn) => fn({ type, payload }));
}

type RpcOverride = (method: string, params: Record<string, unknown>) => Promise<any> | null;
let rpcOverride: RpcOverride | null = null;
let nativeEventFilter: ((type: string) => boolean) | null = null;

/** While joined to someone else's session, calls go to the host instead of the local engine. */
export function setRpcOverride(fn: RpcOverride | null) {
  rpcOverride = fn;
}

/** Drops local engine events (e.g. while showing a remote host's session). */
export function setNativeEventFilter(fn: ((type: string) => boolean) | null) {
  nativeEventFilter = fn;
}

function emitNative(type: string, payload: unknown) {
  if (nativeEventFilter && !nativeEventFilter(type)) return;
  emitLocal(type, payload);
}

/** Calls the local engine even while a remote override is active. */
export async function localRpc<T = any>(method: string, params: Record<string, unknown> = {}, origin = "ui"): Promise<T> {
  const r = await nativeCall("rpc", method, params, origin);
  if (!r || !r.ok) throw new RpcError(r?.error ?? `Call failed: ${method}`);
  return r.result as T;
}

if (isNative) {
  const backend = window.__JUCE__!.backend;
  const pending = new Map<number, (v: any) => void>();
  let nextId = 0;

  backend.addEventListener("__juce__complete", ({ promiseId, result }: { promiseId: number; result: unknown }) => {
    const resolve = pending.get(promiseId);
    if (resolve) {
      pending.delete(promiseId);
      resolve(result);
    }
  });

  backend.addEventListener("s3", (e: { type: string; payload: unknown }) => emitNative(e.type, e.payload));

  nativeCall = (name, ...params) =>
    new Promise((resolve) => {
      const id = nextId++;
      pending.set(id, resolve);
      backend.emitEvent("__juce__invoke", { name, params, resultId: id });
    });
} else {
  const mock = createMock(emitNative);
  nativeCall = (name, ...params) => mock.native(name, params);
}

export class RpcError extends Error {}

/** Calls an engine method. Throws RpcError with a readable message on failure. */
export async function rpc<T = any>(method: string, params: Record<string, unknown> = {}, origin = "ui"): Promise<T> {
  const routed = rpcOverride?.(method, params);
  if (routed) return routed as Promise<T>;
  return localRpc<T>(method, params, origin);
}

/** Same as rpc but returns undefined instead of throwing, reporting the error as a toast. */
export async function tryRpc<T = any>(method: string, params: Record<string, unknown> = {}): Promise<T | undefined> {
  try {
    return await rpc<T>(method, params);
  } catch (e) {
    emitLocal("toast", { level: "error", message: (e as Error).message });
    return undefined;
  }
}

export function on(type: string, fn: Listener): () => void {
  if (!listeners.has(type)) listeners.set(type, new Set());
  listeners.get(type)!.add(fn);
  return () => listeners.get(type)?.delete(fn);
}

export function emit(type: string, payload: unknown) {
  emitLocal(type, payload);
}

export const native = {
  pickFile: (opts: { mode?: "open" | "save" | "folder"; title?: string; filters?: string; multiple?: boolean; dir?: string }) =>
    nativeCall("pickFile", opts) as Promise<string[]>,
  http: (req: { url: string; method?: string; headers?: Record<string, string>; body?: string; timeoutMs?: number }) =>
    nativeCall("http", req) as Promise<{ status: number; body: string; error?: string }>,
  secret: (name: string, value?: string) =>
    (value === undefined ? nativeCall("secret", name) : nativeCall("secret", name, value)) as Promise<string>,
  agentInfo: () => nativeCall("agentInfo") as Promise<{ port: number; token: string; configFile: string; mcpServer: string }>,
  window: (action: "fullscreen" | "minimise" | "title" | "quit", arg?: string) => nativeCall("window", action, arg ?? ""),
  openUrl: (url: string) => nativeCall("openUrl", url),
  checkUpdate: () => nativeCall("checkUpdate") as Promise<{ state: "current" | "staged" | "offline" | "failed" | "skipped" | "busy" }>,
};
