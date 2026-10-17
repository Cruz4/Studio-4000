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

Voice and screen share are in the same panel. An optional password can lock the room. The host's project is the one everyone hears.

## First session

1. Pick **Vocal recording**, **Band tracking**, **Beat making**, **Podcast / voice**, or **Empty session**.
2. On the Audio card, click **Set up** and choose the driver. ASIO is listed when an ASIO driver is installed.
3. Select a track, press **Shift+R** to arm it, then **R** to record. **Space** stops.

**Ctrl+K** searches every command. **?** lists shortcuts. Projects are saved under `Music\Studio 4000\<project name>`. The app autosaves beside the project and can offer that copy after a crash. Settings → General changes how often.

## Tracks, clips, and the mixer

Click a track name to select it. The highlight runs across the name and the clips. Right-click a name, an empty lane, or a mixer strip to add a stereo or mono audio track, an instrument, a stereo or mono bus, or an FX return, or to duplicate and delete. The STEREO or MONO label on an audio track or a bus switches it. A mono track plays one channel. A mono bus sums what you send to it into one channel.

Drag a track name, or the empty part of a mixer strip, to reorder. The track lifts, a label follows the pointer, and a line shows the slot before you let go. If the track header is short, scroll inside that info box to reach the input, effects, and volume.

Arrow keys nudge a selected clip. Shift nudges by a bar. The tools above the arrangement are Move, Time, Split, Slip, and Erase. **Fit** zooms so every clip is on screen. Ctrl+wheel over the clips zooms around the pointer. Ctrl+wheel over the track names changes track height without jumping away from the track under the pointer.

**F3** is the full-page mixer. Every fader is the same height. Right-click empty mixer space to add a track.

## Recording and MIDI

The dot arms a track. The monitor button cycles Auto, On, and Off. Auto hears the input only while that track is actually recording.

Instrument tracks play from a MIDI keyboard, and from the computer keyboard while the piano roll is open or musical typing is on (**Shift+K**). A to L are the white keys. The row above is the black keys. Z and X change octave.

**C** toggles the metronome. **Shift+C** cycles the count-in. Loop a range and record to stack takes, then comp them in the editor (**E**).

## Effects

Click an effect to select it. Double-click to open it. You can leave several open. Clicking the page does not close them. Delete removes the selected effect when no clip is selected.

Track effects and Clip effects each have a Dry / Wet bar, shown next to the tab that is selected. Dry is the sound before that chain. Wet is the full chain. Double-click the bar for fully wet.

On the EQ, the white line is the curve you are shaping. The filled colour is the sound, and it appears when something is actually playing. When you stop, the last shape stays faded.

## Smart Mix and the assistant

**Ctrl+M** opens Smart Mix. It measures the session on this computer. Preview can gain-stage tracks, balance them by role, duck music under a voice, and master toward a loudness target. Apply is one undo step.

The assistant (**Ctrl+J**) stays off until you connect a model under Settings → AI with a key from your own account. That key stays on this computer. Studio 4000 does not charge for the assistant. If a provider bills anyone, it is that account, and only after you connect one.

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
"build\Studio4000_artefacts\Release\Studio 4000.exe" --selftest
cd ui; npm test
cd ui; npm run dev
node tools\ui-screens.mjs
```

`npm run dev` opens the interface in a browser with a stand-in engine. `ui-screens.mjs` refreshes the pictures in `docs/screenshots`. The app hosts live sessions itself. The browser preview has no relay, so a picture of a connected session still needs `node server\index.mjs`.

### Dependencies the script does not download

**Tracktion Engine** is cloned from GitHub at the commit in `tools/deps.json`, then `patches/tracktion-input-monitor.patch` is applied. That patch makes a track's own monitor setting win, and makes Auto hear the input only while that track is recording. If `external/tracktion_engine` is already there and the patch is present, the script leaves it alone.

**ASIO SDK.** Steinberg's license does not allow this repository to ship the SDK. Download the ASIO SDK from Steinberg and place it so `external/asiosdk/common` exists. Hosting VST3 does not need it. ASIO device drivers do. The SDK is their license, or GPL-3.0, as their own `LICENSE.txt` describes. This project's free-use license does not replace that.

**WebView2.** The native window uses Microsoft WebView2. Put the `Microsoft.Web.WebView2` package at `external/webview2` (the layout JUCE expects: a folder whose child is `Microsoft.Web.WebView2.<version>`). Version 1.0.3485.44 is the one this tree was built with.

**VST2.** Hosting old VST2 plug-ins needs Steinberg's VST2 SDK, which cannot be redistributed. Place it at `external/vst2sdk` if you have the right to use it. Without it, the app still hosts VST3.

Do not commit `external/asiosdk`, `external/webview2`, `external/tracktion_engine`, `build`, `dist`, or `vsts`. Those are ignored on purpose.

## Layout

- `src/` — the native app
- `ui/` — the interface
- `mcp/` — the agent link
- `server/` — the live-session relay
- `tools/` — build, fetch, screenshots, and packaging
- `patches/` — the Tracktion monitor patch
