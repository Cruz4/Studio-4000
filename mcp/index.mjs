#!/usr/bin/env node
// MCP server for Studio 4000. Speaks MCP over stdio to the agent and forwards calls to the app's
// local agent link (127.0.0.1, bearer token from agent.json). Edits wait for the user's approval in the app
// unless they turned approvals off.

import { readFileSync } from "node:fs";
import { request } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema, GetPromptRequestSchema, ListPromptsRequestSchema, ListResourcesRequestSchema,
  ListToolsRequestSchema, ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const AGENT_FILE = process.env.STUDIO4000_AGENT_FILE
  ?? join(process.env.APPDATA ?? (process.platform === "darwin" ? join(homedir(), "Library", "Application Support") : join(homedir(), ".config")), "Studio4000", "agent.json");
const EXPOSE_ALL = process.env.STUDIO4000_MCP_ALL_TOOLS === "1";

class StudioError extends Error {}

function connection() {
  let info;
  try { info = JSON.parse(readFileSync(AGENT_FILE, "utf8")); } catch {
    throw new StudioError("Studio 4000 isn't running, or its agent link is off (Settings → Agent link in the app).");
  }
  if (!info.port || !info.token) throw new StudioError(`The agent link file is incomplete: ${AGENT_FILE}`);
  return info;
}

function http(method, path, body) {
  const { port, token } = connection();
  const clientName = String(server.getClientVersion()?.name ?? "agent").replace(/[^\w .()-]/g, "").slice(0, 40) || "agent";
  const data = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const req = request({
      host: "127.0.0.1", port, path, method, timeout: 15 * 60 * 1000,
      headers: {
        authorization: `Bearer ${token}`,
        "x-agent-name": clientName,
        ...(data ? { "content-type": "application/json", "content-length": data.length } : {}),
      },
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); } catch { reject(new StudioError(`Bad response from Studio 4000 (HTTP ${res.statusCode})`)); }
      });
    });
    req.on("timeout", () => req.destroy(new StudioError("Studio 4000 took too long to answer")));
    req.on("error", (e) => reject(e.code === "ECONNREFUSED" ? new StudioError("Studio 4000 isn't running, or its agent link is off.") : e));
    if (data) req.write(data);
    req.end();
  });
}

async function call(method, params = {}) {
  const r = await http("POST", "/rpc", { method, params });
  if (!r.ok) throw new StudioError(r.error ?? `${method} failed`);
  return r.result;
}

let methodCache = null;
async function methods() {
  if (!methodCache) {
    const r = await http("GET", "/methods");
    if (!r.ok) throw new StudioError(r.error ?? "Couldn't list methods");
    methodCache = r.result.filter((m) => !m.name.startsWith("agent."));
  }
  return methodCache;
}

const obj = (properties, required = []) => ({ type: "object", properties, required, additionalProperties: false });
const anyObj = { type: "object", additionalProperties: true };
const callSchema = { type: "object", properties: { method: { type: "string" }, params: anyObj }, required: ["method"] };

/** The compact toolset most agents should use. */
const TOOLS = [
  {
    name: "studio_context",
    description: "Start here. A readable summary of the open session: tempo, tracks with roles, clips, plug-ins, levels, loudness and problems. Use before suggesting or making changes.",
    inputSchema: obj({}),
    run: () => call("ai.context"),
  },
  {
    name: "get_project",
    description: "The full project model as JSON: tracks (ids, kind, volumeDb, pan, mute/solo, plug-ins with parameters, sends), clips (ids, start/end seconds, gain, fades, MIDI notes), markers, tempo, loop and master chain.",
    inputSchema: obj({}),
    run: () => call("project.get"),
  },
  {
    name: "list_methods",
    description: "Lists the studio's methods with their parameters. Filter by prefix such as 'track.', 'clip.', 'plugin.', 'midi.', 'automation.', 'smart.', 'transport.', 'export.'.",
    inputSchema: obj({ prefix: { type: "string", description: "Only methods starting with this" } }),
    run: async ({ prefix }) => (await methods()).filter((m) => !prefix || m.name.startsWith(prefix)).map((m) => ({ name: m.name, changesSession: m.write, description: m.description, params: m.params })),
  },
  {
    name: "analyze_mix",
    description: "Measures every track and the master (LUFS, peak, loudness range, stereo correlation, low-end balance), guesses each track's role and returns a health report with suggested fixes.",
    inputSchema: obj({}),
    run: () => call("smart.analyze"),
  },
  {
    name: "smart_mix",
    description: "Builds a complete first-pass mix plan: gain staging, role-based balance, ducking music under voice, and mastering to a loudness target. With apply=false (default) it only returns the plan and its calls so you can review or edit them; with apply=true it applies everything as one undo step (the user may be asked to approve).",
    inputSchema: obj({
      apply: { type: "boolean" },
      masterLufs: { type: "number", description: "Master loudness target, e.g. -14 streaming, -16 podcast" },
      trackLufs: { type: "number", description: "Per-track gain staging level before plug-ins (default -18)" },
      ceilingDb: { type: "number", description: "True-peak ceiling, e.g. -1" },
      balance: { type: "boolean", description: "Set faders by role (default true)" },
      duck: { type: "boolean", description: "Duck music under speech/vocals (default true)" },
      master: { type: "boolean", description: "Add mastering (default true)" },
    }),
    run: (a) => call("smart.mix", a),
  },
  {
    name: "apply_changes",
    description: "Applies several edits as ONE undo step, rolled back entirely if any fails. Each call is {method, params} using methods from list_methods. A string param \"$N\", \"$N.field\" or \"$N[0]\" is replaced by the result of call N (0-based); e.g. track.add returns [id], so a later call can use \"$0[0]\" as trackId. The user sees the label and approves.",
    inputSchema: obj({
      label: { type: "string", description: "Short human description shown to the user, e.g. 'Brighten vocal and add plate reverb'" },
      calls: { type: "array", items: callSchema },
    }, ["label", "calls"]),
    run: ({ label, calls }) => call("batch.run", { label, calls }),
  },
  {
    name: "call_method",
    description: "Calls any single studio method (see list_methods). Prefer apply_changes for anything that edits the session.",
    inputSchema: callSchema,
    run: ({ method, params }) => call(method, params ?? {}),
  },
  {
    name: "transport",
    description: "Controls playback: play, stop, record (records on armed tracks), or move the playhead to a time in seconds.",
    inputSchema: obj({ action: { type: "string", enum: ["play", "stop", "record", "position"] }, time: { type: "number" } }, ["action"]),
    run: ({ action, time }) => action === "position" ? call("transport.setPosition", { time: time ?? 0 }) : call(`transport.${action}`),
  },
  {
    name: "export_mix",
    description: "Renders the mix or stems to the project's Bounces folder in the background. Progress and files appear in the app.",
    inputSchema: obj({
      what: { type: "string", enum: ["mix", "stems"] },
      format: { type: "string", enum: ["wav", "flac", "ogg"] },
      normalizeLufs: { type: "number" },
      truePeakDb: { type: "number" },
      start: { type: "number" }, end: { type: "number" },
    }),
    run: (a) => call("export.render", a),
  },
  {
    name: "list_tracks",
    description: "Compact list of tracks: id, name, kind, fader, pan, mute/solo, insert plug-ins (id, name) and sends. Use the ids with set_param, add_plugin and apply_changes.",
    inputSchema: obj({}),
    run: async () => (await call("project.get")).tracks.map((t) => ({
      id: t.id, name: t.name, kind: t.kind, volumeDb: t.volumeDb, pan: t.pan, mute: t.mute, solo: t.solo, armed: t.armed,
      plugins: t.plugins.map((p) => ({ id: p.id, name: p.name, enabled: p.enabled })),
      sends: t.sends, clips: t.clips.length,
    })),
  },
  {
    name: "list_plugins",
    description: "Effects and instruments available to add_plugin (built-ins and the user's scanned VST3s). Filter with a search query.",
    inputSchema: obj({ query: { type: "string" } }),
    run: ({ query }) => call("plugins.list", query ? { query } : {}),
  },
  {
    name: "add_plugin",
    description: "Inserts an effect or instrument on a track (or 'master'), optionally at a chain position and with initial parameter values {paramId: realValue}. Returns the new plug-in id.",
    inputSchema: obj({
      trackId: { type: "string", description: "Track id from list_tracks, or 'master'" },
      plugin: { type: "string", description: "Plug-in id from list_plugins" },
      index: { type: "number", description: "Position in the insert chain (0 = first)" },
      params: anyObj,
    }, ["trackId", "plugin"]),
    run: (a) => call("plugin.add", a),
  },
  {
    name: "set_param",
    description: "Sets one plug-in parameter, by real value (e.g. Hz, dB) or by normalised 0..1 value. Get parameter ids and ranges from call_method plugin.params {id}.",
    inputSchema: obj({
      pluginId: { type: "string" },
      paramId: { type: "string" },
      value: { type: "number", description: "Real value in the parameter's own units" },
      norm: { type: "number", description: "Normalised 0..1 value (use instead of value)" },
    }, ["pluginId", "paramId"]),
    run: ({ pluginId, paramId, value, norm }) => call("plugin.setParam", { id: pluginId, paramId, ...(norm !== undefined ? { norm } : { value }) }),
  },
  {
    name: "vocal_chain",
    description: "Builds or tunes a complete vocal chain on a track: cleanup EQ, de-esser, compressor, presence and air, plus a plate reverb send. Styles: pop (bright, upfront), warm (softer), podcast (dry, intelligible speech).",
    inputSchema: obj({
      trackId: { type: "string" },
      style: { type: "string", enum: ["pop", "warm", "podcast"] },
      apply: { type: "boolean", description: "false (default) returns the plan only" },
    }, ["trackId"]),
    run: (a) => call("smart.vocalChain", a),
  },
  {
    name: "apply_mix_plan",
    description: "Applies a plan returned by smart_mix, vocal_chain or another smart tool (with apply=false), optionally after you edited its calls. Runs as one undo step; the user may be asked to approve.",
    inputSchema: obj({
      plan: { type: "object", properties: { summary: { type: "string" }, calls: { type: "array", items: callSchema } }, required: ["calls"] },
    }, ["plan"]),
    run: ({ plan }) => {
      const calls = plan.calls ?? [];
      if (!calls.length) throw new StudioError("The plan has no calls to apply");
      return call("batch.run", { label: plan.summary || "Mix plan", calls });
    },
  },
  {
    name: "undo",
    description: "Undoes the last change in the session (one plan applied with apply_changes is one step).",
    inputSchema: obj({}),
    run: () => call("edit.undo"),
  },
];

const toolName = (m) => m.replace(/\./g, "_");

const server = new Server({ name: "studio-4000", version: "0.1.0" }, { capabilities: { tools: {}, prompts: {}, resources: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => {
  const tools = TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
  if (EXPOSE_ALL) {
    try {
      for (const m of await methods())
        tools.push({ name: toolName(m.name), description: `${m.description}. Params: ${m.params}${m.write ? " (changes the session)" : ""}`, inputSchema: anyObj });
    } catch { /* app not running: the compact tools still explain that when called */ }
  }
  return { tools };
});

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args = {} } = req.params;
  try {
    const tool = TOOLS.find((t) => t.name === name);
    let result;
    if (tool) result = await tool.run(args);
    else {
      const m = (await methods()).find((x) => toolName(x.name) === name);
      if (!m) throw new StudioError(`Unknown tool ${name}`);
      result = await call(m.name, args);
    }
    return { content: [{ type: "text", text: typeof result === "string" ? result : JSON.stringify(result, null, 1) }] };
  } catch (e) {
    return { isError: true, content: [{ type: "text", text: e instanceof StudioError ? e.message : `Error: ${e.message}` }] };
  }
});

const PROMPTS = [
  {
    name: "take_over_mix",
    description: "Have the agent mix the open session end to end, with your approval at each step",
    arguments: [{ name: "goal", description: "e.g. 'warm indie vocal mix for Spotify'", required: false }],
    text: (a) => `You are mixing the open Studio 4000 session${a.goal ? ` with this goal: ${a.goal}` : ""}.
1. Call studio_context and analyze_mix to understand the tracks, their roles and the problems.
2. Call smart_mix with apply=false and review its plan. Adjust it to the goal.
3. Make focused improvements with apply_changes in small, labelled steps (e.g. "Vocal: de-ess and presence boost", "Drums: bus compression"). Use plug-in parameters from get_project.
4. After each step, call analyze_mix again and explain what changed in plain language.
5. Finish by mastering to the right loudness and summarising the mix. Never delete the user's clips or tracks.`,
  },
  {
    name: "session_review",
    description: "A producer-style review of the session with prioritised suggestions (no edits)",
    arguments: [],
    text: () => "Review the open Studio 4000 session like an experienced producer. Call studio_context and analyze_mix, then give a short, prioritised list of the most valuable improvements (arrangement, performance, balance, tone, loudness). Don't change anything; offer to apply the top fixes with apply_changes.",
  },
];

server.setRequestHandler(ListPromptsRequestSchema, async () => ({ prompts: PROMPTS.map(({ name, description, arguments: a }) => ({ name, description, arguments: a })) }));
server.setRequestHandler(GetPromptRequestSchema, async (req) => {
  const p = PROMPTS.find((x) => x.name === req.params.name);
  if (!p) throw new Error(`Unknown prompt ${req.params.name}`);
  return { description: p.description, messages: [{ role: "user", content: { type: "text", text: p.text(req.params.arguments ?? {}) } }] };
});

server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [
    { uri: "studio4000://context", name: "Session summary", mimeType: "text/plain" },
    { uri: "studio4000://project", name: "Project model", mimeType: "application/json" },
  ],
}));
server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
  const uri = req.params.uri;
  if (uri === "studio4000://context") return { contents: [{ uri, mimeType: "text/plain", text: String(await call("ai.context")) }] };
  if (uri === "studio4000://project") return { contents: [{ uri, mimeType: "application/json", text: JSON.stringify(await call("project.get")) }] };
  throw new Error(`Unknown resource ${uri}`);
});

if (process.argv.includes("--check")) {
  try {
    const health = await http("GET", "/health");
    console.log(JSON.stringify({ agentFile: AGENT_FILE, ...health }));
    process.exit(health.ok ? 0 : 1);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}

await server.connect(new StdioServerTransport());
