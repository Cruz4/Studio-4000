# How to use and build Studio 4000

Studio 4000 is a vibe-coded DAW, and it is fully free to use. There is no fee and no account. This is the practical guide. The in-app tour (Help → How Studio 4000 works, or **How things work** on the welcome screen) is about where things are on screen. This file is about installing, sharing a copy, and building.

The mark in the top bar, just before search, opens [AKAsheet](https://akasheet.com/?ref=studio4000): a place for artists to share and sell music, discover other artists, connect, and use a smart notebook with AI tools and pathways.

## Install

After a build, this installs for the current Windows user and adds a Start-menu shortcut. It does not need an administrator:

```powershell
.\tools\package.ps1 -Install
```

The app lands in `%LOCALAPPDATA%\Programs\Studio 4000\`. Run `Studio 4000.exe` there, or open **Studio 4000** from the Start menu.

While a published copy is online, it checks for a newer build when it opens and every few minutes after. Help → Check for updates runs that check immediately. Help → What's new shows the version and the notes from the latest published build. A push to the main branch of the public project publishes the build, and the app downloads it and reopens, whether it lives in the install folder or was unzipped somewhere else. It waits if you are playing or recording. A copy you built yourself, in the build folder, does not replace itself.

`.\tools\package.ps1` without `-Install` only writes a portable zip at `dist\Studio4000-0.1.0-win64.zip`.

## Give someone a copy

1. Zip the whole `Studio 4000` folder next to the exe (the install folder, or the folder inside the portable zip).
2. Send that zip.
3. They unzip it and run `Studio 4000.exe`.

That copy is their own app. It does not join your session by itself, and it does not sign them into an account. There is no account.

To work on one session together:

1. Both people run Studio 4000.
2. The host opens a project, presses the people button (**Ctrl+Shift+C**), and clicks **Host this session**.
3. The host copies the code and sends it.
4. The other person pastes that whole code and clicks **Join**.

Studio 4000 opens the connection. The code looks like `AB12CD@192.168.1.20:3031,203.0.113.5:3031`. Paste the whole code. It tries the same network first, then the internet address. **End** closes the session. **Leave** drops out and returns to the join screen.

If a chat or email inserts invisible soft hyphens, zero-width marks, or line wraps into the copied code, Join removes them before validating both addresses.

Voice and screen share are in the same panel. An optional password can lock the room. The host's project is the one everyone hears.

## First session

1. Pick **Vocal recording**, **Band tracking**, **Beat making**, **Podcast / voice**, or **Empty session**.
2. On the Audio card, click **Set up** and choose the driver. Installed ASIO interfaces appear directly in the Driver list, for example **Focusrite USB ASIO (ASIO)** for a Scarlett interface. ASIO uses the same interface for input and output.
3. Select a track, press **Shift+R** to arm it, then **R** to record. **Space** stops.

**Ctrl+K** searches every command. **?** lists shortcuts. Projects are saved under `Music\Studio 4000\<project name>`. The app autosaves beside the project and can offer that copy after a crash. Settings → General changes how often.

## Tracks, clips, and the mixer

Click a track name to select it. The highlight runs across the name and the clips. Right-click a name, an empty lane, or a mixer strip to add a stereo or mono audio track, an instrument, a stereo or mono bus, or an FX return, or to duplicate and delete. The STEREO or MONO label on an audio track or a bus switches it. A mono track plays one channel. A mono bus sums what you send to it into one channel.

New items are numbered without collisions: Audio 01, Audio 02, Instrument 01, Bus 01, and so on. Moving tracks into a bus gives its whole family one colour across track headers and clips. Change the bus colour to recolour the group together; individual tracks can still be recoloured afterward.

Drag a track name, or the empty part of a mixer strip, to reorder. The track lifts, a label follows the pointer, and a line shows the slot before you let go. If the track header is short, scroll inside that info box to reach the input, effects, and volume.

Arrow keys nudge a selected clip. Shift nudges by a bar. The tools above the arrangement are Move, Time, Split, Slip, and Erase. **Fit** zooms so every clip is on screen. Ctrl+wheel over the clips zooms around the pointer. Ctrl+wheel over the track names changes track height without jumping away from the track under the pointer.

**F3** is the full-page mixer. Every fader is the same height. Right-click empty mixer space to add a track.

The compact mixer keeps pan on its own row above Mute, Solo, Mono and Arm, so every control remains available at narrow dock sizes. A bus can choose another bus as its output; Studio 4000 blocks routes that would feed back into themselves.

## Recording and MIDI

The dot arms a track. The monitor button cycles Auto, On, and Off. Auto hears the input only while that track is actually recording.

The clip grows while you record, with a waveform drawn from the captured audio. It appears before you stop, including when monitoring is Off.

Settings → Audio shows the input and output latency reported by the driver. Recording compensates for that latency automatically. If a hardware loopback measurement still places a pulse late by 10 ms, set that input's **Timing correction** to **+10 ms**. If the pulse is early by 10 ms, use **−10 ms**. The correction affects new takes; it does not move existing clips. Leave the correction at 0 unless you have measured a remaining offset.

With the Move tool, drag empty track space to select clips. Holding the pointer at any edge scrolls the tracks in that direction, and clips beyond the original view stay included in the selection.

Instrument tracks play from a MIDI keyboard, and from the computer keyboard while the piano roll is open or musical typing is on (**Shift+K**). A to L are the white keys. The row above is the black keys. Z and X change octave.

**C** toggles the metronome. **Shift+C** cycles the count-in. Loop a range and record to stack takes, then comp them in the editor (**E**).

## Effects

Effect controls update the audio engine continuously while you drag. Use the Undo and Redo arrows in any effect window to move backward or forward through parameter changes without closing it. A whole drag is stored as one history step, and the toolbar shares the same history.

### Learned Noise Reduction

Add **Noise Reduction** from the browser's Noise Reduction category. Select one audio clip, then drag a time range over a section containing only the steady unwanted sound. Open the effect and choose **Capture Noise Print**. The graph displays the learned FFT profile.

Loop the part you want to clean and adjust **Noise Reduction**, **Reduce By**, and **Noise Floor** while listening; changes are live. **Output Noise Only** lets you hear what the processor removes. Use the effect power button for instant before/after. When satisfied, choose **Print Cleaned Track** to create a baked audio track while retaining the editable source. Short, representative noise-only captures work best; excessive reduction can create watery or flanged artifacts.

Click an effect to select it. Double-click to open it. You can leave several open. Clicking the page does not close them. Delete removes the selected effect when no clip is selected.

Track effects and Clip effects each have a Dry / Wet bar, shown next to the tab that is selected. Dry is the sound before that chain. Wet is the full chain. Double-click the bar for fully wet.

The Chains browser includes 132 complete multi-effect starting points. Three mastering categories contain 12 vocal-mix masters, 12 instrumental masters, and 12 delivery/utility masters. These use conservative, real parameter values across EQ, compression, saturation, stereo width and limiting; always level-match and adjust them for the actual song rather than treating a preset as automatic mastering.

On the EQ, the white line is the curve you are shaping. The filled colour is the sound, and it appears when something is actually playing. When you stop, the last shape stays faded.

### Reference audio from another app

Click **Reference** above the tracks, then **Choose app / window**. Select the Windows source and enable **Share audio**. The blue trace is the external reference; **Compare DAW master** adds the fuchsia master trace, and a loaded saved profile is amber. The stereo panel shows the source's width and field. This is a draggable FX-style window, so the arrangement remains usable underneath it. Hide it with X or **Hide window**; analysis, averaging and recording continue in the background. The **Reference Match** bar can load a saved profile, choose an exact target track, apply its EQ, reopen the analyzer, or explicitly disconnect the source. Its X button closes the bar and stops a live source without deleting saved profiles; use the main Reference button whenever you want it again.

**Record source to Reference track** writes a stereo WAV into the project and places it on a Reference track. Let a source play for a few seconds before saving a profile. Load that profile, choose an audio or instrument target, and apply it from either the analyzer or the background bar. Studio 4000 adds and opens an editable eight-band Parametric EQ. Match corrections are limited to ±6 dB and do not copy loudness or mastering.

### Print a track or group with effects

Right-click an audio, instrument or group track. Choose **Bounce with Effects to New Track**, or **Bounce Group with Effects to New Track** for a bus. Studio 4000 renders the audible result onto a new stereo track directly after the source and mutes the editable source to prevent doubled playback. Group prints include their child tracks, bus inserts and bus fader. Printed tracks carry an **FX PRINT** badge and have no duplicate insert chain because the processing is already baked into the audio.

## Smart Mix and the assistant

**Ctrl+M** opens Smart Mix. It measures the session on this computer. Preview can gain-stage tracks, balance them by role, duck music under a voice, and master toward a loudness target. Apply is one undo step.

The assistant (**Ctrl+J**) is an editor for the session: it can arm tracks, print MIDI to audio, turn a hummed clip into notes, and propose mix changes. Every edit is a plan you approve, and that plan is one undo step. Without a model key it still runs Smart Mix and the converters on this computer. Connect your own key under Settings → AI for a smarter editor. Studio 4000 does not charge for that key.

MIDI records like a vocal: arm an instrument track, loop a range, and Record stacks takes you can cycle in the editor. **Capture MIDI** (Ctrl+Shift+L) keeps the last notes you played if you forgot to record. **Audio to MIDI** (Ctrl+Shift+M) turns a hummed or sung clip into notes. **Print to audio** (Ctrl+Shift+B) plays the instrument and drops a new audio clip.

In a live session, guests should use **Click + cue**. The click is generated on their computer from your playhead, so it is not late. Mark tracks with **C** for the cue they should hear. The full mix over screen share arrives late — leave it muted while they record.

Settings → Agent link can show a config block for an MCP client on this computer. The link listens on localhost and needs the token stored in your user profile.

## Build from source

You need:

- Windows
- Visual Studio 2022 Build Tools (or Visual Studio) with the C++ workload and the Windows SDK
- CMake (the Build Tools copy is enough; `build.ps1` finds it)
- Node.js 18 or newer
- Git

Then, from this folder:

```powershell
.\tools\fetch-deps.ps1
.\build.ps1
.\tools\package.ps1 -Install
```

`build.ps1` builds the interface, the MCP server, the session relay, and `Studio 4000.exe`.

Other checks:

```powershell
.\build.ps1 -Config Debug
.\tools\test-recording.ps1
"build\Studio4000_artefacts\Release\Studio 4000.exe" --selftest
cd ui; npm test
cd ui; npm run dev
node tools\ui-screens.mjs
```

`npm run dev` opens the interface in a browser with a stand-in engine. `ui-screens.mjs` refreshes the pictures in `docs/screenshots`. The app hosts live sessions itself. The browser preview has no relay, so a picture of a connected session still needs `node server\index.mjs`.

### Dependencies

**Tracktion Engine** is cloned from GitHub at the commit in `tools/deps.json`, then `patches/tracktion-input-monitor.patch` is applied. That patch makes a track's own monitor setting win, and makes Auto hear the input only while that track is recording. If `external/tracktion_engine` is already there and the patch is present, the script leaves it alone.

**ASIO SDK.** `fetch-deps.ps1` downloads the pinned official Steinberg SDK into `external/asiosdk` when its headers are missing. Published Windows builds require ASIO support. The SDK stays outside this source repository, and its license and usage notices are copied into the portable package. The SDK has its own Steinberg or GPL-3.0 license, as its `LICENSE.txt` describes; this project's free-use license does not replace those terms.

**WebView2.** The native window uses Microsoft WebView2. `fetch-deps.ps1` downloads the package into `external/webview2`, using the version in `tools/deps.json`.

**VST2.** Hosting old VST2 plug-ins needs Steinberg's VST2 SDK, which cannot be redistributed. Place it at `external/vst2sdk` if you have the right to use it. Without it, the app still hosts VST3.

Do not commit `external/asiosdk`, `external/webview2`, `external/tracktion_engine`, `build`, `dist`, or `vsts`. Those are ignored on purpose.

## Layout

- `src/` — the native app
- `ui/` — the interface
- `mcp/` — the agent link
- `server/` — the live-session relay
- `tools/` — build, fetch, screenshots, and packaging
- `patches/` — the Tracktion monitor patch


## Vocal effects and presets

Use **Vocal Leveler** for slow RMS phrase leveling. Set its noise floor above the recording's room noise; limit maximum gain change to keep breaths natural. Follow it with **Compressor** or **Tube-style Compressor** for individual peaks. The tube-style processor adds asymmetric saturation; it does not model a particular hardware unit.

**Vocal Dynamics** combines compression, downward expansion and a sample ceiling. **Vocal Enhancer** offers a rumble cut, 3.5 kHz presence, 10 kHz air and harmonic excitation. Use the existing **De-esser** after brightening a voice. **Hard Limiter** is a zero-latency hard sample clipper; choose **Brickwall Limiter** for smoother look-ahead limiting. Neither label promises intersample true-peak protection. **Stereo Width** expands existing stereo content; use **Vocal Doubler** first if you need side content from a mono voice.

Every bundled effect has a **Factory default** entry. The original Studio effects and the new vocal suite also have curated starting points. Their thresholds still need to match the level of your recording, and pitch presets require the correct key and scale. **Save preset** stores a parameter snapshot on this device for that processor type. A preset replaces controls from the factory baseline, so the previous preset cannot leave extra boosts, bands or modes active. Fixed processors with no exposed controls have their factory response.

## Markers, duplicate previews and appearance

Marker lines extend through tracks and clips. With Snap enabled, either clip edge catches a marker within ten screen pixels. With Snap off, hold Ctrl while dragging to enable the marker magnet temporarily. Move farther than the catch zone to continue past the marker. With Snap enabled, Ctrl still locks time for vertical moves. Alt-drag shows the stationary original plus a translucent copy while dragging, then commits the copy at the shown time and compatible destination track.

Select a palette under **Settings > General > Appearance theme**. Blue Storm is the default dark theme. Studio Sessions remains available with its fuchsia Effects headings, and Dark Night preserves the original dark appearance. All 35 supplied palettes remain available, with dark tinted surfaces and contrast-adjusted text. The toolbar Light/Dark button switches between Default Light and Blue Storm. Ctrl+wheel over track information continues to resize tracks.

### Record loop takes on separate tracks

Highlight the part you want by dragging left or right on the time ruler. This works with every editing tool. The range must be longer than two seconds. Right-click **Record**, choose the source audio track, and select a take count or **Keep going until I stop**. Keep **Mute previous takes as I go** on for individual takes, or turn it off to layer over earlier performances. Click **Arm loop takes** to save the setup without starting recording. The Record button shows **LOOP** while this mode is enabled. When you're ready, click Record or press **R**.

Each pass gets its own track with the source's mono/stereo format, effects, mixer settings and output routing. The transport keeps running between passes. Recording stops at the chosen count or when you press Stop; the most recent take stays audible. Right-click Record again to change the setup or choose **Turn off loop takes** before recording. The LOOP badge disappears when standard recording is restored.

### Use complete track chains

Open **Chains** in the left browser, or **Load chain** in the effects rack. There are 96 factory chains in eight categories, including 36 vocal chains. Search for a sound or processor, select a chain, and review its effect order. Choose whether to replace or append effects, then apply it. Instruments and mixer controls stay in place, and the change undoes in one step. You can also drag a chain onto a track to open its preview. See [Track chains](TRACK-CHAINS.md) for starting levels and examples.

### Split a selected range

Drag the ruler to highlight time, then right-click inside the highlighted range on a clip, a lane or the ruler. **Split all tracks at selection boundaries** cuts audio and MIDI clips at both ends without deleting the middle. Both cuts undo together. If tracks are selected, the menu also offers to split only those tracks.

### Print a track with its effects

Right-click a track header and choose **Bounce with Effects to New Track**. A new audio track appears directly below the source, with its effects and fader level baked into the audio and an allowance for effect tails. The original remains editable and is muted to avoid doubled playback. The new track has no duplicate insert effects. Undo removes the printed track and restores the original's mute state.

Bus meters show the summed signal after the bus fader, including buses inside other buses. Alt-drag duplicates display overlap crossfades during the drag and retain them immediately on drop. Selected clips and time ranges use clearer fuchsia highlights.

The **Mono** toggle in every track header and mixer strip averages left and right into matching mono outputs. It is available on audio tracks, instruments, returns, buses and the master. Toggle it off to restore stereo. This checks playback without changing the recording format, source files or insert presets.
