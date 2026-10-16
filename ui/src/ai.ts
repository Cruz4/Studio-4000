// Bring-your-own-model assistant. Reads run immediately; every edit is proposed as a plan the user approves.
import { native, rpc } from "./bridge";
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
  | { role: "user"; content: string }
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
  return `You are the production and mixing assistant inside Studio 4000, a music recording app. You help musicians record, arrange, mix and master.

How you work:
- Inspect first with the read tools (project.get, plugins.list, plugin.params, smart.analyze, smart.* plans).
- To change anything, call propose_plan with concrete method calls. The user approves before it runs. Never say a change was made until you're told the plan was applied.
- Prefer the smart.* planners for gain staging, ducking and mastering, then pass their calls into propose_plan (you may combine and adjust them).
- Volumes are in dB (track.set volumeDb, master.set volumeDb), pan is -1..1. Plug-in parameters use plugin.setParam with norm 0..1 unless you know the real value range from plugin.params.
- Built-in plug-in ids come from plugins.list (e.g. "4bandEq", "compressor", "reverb", "delay", "s4000limiter"). Use exact ids.
- Be brief and practical. Explain the musical reason for each change in plain words.
${takeOver ? "- TAKE-OVER MODE: you are driving this session. Analyse, then propose one complete, well-ordered plan. After it's applied you'll be told the results; re-check with smart.analyze and propose a follow-up only if it clearly helps. Stop when the mix is in good shape and summarise what you did.\n" : ""}
Edit methods for propose_plan:
${edits}

Current project:
${context}`;
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

/** Runs model turns until it answers in text or proposes a plan. */
export async function runAgent(cfg: AiConfig, history: Msg[], takeOver: boolean, ev: AgentEvents, signal: { cancelled: boolean }) {
  const key = await getKey(cfg.provider);
  if (PROVIDERS[cfg.provider].needsKey && !key) throw new Error("Add an API key in the assistant settings first.");
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
