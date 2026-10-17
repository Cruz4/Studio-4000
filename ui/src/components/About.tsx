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
      title="What's new"
      onClose={closeNotes}
      width={860}
      footer={(
        <div className="whats-foot">
          <span className="pill whats-ver">{label || "v0.1.0"}</span>
          <button className="btn sm accent" onClick={closeNotes}>Got it</button>
        </div>
      )}
    >
      <div className="whats-grid">
        {[["Sessions", "Help"], ["Effects"], ["Arrange", "Look"]].map((titles) => (
          <div key={titles.join()} className="whats-col">
            {titles.map((title) => {
              const group = WHATS_NEW.find((g) => g.title === title)!;
              return (
                <section key={group.title} className="whats-card" style={{ ["--accent" as string]: group.color }}>
                  <span className="whats-tag">{group.title}</span>
                  <ul>
                    {group.items.map((item) => <li key={item}>{item}</li>)}
                  </ul>
                </section>
              );
            })}
          </div>
        ))}
      </div>
    </Modal>
  );
}
