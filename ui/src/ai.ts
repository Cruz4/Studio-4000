// Bring-your-own-model assistant. Reads run immediately; every edit is proposed as a plan the user approves.
import { native, rpc } from "./bridge";
import { useStore } from "./store";
import type { PlanCall } from "./types";

export type Provider = "openai" | "anthropic" | "compatible";

export interface AiConfig {
  provider: Provider;
  model: string;
  baseUrl: string;
}

export const PROVIDERS: Record<Provider, { label: string; model: string; baseUrl: string; needsKey: boolean; hint: string }> = {
  openai: { label: "OpenAI", model: "gpt-4.1", baseUrl: "https://api.openai.com/v1", needsKey: true, hint: "Key from platform.openai.com" },
  anthropic: { label: "Anthropic Claude", model: "claude-sonnet-4-5", baseUrl: "https://api.anthropic.com/v1", needsKey: true, hint: "Key from console.anthropic.com" },
  compatible: { label: "OpenAI-compatible (Ollama, LM Studio, OpenRouter, Groq…)", model: "llama3.1", baseUrl: "http://localhost:11434/v1", needsKey: false, hint: "Local servers usually need no key" },
};

export interface ToolCall { id: string; name: string; args: Record<string, unknown> }

export type Msg =
  | { role: "user"; content: string; hidden?: boolean }
  | { role: "assistant"; content: string; toolCalls?: ToolCall[] }
  | { role: "tool"; toolCallId: string; name: string; content: string };

export interface ProposedPlan { summary: string; steps: string[]; calls: PlanCall[] }

interface MethodInfo { name: string; write: boolean; description: string; params: string }

export async function loadConfig(): Promise<AiConfig> {
  const get = (key: string) => rpc<string>("settings.get", { key }).catch(() => "");
  const provider = ((await get("aiProvider")) || "openai") as Provider;
  const def = PROVIDERS[provider] ?? PROVIDERS.openai;
  return { provider, model: (await get("aiModel")) || def.model, baseUrl: (await get("aiBaseUrl")) || def.baseUrl };
}

export async function saveConfig(c: AiConfig, key?: string) {
  await rpc("settings.set", { key: "aiProvider", value: c.provider });
  await rpc("settings.set", { key: "aiModel", value: c.model });
  await rpc("settings.set", { key: "aiBaseUrl", value: c.baseUrl });
  if (key !== undefined) await native.secret(`AiKey_${c.provider}`, key);
}

export const getKey = (p: Provider) => native.secret(`AiKey_${p}`).then((k) => k || "").catch(() => "");

const toolName = (m: string) => m.replace(/\./g, "__");
const methodName = (t: string) => t.replace(/__/g, ".");

const READ_BLOCKLIST = new Set(["batch.run", "export.render", "edit.undo"]);

let methodCache: MethodInfo[] | null = null;

async function methods() {
  if (!methodCache) methodCache = await rpc<MethodInfo[]>("ai.tools");
  return methodCache;
}

function schemaFor(m: MethodInfo) {
  return {
    type: "object",
    description: `Parameters: ${m.params}`,
    additionalProperties: true,
    properties: {},
  };
}

async function toolset() {
  const all = await methods();
  const reads = all.filter((m) => !m.write && !READ_BLOCKLIST.has(m.name));
  const tools = reads.map((m) => ({
    name: toolName(m.name),
    description: `${m.description}. Params ${m.params}.${m.name.startsWith("smart.") ? " Returns a plan (summary, steps, calls) without changing anything; put its calls into propose_plan to apply." : ""}`,
    schema: schemaFor(m),
  }));
  tools.push({
    name: "propose_plan",
    description: "Proposes edits to the project. The user sees the plan and approves or rejects it; nothing changes until then. Calls run in order as ONE undo step. A string param like \"$0[0]\" or \"$2.id\" refers to the result of an earlier call in the same plan (track.add returns [id], plugin.add returns {id}).",
    schema: {
      type: "object",
      additionalProperties: false,
      description: "",
      properties: {
        summary: { type: "string", description: "One sentence the user reads first" },
        steps: { type: "array", items: { type: "string" }, description: "Short human-readable steps" },
        calls: {
          type: "array",
          description: "Edit method calls",
          items: { type: "object", properties: { method: { type: "string" }, params: { type: "object", additionalProperties: true } }, required: ["method", "params"] },
        },
      },
      required: ["summary", "calls"],
    } as unknown as ReturnType<typeof schemaFor>,
  });
  return tools;
}

async function systemPrompt(takeOver: boolean) {
  const all = await methods();
  const edits = all.filter((m) => m.write || m.name.startsWith("smart.")).map((m) => `- ${m.name} ${m.params}: ${m.description}`).join("\n");
  const context = await rpc<string>("ai.context").catch(() => "No project is open.");
  const focus = describeFocus();
  return `You are a first-class editor inside Studio 4000 — not a chatbot on the side. You edit the session the way a producer would: inspect, decide, propose concrete calls, wait for approval.

How you work:
- Read first (project.get, plugin.params, smart.analyze). Then propose_plan. Nothing changes until the musician approves.
- Prefer smart.* for gain staging, ducking, vocal chains and mastering; you may combine and adjust those calls.
- Recording: arm with track.arm, click with transport.setClick, punch/loop with transport.setLoop + transport.setPunch. MIDI records like a vocal: loop + record stacks takes. midi.capture drops notes they already played. clip.toMidi turns a hummed/sung audio clip into notes. clip.bounce prints MIDI through the instrument as audio.
- Guest sessions: track.setCue marks the headphone mix (click + those tracks). Do not tell them to share the full mix — it arrives late.
- Volumes are dB, pan is -1..1. Plug-in params use plugin.setParam; get ranges from plugin.params. Built-in ids come from plugins.list (s4000eq, s4000comp, s4000tune, 4osc, …).
- Be brief. Say the musical why in one line. Never paste JSON or raw tool dumps.
${takeOver ? "- TAKE-OVER: one complete ordered plan, then re-check. Stop when the session is in good shape.\n" : ""}
What they have selected right now:
${focus}

Edit methods for propose_plan:
${edits}

Current project:
${context}`;
}

function describeFocus() {
  try {
    const s = useStore.getState();
    const p = s.project;
    if (!p) return "No project open.";
    const tracks = p.tracks.filter((t) => s.selectedTracks.includes(t.id) || t.id === s.selectedTrack);
    const clips = p.tracks.flatMap((t) => t.clips.filter((c) => s.selectedClips.includes(c.id)));
    const bits: string[] = [];
    bits.push(`Playhead ${s.transport.playing ? "playing" : "stopped"} (use project.get for exact time).`);
    if (tracks.length) bits.push(`Selected track(s): ${tracks.map((t) => `${t.name} [${t.id}] ${t.kind}${t.armed ? " armed" : ""}${t.cue ? " cue" : ""}`).join("; ")}`);
    if (clips.length) bits.push(`Selected clip(s): ${clips.map((c) => `${c.name} [${c.id}] ${c.kind} ${c.start.toFixed(2)}-${c.end.toFixed(2)}s`).join("; ")}`);
    if (s.editorClip) bits.push(`Editor is open on clip ${s.editorClip}.`);
    return bits.join("\n") || "Nothing selected.";
  } catch {
    return "Selection unknown.";
  }
}

function truncate(s: string, n = 14000) {
  return s.length > n ? s.slice(0, n) + `\n…(${s.length - n} more characters truncated)` : s;
}

async function callModel(cfg: AiConfig, key: string, system: string, msgs: Msg[], tools: Awaited<ReturnType<typeof toolset>>) {
  if (cfg.provider === "anthropic") {
    const messages: unknown[] = [];
    for (const m of msgs) {
      if (m.role === "user") messages.push({ role: "user", content: m.content });
      else if (m.role === "assistant") {
        const content: unknown[] = [];
        if (m.content) content.push({ type: "text", text: m.content });
        for (const t of m.toolCalls ?? []) content.push({ type: "tool_use", id: t.id, name: t.name, input: t.args });
        messages.push({ role: "assistant", content });
      } else {
        const block = { type: "tool_result", tool_use_id: m.toolCallId, content: m.content };
        const last = messages[messages.length - 1] as { role: string; content: unknown[] } | undefined;
        if (last && last.role === "user" && Array.isArray(last.content)) last.content.push(block);
        else messages.push({ role: "user", content: [block] });
      }
    }
    const r = await native.http({
      url: `${cfg.baseUrl.replace(/\/$/, "")}/messages`, method: "POST", timeoutMs: 120000,
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: cfg.model, max_tokens: 4096, system, messages, tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.schema })) }),
    });
    const j = parse(r);
    const text = (j.content ?? []).filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("\n");
    const calls: ToolCall[] = (j.content ?? []).filter((b: { type: string }) => b.type === "tool_use").map((b: { id: string; name: string; input: Record<string, unknown> }) => ({ id: b.id, name: b.name, args: b.input ?? {} }));
    return { text, calls };
  }

  const messages: unknown[] = [{ role: "system", content: system }];
  for (const m of msgs) {
    if (m.role === "user") messages.push({ role: "user", content: m.content });
    else if (m.role === "assistant") messages.push({
      role: "assistant", content: m.content || null,
      ...(m.toolCalls?.length ? { tool_calls: m.toolCalls.map((t) => ({ id: t.id, type: "function", function: { name: t.name, arguments: JSON.stringify(t.args) } })) } : {}),
    });
    else messages.push({ role: "tool", tool_call_id: m.toolCallId, content: m.content });
  }
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (key) headers.authorization = `Bearer ${key}`;
  const r = await native.http({
    url: `${cfg.baseUrl.replace(/\/$/, "")}/chat/completions`, method: "POST", timeoutMs: 180000, headers,
    body: JSON.stringify({ model: cfg.model, messages, tools: tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.schema } })), tool_choice: "auto" }),
  });
  const j = parse(r);
  const msg = j.choices?.[0]?.message ?? {};
  const calls: ToolCall[] = (msg.tool_calls ?? []).map((t: { id: string; function: { name: string; arguments: string } }) => {
    let args: Record<string, unknown> = {};
    try { args = JSON.parse(t.function.arguments || "{}"); } catch { args = {}; }
    return { id: t.id, name: t.function.name, args };
  });
  return { text: msg.content ?? "", calls };
}

function parse(r: { status: number; body: string; error?: string }) {
  if (r.error) throw new Error(r.error);
  let j: any;
  try { j = JSON.parse(r.body); } catch { throw new Error(`The model service answered ${r.status}: ${r.body.slice(0, 300)}`); }
  if (r.status >= 400) throw new Error(j.error?.message ?? j.message ?? `The model service answered ${r.status}`);
  return j;
}

export interface AgentEvents {
  onMessage: (m: Msg) => void;
  onPlan: (p: ProposedPlan) => void;
  onStatus: (s: string | null) => void;
}

/** Smart Mix on this computer when no model key is connected. */
async function runLocalAssistant(history: Msg[], ev: AgentEvents) {
  const asked = [...history].reverse().find((m) => m.role === "user")?.content.toLowerCase() ?? "";
  ev.onStatus("Working from Smart Mix (no model key)…");
  try {
    const s = useStore.getState();
    const track = s.project?.tracks.find((t) => t.id === s.selectedTrack);
    const clip = s.project?.tracks.flatMap((t) => t.clips).find((c) => s.selectedClips.includes(c.id));
    if (/audio to midi|hum|sung|melody from/.test(asked) && clip?.kind === "audio") {
      ev.onPlan({ summary: "Turn the selected audio into MIDI notes", steps: ["Detect pitch", "Drop notes on an instrument track"], calls: [{ method: "clip.toMidi", params: { id: clip.id } }] });
      ev.onMessage({ role: "assistant", content: "No model key is connected, so I'm using the built-in pitch reader. Approve to turn that clip into MIDI." });
      ev.onStatus(null);
      return;
    }
    if (/print|bounce|midi to audio|freeze/.test(asked) && clip?.kind === "midi") {
      ev.onPlan({ summary: "Print the selected MIDI through the instrument as audio", steps: ["Render the instrument", "Drop a new audio clip"], calls: [{ method: "clip.bounce", params: { id: clip.id } }] });
      ev.onMessage({ role: "assistant", content: "I'll print that MIDI as audio so you can fade and comp it like a vocal." });
      ev.onStatus(null);
      return;
    }
    if (/capture midi|catch|already played/.test(asked)) {
      ev.onPlan({ summary: "Capture the notes you just played", steps: ["Write the last notes onto an instrument track"], calls: [{ method: "midi.capture", params: { trackId: track?.kind === "instrument" ? track.id : undefined, seconds: 30 } }] });
      ev.onMessage({ role: "assistant", content: "I'll drop the notes you already played onto the timeline." });
      ev.onStatus(null);
      return;
    }
    if (/vocal chain|tune|comp the vocal/.test(asked) && track) {
      const plan = await rpc<ProposedPlan>("smart.vocalChain", { trackId: track.id, style: /warm/.test(asked) ? "warm" : /podcast/.test(asked) ? "podcast" : "pop" });
      ev.onPlan(plan);
      ev.onMessage({ role: "assistant", content: "No model key — this is the built-in vocal chain. Approve to add it." });
      ev.onStatus(null);
      return;
    }
    if (/duck/.test(asked)) {
      const plan = await rpc<ProposedPlan>("smart.duck", {});
      ev.onPlan(plan);
      ev.onMessage({ role: "assistant", content: "Built-in ducking plan. Approve to write the automation." });
      ev.onStatus(null);
      return;
    }
    if (/master|spotify|loud/.test(asked)) {
      const plan = await rpc<ProposedPlan>("smart.master", {});
      ev.onPlan(plan);
      ev.onMessage({ role: "assistant", content: "Built-in master toward a streaming target. Approve to apply." });
      ev.onStatus(null);
      return;
    }
    const report = await rpc<{ issues?: { message: string }[]; master?: { lufs?: number } }>("smart.analyze", { master: true });
    const issues = report.issues ?? [];
    const mix = await rpc<ProposedPlan>("smart.mix", {});
    ev.onPlan(mix);
    ev.onMessage({
      role: "assistant",
      content: `No model key is connected, so I'm using Smart Mix on this computer.${
        issues.length ? ` I see: ${issues.slice(0, 4).map((i) => i.message).join(" ")}` : ""
      } Approve the plan, or add a key in Settings → AI for a smarter editor.`,
    });
  } catch (e) {
    ev.onMessage({ role: "assistant", content: `I can still help without a key once a project is open. ${(e as Error).message}` });
  }
  ev.onStatus(null);
}

/** Runs model turns until it answers in text or proposes a plan. */
export async function runAgent(cfg: AiConfig, history: Msg[], takeOver: boolean, ev: AgentEvents, signal: { cancelled: boolean }) {
  const key = await getKey(cfg.provider);
  if (PROVIDERS[cfg.provider].needsKey && !key) {
    await runLocalAssistant(history, ev);
    return history;
  }
  const tools = await toolset();
  const system = await systemPrompt(takeOver);
  const msgs = [...history];

  for (let round = 0; round < 14 && !signal.cancelled; round++) {
    ev.onStatus("Thinking…");
    const { text, calls } = await callModel(cfg, key, system, msgs, tools);
    const reply: Msg = { role: "assistant", content: text, toolCalls: calls.length ? calls : undefined };
    msgs.push(reply);
    ev.onMessage(reply);
    if (!calls.length) break;

    let proposed = false;
    for (const c of calls) {
      if (signal.cancelled) break;
      let result: string;
      if (c.name === "propose_plan") {
        const calls = (Array.isArray(c.args.calls) ? c.args.calls : []) as PlanCall[];
        ev.onPlan({ summary: String(c.args.summary ?? "Proposed changes"), steps: (c.args.steps as string[]) ?? [], calls });
        result = "The plan is shown to the user, waiting for approval. Stop here; you'll be told the outcome.";
        proposed = true;
      } else {
        const method = methodName(c.name);
        ev.onStatus(`Checking ${method}…`);
        try {
          const params = { ...c.args };
          delete params.apply;
          result = truncate(JSON.stringify(await rpc(method, params, "assistant")));
        } catch (e) {
          result = `Error: ${(e as Error).message}`;
        }
      }
      const toolMsg: Msg = { role: "tool", toolCallId: c.id, name: c.name, content: result };
      msgs.push(toolMsg);
      ev.onMessage(toolMsg);
    }
    if (proposed) break;
  }
  ev.onStatus(null);
  return msgs;
}

export async function applyPlan(plan: ProposedPlan) {
  const results = await rpc<unknown[]>("batch.run", { label: `AI: ${plan.summary}`.slice(0, 80), calls: plan.calls });
  return results;
}
