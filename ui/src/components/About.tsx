import { useEffect, useState } from "react";
import { native } from "../bridge";
import { useStore } from "../store";
import { Modal } from "./ui";

const RELEASE_API = "https://api.github.com/repos/Cruz4/Studio-4000/releases/latest";

/** Shown when the published notes can't be loaded. */
const FALLBACK = "Studio 4000 checks for a newer build every time it opens, and from Help → Check for updates. What's new is this window. The AKAsheet mark sits in the top bar, just before search.";

interface PublishedBuild {
  name: string;
  commit: string;
  published: string;
  notes: string;
}

function cleanCommit(value?: string) {
  return (value ?? "").trim().toLowerCase().replace(/[^0-9a-f]/g, "");
}

function shortCommit(commit: string) {
  return commit.length >= 7 ? commit.slice(0, 7) : commit;
}

function publishedWhen(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** Help → What's new. This copy's commit, and the date, time, and commit of the latest published build. */
export function About() {
  const open = useStore((s) => s.aboutOpen);
  const info = useStore((s) => s.info);
  const [published, setPublished] = useState<PublishedBuild | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "offline">("loading");

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setPhase("loading");
    setPublished(null);
    native.http({
      url: RELEASE_API,
      headers: { Accept: "application/vnd.github+json", "User-Agent": "Studio4000" },
      timeoutMs: 8000,
    }).then((r) => {
      if (!alive) return;
      if (r.status !== 200 || !r.body) {
        setPhase("offline");
        return;
      }
      try {
        const release = JSON.parse(r.body) as { name?: string; tag_name?: string; published_at?: string; body?: string };
        const tag = release.tag_name ?? "";
        const fromTag = /^b-([0-9a-f]{7,40})$/i.exec(tag)?.[1] ?? "";
        setPublished({
          name: release.name || tag || "Latest build",
          commit: cleanCommit(fromTag),
          published: release.published_at ?? "",
          notes: (release.body ?? "").trim() || FALLBACK,
        });
        setPhase("ready");
      } catch {
        setPhase("offline");
      }
    }).catch(() => {
      if (!alive) return;
      setPhase("offline");
    });
    return () => { alive = false; };
  }, [open]);

  if (!open) return null;
  const mine = cleanCommit(info?.commit);
  const same = phase === "ready" && !!mine && !!published?.commit && (mine === published.commit || mine.startsWith(published.commit) || published.commit.startsWith(mine));
  const when = published ? publishedWhen(published.published) : "";

  return (
    <Modal title="About Studio 4000" onClose={() => useStore.setState({ aboutOpen: false })} width={520}>
      <div className="col" style={{ gap: 14 }}>
        <span className="small dim">Every time this app opens while online, it compares the commit below with the latest published build. When they differ, it downloads that build and reopens. Nobody has to go back to GitHub.</span>
        <div className="col" style={{ gap: 4 }}>
          <b>This copy</b>
          <div className="row" style={{ gap: 8 }}>
            <span className="pill">{info?.version || "0.1.0"}</span>
            <span className="small mono">{mine ? shortCommit(mine) : "Local build"}</span>
          </div>
          {mine.length > 7 && <span className="small faint mono">{mine}</span>}
        </div>
        <div className="col" style={{ gap: 4 }}>
          <b>Latest published build</b>
          {phase === "loading" && <span className="small dim">Checking the published build…</span>}
          {phase === "offline" && <span className="small dim">Couldn't reach GitHub, so the date and commit of the latest build aren't available right now.</span>}
          {phase === "ready" && published && (
            <>
              <span className="small">{published.name}</span>
              <span className="small mono">{published.commit ? shortCommit(published.commit) : "No commit on this release"}</span>
              {published.commit.length > 7 && <span className="small faint mono">{published.commit}</span>}
              {when && <span className="small dim">Published {when}</span>}
              <span className="small">{same ? "This copy is that build." : "A newer build is published. It installs the next time Studio 4000 opens while online."}</span>
            </>
          )}
        </div>
        <b>What's new</b>
        <span className="small dim" style={{ whiteSpace: "pre-wrap" }}>{phase === "ready" && published ? published.notes : FALLBACK}</span>
      </div>
    </Modal>
  );
}
