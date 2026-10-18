import { useStore } from "../store";
import { rememberNotes, versionLabel, WHATS_NEW } from "../whatsNew";
import { Modal } from "./ui";

function closeNotes() {
  rememberNotes(versionLabel(useStore.getState().info));
  useStore.setState({ aboutOpen: false });
}

/** Help → What's new, and the first time a session opens on this build. */
export function About() {
  const open = useStore((s) => s.aboutOpen);
  const info = useStore((s) => s.info);
  if (!open) return null;
  const label = versionLabel(info);
  return (
    <Modal
      title={<span className="whats-title">What's new</span>}
      onClose={closeNotes}
      width={560}
      footer={(
        <div className="whats-foot">
          <span className="pill whats-ver">{label || "v0.1.0"}</span>
          <button className="btn sm accent" onClick={closeNotes}>Got it</button>
        </div>
      )}
    >
      <div className="whats">
        <p className="whats-lead">Trim from any edge. Fade when clips overlap. Pan on the clip and the track.</p>
        {WHATS_NEW.map((group) => (
          <section key={group.title} className="whats-row" style={{ ["--accent" as string]: group.color }}>
            <h4>{group.title}</h4>
            <ul>
              {group.items.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </section>
        ))}
      </div>
    </Modal>
  );
}
