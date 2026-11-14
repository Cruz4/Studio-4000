Updates from November 12–14, 2026

### Reference another app
Add a Reference Track from the track toolbar, then choose a Windows app, window or screen and enable Share audio. Its draggable, non-blocking FX-style analyzer keeps capturing and averaging while hidden. The Reference Match bar loads saved spectra, explicitly chooses a target track and applies EQ without reopening the analyzer, and can be closed completely when it is not needed. Saved profiles draw their own amber trace, and applying one immediately opens the new editable Parametric EQ. Studio 4000 also shows the live reference spectrum, stereo field and an optional DAW-master overlay, and can record the source to a stereo Reference track.

The AKAsheet button now looks for an installed AKAsheet web-app shortcut first. If it is not installed, the website opens with an install suggestion.

EQ nodes and their frequency knobs use the same logarithmic range during a drag, so the selected knob follows the dot smoothly instead of jumping up and down. Every bundled effect editor now also sends its newest EQ, knob, slider and graph value to the audio engine while the pointer is moving, so a playing or looped passage responds before the control is released.

Noise Reduction adds an Audition-style learned noise-print workflow. Select a noise-only range over an audio clip, capture its FFT profile, then hear Noise Reduction, Reduce By and Noise Floor changes in real time. The spectrum shows the learned print, Output Noise Only auditions exactly what is being removed, bypass gives instant before/after, and Print Cleaned Track creates a baked copy when the cleanup is ready.

### Collaboration codes that survive copy and paste
Join now removes invisible soft hyphens, zero-width characters and line wraps inserted by chat and email. Codes containing both a local and public address try each valid address in order instead of passing malformed text to WebSocket.

### Light mode restored
Restored the original gray backgrounds, toolbar gradients, FX panels and graph styling. Kept the requested slightly darker, bolder main text and readable EQ type labels.

Light-mode browser categories use vivid purple headings on compact light-gray section strips, with a purple edge and clear spacing from the effect names. The lettering has at least 4.5:1 contrast across the original browser gradient. This applies across Effects, Instruments, Media and Chains; the rest of the gray theme is preserved.

### Keep the takes coming
Right-click Record to set up and arm loop takes without starting recording. A LOOP badge on Record shows the mode is enabled. Click Record or press R when you're ready, or right-click again to change settings or turn the mode off. Choose 1–99 passes or keep going until you stop. New tracks inherit the source audio track's mono/stereo format, effects, mixer settings and routing. Mute earlier takes as you go, or keep them playing for layering. The most recent take remains audible when you stop.

Recording waveforms stay steady as the take grows. ASIO interfaces appear in the driver list, pending input changes settle before capture, and driver latency is compensated. The audio-load badge stays still and leaves padding around the toolbar's search button.

### Find your sound
132 complete track chains, with 12 per category: clean vocals, warm vocals, creative vocals, individual drum hits, drum loops and buses, bass, instruments, mix/group processing, vocal mastering, instrumental mastering, and delivery/utility mastering. Browse, search and preview their effect order in Chains, or choose a factory chain in the effects rack. Replace or append effects in one undo step; instruments and mixer controls are preserved.

Vocal Leveler, Hard Limiter, Tube-style Compressor, Vocal Dynamics and Vocal Enhancer join 378 curated effect presets and genuine factory defaults for all 229 bundled effects. New master-bus starting points cover EQ, compression, saturation, width and limiting for vocal mixes, instrumentals, streaming, broadcast and translation checks. These are adjustable starting points. Hard Limiter controls sample peaks; it is not a true-peak limiter.

### Edit with confidence
Selected clips have a fuchsia outline and a subtle brightness lift. Time selections have a clearer fill and edges. Drag the ruler with any tool to select a range, then right-click to split all tracks at both boundaries. Markers extend through the tracks and magnetically catch clips. Ctrl-drag catches markers when Snap is off.

Clip gain, fade, trim and take controls stay behind the track information panels when scrolling horizontally. Hidden controls no longer draw or receive clicks over track headers.

Alt-drag shows a live ghost copy, applies overlap crossfades during the drag, and keeps them on drop. Copies retain independent effects and automation. History has readable names, fixed-height rows, clear Undo/Redo sections and exact step counts.

Normal clip moves now remain visible as a translucent ghost while crossing compatible tracks. Hold Ctrl while trimming or changing a fade on a multi-clip selection to apply the same edit to every selected clip.

Every effect window has local Undo and Redo controls backed by the same reliable engine history as the app toolbar. Continuous control drags coalesce into one step. The compact mixer keeps pan and Mute/Solo/Mono/Arm controls on separate rows so they do not overlap.

### Print your effects
Choose Bounce with Effects to New Track from a track's menu. The track and its inserts are rendered to audio below the original, with room for effect tails. The original stays editable and is muted for comparison, avoiding doubled playback.

Groups have **Bounce Group with Effects to New Track**. It renders all child tracks through the group's inserts and fader onto a stereo track directly after the group. The result is visibly marked **FX PRINT**, and the editable source group is muted automatically so the processed signal does not play twice.

Bus meters now follow the summed post-fader signal, including buses nested inside other buses.

Buses can now output into another bus, with feedback-loop protection. Reference-source recordings are written as stereo 32-bit float WAV files instead of reducing the captured stream to 16-bit.

New audio tracks, instrument tracks, buses and FX returns receive collision-free two-digit names such as Audio 01, Audio 02, Bus 01 and Bus 02. Tracks moved into a group inherit its colour, and grouped track headers and clips stay visually uniform; changing a bus colour updates its family.

Every track, bus and the master has a Mono toggle for checking left/right compatibility. It averages the channels for playback and restores stereo when switched off, without changing the recording format.

Exports now suggest the editable suffix `_4kmix` on the project name so finished mixes are easy to identify. You can remove or rename the suffix before choosing the destination.

### Make it yours
Blue Storm is the default dark theme. The top-right switch alternates between Light and Blue Storm. Existing use of the previous Studio Sessions default moves to Blue Storm once; Studio Sessions can still be selected in Settings afterward. Dark Night preserves the original dark appearance, Plotting has its shorter name, and all 35 supplied palettes remain in Settings.

Light mode retains its original gray surfaces, with slightly stronger dark text, readable EQ type labels and purple browser section headings. Active track FX badges are fuchsia in Studio Sessions.
