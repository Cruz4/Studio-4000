import { native } from "../bridge";
import { AKASHEET_TIP, AKASHEET_URL, COFFEE_URL, supportMailto } from "../support";
import { useStore } from "../store";
import { Modal } from "./ui";

const SECTIONS: { title: string; where: string; text: string }[] = [
  {
    title: "The screen",
    where: "Menus across the top, tracks down the left, clips to the right",
    text: "The left column is the track list. The area beside it is the arrangement, where clips live. The buttons along the top move the playhead, record, undo, and open the mixer, the editor, Smart Mix, the assistant, and a live session.",
  },
  {
    title: "Tracks",
    where: "Click a name in the left list",
    text: "Click a track to select it. The highlight runs across the name and the clips. Right-click a name, an empty lane, or a mixer strip to add an audio track, an instrument, a bus, or an FX return, or to duplicate and delete. Drag a track name, or the empty part of a mixer strip, to reorder it. While you hold it, the track lifts and a line shows the slot it will drop into. The bar under the name is that track's level.",
  },
  {
    title: "Recording",
    where: "The R button, or the R key",
    text: "Arm the track with the record button on its header, then press R. Recording starts after the count-in. Loop a section to stack takes, then open the clip and comp the best parts. Monitor is Auto by default: you hear the input only while that track is actually recording.",
  },
  {
    title: "Clips",
    where: "The arrangement, and the tool buttons above it",
    text: "Move, Time, Split, Slip, and Erase change what a click does. Arrow keys nudge a selected clip; Shift jumps by a bar. Right-click a clip to split, cut, copy, paste, duplicate, mute, or delete. Fit, next to the zoom buttons, shows every clip. Double-click a clip to edit it.",
  },
  {
    title: "The editor",
    where: "Double-click a clip, or press E",
    text: "Audio clips open for gain, fades, and takes. MIDI clips open in the piano roll. With a MIDI clip open on an instrument track, the computer keyboard plays that instrument: A to L are the white keys, the row above is the black keys. Clicking a piano key plays it too. Arrows edit the notes you have selected.",
  },
  {
    title: "Effects",
    where: "The FX row on a track, or the inserts in the mixer",
    text: "Click an effect to select it. Double-click to open it. Several can stay open; clicking the page does not close them. Delete removes the selected effect. The white line on the EQ is the curve you are shaping. The filled colour is the sound, and it only appears when something is actually playing. When you stop, that last shape stays faded until you play again.",
  },
  {
    title: "The mixer",
    where: "The Mixer tab at the bottom, or F3 for the full page",
    text: "Every fader is the same height. Right-click a strip for the same track actions as the track list: new tracks, duplicate, and delete. Right-click empty mixer space to add a track.",
  },
  {
    title: "Smart Mix",
    where: "The sparkle button, or Ctrl+M",
    text: "Smart Mix measures the session on this computer. Preview can gain-stage every track, balance them by role, duck music under a voice, and master to a loudness target. Read the plan, then Apply. It is one undo step, so Ctrl+Z puts it back.",
  },
  {
    title: "The assistant",
    where: "The assistant button on the right of the top bar",
    text: "The assistant can look at the session and propose mix changes for you to apply. It stays off until you connect a model under Settings, then AI, with a key from your own account. That key never leaves this computer. Studio 4000 does not charge for it; if a provider bills anyone, it is that account, and only after you connect one.",
  },
  {
    title: "Updates",
    where: "Automatic when it opens, or Help → Check for updates",
    text: "While this computer is online, Studio 4000 looks for a newer build every time it opens, and again every few minutes. Help → Check for updates does the same check right away. A new push on the public project publishes that build. The app downloads it and reopens. It waits until playback or recording has stopped. Help → What's new shows the version and the notes for the latest build.",
  },
  {
    title: "Playing together",
    where: "The people button, or Ctrl+Shift+C",
    text: "Both people run Studio 4000. One hosts a session and shares the room code. The other joins with that code. Voice and screen share are in the same panel. The session goes through a small relay you start on a computer both of you can reach.",
  },
];

/** Where things are and what they do. Opened from Help and from the welcome screen. */
export function Guide() {
  const open = useStore((s) => s.guideOpen);
  const version = useStore((s) => s.info?.version);
  if (!open) return null;
  return (
    <Modal title="How Studio 4000 works" onClose={() => useStore.setState({ guideOpen: false })} width={640}>
      <div className="col" style={{ gap: 14 }}>
        {SECTIONS.map((s) => (
          <div key={s.title} className="col" style={{ gap: 3 }}>
            <b>{s.title}</b>
            <span className="small" style={{ color: "var(--cyan)" }}>{s.where}</span>
            <span className="small dim">{s.text}</span>
          </div>
        ))}
        <button className="btn sm akasheet-text" onClick={() => native.openUrl(AKASHEET_URL)}>AKAsheet<span className="tip">{AKASHEET_TIP}</span></button>
        <button className="btn sm" title="Opens your email app with a note to akasheet.support@gmail.com" onClick={() => native.openUrl(supportMailto(version))}>Report a bug or idea</button>
        <button className="btn sm" onClick={() => native.openUrl(COFFEE_URL)}>Buy me a coffee</button>
        <span className="small faint">Studio 4000 is free to use. A tip is optional, and it goes to the person who makes it.</span>
      </div>
    </Modal>
  );
}
