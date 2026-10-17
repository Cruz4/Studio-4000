import { useEffect, useState } from "react";
import wordmark from "../assets/wordmark.png";
import { PROVIDERS, getKey, loadConfig, saveConfig, type AiConfig, type Provider } from "../ai";
import { localRpc, native } from "../bridge";
import { COFFEE_URL, supportMailto } from "../support";
import { act, loadCatalogue, toast, useStore } from "../store";
import { Icon, Modal, Spinner, Tabs } from "./ui";

type TabId = "audio" | "plugins" | "ai" | "agent" | "collab" | "general";

interface Devices {
  type: string; input: string; output: string;
  types: { name: string; inputs: string[]; outputs: string[] }[];
  current: { sampleRate?: number; bufferSize?: number; sampleRates?: number[]; bufferSizes?: number[]; inputLatencyMs?: number; outputLatencyMs?: number; hasControlPanel?: boolean };
  waveInputs: { name: string; enabled: boolean; stereo: boolean }[];
  midiInputs: { name: string; enabled: boolean }[];
}

const call = async (method: string, params: Record<string, unknown> = {}) => {
  try { return await localRpc(method, params); } catch (e) { toast((e as Error).message, "error"); return undefined; }
};

function AudioTab() {
  const [d, setD] = useState<Devices | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () => localRpc<Devices>("devices.get").then(setD).catch((e) => toast(e.message, "error"));
  useEffect(() => { load(); }, []);
  const set = async (p: Record<string, unknown>) => { setBusy(true); await call("devices.set", p); await load(); setBusy(false); };
  if (!d) return <div className="empty"><Spinner /></div>;
  const type = d.types.find((t) => t.name === d.type);
  const latency = (d.current.inputLatencyMs ?? 0) + (d.current.outputLatencyMs ?? 0);

  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="row" style={{ alignItems: "flex-end" }}>
        <label className="field grow"><span>Driver</span>
          <select className="input" value={d.type} disabled={busy} onChange={(e) => set({ type: e.target.value })}>
            {d.types.map((t) => <option key={t.name}>{t.name}</option>)}
          </select>
        </label>
        {busy && <Spinner />}
      </div>
      {!d.type.includes("ASIO") && d.types.some((t) => t.name.includes("ASIO")) && (
        <div className="pill warn" style={{ alignSelf: "flex-start" }}><Icon name="bolt" size={11} /> ASIO is available, and it gives the lowest latency for recording.</div>
      )}
      <div className="row">
        <label className="field grow"><span>Output</span>
          <select className="input" value={d.output} disabled={busy} onChange={(e) => set({ output: e.target.value })}>
            {type?.outputs.map((o) => <option key={o}>{o}</option>)}
          </select>
        </label>
        {!d.type.includes("ASIO") && (
          <label className="field grow"><span>Input</span>
            <select className="input" value={d.input} disabled={busy} onChange={(e) => set({ input: e.target.value })}>
              <option value="">None</option>
              {type?.inputs.map((o) => <option key={o}>{o}</option>)}
            </select>
          </label>
        )}
      </div>
      <div className="row">
        <label className="field grow"><span>Sample rate</span>
          <select className="input" value={d.current.sampleRate ?? ""} disabled={busy} onChange={(e) => set({ sampleRate: Number(e.target.value) })}>
            {d.current.sampleRates?.map((r) => <option key={r} value={r}>{(r / 1000).toFixed(1)} kHz</option>)}
          </select>
        </label>
        <label className="field grow"><span>Buffer size</span>
          <select className="input" value={d.current.bufferSize ?? ""} disabled={busy} onChange={(e) => set({ bufferSize: Number(e.target.value) })}>
            {d.current.bufferSizes?.map((b) => <option key={b} value={b}>{b} samples ({((b / (d.current.sampleRate || 48000)) * 1000).toFixed(1)} ms)</option>)}
          </select>
        </label>
        <div className="stat"><b>{latency.toFixed(1)}</b><span>ms round trip</span></div>
      </div>
      <div className="row">
        {d.current.hasControlPanel && <button className="btn" onClick={() => call("devices.controlPanel").then(load)}>Driver control panel</button>}
        <button className="btn" onClick={() => call("devices.showPanel")}><Icon name="window" size={13} /> Advanced device window</button>
        <button className="btn ghost" onClick={load}>Refresh</button>
      </div>

      <div className="col">
        <span className="section-title">Inputs</span>
        {d.waveInputs.map((w) => (
          <div key={w.name} className="row">
            <label className="row grow" style={{ cursor: "pointer" }}>
              <input type="checkbox" checked={w.enabled} onChange={(e) => call("devices.setInput", { name: w.name, enabled: e.target.checked }).then(load)} />
              <span className="ellipsis">{w.name}</span>
            </label>
            <label className="row small dim" style={{ cursor: "pointer" }} title="Off splits the pair into two mono inputs">
              <input type="checkbox" checked={w.stereo} onChange={(e) => call("devices.setInput", { name: w.name, stereo: e.target.checked }).then(load)} /> Stereo pair
            </label>
          </div>
        ))}
        {!d.waveInputs.length && <span className="small faint">No inputs on this device.</span>}
      </div>
      <div className="col">
        <span className="section-title">MIDI inputs</span>
        {d.midiInputs.map((m) => (
          <label key={m.name} className="row" style={{ cursor: "pointer" }}>
            <input type="checkbox" checked={m.enabled} onChange={(e) => call("devices.setInput", { name: m.name, enabled: e.target.checked }).then(load)} />
            <Icon name="keyboard" size={13} className="faint" /> {m.name}
          </label>
        ))}
        {!d.midiInputs.length && <span className="small faint">No MIDI devices found. Plug one in and press Refresh.</span>}
      </div>
    </div>
  );
}

function PluginsTab() {
  const catalogue = useStore((s) => s.catalogue);
  const scanning = useStore((s) => s.scanning);
  const [paths, setPaths] = useState("");
  const [blocked, setBlocked] = useState<string[]>([]);
  const [info, setInfo] = useState<{ studioFolders: { path: string; exists: boolean }[]; vst2: boolean; unhostableVst2: number }>({ studioFolders: [], vst2: false, unhostableVst2: 0 });
  const load = () => localRpc<{ vst3Paths: string; blocked: string[]; studioFolders?: { path: string; exists: boolean }[]; vst2?: boolean; unhostableVst2?: number }>("plugins.list").then((r) => {
    setPaths(r.vst3Paths ?? ""); setBlocked(r.blocked ?? []);
    setInfo({ studioFolders: r.studioFolders ?? [], vst2: !!r.vst2, unhostableVst2: r.unhostableVst2 ?? 0 });
  });
  useEffect(() => { load(); }, []);
  const save = (p: string) => { setPaths(p); call("plugins.setPaths", { paths: p }); };
  const vst = catalogue.filter((c) => c.format !== "Built-in");

  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="row">
        <div className="stat"><b>{catalogue.length - vst.length}</b><span>built-in</span></div>
        <div className="stat"><b>{vst.length}</b><span>VST</span></div>
        <div className="stat"><b>{blocked.length}</b><span>blocked</span></div>
        <div className="grow" />
        <button className="btn primary" disabled={!!scanning} onClick={() => act("plugins.scan")}>{scanning ? <Spinner /> : <Icon name="search" size={13} />} Scan for plug-ins</button>
      </div>
      {scanning && (
        <div className="col" style={{ gap: 4 }}>
          <div className="progress"><div style={{ width: `${(scanning.progress ?? 0) * 100}%` }} /></div>
          <span className="small faint ellipsis">{scanning.current ?? "Scanning…"}</span>
        </div>
      )}
      <span className="small dim">Plug-ins are scanned in a separate process, so one that crashes is blocked instead of taking the studio down.
        Drop new plug-ins (.vst3{info.vst2 ? " or VST2 .dll" : ""}) into a studio plug-in folder below, then press Scan. The system VST3 folder is always included too.</span>
      <div className="col" style={{ gap: 4 }}>
        <span className="section-title">Studio plug-in folders</span>
        {info.studioFolders.map((f) => (
          <div key={f.path} className="row small">
            <Icon name="folder" size={12} />
            <span className="grow ellipsis mono" title={f.path}>{f.path}</span>
            <span className="faint">{f.exists ? "scanned" : "create it to use it"}</span>
          </div>
        ))}
      </div>
      {!info.vst2 && info.unhostableVst2 > 0 && (
        <div className="pill warn" style={{ whiteSpace: "normal", borderRadius: 8, padding: "8px 10px" }}>
          {info.unhostableVst2} VST2 plug-in{info.unhostableVst2 === 1 ? "" : "s"} (.dll) found, but this build can't load VST2 yet. It needs Steinberg's VST2 SDK headers in external\vst2sdk; VST3 plug-ins work now.
        </div>
      )}
      <label className="field"><span>Extra plug-in folders</span>
        <div className="row">
          <input className="input grow mono" value={paths} onChange={(e) => setPaths(e.target.value)} onBlur={(e) => save(e.target.value)} placeholder="D:\Plugins\VST3;E:\More" />
          <button className="btn" onClick={async () => { const f = await native.pickFile({ mode: "folder", title: "Add a plug-in folder" }); if (f?.[0]) save([paths, f[0]].filter(Boolean).join(";")); }}><Icon name="folder" size={13} /> Add</button>
        </div>
      </label>
      {blocked.length > 0 && (
        <div className="col">
          <span className="section-title">Blocked</span>
          {blocked.map((b) => (
            <div key={b} className="row small">
              <span className="grow ellipsis mono" title={b}>{b}</span>
              <button className="btn sm" onClick={() => call("plugins.unblock", { file: b }).then(load)}>Unblock</button>
            </div>
          ))}
        </div>
      )}
      {vst.length > 0 && (
        <div className="col" style={{ gap: 2, maxHeight: 220, overflow: "auto" }}>
          <span className="section-title">Installed VST plug-ins</span>
          {vst.map((p) => (
            <div key={p.id} className="row small">
              <Icon name={p.synth ? "piano" : "plug"} size={12} className="faint" />
              <span className="grow ellipsis">{p.name}</span><span className="faint">{p.vendor}</span>
              <button className="btn sm ghost" title="Never load this plug-in" onClick={() => call("plugins.block", { id: p.id }).then(() => { load(); loadCatalogue(); })}>Block</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AiTab() {
  const [cfg, setCfg] = useState<AiConfig | null>(null);
  const [key, setKey] = useState("");
  const [hasKey, setHasKey] = useState(false);
  useEffect(() => { loadConfig().then(async (c) => { setCfg(c); setHasKey(!!(await getKey(c.provider))); }); }, []);
  if (!cfg) return <div className="empty"><Spinner /></div>;
  const p = PROVIDERS[cfg.provider];

  return (
    <div className="col" style={{ gap: 14 }}>
      <span className="small dim">The assistant uses your own model account. It can read the session, analyse it and propose changes; nothing changes until you approve. Your key is kept by the app and never shown to linked agents.</span>
      <label className="field"><span>Provider</span>
        <select className="input" value={cfg.provider} onChange={async (e) => {
          const provider = e.target.value as Provider;
          setCfg({ provider, model: PROVIDERS[provider].model, baseUrl: PROVIDERS[provider].baseUrl });
          setHasKey(!!(await getKey(provider)));
        }}>
          {(Object.keys(PROVIDERS) as Provider[]).map((k) => <option key={k} value={k}>{PROVIDERS[k].label}</option>)}
        </select>
      </label>
      <div className="row">
        <label className="field grow"><span>Model</span><input className="input mono" value={cfg.model} onChange={(e) => setCfg({ ...cfg, model: e.target.value })} /></label>
        <label className="field grow"><span>Endpoint</span><input className="input mono" value={cfg.baseUrl} onChange={(e) => setCfg({ ...cfg, baseUrl: e.target.value })} /></label>
      </div>
      <label className="field"><span>API key {hasKey && <span className="pill live" style={{ marginLeft: 6 }}>saved</span>}</span>
        <input className="input mono" type="password" placeholder={hasKey ? "•••••••• (leave empty to keep)" : p.hint} value={key} onChange={(e) => setKey(e.target.value)} />
      </label>
      <div className="row">
        <button className="btn primary" onClick={async () => { await saveConfig(cfg, key || undefined); if (key) setHasKey(true); setKey(""); toast("AI settings saved", "success"); }}>Save</button>
        {hasKey && <button className="btn danger" onClick={async () => { await native.secret(`AiKey_${cfg.provider}`, ""); setHasKey(false); toast("Key removed"); }}>Remove key</button>}
      </div>
    </div>
  );
}

function AgentTab() {
  const [st, setSt] = useState<{ enabled: boolean; running: boolean; port: number; askBeforeEdits: boolean; clients: number; configFile: string } | null>(null);
  const [mcp, setMcp] = useState("");
  const activity = useStore((s) => s.agentActivity);
  const load = () => localRpc("agent.status").then(setSt);
  useEffect(() => { load(); native.agentInfo().then((i) => setMcp(i.mcpServer)).catch(() => {}); }, []);
  if (!st) return <div className="empty"><Spinner /></div>;

  const snippet = JSON.stringify({ mcpServers: { "studio-4000": { command: "node", args: [mcp] } } }, null, 2);
  const copy = (t: string) => { navigator.clipboard?.writeText(t); toast("Copied", "success"); };

  return (
    <div className="col" style={{ gap: 14 }}>
      <span className="small dim">Link an AI agent you already use (Claude Desktop, Cursor, ChatGPT with MCP, your own scripts) so it can see and drive this studio. The link only listens on this computer and needs the token from your user profile.</span>
      <div className="row">
        <label className="row grow" style={{ cursor: "pointer" }}>
          <input type="checkbox" checked={st.enabled} onChange={(e) => call("agent.setEnabled", { enabled: e.target.checked }).then(load)} />
          <b>Agent link</b>
          {st.running ? <span className="pill live"><span className="dot" /> port {st.port}</span> : <span className="pill">off</span>}
          {st.clients > 0 && <span className="pill">{st.clients} connected</span>}
        </label>
        <button className="btn sm" title="Disconnects every agent until it re-reads the config file" onClick={() => call("agent.newToken").then(() => toast("New token issued", "success"))}>New token</button>
      </div>
      <label className="row" style={{ cursor: "pointer" }}>
        <input type="checkbox" checked={st.askBeforeEdits} onChange={(e) => call("agent.setAskBeforeEdits", { ask: e.target.checked }).then(load)} />
        Ask me before an agent changes the session <span className="small faint">(recommended)</span>
      </label>
      <div className="col">
        <div className="row"><span className="section-title grow">MCP server config</span><button className="btn sm" onClick={() => copy(snippet)}><Icon name="copy" size={12} /> Copy</button></div>
        <pre className="card mono small" style={{ margin: 0, padding: 10, userSelect: "text", overflow: "auto" }}>{snippet}</pre>
        <span className="small faint">Paste into Claude Desktop's <span className="mono">claude_desktop_config.json</span>, Cursor's <span className="mono">mcp.json</span>, or any MCP client. Needs Node.js 18 or newer.</span>
      </div>
      <div className="col">
        <span className="section-title">Plain HTTP</span>
        <span className="small faint">Scripts can POST <span className="mono">{`{"method":"project.get","params":{}}`}</span> to <span className="mono">http://127.0.0.1:{st.port}/rpc</span> with the bearer token from <span className="mono">{st.configFile}</span>. <span className="mono">GET /methods</span> lists everything.</span>
      </div>
      {activity.length > 0 && (
        <div className="col" style={{ gap: 2 }}>
          <span className="section-title">Recent agent activity</span>
          {activity.slice(-8).reverse().map((a, i) => (
            <div key={i} className="row small"><Icon name={a.ok ? "check" : "alert"} size={11} /><b>{a.client}</b><span className="mono faint grow ellipsis">{a.method}</span><span className="faint">{new Date(a.time).toLocaleTimeString()}</span></div>
          ))}
        </div>
      )}
    </div>
  );
}

function SettingRow({ k, label, placeholder, hint }: { k: string; label: string; placeholder?: string; hint?: string }) {
  const [v, setV] = useState("");
  useEffect(() => { localRpc<string>("settings.get", { key: k }).then((x) => setV(x ?? "")).catch(() => {}); }, [k]);
  return (
    <label className="field"><span>{label}</span>
      <input className="input mono" value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)} onBlur={(e) => call("settings.set", { key: k, value: e.target.value })} />
      {hint && <span className="small faint" style={{ textTransform: "none", letterSpacing: 0 }}>{hint}</span>}
    </label>
  );
}

function CollabTab() {
  return (
    <div className="col" style={{ gap: 14 }}>
      <span className="small dim">Press Host on the people button. Studio 4000 opens the connection and shows a code to send. The other person pastes that code and presses Join. They can be anywhere. Voice and screen go directly between you. A custom server is only for a relay you already have.</span>
      <SettingRow k="collabName" label="Your display name" placeholder="Musician" />
      <SettingRow k="collabServer" label="Custom server" placeholder="Leave blank. Studio 4000 hosts the connection." />
      <SettingRow k="collabTurn" label="TURN servers (JSON)" placeholder='[{"urls":"turn:example.com:3478","username":"u","credential":"p"}]' hint="Only needed when peers can't connect directly (strict corporate or mobile networks)." />
    </div>
  );
}

function GeneralTab() {
  const info = useStore((s) => s.info);
  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="row"><img className="wordmark sm" src={wordmark} alt="Studio 4000" /><span className="pill">{info?.version}</span></div>
      <div className="col small">
        <div className="row"><span className="faint" style={{ width: 110 }}>Projects</span><span className="mono grow ellipsis">{info?.projectsDir}</span></div>
        <div className="row"><span className="faint" style={{ width: 110 }}>App data</span><span className="mono grow ellipsis">{info?.dataDir}</span></div>
      </div>
      <SettingRow k="autosaveSeconds" label="Autosave every (seconds)" placeholder="60" hint="Autosaves never overwrite your project; after a crash you're offered the newer copy." />
      <div className="row">
        <button className="btn" onClick={() => useStore.setState({ settingsOpen: null, shortcutsOpen: true })}><Icon name="keyboard" size={13} /> Keyboard shortcuts</button>
        <button className="btn" onClick={() => call("settings.set", { key: "onboarded", value: "" }).then(() => toast("Tips will show on the start screen", "success"))}>Show welcome tips again</button>
      </div>
      <span className="small faint">Built with JUCE and Tracktion Engine. Includes Airwindows effects (MIT) and SoundTouch (LGPL). Free to use. See the license that ships with the app.</span>
      <div className="row">
        <button className="btn" title="Opens your email app with a note to akasheet.support@gmail.com" onClick={() => native.openUrl(supportMailto(info?.version))}>Report a bug or idea</button>
        <button className="btn" onClick={() => native.openUrl(COFFEE_URL)}>Buy me a coffee</button>
        <span className="small faint">Optional. Studio 4000 does not charge a fee, and a tip goes to the person who makes it.</span>
      </div>
    </div>
  );
}

export function Settings() {
  const open = useStore((s) => s.settingsOpen);
  if (!open) return null;
  const tab = open as TabId;
  const close = () => useStore.setState({ settingsOpen: null });
  return (
    <Modal title="Settings" onClose={close} width={760}>
      <Tabs value={tab} onChange={(t) => useStore.setState({ settingsOpen: t })} items={[
        { id: "audio", label: "Audio", icon: "headphones" },
        { id: "plugins", label: "Plug-ins", icon: "plug" },
        { id: "ai", label: "AI", icon: "sparkles" },
        { id: "agent", label: "Agent link", icon: "link" },
        { id: "collab", label: "Sessions", icon: "users" },
        { id: "general", label: "General", icon: "settings" },
      ]} />
      {tab === "audio" && <AudioTab />}
      {tab === "plugins" && <PluginsTab />}
      {tab === "ai" && <AiTab />}
      {tab === "agent" && <AgentTab />}
      {tab === "collab" && <CollabTab />}
      {tab === "general" && <GeneralTab />}
    </Modal>
  );
}
