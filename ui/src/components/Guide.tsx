import { useMemo, useState } from "react";
import { native } from "../bridge";
import { GLOSSARY, searchGlossary } from "../glossary";
import { AKASHEET_TIP, AKASHEET_URL, COFFEE_URL, supportMailto } from "../support";
import { useStore } from "../store";
import { versionLabel } from "../whatsNew";
import { Modal } from "./ui";

/** Where things are and how to use them. Opened from Help and from the welcome screen. */
export function Guide() {
  const open = useStore((s) => s.guideOpen);
  const info = useStore((s) => s.info);
  const version = info?.version;
  const label = versionLabel(info);
  const [query, setQuery] = useState("");
  const hits = useMemo(() => searchGlossary(query), [query]);
  if (!open) return null;
  const searching = query.trim().length > 0;
  let lastGroup = "";
  return (
    <Modal title="How Studio 4000 works" onClose={() => useStore.setState({ guideOpen: false })} width={720}>
      <label className="guide-search">
        <input className="input" autoFocus placeholder="Search the app. Try collab, record, fade, or export" value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>
      <span className="small faint">{searching ? `${hits.length} match${hits.length === 1 ? "" : "es"}` : `${GLOSSARY.length} topics. Type to search.`}</span>
      {!hits.length && <span className="small dim">Nothing matches. Try a shorter word, such as record, fade, mixer, or collab.</span>}
      {hits.map((s) => {
        const head = !searching && s.group !== lastGroup;
        lastGroup = s.group;
        return (
          <div key={s.title} className="guide-hit">
            {head && <span className="guide-group">{s.group}</span>}
            <b>{s.title}</b>
            {searching && <span className="small faint">{s.group}</span>}
            <span className="small guide-where">{s.where}</span>
            <span className="small dim">{s.how}</span>
          </div>
        );
      })}
      <button className="btn sm akasheet-text" onClick={() => native.openUrl(AKASHEET_URL)}>AKAsheet<span className="tip">{AKASHEET_TIP}</span></button>
      <button className="btn sm" title="Opens your email app with a note to akasheet.support@gmail.com" onClick={() => native.openUrl(supportMailto(version))}>Report a bug or idea</button>
      <button className="btn sm" onClick={() => native.openUrl(COFFEE_URL)}>Buy me a coffee</button>
      <span className="small faint">Studio 4000 is free to use. A tip is optional, and it goes to the person who makes it.</span>
      <div className="whats-foot">
        <span className="pill whats-ver">{label || "v0.1.0"}</span>
        <button className="btn sm" onClick={() => useStore.setState({ guideOpen: false, aboutOpen: true })}>What's new</button>
      </div>
    </Modal>
  );
}
