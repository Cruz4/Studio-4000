#include "Instruments.h"

namespace s3
{
namespace
{
    constexpr double sr = 48000.0;
    constexpr double twoPi = juce::MathConstants<double>::twoPi;
    const juce::Identifier displayNameId ("s4Name");

    juce::File instrumentsDir()     { return appDataDir().getChildFile ("Instruments"); }

    void writeWav (const juce::File& file, std::vector<float> samples)
    {
        float peak = 0.0f;

        for (auto s : samples)
            peak = juce::jmax (peak, std::abs (s));

        if (peak > 0.0f)
            for (auto& s : samples)
                s *= 0.89f / peak;

        juce::AudioBuffer<float> buffer (1, (int) samples.size());
        buffer.copyFrom (0, 0, samples.data(), (int) samples.size());

        file.getParentDirectory().createDirectory();
        file.deleteFile();
        juce::WavAudioFormat wav;
        std::unique_ptr<juce::OutputStream> out (file.createOutputStream().release());

        if (auto writer = wav.createWriterFor (out, juce::AudioFormatWriterOptions{}.withSampleRate (sr).withNumChannels (1).withBitsPerSample (24)))
            writer->writeFromAudioSampleBuffer (buffer, 0, buffer.getNumSamples());
    }

    struct Noise
    {
        juce::Random random { 3030 };
        float next() { return random.nextFloat() * 2.0f - 1.0f; }
    };

    /** Six detuned square waves: the classic analogue cymbal source. */
    float metallic (double t, double scale)
    {
        static const double freqs[] { 205.3, 304.4, 369.6, 522.7, 540.0, 800.0 };
        float v = 0.0f;

        for (auto f : freqs)
            v += std::sin (twoPi * f * scale * t) >= 0.0 ? 1.0f : -1.0f;

        return v / 6.0f;
    }

    struct OnePoleHP
    {
        float a, x1 = 0.0f, y1 = 0.0f;
        explicit OnePoleHP (double hz) : a ((float) std::exp (-twoPi * hz / sr)) {}
        float process (float x) { const float y = a * (y1 + x - x1); x1 = x; y1 = y; return y; }
    };

    std::vector<float> render (double seconds, std::function<float (double t)> fn)
    {
        std::vector<float> s ((size_t) (seconds * sr));

        for (size_t i = 0; i < s.size(); ++i)
            s[i] = fn ((double) i / sr);

        // 3 ms fade-out so the sample never ends on a click
        const size_t fade = (size_t) (0.003 * sr);

        for (size_t i = 0; i < fade && i < s.size(); ++i)
            s[s.size() - 1 - i] *= (float) i / (float) fade;

        return s;
    }

    //==============================================================================
    struct DrumSound { int note; const char* name; std::function<std::vector<float>()> make; };

    std::vector<DrumSound> drumSounds()
    {
        return {
            { 36, "Kick", []
            {
                double phase = 0.0;
                Noise n;
                return render (0.7, [&] (double t)
                {
                    phase += twoPi * (45.0 + 110.0 * std::exp (-t * 28.0)) / sr;
                    const float body = (float) (std::sin (phase) * std::exp (-t * 6.5));
                    return std::tanh (1.6f * (body + n.next() * 0.25f * (float) std::exp (-t * 300.0)));
                });
            } },
            { 37, "Rim", []
            {
                Noise n; OnePoleHP hp (2000.0);
                return render (0.08, [&] (double t)
                {
                    return (float) (std::sin (twoPi * 1700.0 * t) * std::exp (-t * 90.0)) + hp.process (n.next()) * 0.4f * (float) std::exp (-t * 120.0);
                });
            } },
            { 38, "Snare", []
            {
                Noise n; OnePoleHP hp (900.0);
                return render (0.35, [&] (double t)
                {
                    const double tone = std::sin (twoPi * 185.0 * t) * std::exp (-t * 20.0) * 0.5 + std::sin (twoPi * 330.0 * t) * std::exp (-t * 25.0) * 0.25;
                    return (float) tone + hp.process (n.next()) * 0.8f * (float) std::exp (-t * 14.0);
                });
            } },
            { 39, "Clap", []
            {
                Noise n; OnePoleHP hp (800.0);
                float lp = 0.0f;
                return render (0.4, [&] (double t)
                {
                    double env = 0.0;

                    for (double at : { 0.0, 0.011, 0.022 })
                        if (t >= at)
                            env += std::exp (-(t - at) * 180.0);

                    if (t > 0.03)
                        env += 0.6 * std::exp (-(t - 0.03) * 16.0);

                    lp += 0.35f * (hp.process (n.next()) - lp);
                    return lp * (float) env;
                });
            } },
            { 41, "Low Tom", [] { return render (0.6, [] (double t) { return (float) (std::sin (twoPi * 90.0 * (1.0 + 0.5 * std::exp (-t * 20.0)) * t) * std::exp (-t * 7.0)); }); } },
            { 42, "Closed Hat", []
            {
                Noise n; OnePoleHP hp (7000.0);
                return render (0.15, [&] (double t) { return hp.process (metallic (t, 2.0) * 0.7f + n.next() * 0.3f) * (float) std::exp (-t * 55.0); });
            } },
            { 45, "Mid Tom", [] { return render (0.55, [] (double t) { return (float) (std::sin (twoPi * 130.0 * (1.0 + 0.5 * std::exp (-t * 20.0)) * t) * std::exp (-t * 7.5)); }); } },
            { 46, "Open Hat", []
            {
                Noise n; OnePoleHP hp (6500.0);
                return render (0.8, [&] (double t) { return hp.process (metallic (t, 2.0) * 0.7f + n.next() * 0.3f) * (float) std::exp (-t * 7.0); });
            } },
            { 48, "High Tom", [] { return render (0.5, [] (double t) { return (float) (std::sin (twoPi * 180.0 * (1.0 + 0.5 * std::exp (-t * 20.0)) * t) * std::exp (-t * 8.0)); }); } },
            { 49, "Crash", []
            {
                Noise n; OnePoleHP hp (5000.0);
                return render (2.2, [&] (double t) { return hp.process (metallic (t, 3.1) * 0.5f + n.next() * 0.5f) * (float) std::exp (-t * 2.2); });
            } },
            { 51, "Ride", []
            {
                OnePoleHP hp (6000.0);
                return render (1.8, [&] (double t)
                {
                    return hp.process (metallic (t, 4.3)) * 0.6f * (float) std::exp (-t * 3.0) + (float) (std::sin (twoPi * 3000.0 * t) * std::exp (-t * 4.0) * 0.12);
                });
            } },
            { 56, "Cowbell", []
            {
                float lp = 0.0f;
                return render (0.4, [&] (double t)
                {
                    const float v = (std::sin (twoPi * 562.0 * t) >= 0.0 ? 0.5f : -0.5f) + (std::sin (twoPi * 845.0 * t) >= 0.0 ? 0.5f : -0.5f);
                    lp += 0.25f * (v - lp);
                    return lp * (float) std::exp (-t * 9.0);
                });
            } },
        };
    }

    //==============================================================================
    double noteHz (int note)        { return 440.0 * std::pow (2.0, (note - 69) / 12.0); }

    std::vector<float> pianoNote (int note)
    {
        const double f = noteHz (note);
        const double length = juce::jlimit (1.2, 4.0, 4.0 - (note - 24) * 0.035);
        const double decayScale = 1.0 + juce::jmax (0, note - 48) / 30.0;
        const double inharmonicity = 0.0002 * std::pow (note / 60.0, 2.0);
        Noise n;
        float thump = 0.0f;

        return render (length, [&] (double t)
        {
            double v = 0.0;

            for (int k = 1; k <= 16 && k * f < 12000.0; ++k)
            {
                const double fk = k * f * std::sqrt (1.0 + inharmonicity * k * k);
                const double amp = std::pow (k, -1.15) * std::exp (-t * (0.5 + 0.35 * k) * decayScale);
                v += amp * (std::sin (twoPi * fk * t) + std::sin (twoPi * fk * 1.0005 * t + 0.3 * k)) * 0.5;
            }

            thump += 0.2f * (n.next() - thump);
            const double attack = juce::jmin (1.0, t / 0.003);
            return (float) (v * attack) + thump * 0.08f * (float) std::exp (-t * 80.0);
        });
    }

    std::vector<float> malletNote (int note)
    {
        const double f = noteHz (note);
        const double scale = 1.0 + juce::jmax (0, note - 60) / 24.0;

        return render (1.6, [&] (double t)
        {
            const double v = std::sin (twoPi * f * t) * std::exp (-t * 3.5 * scale)
                           + 0.35 * std::sin (twoPi * f * 3.9 * t) * std::exp (-t * 9.0 * scale)
                           + 0.1 * std::sin (twoPi * f * 9.2 * t) * std::exp (-t * 20.0 * scale);
            return (float) (v * juce::jmin (1.0, t / 0.001));
        });
    }

    std::vector<float> bass808()
    {
        double phase = 0.0;

        return render (2.5, [&] (double t)
        {
            phase += twoPi * noteHz (36) * (1.0 + 0.3 * std::exp (-t * 30.0)) / sr;
            return std::tanh (1.8f * (float) (std::sin (phase) * std::exp (-t * 1.2)));
        });
    }

    struct KitSample { String file; int key, low, high; bool openEnded; };

    std::vector<KitSample> kitLayout (const String& kit)
    {
        std::vector<KitSample> list;

        if (kit == "drums")
        {
            for (auto& d : drumSounds())
                list.push_back ({ String (d.name).replaceCharacter (' ', '_') + ".wav", d.note, d.note, d.note, true });
        }
        else if (kit == "piano")
        {
            for (int note = 24; note <= 96; note += 6)
                list.push_back ({ "piano_" + String (note) + ".wav", note, note == 24 ? 0 : note - 3, note == 96 ? 127 : note + 2, false });
        }
        else if (kit == "mallets")
        {
            for (int note = 36; note <= 96; note += 12)
                list.push_back ({ "mallet_" + String (note) + ".wav", note, note == 36 ? 0 : note - 6, note == 96 ? 127 : note + 5, true });
        }
        else if (kit == "808")
        {
            list.push_back ({ "808.wav", 36, 0, 127, false });
        }

        return list;
    }

    void writeKit (const String& kit)
    {
        auto dir = instrumentsDir().getChildFile (kit);

        if (kit == "drums")
        {
            for (auto& d : drumSounds())
            {
                auto f = dir.getChildFile (String (d.name).replaceCharacter (' ', '_') + ".wav");
                if (! f.existsAsFile())
                    writeWav (f, d.make());
            }
            return;
        }

        for (auto& s : kitLayout (kit))
        {
            auto f = dir.getChildFile (s.file);

            if (f.existsAsFile())
                continue;

            if (kit == "piano")         writeWav (f, pianoNote (s.key));
            else if (kit == "mallets")  writeWav (f, malletNote (s.key));
            else if (kit == "808")      writeWav (f, bass808());
        }
    }

    //==============================================================================
    struct Osc { int wave = 0; float tune = 0, fine = 0, level = 0, pw = 0.5f; int voices = 1; float detune = 0, spread = 0; };

    struct SynthPreset
    {
        std::vector<Osc> oscs;
        float attack = 0.005f, decay = 0.3f, sustain = 80, release = 0.2f;
        int filterType = 0;
        float cutoff = 100, resonance = 10, envAmount = 0, fAttack = 0.0f, fDecay = 0.3f, fSustain = 50, fRelease = 0.3f;
        int voiceMode = 2;
        float glide = 0, level = -6;
        float chorus = 0, reverb = 0, reverbSize = 0.5f, delay = 0, distortion = 0;
    };

    enum { none, sine, triangle, sawUp, sawDown, square };

    const std::map<String, SynthPreset>& synthPresets()
    {
        static const std::map<String, SynthPreset> presets {
            { "synth-bass", { { { sawUp }, { square, -12, 0, -6 } }, 0.003f, 0.3f, 80, 0.08f, 1, 50, 25, 0.5f, 0, 0.25f, 10, 0.1f, 0, 30, -6 } },
            { "sub-bass", { { { sine }, { triangle, -12, 0, -12 } }, 0.005f, 0.2f, 100, 0.1f, 0, 100, 0, 0, 0, 0.3f, 50, 0.3f, 0, 20, -4 } },
            { "warm-pad", { { { sawUp, 0, 0, 0, 0.5f, 4, 0.15f, 60 }, { sawDown, 12, 0, -10, 0.5f, 3, 0.1f, 40 } }, 0.8f, 1.0f, 85, 1.8f,
                            1, 80, 10, 0.2f, 1.2f, 1.0f, 60, 1.5f, 2, 0, -10, 0.3f, 0.3f, 0.7f } },
            { "bright-lead", { { { square, 0, 0, 0, 0.3f }, { sawUp, 0, 8, -4 } }, 0.005f, 0.3f, 90, 0.2f, 1, 100, 30, 0.3f, 0, 0.4f, 50, 0.3f,
                               1, 40, -8, 0, 0, 0.5f, 0.2f } },
            { "e-piano", { { { sine }, { sine, 12, 0, -14 }, { triangle, 0, 0, -10 } }, 0.002f, 1.4f, 20, 0.4f, 1, 100, 5, 0.2f, 0, 0.6f, 30, 0.4f,
                           2, 0, -8, 0.25f, 0.15f, 0.5f } },
            { "pluck", { { { sawUp }, { square, 0, -6, -6 } }, 0.001f, 0.35f, 0, 0.25f, 1, 60, 25, 0.7f, 0, 0.18f, 0, 0.2f, 2, 0, -8, 0, 0.2f, 0.5f, 0.15f } },
            { "strings", { { { sawUp, 0, 0, 0, 0.5f, 5, 0.2f, 80 }, { sawUp, 12, 0, -12, 0.5f, 3, 0.15f, 60 } }, 0.35f, 0.5f, 90, 0.9f,
                           1, 90, 5, 0, 0, 0.3f, 100, 0.5f, 2, 0, -10, 0.35f, 0.35f, 0.8f } },
            { "brass", { { { sawUp, 0, 0, 0, 0.5f, 2, 0.08f, 30 }, { sawUp, 0, 6, -2 } }, 0.04f, 0.2f, 85, 0.25f, 1, 65, 15, 0.6f, 0.06f, 0.4f, 50, 0.3f,
                         2, 0, -9, 0, 0.15f, 0.6f } },
            { "organ", { { { sine }, { sine, 12, 0, -6 }, { sine, 19, 0, -10 }, { sine, 24, 0, -12 } }, 0.005f, 0.1f, 100, 0.05f, 0, 100, 0, 0, 0, 0.3f, 50, 0.3f,
                         2, 0, -10, 0.3f, 0.1f, 0.5f } },
            { "chip-lead", { { { square } }, 0.001f, 0.1f, 100, 0.05f, 0, 100, 0, 0, 0, 0.3f, 50, 0.3f, 0, 15, -10, 0, 0, 0.5f, 0.15f } },
        };

        return presets;
    }

    void applySynthPreset (te::FourOscPlugin& p, const SynthPreset& s)
    {
        for (int i = 0; i < p.oscParams.size(); ++i)
        {
            auto& o = *p.oscParams[i];
            const Osc def = i < (int) s.oscs.size() ? s.oscs[(size_t) i] : Osc {};
            o.waveShapeValue = def.wave;
            o.tuneValue = def.tune;
            o.fineTuneValue = def.fine;
            o.levelValue = def.level;
            o.pulseWidthValue = def.pw;
            o.voicesValue = def.voices;
            o.detuneValue = def.detune;
            o.spreadValue = def.spread;
        }

        p.ampAttackValue = s.attack;
        p.ampDecayValue = s.decay;
        p.ampSustainValue = s.sustain;
        p.ampReleaseValue = s.release;
        p.filterTypeValue = s.filterType;
        p.filterFreqValue = s.cutoff;
        p.filterResonanceValue = s.resonance;
        p.filterAmountValue = s.envAmount;
        p.filterAttackValue = s.fAttack;
        p.filterDecayValue = s.fDecay;
        p.filterSustainValue = s.fSustain;
        p.filterReleaseValue = s.fRelease;
        p.voiceModeValue = s.voiceMode;
        p.legatoValue = s.glide;
        p.masterLevelValue = s.level;
        p.chorusOnValue = s.chorus > 0.0f;
        p.chorusMixValue = s.chorus;
        p.reverbOnValue = s.reverb > 0.0f;
        p.reverbMixValue = s.reverb;
        p.reverbSizeValue = s.reverbSize;
        p.reverbWidthValue = 1.0f;
        p.delayOnValue = s.delay > 0.0f;
        p.delayMixValue = s.delay;
        p.distortionOnValue = s.distortion > 0.0f;
        p.distortionValue = s.distortion;
    }
}

const std::vector<InstrumentEntry>& instrumentCatalogue()
{
    static const std::vector<InstrumentEntry> list {
        { "kit:drums",          "Drum Kit",         "Drums & Percussion" },
        { "kit:808",            "808 Bass",         "Bass" },
        { "4osc:synth-bass",    "Synth Bass",       "Bass" },
        { "4osc:sub-bass",      "Sub Bass",         "Bass" },
        { "kit:piano",          "Studio Piano",     "Keys" },
        { "4osc:e-piano",       "Electric Piano",   "Keys" },
        { "4osc:organ",         "Organ",            "Keys" },
        { "kit:mallets",        "Mallets",          "Keys" },
        { "4osc:warm-pad",      "Warm Pad",         "Pads & Strings" },
        { "4osc:strings",       "Synth Strings",    "Pads & Strings" },
        { "4osc:brass",         "Synth Brass",      "Pads & Strings" },
        { "4osc:bright-lead",   "Bright Lead",      "Leads & Plucks" },
        { "4osc:pluck",         "Pluck",            "Leads & Plucks" },
        { "4osc:chip-lead",     "Chip Lead",        "Leads & Plucks" },
    };

    return list;
}

void ensureInstrumentSamples()
{
    for (auto kit : { "drums", "piano", "mallets", "808" })
        writeKit (kit);
}

te::Plugin::Ptr createInstrument (te::Edit& edit, const String& id)
{
    const InstrumentEntry* entry = nullptr;

    for (auto& e : instrumentCatalogue())
        if (e.id == id)
            entry = &e;

    if (entry == nullptr)
        return {};

    if (id.startsWith ("4osc:"))
    {
        auto plugin = edit.getPluginCache().createNewPlugin (te::FourOscPlugin::xmlTypeName, {});

        if (auto* fo = dynamic_cast<te::FourOscPlugin*> (plugin.get()))
        {
            auto it = synthPresets().find (id.fromFirstOccurrenceOf (":", false, false));

            if (it != synthPresets().end())
                applySynthPreset (*fo, it->second);
        }

        if (plugin != nullptr)
            plugin->state.setProperty (displayNameId, entry->name, nullptr);

        return plugin;
    }

    const auto kit = id.fromFirstOccurrenceOf (":", false, false);
    writeKit (kit);
    auto plugin = edit.getPluginCache().createNewPlugin (te::SamplerPlugin::xmlTypeName, {});

    if (auto* sampler = dynamic_cast<te::SamplerPlugin*> (plugin.get()))
    {
        auto dir = instrumentsDir().getChildFile (kit);

        for (auto& s : kitLayout (kit))
        {
            auto file = dir.getChildFile (s.file);
            const auto error = sampler->addSound (file.getFullPathName(), s.file.upToLastOccurrenceOf (".", false, false).replaceCharacter ('_', ' '),
                                                  0.0, 0.0, 0.0f);

            if (error.isNotEmpty())
                continue;

            const int index = sampler->getNumSounds() - 1;
            sampler->setSoundParams (index, s.key, s.low, s.high);
            sampler->setSoundOpenEnded (index, s.openEnded);
        }

        plugin->state.setProperty (displayNameId, entry->name, nullptr);
    }

    return plugin;
}

String displayNameFor (te::Plugin& p)
{
    return p.state.getProperty (displayNameId, p.getName()).toString();
}
}
