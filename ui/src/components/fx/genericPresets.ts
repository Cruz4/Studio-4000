import type { Preset } from "./presets";
export const GENERIC_PRESETS: Record<string, Preset[]> = {
  "s4000leveler": [
    {
      "name": "Lead vocal - gentle leveling",
      "values": {
        "target": -20,
        "range": 6,
        "floor": -50,
        "attack": 200,
        "release": 1100
      },
      "description": "Slow RMS gain riding, limited to 6 dB. Set the floor above room noise."
    },
    {
      "name": "Rap vocal - steady phrases",
      "values": {
        "target": -18,
        "range": 9,
        "floor": -48,
        "attack": 90,
        "release": 500
      },
      "description": "Faster phrase leveling. Follow with the compressor for individual peaks."
    },
    {
      "name": "Spoken word - soft leveling",
      "values": {
        "target": -22,
        "range": 6,
        "floor": -52,
        "attack": 250,
        "release": 1500
      },
      "description": "Gradual gain changes preserve speech emphasis."
    },
    {
      "name": "Quiet vocal lift",
      "values": {
        "target": -20,
        "range": 12,
        "floor": -44,
        "attack": 180,
        "release": 1200
      },
      "description": "Raises quiet phrases up to 12 dB, only above the detector floor."
    },
    {
      "name": "Backing vocal consistency",
      "values": {
        "target": -24,
        "range": 8,
        "floor": -50,
        "attack": 180,
        "release": 700
      },
      "description": "Restrained backing-vocal level with moderate recovery."
    },
    {
      "name": "Loud vocal restraint",
      "values": {
        "target": -24,
        "range": 9,
        "floor": -48,
        "attack": 40,
        "release": 1200
      },
      "description": "Lower RMS target and fast gain reduction. This is not a peak limiter."
    }
  ],
  "s4000hardlimit": [
    {
      "name": "Vocal sample safety -2 dBFS",
      "values": {
        "input": 0,
        "ceiling": -2
      },
      "description": "Hard sample ceiling at -2 dBFS. Clipping becomes audible on sustained overload."
    },
    {
      "name": "Mix sample safety -1 dBFS",
      "values": {
        "input": 0,
        "ceiling": -1
      },
      "description": "Limits sample peaks; it does not measure intersample true peaks."
    },
    {
      "name": "Aggressive vocal clipping",
      "values": {
        "input": 6,
        "ceiling": -3
      },
      "description": "6 dB input boost drives the hard ceiling for deliberate distortion."
    },
    {
      "name": "Parallel crushed vocal",
      "values": {
        "input": 12,
        "ceiling": -6
      },
      "description": "Strong clipping for a parallel effects bus. Blend at the return fader."
    }
  ],
  "s4000tubecomp": [
    {
      "name": "Lead vocal - warm control",
      "values": {
        "threshold": -20,
        "ratio": 3,
        "knee": 9,
        "attack": 15,
        "release": 180,
        "drive": 4,
        "makeup": 2,
        "mix": 100
      },
      "description": "Soft-knee single-band compression with mild asymmetric saturation."
    },
    {
      "name": "Rap vocal - firm control",
      "values": {
        "threshold": -18,
        "ratio": 5,
        "knee": 6,
        "attack": 5,
        "release": 90,
        "drive": 6,
        "makeup": 3,
        "mix": 100
      },
      "description": "Faster attack and a firmer ratio for close vocals."
    },
    {
      "name": "Ballad vocal - open attack",
      "values": {
        "threshold": -22,
        "ratio": 2.5,
        "knee": 12,
        "attack": 30,
        "release": 300,
        "drive": 2,
        "makeup": 2,
        "mix": 100
      },
      "description": "Slower attack retains consonants and vocal articulation."
    },
    {
      "name": "Backing vocals - smooth",
      "values": {
        "threshold": -24,
        "ratio": 4,
        "knee": 12,
        "attack": 10,
        "release": 220,
        "drive": 3,
        "makeup": 1,
        "mix": 100
      },
      "description": "Broad compression for a vocal stack."
    },
    {
      "name": "Parallel vocal density",
      "values": {
        "threshold": -28,
        "ratio": 8,
        "knee": 6,
        "attack": 3,
        "release": 100,
        "drive": 9,
        "makeup": 5,
        "mix": 35
      },
      "description": "Blends a heavily compressed saturated signal under the dry vocal."
    },
    {
      "name": "Spoken voice - warm",
      "values": {
        "threshold": -20,
        "ratio": 3,
        "knee": 9,
        "attack": 8,
        "release": 200,
        "drive": 3,
        "makeup": 1,
        "mix": 100
      },
      "description": "Moderate linked compression and gentle harmonic colour."
    }
  ],
  "s4000vocaldynamics": [
    {
      "name": "Clean lead vocal",
      "values": {
        "threshold": -18,
        "ratio": 3,
        "attack": 10,
        "release": 160,
        "expandThreshold": -50,
        "expandRatio": 1.5,
        "range": 12,
        "makeup": 2,
        "ceiling": -2
      },
      "description": "Soft compression, gentle downward expansion, and a -2 dBFS sample ceiling."
    },
    {
      "name": "Rap vocal - tight pauses",
      "values": {
        "threshold": -20,
        "ratio": 5,
        "attack": 4,
        "release": 100,
        "expandThreshold": -44,
        "expandRatio": 2.5,
        "range": 24,
        "makeup": 3,
        "ceiling": -2
      },
      "description": "Firmer peaks and stronger attenuation between phrases. Tune the noise threshold."
    },
    {
      "name": "Podcast - relaxed pauses",
      "values": {
        "threshold": -22,
        "ratio": 3,
        "attack": 8,
        "release": 220,
        "expandThreshold": -54,
        "expandRatio": 1.4,
        "range": 10,
        "makeup": 2,
        "ceiling": -3
      },
      "description": "Gentle pause cleanup avoids a hard gate on conversational speech."
    },
    {
      "name": "Backing vocal cleanup",
      "values": {
        "threshold": -24,
        "ratio": 4,
        "attack": 12,
        "release": 180,
        "expandThreshold": -46,
        "expandRatio": 2,
        "range": 18,
        "makeup": 1,
        "ceiling": -3
      },
      "description": "Restrains a backing stack and attenuates its pauses."
    },
    {
      "name": "Compression only",
      "values": {
        "threshold": -18,
        "ratio": 3,
        "attack": 10,
        "release": 180,
        "expandRatio": 1,
        "range": 0,
        "makeup": 0,
        "ceiling": 0
      },
      "description": "Disables expansion; the 0 dBFS sample ceiling still catches overloads."
    }
  ],
  "s4000vocalenhancer": [
    {
      "name": "Lead vocal clarity",
      "values": {
        "highpass": 80,
        "presence": 2,
        "air": 2,
        "excite": 10,
        "output": -1
      },
      "description": "80 Hz rumble cut, broad presence and a restrained high shelf."
    },
    {
      "name": "Dark microphone - brighter vocal",
      "values": {
        "highpass": 75,
        "presence": 3,
        "air": 4,
        "excite": 18,
        "output": -2
      },
      "description": "Raises upper-mid detail and air. Use de-essing if sibilance increases."
    },
    {
      "name": "Bright microphone - softer vocal",
      "values": {
        "highpass": 85,
        "presence": -1.5,
        "air": -2,
        "excite": 0,
        "output": 0
      },
      "description": "Tames presence and air without adding harmonic excitation."
    },
    {
      "name": "Spoken word intelligibility",
      "values": {
        "highpass": 95,
        "presence": 2.5,
        "air": 0.5,
        "excite": 5,
        "output": -1
      },
      "description": "Removes low rumble and adds a broad 3.5 kHz speech lift."
    },
    {
      "name": "Airy backing vocals",
      "values": {
        "highpass": 130,
        "presence": 1,
        "air": 4.5,
        "excite": 12,
        "output": -2
      },
      "description": "Higher rumble cut and extra air for backing vocals."
    },
    {
      "name": "Natural vocal cleanup",
      "values": {
        "highpass": 70,
        "presence": 0,
        "air": 0,
        "excite": 0,
        "output": 0
      },
      "description": "Only the 70 Hz high-pass filter is active."
    }
  ],
  "s4000autofilter": [
    {
      "name": "Vocal envelope low-pass",
      "values": {
        "cutoff": 900,
        "range": 6500,
        "resonance": 0.7,
        "attack": 5,
        "release": 160,
        "mode": 0,
        "mix": 60
      },
      "description": "Opens the low-pass with vocal amplitude."
    },
    {
      "name": "Slow filtered ad-lib",
      "values": {
        "cutoff": 400,
        "range": 2500,
        "resonance": 1.2,
        "attack": 50,
        "release": 400,
        "mode": 0,
        "mix": 100
      },
      "description": "A slower envelope-following effect."
    },
    {
      "name": "High-pass movement",
      "values": {
        "cutoff": 100,
        "range": 700,
        "resonance": 0.7,
        "attack": 12,
        "release": 200,
        "mode": 1,
        "mix": 50
      },
      "description": "Amplitude moves the low cut for a special effect."
    }
  ],
  "s4000autopan": [
    {
      "name": "Backing vocal drift",
      "values": {
        "rate": 0.2,
        "depth": 30,
        "shape": 0
      },
      "description": "Gentle slow stereo movement."
    },
    {
      "name": "Ad-lib side to side",
      "values": {
        "rate": 1,
        "depth": 75,
        "shape": 0
      },
      "description": "One pan cycle per second."
    },
    {
      "name": "Hard alternating sides",
      "values": {
        "rate": 2,
        "depth": 100,
        "shape": 2
      },
      "description": "Square-wave panning for rhythmic effects."
    }
  ],
  "s4000channel": [
    {
      "name": "Vocal cleanup",
      "values": {
        "highpass": 85,
        "low": -1,
        "mid": 1.5,
        "high": 2,
        "width": 100
      },
      "description": "Rumble cut and restrained tonal shaping."
    },
    {
      "name": "Backing vocals - light",
      "values": {
        "highpass": 140,
        "low": -2,
        "mid": -1,
        "high": 2.5,
        "width": 120
      },
      "description": "Thinner backing stack; width affects stereo material."
    },
    {
      "name": "Warm spoken voice",
      "values": {
        "highpass": 75,
        "low": 1,
        "mid": 1,
        "high": -1,
        "width": 100
      },
      "description": "Gentle body lift and darker top."
    }
  ],
  "s4000channel2": [
    {
      "name": "Lead vocal strip",
      "values": {
        "gateThreshold": -52,
        "gateRelease": 180,
        "compThreshold": -20,
        "compRatio": 3,
        "compAttack": 10,
        "compRelease": 160,
        "low": -1,
        "mid": 1.5,
        "high": 2,
        "output": 2
      },
      "description": "Gate, compression and three-band tone. Adjust gate to the source."
    },
    {
      "name": "Tight rap strip",
      "values": {
        "gateThreshold": -45,
        "gateRelease": 100,
        "compThreshold": -18,
        "compRatio": 5,
        "compAttack": 4,
        "compRelease": 90,
        "low": -2,
        "mid": 2,
        "high": 1.5,
        "output": 2
      },
      "description": "Tighter gate and faster compression."
    },
    {
      "name": "Soft spoken voice strip",
      "values": {
        "gateThreshold": -60,
        "gateRelease": 250,
        "compThreshold": -24,
        "compRatio": 2,
        "compAttack": 15,
        "compRelease": 220,
        "low": 0,
        "mid": 1,
        "high": 1,
        "output": 1
      },
      "description": "Low gate threshold and gentle compression."
    }
  ],
  "s4000djeq": [
    {
      "name": "Voice low cut balance",
      "values": {
        "low": -8,
        "mid": 1,
        "high": 1,
        "lowFreq": 180,
        "highFreq": 3500
      },
      "description": "Attenuates the low shelf rather than a steep high-pass."
    },
    {
      "name": "Dark backing voice",
      "values": {
        "low": -3,
        "mid": 0,
        "high": -6,
        "lowFreq": 200,
        "highFreq": 4000
      },
      "description": "Tucks back a backing track."
    },
    {
      "name": "Air shelf lift",
      "values": {
        "low": 0,
        "mid": 0,
        "high": 3,
        "highFreq": 7000
      },
      "description": "Simple treble shelf lift."
    }
  ],
  "s4000dualfilter": [
    {
      "name": "Telephone voice",
      "values": {
        "aCutoff": 350,
        "aMode": 1,
        "aResonance": 0.7,
        "bCutoff": 3400,
        "bMode": 0,
        "bResonance": 0.7,
        "routing": 0,
        "mix": 100
      },
      "description": "Series high-pass and low-pass create a speech band."
    },
    {
      "name": "Vocal rumble and hiss cut",
      "values": {
        "aCutoff": 85,
        "aMode": 1,
        "bCutoff": 12000,
        "bMode": 0,
        "routing": 0,
        "mix": 100
      },
      "description": "Broad voice-band cleanup."
    },
    {
      "name": "Dark ad-lib filter",
      "values": {
        "aCutoff": 180,
        "aMode": 1,
        "bCutoff": 2400,
        "bMode": 0,
        "routing": 0,
        "mix": 100
      },
      "description": "Narrower dark band for ad-libs."
    }
  ],
  "s4000expander": [
    {
      "name": "Vocal room-noise reduction",
      "values": {
        "threshold": -48,
        "ratio": 1.5,
        "attack": 3,
        "release": 220,
        "range": 12
      },
      "description": "Gentle downward expansion; set threshold above room noise."
    },
    {
      "name": "Tight vocal pauses",
      "values": {
        "threshold": -42,
        "ratio": 3,
        "attack": 1,
        "release": 120,
        "range": 30
      },
      "description": "Stronger pause attenuation."
    },
    {
      "name": "Natural spoken pauses",
      "values": {
        "threshold": -54,
        "ratio": 1.3,
        "attack": 5,
        "release": 350,
        "range": 8
      },
      "description": "Subtle speech cleanup with slow release."
    }
  ],
  "s4000flanger": [
    {
      "name": "Soft vocal flange",
      "values": {
        "rate": 0.15,
        "depth": 25,
        "feedback": 15,
        "mix": 15
      },
      "description": "Slow and lightly blended."
    },
    {
      "name": "Swirling ad-lib",
      "values": {
        "rate": 0.6,
        "depth": 65,
        "feedback": 45,
        "mix": 40
      },
      "description": "Audible modulated comb filtering."
    },
    {
      "name": "Deep flange effect",
      "values": {
        "rate": 0.25,
        "depth": 90,
        "feedback": 65,
        "mix": 50
      },
      "description": "Resonant special effect."
    }
  ],
  "s4000monodelay": [
    {
      "name": "Vocal slap 95 ms",
      "values": {
        "time": 95,
        "feedback": 8,
        "tone": 5000,
        "mix": 15
      },
      "description": "Short, dark single-repeat space."
    },
    {
      "name": "Lead echo 320 ms",
      "values": {
        "time": 320,
        "feedback": 28,
        "tone": 4500,
        "mix": 20
      },
      "description": "Repeated dark vocal echoes; time is not tempo synced."
    },
    {
      "name": "Ad-lib throw 480 ms",
      "values": {
        "time": 480,
        "feedback": 45,
        "tone": 3500,
        "mix": 35
      },
      "description": "Longer feedback echo for an ad-lib or effects bus."
    }
  ],
  "s4000overdrive": [
    {
      "name": "Vocal edge - parallel",
      "values": {
        "drive": 8,
        "tone": 6000,
        "output": -4,
        "mix": 20
      },
      "description": "Light parallel soft clipping."
    },
    {
      "name": "Distorted ad-lib",
      "values": {
        "drive": 20,
        "tone": 3500,
        "output": -8,
        "mix": 70
      },
      "description": "Strong soft clipping with a dark tone filter."
    },
    {
      "name": "Lo-fi vocal crunch",
      "values": {
        "drive": 28,
        "tone": 1800,
        "output": -10,
        "mix": 100
      },
      "description": "Heavy distortion and filtered highs."
    }
  ],
  "s4000ringmod": [
    {
      "name": "Robot voice",
      "values": {
        "frequency": 80,
        "mix": 65
      },
      "description": "Ring modulation adds nonharmonic sidebands."
    },
    {
      "name": "Metallic voice",
      "values": {
        "frequency": 220,
        "mix": 40
      },
      "description": "Higher carrier for a metallic tone."
    },
    {
      "name": "Low tremor",
      "values": {
        "frequency": 12,
        "mix": 50
      },
      "description": "Low carrier creates rapid amplitude movement."
    }
  ],
  "s4000siggen": [
    {
      "name": "A4 tuning reference -24 dBFS",
      "values": {
        "wave": 0,
        "frequency": 440,
        "level": -24,
        "mix": 100
      },
      "description": "Sine tone at concert A. Replaces the input."
    },
    {
      "name": "1 kHz calibration -18 dBFS",
      "values": {
        "wave": 0,
        "frequency": 1000,
        "level": -18,
        "mix": 100
      },
      "description": "A steady calibration sine."
    },
    {
      "name": "Quiet white noise source",
      "values": {
        "wave": 3,
        "level": -36,
        "mix": 100
      },
      "description": "Low-level noise for routing checks. The generator noise is white, not pink."
    }
  ],
  "s4000tilteq": [
    {
      "name": "Vocal brightness",
      "values": {
        "tilt": 2,
        "pivot": 1200,
        "output": -1
      },
      "description": "Raises highs while lowering lows around 1.2 kHz."
    },
    {
      "name": "Vocal warmth",
      "values": {
        "tilt": -2,
        "pivot": 1000,
        "output": -1
      },
      "description": "The reverse tilt adds body and softens highs."
    },
    {
      "name": "Light backing stack",
      "values": {
        "tilt": 3,
        "pivot": 700,
        "output": -2
      },
      "description": "Thins the low end while lifting the top."
    }
  ],
  "s4000utility": [
    {
      "name": "Mono vocal check",
      "values": {
        "mono": 1,
        "width": 0
      },
      "description": "Sums left and right; use to check cancellation."
    },
    {
      "name": "Stereo vocal stack wider",
      "values": {
        "width": 140,
        "mono": 0,
        "gain": -1
      },
      "description": "Raises side content of stereo material; a mono input stays mono."
    },
    {
      "name": "Swap stereo sides",
      "values": {
        "swap": 1
      },
      "description": "Exchanges left and right channels."
    }
  ],
  "s4000resofilter": [
    {
      "name": "Vocal rumble cut",
      "values": {
        "cutoff": 85,
        "resonance": 0.707,
        "mode": 1,
        "drive": 0,
        "mix": 100
      },
      "description": "Resonant filter configured as a conventional high-pass."
    },
    {
      "name": "Telephone band focus",
      "values": {
        "cutoff": 1400,
        "resonance": 0.7,
        "mode": 2,
        "drive": 0,
        "mix": 100
      },
      "description": "A band-pass vocal special effect."
    },
    {
      "name": "Dark voice low-pass",
      "values": {
        "cutoff": 3000,
        "resonance": 0.707,
        "mode": 0,
        "drive": 0,
        "mix": 100
      },
      "description": "A simple dark low-pass effect."
    }
  ],
  "s4000fm": [
    {
      "name": "Soft FM keys",
      "values": {
        "ratio": 2,
        "index": 1,
        "feedback": 5,
        "attack": 0.02,
        "decay": 1,
        "release": 0.5,
        "level": -10
      },
      "description": "Moderate FM index and smooth release."
    },
    {
      "name": "FM bell",
      "values": {
        "ratio": 3.5,
        "index": 3,
        "feedback": 10,
        "attack": 0.001,
        "decay": 2,
        "release": 1.5,
        "level": -12
      },
      "description": "Inharmonic ratio and a longer bell decay."
    }
  ],
  "s4000poly": [
    {
      "name": "Warm pad",
      "values": {
        "cutoff": 1100,
        "resonance": 0.7,
        "env": 25,
        "detune": 12,
        "mix": 50,
        "attack": 0.6,
        "decay": 0.8,
        "sustain": 75,
        "release": 1.8,
        "level": -12
      },
      "description": "Slow attack, detuned oscillators and a soft filter."
    },
    {
      "name": "Analog pluck",
      "values": {
        "cutoff": 500,
        "resonance": 1.2,
        "env": 75,
        "detune": 5,
        "mix": 40,
        "attack": 0.002,
        "decay": 0.25,
        "sustain": 15,
        "release": 0.2,
        "level": -10
      },
      "description": "Short filter envelope and fast amplitude decay."
    }
  ]
};
