import { useEffect, useRef, useState } from "react";
import { create } from "zustand";
import { applyPlan, getKey, loadConfig, PROVIDERS, runAgent, saveConfig, type AiConfig, type Msg, type ProposedPlan, type Provider } from "../ai";
import { act, toast, useStore } from "../store";
import { cx } from "../util";
import { Icon, Spinner } from "./ui";

interface Chat {
  messages: Msg[];
  plan: ProposedPlan | null;
  status: string | null;
  takeOver: boolean;
  autoApprove: boolean;
  rounds: number;
}

const useChat = create<Chat>(() => ({ messages: [], plan: null, status: null, takeOver: false, autoApprove: false, rounds: 0 }));
let cancel = { cancelled: false };

const QUICK = [
  "What's wrong with my mix, and fix the worst of it",
  "Make the lead vocal sit on top of the beat",
  "Turn the selected audio into MIDI",
  "Print the selected MIDI to audio",
  "Capture the MIDI I just played",
  "Set up a vocal chain on the selected track",
  "Master this for Spotify",
];

const TAKE_OVER_PROMPT = "Take over the mix. Analyse the whole session, then propose a complete plan: gain staging, EQ and compression where it helps, reverb/delay sends for depth, balance, and mastering to -14 LUFS with a -1 dB ceiling. Explain each move briefly.";

function Setup({ cfg, onSaved }: { cfg: AiConfig; onSaved: (c: AiConfig) => void }) {
  const [c, setC] = useState(cfg);
  const [key, setKey] = useState("");
  const [hasKey, setHasKey] = useState(false);
  useEffect(() => { getKey(c.provider).then((k) => setHasKey(!!k)); }, [c.provider]);
  const def = PROVIDERS[c.provider];
  return (
    <div className="card col" style={{ padding: 12 }}>
      <b>Connect a model</b>
      <span className="small dim">Use your own account. Keys are stored only on this computer and never shared with collaborators or linked agents.</span>
      <label className="field"><span>Provider</span>
        <select className="input sm" value={c.provider} onChange={(e) => { const p = e.target.value as Provider; setC({ provider: p, model: PROVIDERS[p].model, baseUrl: PROVIDERS[p].baseUrl }); }}>
          {(Object.keys(PROVIDERS) as Provider[]).map((p) => <option key={p} value={p}>{PROVIDERS[p].label}</option>)}
        </select>
      </label>
      <label className="field"><span>Model</span><input className="input sm" value={c.model} onChange={(e) => setC({ ...c, model: e.target.value })} /></label>
      {c.provider !== "anthropic" && c.provider !== "openai" && (
        <label className="field"><span>Server URL</span><input className="input sm" value={c.baseUrl} onChange={(e) => setC({ ...c, baseUrl: e.target.value })} /></label>
      )}
      <label className="field"><span>API key {hasKey && "(saved, type to replace)"}</span>
        <input className="input sm" type="password" placeholder={def.hint} value={key} onChange={(e) => setKey(e.target.value)} />
      </label>
      <button className="btn primary" onClick={async () => { await saveConfig(c, key || undefined); setKey(""); toast("Assistant connected", "success"); onSaved(c); }}>Save</button>
    </div>
  );
}

export function Assistant() {
  const chat = useChat();
  const [cfg, setCfg] = useState<AiConfig | null>(null);
  const [ready, setReady] = useState(false);
  const [hasModel, setHasModel] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [input, setInput] = useState("");
  const [showTools, setShowTools] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const project = useStore((s) => s.project);

  const check = async (c?: AiConfig) => {
    const conf = c ?? (await loadConfig());
    setCfg(conf);
    const k = await getKey(conf.provider);
    setReady(true);
    setHasModel(!PROVIDERS[conf.provider].needsKey || !!k);
  };
  useEffect(() => { check(); }, []);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [chat.messages.length, chat.plan, chat.status]);

  const send = async (text: string, takeOver = useChat.getState().takeOver, hidden = false) => {
    if (!cfg || !text.trim() || useChat.getState().status) return;
    cancel = { cancelled: false };
    const history: Msg[] = [...useChat.getState().messages, { role: "user", content: text.trim(), hidden }];
    useChat.setState({ messages: history, plan: null, takeOver });
    setInput("");
    try {
      await runAgent(cfg, history, takeOver, {
        onMessage: (m) => useChat.setState((s) => ({ messages: s.messages.includes(m) ? s.messages : [...s.messages, m] })),
        onPlan: (p) => {
          useChat.setState({ plan: p });
          if (useChat.getState().takeOver && useChat.getState().autoApprove) setTimeout(() => approve(), 50);
        },
        onStatus: (s) => useChat.setState({ status: s }),
      }, cancel);
    } catch (e) {
      useChat.setState((s) => ({ status: null, messages: [...s.messages, { role: "assistant", content: `⚠ ${(e as Error).message}` }] }));
    }
  };

  const approve = async () => {
    const plan = useChat.getState().plan;
    if (!plan) return;
    useChat.setState({ plan: null, status: "Applying…" });
    let note: string;
    let failed = false;
    try {
      await applyPlan(plan);
      toast(plan.summary, "success", { title: "Applied", action: { label: "Undo", run: () => act("edit.undo") } });
      note = `Done. ${plan.summary} Undo puts this back.`;
    } catch (e) {
      failed = true;
      note = `That change didn't apply, and nothing was left half-done. ${(e as Error).message}`;
    }
    useChat.setState({ status: null });
    const s = useChat.getState();
    if (!failed && s.takeOver && s.rounds < 3) {
      const done = plan.calls.map((c) => c.method).join(", ") || "no changes";
      useChat.setState((st) => ({ rounds: st.rounds + 1, messages: [...st.messages, { role: "assistant", content: note }] }));
      send(`${note}\nCompleted: ${done}. Re-check the session and continue only if something still needs work. Otherwise summarise and stop.`, true, true);
    } else {
      useChat.setState((st) => ({ messages: [...st.messages, { role: "assistant", content: note }], rounds: 0 }));
    }
  };

  const reject = () => {
    useChat.setState((s) => ({ plan: null, rounds: 0, messages: [...s.messages, { role: "user", content: "I rejected that plan. Ask me what I'd like instead, or suggest something smaller." }] }));
  };

  if (!cfg) return <div className="side-body"><Spinner /></div>;

  const visible = chat.messages.filter((m) => showTools || m.role !== "tool");

  return (
    <>
      <div className="side-body">
        {showSetup && <Setup cfg={cfg} onSaved={(c) => { setShowSetup(false); check(c); }} />}
        {ready && !chat.messages.length && (
          <div className="col" style={{ gap: 10 }}>
            <div className="card col" style={{ padding: 12, background: "linear-gradient(135deg, rgba(124,92,255,.15), rgba(0,209,255,.08))" }}>
              <b><Icon name="bot" size={14} /> Session editor</b>
              <span className="small dim">{hasModel
                ? "I can read the session, record setup, MIDI, and the mix. Every edit is a plan you approve — one undo step."
                : "No model key yet. I still run Smart Mix, audio↔MIDI, and capture on this computer. Connect a key for a smarter editor."}</span>
              <button className="btn accent" disabled={!project} onClick={() => send(TAKE_OVER_PROMPT, true)}><Icon name="wand" size={14} /> Take over the mix</button>
            </div>
            <div className="section-title">Try</div>
            {QUICK.map((q) => <button key={q} className="btn sm" style={{ justifyContent: "flex-start" }} disabled={!project} onClick={() => send(q)}>{q}</button>)}
          </div>
        )}
        {visible.map((m, i) => {
          if (m.role === "user" && m.hidden) return null;
          if (m.role === "tool") return <div key={i} className="msg tool">→ {m.name.replace(/__/g, ".")} {m.content.startsWith("Error") ? "✗" : "✓"} {m.content.slice(0, 160)}</div>;
          if (m.role === "assistant" && !m.content && m.toolCalls) {
            return showTools ? <div key={i} className="msg tool">{m.toolCalls.map((t) => t.name.replace(/__/g, ".")).join(", ")}</div> : null;
          }
          return <div key={i} className={cx("msg", m.role)}>{m.content}</div>;
        })}
        {chat.plan && (
          <div className="plan">
            <div className="row"><Icon name="sparkles" size={14} /><b className="grow">{chat.plan.summary}</b></div>
            {chat.plan.steps.length > 0 && <ol>{chat.plan.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>}
            <details>
              <summary className="small faint" style={{ cursor: "pointer" }}>{chat.plan.calls.length} change(s)</summary>
              <pre style={{ fontSize: 10, maxHeight: 180, overflow: "auto", userSelect: "text", whiteSpace: "pre-wrap" }}>{chat.plan.calls.map((c) => `${c.method} ${JSON.stringify(c.params)}`).join("\n")}</pre>
            </details>
            <div className="row">
              <button className="btn primary grow" onClick={approve}><Icon name="check" size={13} /> Apply</button>
              <button className="btn" onClick={reject}>Reject</button>
            </div>
          </div>
        )}
        {chat.status && <div className="row small dim"><Spinner /> {chat.status} <button className="btn sm ghost" onClick={() => { cancel.cancelled = true; useChat.setState({ status: null }); }}>Stop</button></div>}
        <div ref={end} />
      </div>
      {ready && (
        <div className="composer">
          <div className="row small">
            <button className={cx("btn sm", chat.takeOver && "on")} onClick={() => useChat.setState({ takeOver: !chat.takeOver })} title="Take-over mode: the assistant drives the session in rounds, re-checking after each plan">
              <Icon name="wand" size={12} /> Take over
            </button>
            {chat.takeOver && (
              <button className={cx("btn sm", chat.autoApprove && "on")} onClick={() => useChat.setState({ autoApprove: !chat.autoApprove })} title="Apply plans without asking (each is still one undo step)">
                Auto-approve
              </button>
            )}
            <div className="grow" />
            <button className={cx("btn sm ghost", showTools && "on")} title="Show tool calls" onClick={() => setShowTools(!showTools)}><Icon name="search" size={12} /></button>
            <button className="btn sm ghost" title="Model settings" onClick={() => setShowSetup(!showSetup)}><Icon name="settings" size={12} /></button>
            <button className="btn sm ghost" title="New conversation" onClick={() => useChat.setState({ messages: [], plan: null, rounds: 0 })}><Icon name="trash" size={12} /></button>
          </div>
          <div className="row" style={{ alignItems: "flex-end" }}>
            <textarea className="input grow" rows={2} placeholder={project ? "Ask anything about this session…" : "Open a project first"} value={input} disabled={!project}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }} />
            <button className="btn primary icon" disabled={!input.trim() || !!chat.status} onClick={() => send(input)}><Icon name="send" size={14} /></button>
          </div>
          <span className="small faint">{PROVIDERS[cfg.provider].label.split(" (")[0]} · {cfg.model}</span>
        </div>
      )}
    </>
  );
}
