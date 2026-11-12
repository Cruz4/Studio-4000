# Complete track chains

The Chains browser contains 96 factory starting points made from Studio 4000's bundled effects. Every category has 12 chains. The preview shows the exact processor order and setting used by each stage; settings remain editable after applying a chain.

| Category | Examples | Chains |
| --- | --- | ---: |
| Vocals: Clean and Forward | Clear Lead, Locked Rap, Proximity Rescue | 12 |
| Vocals: Warm and Smooth | Tube Silk, Velvet Ballad, Warm Narration | 12 |
| Vocals: Creative and Wide | Fuchsia Orbit, Broken Radio, Studio 4000 Prism Voice | 12 |
| Drums: Individual Hits | Kick Deep Punch, Hi-Hat Silk, Tom Weight | 12 |
| Drums: Loops and Buses | Clean Drum Glue, Dusty Sampler, Breakbeat Crunch | 12 |
| Bass | Sub Foundation, Picked Definition, Fuzz Anchor | 12 |
| Instruments | Acoustic Sparkle, Open Piano, Wide Floating Pad | 12 |
| Mix and Groups | Vocal Bus Focus, Keys Group Air, Small Room Group | 12 |

Choose **Replace effects** to start with the selected chain while keeping the instrument and mixer controls, or **Append** to keep the current inserts ahead of it. Both choices undo in one step. Save an edited chain from the effects rack to add your own version to the saved chains list.

## Make the starting point fit the recording

Start with healthy input headroom: peaks around -12 dBFS are useful for auditioning these settings. Adjust compressor and de-esser thresholds while listening to the actual performance. A quiet recording and a loud recording need different thresholds. Use a lower de-esser range if consonants lose clarity. Move a resonance-cut EQ band to the problem frequency rather than assuming every microphone or voice has the same resonance.

Pitch chains start chromatic. Select the song's key and scale for tonal correction. For stereo double and width chains, check the result in mono too. Width on a mono output cannot provide the same stereo spread as a stereo output.

The clean vocal chains use cleanup, controlled dynamics and de-essing before ambience. Warm chains add restrained saturation or tube-style compression. Creative chains deliberately add stronger retuning, sampling texture, doubling, modulation or audible echoes. Names describe the intended starting sound; they do not claim to reproduce a particular artist's session or guarantee a finished mix.

The processing order follows common engineering approaches, including technical EQ, dynamics, tone shaping and de-essing described in [iZotope's vocal-chain guide](https://www.izotope.com/en/learn/crafting-a-basic-vocal-chain) and [its discussion of EQ before and after compression](https://www.izotope.com/community/blog/eq-before-or-after-compression). Drum presets vary attack and release for transient preservation or softening, consistent with the explanation in the [Universal Audio 6176 manual](https://media.uaudio.com/support/downloads/6176_Manual.pdf).

## Verify and maintain the catalogue

`ui/src/data/trackChains.json` contains every stage and parameter value in native units. `tools/make-track-chains.py` builds it from the effect preset banks exported by `tools/export-presets.mjs`. The native refinement checks apply all 96 chains, verify parameter IDs, ranges and actual stored values, and check undo, invalid-input handling and instrument preservation. The app-original creative chains are combinations designed for Studio 4000.
