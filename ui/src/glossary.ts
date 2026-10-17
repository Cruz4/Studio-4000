// Searchable Help. Each entry says where a control is and how to use it.
export interface GlossaryEntry {
  title: string;
  group: string;
  where: string;
  how: string;
  /** Extra words people type, such as "collab" for Collaborate. */
  also?: string[];
}

export const GLOSSARY: GlossaryEntry[] = [
  {
    title: "How to use this Help",
    group: "Looking around",
    where: "Help menu → How Studio 4000 works, or the welcome screen",
    how: "Type what you want to learn. A few words are enough: collab, record, fade, snap, export. Each result tells you where the control is and what to do. Clear the box to browse everything.",
    also: ["search", "glossary", "help", "guide", "find"],
  },
  {
    title: "Command search",
    group: "Looking around",
    where: "The magnifying-glass button at the right of the top bar, or Ctrl+K",
    how: "Opens a list of commands. Type a name, such as export or metronome, and press Enter to run it. Help → Keyboard shortcuts, or the ? key, lists the keys.",
    also: ["palette", "search commands", "ctrl k"],
  },
  {
    title: "Collaborate",
    group: "Working together",
    where: "The people button on the right of the top bar, or Ctrl+Shift+C",
    how: "That button opens the live session panel. Open a project first. Press Host this session. Studio 4000 opens the connection and shows a code. Copy that code and send it. The other person opens Studio 4000, presses the same people button, pastes the code, and presses Join. The code looks like AB12CD@203.0.113.5:3031. They can be anywhere. End closes the session for everyone. Leave drops you out and returns to the join screen. Voice and screen share are in that panel after you are connected. A room password is optional under Connection settings.",
    also: ["collab", "collab button", "collaborate", "collaboration", "people", "room", "session", "host", "join", "voice", "screen share", "live session"],
  },
  {
    title: "AI assistant",
    group: "Mix help",
    where: "The assistant button on the right of the top bar, or Ctrl+J",
    how: "Opens the side panel. It stays off until you add a key under Settings → AI. The key stays on this computer. Ask it about the session, read what it proposes, then apply only what you want.",
    also: ["ai", "chat", "bot", "gpt", "model"],
  },
  {
    title: "Play and stop",
    group: "Playing and recording",
    where: "The play button in the top transport, or Space",
    how: "Space starts playback from the playhead. Space again stops. Enter stops, and pressing it again returns to the start. Home jumps to the start. End jumps to the end of the session. The comma and period keys move one bar back or forward.",
    also: ["playback", "transport", "spacebar"],
  },
  {
    title: "Record",
    group: "Playing and recording",
    where: "The red record button in the transport, or the R key",
    how: "Arm a track with the record button on its header, or press Shift+R. Then press R. If nothing is armed, R arms the selected track and records. Recording waits for the count-in when that is on. Press R or Space to stop.",
    also: ["arm", "recording", "rec"],
  },
  {
    title: "Count-in",
    group: "Playing and recording",
    where: "The count-in button in the transport, next to the metronome",
    how: "Click it to cycle off, 1 bar, and 2 bars. Shift+C does the same. Recording starts after those bars of clicks.",
    also: ["count in", "preroll"],
  },
  {
    title: "Metronome",
    group: "Playing and recording",
    where: "The metronome button in the transport, or the C key",
    how: "Turns the click on or off. Its level is in the session. Use it with the count-in when you record.",
    also: ["click", "click track"],
  },
  {
    title: "Loop",
    group: "Playing and recording",
    where: "The loop button in the transport, or the L key. The loop range is the top strip of the time ruler",
    how: "Drag in the top of the ruler to set the loop. L turns looping on. Recording while looped stacks takes on the clip. Shift+L loops whatever clips are selected. Punch, the button next to loop or the P key, records only inside that range.",
    also: ["cycle", "loop region", "punch"],
  },
  {
    title: "Tempo and time signature",
    group: "Playing and recording",
    where: "The BPM and time-signature readouts in the transport",
    how: "Scroll the BPM number or click it and type. Click the time signature to change the bar length. The clock beside them switches between bars and minutes when you click it.",
    also: ["bpm", "time sig", "bars", "clock"],
  },
  {
    title: "Markers",
    group: "Playing and recording",
    where: "The time ruler, or the M key",
    how: "M drops a marker at the playhead. Right-click a lane and choose Add marker here. Markers show on the ruler so you can jump to a verse or a hook.",
    also: ["marker", "cue", "verse"],
  },
  {
    title: "Time ruler",
    group: "Looking around",
    where: "The strip directly above the clips",
    how: "It shows clock time, such as 0:05.0. Zoom in and the marks get closer in time. Zoom out and they spread to 5, 15, or 30 seconds. Click the ruler under the loop strip to move the playhead. Drag the top strip to set the loop.",
    also: ["timeline", "seconds", "ruler", "zoom marks"],
  },
  {
    title: "Zoom",
    group: "Looking around",
    where: "The minus, plus, and Fit buttons above the tracks",
    how: "Minus zooms out, plus zooms in. The same keys are - and =. Ctrl+wheel over the clips zooms around the pointer. Fit, or Shift+Z, frames every clip. Ctrl+wheel over the track names changes how tall the tracks are.",
    also: ["zoom in", "zoom out", "fit", "magnify"],
  },
  {
    title: "Snap",
    group: "Clips",
    where: "The Snap menu above the clips, on the right",
    how: "Clips, trims, and the playhead land on this grid. Choices run from 1 bar down through 1/4, 1/8, triplets, and off. Hold Alt while you drag to ignore the grid for that one move.",
    also: ["grid", "quantize grid", "magnet"],
  },
  {
    title: "Arrange tools",
    group: "Clips",
    where: "Move, Time, Split, Slip, and Erase above the clips",
    how: "Keys 1 through 5 select them. The backtick key cycles them. Move drags clips. Time sets the playhead, or drags a loop on empty space. Split cuts a clip where you click. Slip slides the audio inside the clip without moving the clip. Erase deletes the clip you click.",
    also: ["move tool", "split tool", "slip", "erase", "razor"],
  },
  {
    title: "Move a clip",
    group: "Clips",
    where: "The title line on any clip, or the Move tool",
    how: "The title bar is always the move tool, even if Split or Erase is selected. Drag the title onto another track. The ghost grows or shrinks to the height of the track you are dropping on. Audio only drops on audio tracks, and MIDI only on instrument tracks. Arrow keys nudge by one snap step. Shift+arrows jump by a bar. Up and down move the clip to the next track.",
    also: ["drag clip", "move clip", "ghost", "another track"],
  },
  {
    title: "Trim a clip",
    group: "Clips",
    where: "The left and right edges of a clip, with the Move tool selected",
    how: "Drag either edge to shorten or lengthen the clip. The audio stays put while the edge moves. New clips do not get an automatic fade. Drag the small handles on the top edge when you want a fade in or fade out.",
    also: ["crop", "resize clip", "edge", "fade"],
  },
  {
    title: "Clip fades and crossfade",
    group: "Clips",
    where: "The fade handles on an audio clip, or the X key",
    how: "Drag the fade-in handle from the left and the fade-out handle from the right. Right-click a clip and choose Crossfade overlaps, or press X, to fade two overlapping clips on the same track across the overlap.",
    also: ["fade in", "fade out", "crossfade"],
  },
  {
    title: "Clip gain",
    group: "Clips",
    where: "The horizontal line across an audio clip",
    how: "The line is 0 dB in the middle, louder toward the top and quieter toward the bottom. Click it to add a point and drag the point. Double-click or right-click a point to remove it. This is the clip's own level over time, on top of the clip gain in the editor.",
    also: ["volume envelope", "clip volume", "automation on clip"],
  },
  {
    title: "Copy, paste, and delete clips",
    group: "Clips",
    where: "Right-click a clip, or the usual keys",
    how: "Ctrl+C copies, Ctrl+X cuts, Ctrl+V pastes at the playhead, Ctrl+D duplicates, Delete removes. Ctrl+A selects every clip. Right-click also splits, mutes, reverses, normalizes, and recolors. Shift+M mutes the selection.",
    also: ["duplicate", "cut", "copy", "paste", "delete"],
  },
  {
    title: "Split a clip",
    group: "Clips",
    where: "The Split tool, the S key, or right-click → Split here",
    how: "Choose Split above the clips and click inside a clip. Or put the playhead where you want the cut and press S. Right-click and choose Split here to cut at the pointer.",
    also: ["cut clip", "razor", "slice"],
  },
  {
    title: "Takes",
    group: "Clips",
    where: "The take chip on the right of a clip title, and the editor",
    how: "Record in a loop and each pass stacks a take. Click the take chip on the clip to cycle them. Open the editor to comp the parts you want to keep.",
    also: ["comp", "loop record", "takes"],
  },
  {
    title: "Import audio",
    group: "Clips",
    where: "Import above the clips, Ctrl+I, or drop a file on a lane",
    how: "WAV, AIFF, FLAC, OGG, and MP3 land on the selected audio track at the playhead. Drop a file on a lane to put it there. Right-click an audio lane and choose Import audio here.",
    also: ["drag audio", "wav", "import"],
  },
  {
    title: "Tracks",
    group: "Tracks",
    where: "The names on the left of the arrangement",
    how: "Click a name to select that track. Ctrl+click or Shift+click selects several. Drag a name to reorder. The bar under the name is the track level. Drag the divider under a track to change its height. Double-click the divider to reset it. Drag the right edge of the name column to make the headers wider.",
    also: ["track list", "select track", "reorder"],
  },
  {
    title: "Add a track",
    group: "Tracks",
    where: "Right-click a track name or an empty lane, or the Add track row at the bottom",
    how: "Choose an audio track (Ctrl+T), an instrument (Ctrl+Shift+T), a group, or an FX return. The return is created with a reverb. Right-click to duplicate or delete the track you clicked.",
    also: ["new track", "instrument track", "bus", "fx return", "group"],
  },
  {
    title: "Mute, solo, and monitor",
    group: "Tracks",
    where: "The M, S, and monitor controls on the track header and the mixer strip",
    how: "M mutes the track. S solos it. Monitor is Auto unless you set it: you hear the input while that track is recording. Arm with the record dot or Shift+R before you record.",
    also: ["mute", "solo", "input monitoring", "arm"],
  },
  {
    title: "Track volume and pan",
    group: "Tracks",
    where: "The level bar on the track header, and the fader in the mixer",
    how: "Drag the header bar or the mixer fader. The scale is in decibels, and 0 dB is unity. Double-click a fader or its meter to put it back to 0. The same fader is the track volume.",
    also: ["fader", "volume", "pan", "db", "gain"],
  },
  {
    title: "Effects panel",
    group: "Effects",
    where: "The FX button in the top bar. Effects is the first tab along the bottom",
    how: "Shows the effects on the selected track. Switch to Clip effects to edit the chain on the selected audio clip instead. Drag an effect in from the browser, or press Add effect. The dashed box at the end of the row is the drop target.",
    also: ["fx", "plugin", "plug-in", "inserts"],
  },
  {
    title: "Open or minimize an effect",
    group: "Effects",
    where: "The arrow on an effect card in the Effects tab",
    how: "A minimized card keeps a few knobs so the row stays readable. Open it for the full graph, meters, and the rest of the controls. The same two sizes are used for built-in effects and other plug-ins. Click the name to open or minimize. Double-click the card to open the effect in its own window.",
    also: ["minimize", "expand", "vst", "vst3", "plugin window"],
  },
  {
    title: "Turn an effect on or off",
    group: "Effects",
    where: "The power button on the effect card, or Shift+F for the whole track",
    how: "The power button bypasses that one effect. Shift+F bypasses every insert on the selected track, and presses again to bring back the ones that were on.",
    also: ["bypass", "power", "disable effect"],
  },
  {
    title: "Copy and reorder effects",
    group: "Effects",
    where: "The Effects tab, with the rack clicked so it has focus",
    how: "Ctrl+click or Shift+click selects several. Ctrl+C copies them and Ctrl+V pastes onto the track or clip you are viewing. Drag a name onto another track to copy it there. Drag the grip to reorder. Delete removes the selection. Save chain stores the row. Load chain, and Load insert chain on the track right-click menu, puts a saved chain back.",
    also: ["duplicate effect", "paste effect", "chain", "preset chain"],
  },
  {
    title: "Browse effects and instruments",
    group: "Effects",
    where: "The browser on the left, or the B key",
    how: "B shows or hides the browser. The Effects, Instruments, Media, and Chains tabs are inside it. Drag an effect onto a track, a clip, or the Effects panel. Drag an instrument onto an instrument track. Scan for VST plug-ins from the browser or from Settings → Plug-ins.",
    also: ["browser", "vst scan", "media", "instruments"],
  },
  {
    title: "Clip editor",
    group: "Editing audio and MIDI",
    where: "Double-click a clip, the piano button in the top bar, or the E key",
    how: "Audio opens for gain, fades, pitch, and takes. MIDI opens the piano roll. Drag notes, and use the arrows to nudge the notes you selected. Q quantizes selected MIDI to 1/16.",
    also: ["editor", "piano roll", "waveform editor"],
  },
  {
    title: "Play an instrument from the computer keyboard",
    group: "Editing audio and MIDI",
    where: "An instrument track, with musical typing on (Shift+K)",
    how: "A to L are the white keys and the row above is the black keys. Z and X change octave. Click the on-screen keys as well. MIDI panic stops stuck notes. It is in the command search.",
    also: ["typing keyboard", "midi keyboard", "caps", "notes"],
  },
  {
    title: "New MIDI clip",
    group: "Editing audio and MIDI",
    where: "Double-click an empty instrument lane, or right-click it",
    how: "Choose New MIDI clip here. The clip opens in the piano roll. Add an instrument track first with Ctrl+Shift+T if you do not have one.",
    also: ["midi clip", "piano clip"],
  },
  {
    title: "Automation",
    group: "Editing audio and MIDI",
    where: "The A key, or the automation menu on a track",
    how: "A opens the volume lane under the selected track. Drag on the lane to draw points. The clip gain line is separate: that one rides on the clip and moves with it.",
    also: ["automate", "volume lane", "envelope"],
  },
  {
    title: "Mixer",
    group: "Mixer",
    where: "The mixer button in the top bar (Tab), or F3 for the full page",
    how: "Tab opens the mixer under the tracks. F3 replaces the arrangement with the full mixer, and F3 again comes back. Every fader is the same height. Right-click a strip for the same track actions as the name column. Double-click a fader or meter to reset it to 0 dB. The loudness number in the transport is the master reading. Click it to reset the integrated measurement.",
    also: ["mix window", "faders", "lufs", "strips"],
  },
  {
    title: "Smart Mix",
    group: "Mix help",
    where: "The sparkle button in the top bar, or Ctrl+M",
    how: "Measures the session on this computer. Preview can set levels, balance tracks by role, duck music under a voice, and master toward a loudness target. Read the plan, then Apply. Ctrl+Z undoes the whole pass. Right-click a track header for an instant vocal chain: modern pop, warm, or podcast.",
    also: ["smartmix", "auto mix", "master", "vocal chain", "gain stage"],
  },
  {
    title: "Save, open, and export",
    group: "Files and settings",
    where: "The File menu, and the export button on the right of the top bar",
    how: "Ctrl+N starts a session, Ctrl+O opens one, Ctrl+S saves. Projects are .s4000 files. Ctrl+E exports the mix or stems. Archive project zips the session with its audio. Show project folder opens the folder on disk.",
    also: ["save", "open", "export", "stems", "bounce", "archive"],
  },
  {
    title: "Undo and history",
    group: "Files and settings",
    where: "The undo and redo buttons in the top bar, and the History button beside them",
    how: "Ctrl+Z undoes. Ctrl+Y or Ctrl+Shift+Z redoes. History lists the steps so you can jump back to one of them. Clip edits, effect edits, and Smart Mix each undo as their own step.",
    also: ["undo", "redo", "history"],
  },
  {
    title: "Settings",
    group: "Files and settings",
    where: "The gear button on the right of the top bar, or Ctrl+comma",
    how: "Audio chooses the device, sample rate, and buffer. Plug-ins scans and blocks VST plug-ins. AI is where the assistant key goes. Sessions holds an optional custom relay, your display name, and TURN. Hosting a session uses the connection the app opens itself. General includes the look of the app. The theme button in the top bar switches between dark and light without opening Settings.",
    also: ["preferences", "audio device", "sample rate", "buffer", "asio", "wasapi", "theme", "dark", "light"],
  },
  {
    title: "Updates",
    group: "Files and settings",
    where: "Automatic when Studio 4000 opens, or Help → Check for updates",
    how: "Online, it looks for a newer build on open and every few minutes. It waits until you are not playing or recording, then downloads and reopens. The first time you open a session on a new build, What's new lists what changed. Help → What's new opens that list again. The v label at the bottom is this copy. Help → Check for updates runs the check immediately.",
    also: ["update", "version", "what's new"],
  },
  {
    title: "Report a problem or tip",
    group: "Files and settings",
    where: "The Help menu, and the buttons at the bottom of this guide",
    how: "Report a bug or idea opens an email to akasheet.support@gmail.com. Buy me a coffee is optional. Studio 4000 is free to use. The AKAsheet button opens akasheet.com, where artists share and sell music.",
    also: ["support", "bug", "coffee", "akasheet", "tip"],
  },
];

const STOP = new Set(["a", "an", "the", "where", "is", "how", "to", "do", "it", "i", "want", "find", "out", "and", "or", "of", "in", "on", "for", "my", "me", "what", "can", "you", "please", "show", "tell", "about", "does", "this", "that", "with"]);

function words(q: string) {
  return q.toLowerCase().split(/[^a-z0-9+]+/).filter((w) => w && !STOP.has(w));
}

function haystack(entry: GlossaryEntry) {
  return [entry.title, entry.group, entry.where, entry.how, ...(entry.also ?? [])].join(" ").toLowerCase();
}

/** Entries whose text contains every meaningful word, best title matches first. */
export function searchGlossary(query: string, entries: GlossaryEntry[] = GLOSSARY) {
  const need = words(query);
  if (!need.length) return entries;
  const ranked = entries.flatMap((entry) => {
    const text = haystack(entry);
    if (!need.every((w) => text.includes(w))) return [];
    const title = entry.title.toLowerCase();
    const also = (entry.also ?? []).join(" ").toLowerCase();
    const score = need.reduce((n, w) => n + (title.includes(w) ? 3 : 0) + (also.includes(w) ? 2 : 0) + (text.includes(w) ? 1 : 0), 0);
    return [{ entry, score }];
  });
  ranked.sort((a, b) => b.score - a.score);
  return ranked.map((r) => r.entry);
}
