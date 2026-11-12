#include "VocalFx.h"

namespace s3
{
namespace
{
float gain (float db) { return std::pow (10.0f, db * .05f); }
float db (float x) { return juce::Decibels::gainToDecibels (x, -120.0f); }
float coefficient (double sr, float ms) { return 1.0f - (float) std::exp (-1.0 / (sr * .001 * juce::jmax (.01f, ms))); }

class VocalLeveler : public StudioFxPlugin
{
public:
    explicit VocalLeveler (te::PluginCreationInfo info) : StudioFxPlugin (info, {
        { "target", "Target RMS", -36, -6, -18, "dBFS" },
        { "range", "Maximum gain change", 0, 18, 9, "dB" },
        { "floor", "Noise floor", -80, -24, -50, "dBFS" },
        { "attack", "Gain reduction speed", 20, 1000, 150, "ms" },
        { "release", "Gain recovery speed", 100, 4000, 800, "ms" },
        { "output", "Output", -18, 12, 0, "dB" } }) {}
    S4_FX_IDENTITY (VocalLeveler, "s4000leveler", "Vocal Leveler", "Level")
private:
    float square = 0, change = 0;
    void clear() override { square = change = 0; }
    void process (float* l, float* r, int n) override
    {
        const float rms = coefficient (sampleRate, 50), atk = coefficient (sampleRate, value (3)), rel = coefficient (sampleRate, value (4));
        for (int i = 0; i < n; ++i)
        {
            square += (.5f * (l[i] * l[i] + r[i] * r[i]) - square) * rms;
            const float level = db (std::sqrt (juce::jmax (0.0f, square)));
            const float target = level > value (2) ? juce::jlimit (-value (1), value (1), value (0) - level) : 0;
            change += (target - change) * (target < change ? atk : rel);
            const float g = gain (change + value (5));
            l[i] *= g; r[i] *= g;
        }
    }
};

// Zero-latency sample-peak hard limiting. This deliberately makes no true-peak claim.
class HardLimiter : public StudioFxPlugin
{
public:
    explicit HardLimiter (te::PluginCreationInfo info) : StudioFxPlugin (info, {
        { "input", "Input gain", -18, 24, 0, "dB" },
        { "ceiling", "Sample ceiling", -24, 0, -1, "dBFS" } }) {}
    S4_FX_IDENTITY (HardLimiter, "s4000hardlimit", "Hard Limiter", "Hard")
private:
    void process (float* l, float* r, int n) override
    {
        const float g = gain (value (0)), ceiling = gain (value (1));
        for (int i = 0; i < n; ++i)
        {
            l[i] = juce::jlimit (-ceiling, ceiling, l[i] * g);
            r[i] = juce::jlimit (-ceiling, ceiling, r[i] * g);
        }
    }
};

// A single-band linked compressor followed by asymmetric tube-style saturation.
// It is a distinct DSP design, rather than a claim to model a particular device.
class TubeCompressor : public StudioFxPlugin
{
public:
    explicit TubeCompressor (te::PluginCreationInfo info) : StudioFxPlugin (info, {
        { "threshold", "Threshold", -48, 0, -18, "dB" },
        { "ratio", "Ratio", 1, 12, 3, ":1" },
        { "knee", "Knee", 0, 24, 9, "dB" },
        { "attack", "Attack", .1f, 100, 12, "ms" },
        { "release", "Release", 10, 2000, 180, "ms" },
        { "drive", "Tube drive", 0, 18, 3, "dB" },
        { "makeup", "Make-up", -18, 18, 0, "dB" },
        { "mix", "Mix", 0, 100, 100, "%" } }) {}
    S4_FX_IDENTITY (TubeCompressor, "s4000tubecomp", "Tube-style Compressor", "Tube")
private:
    float square = 0, reduction = 0;
    Biquad dc[2];
    void clear() override { square = reduction = 0; for (auto& f : dc) f.reset(); }
    void prepare() override { for (auto& f : dc) f.highPass (sampleRate, 15); }
    void process (float* l, float* r, int n) override
    {
        const float detector = coefficient (sampleRate, 8), atk = coefficient (sampleRate, value (3)), rel = coefficient (sampleRate, value (4));
        const float drive = gain (value (5)), makeup = gain (value (6)), wet = value (7) * .01f;
        const float bias = .12f, offset = std::tanh (bias);
        const float normal = drive * (1 - offset * offset);
        for (int i = 0; i < n; ++i)
        {
            const float key = juce::jmax (std::abs (l[i]), std::abs (r[i]));
            square += (key * key - square) * detector;
            const float target = CompressorFx::staticGainDb (db (std::sqrt (juce::jmax (0.0f, square))), value (0), value (1), value (2));
            reduction += (target - reduction) * (target < reduction ? atk : rel);
            const float g = gain (reduction);
            float* channels[] { l, r };
            for (int c = 0; c < 2; ++c)
            {
                const float dry = channels[c][i];
                const float shaped = (std::tanh (dry * g * drive + bias) - offset) / normal;
                const float out = dc[c].process (shaped) * makeup;
                channels[c][i] = dry + (out - dry) * wet;
            }
        }
    }
};

class VocalDynamics : public StudioFxPlugin
{
public:
    explicit VocalDynamics (te::PluginCreationInfo info) : StudioFxPlugin (info, {
        { "threshold", "Compressor threshold", -48, 0, -18, "dB" },
        { "ratio", "Compressor ratio", 1, 16, 3, ":1" },
        { "attack", "Attack", .1f, 100, 8, "ms" },
        { "release", "Release", 10, 2000, 150, "ms" },
        { "expandThreshold", "Expander threshold", -80, -18, -50, "dB" },
        { "expandRatio", "Expander ratio", 1, 8, 2, ":1" },
        { "range", "Expander range", 0, 60, 18, "dB" },
        { "makeup", "Make-up", -18, 18, 0, "dB" },
        { "ceiling", "Sample ceiling", -24, 0, -1, "dBFS" } }) {}
    S4_FX_IDENTITY (VocalDynamics, "s4000vocaldynamics", "Vocal Dynamics", "V.Dyn")
private:
    float envelope = 0, reduction = 0;
    void clear() override { envelope = reduction = 0; }
    void process (float* l, float* r, int n) override
    {
        const float atk = coefficient (sampleRate, value (2)), rel = coefficient (sampleRate, value (3));
        const float ceiling = gain (value (8));
        for (int i = 0; i < n; ++i)
        {
            const float key = juce::jmax (std::abs (l[i]), std::abs (r[i]));
            envelope += (key - envelope) * (key > envelope ? atk : rel);
            const float level = db (envelope);
            const float compress = CompressorFx::staticGainDb (level, value (0), value (1), 6);
            const float expand = level < value (4) ? juce::jmax (-value (6), (level - value (4)) * (value (5) - 1)) : 0;
            const float target = compress + expand;
            reduction += (target - reduction) * (target < reduction ? atk : rel);
            const float g = gain (reduction + value (7));
            l[i] = juce::jlimit (-ceiling, ceiling, l[i] * g);
            r[i] = juce::jlimit (-ceiling, ceiling, r[i] * g);
        }
    }
};

class VocalEnhancer : public StudioFxPlugin
{
public:
    explicit VocalEnhancer (te::PluginCreationInfo info) : StudioFxPlugin (info, {
        { "highpass", "Rumble cut", 20, 250, 75, "Hz" },
        { "presence", "Presence at 3.5 kHz", -6, 9, 2, "dB" },
        { "air", "Air above 10 kHz", -6, 9, 1.5f, "dB" },
        { "excite", "Harmonic excitation", 0, 100, 12, "%" },
        { "output", "Output", -18, 12, -1, "dB" } }) {}
    S4_FX_IDENTITY (VocalEnhancer, "s4000vocalenhancer", "Vocal Enhancer", "V.Enh")
private:
    Biquad cut[2], presence[2], air[2], high[2], harmonic[2];
    void clear() override
    {
        for (int c = 0; c < 2; ++c) { cut[c].reset(); presence[c].reset(); air[c].reset(); high[c].reset(); harmonic[c].reset(); }
    }
    void process (float* l, float* r, int n) override
    {
        for (int c = 0; c < 2; ++c)
        {
            cut[c].highPass (sampleRate, value (0));
            presence[c].design (Biquad::bell, sampleRate, 3500, value (1), .8);
            air[c].design (Biquad::highShelf, sampleRate, juce::jmin (10000.0, sampleRate * .4), value (2), .707);
            high[c].highPass (sampleRate, 2500);
            harmonic[c].highPass (sampleRate, 3500);
        }
        const float excite = value (3) * .0025f, out = gain (value (4));
        float* channels[] { l, r };
        for (int i = 0; i < n; ++i) for (int c = 0; c < 2; ++c)
        {
            const float clean = cut[c].process (channels[c][i]);
            const float band = high[c].process (clean);
            const float added = harmonic[c].process (std::tanh (band * 4) - band * 4);
            channels[c][i] = air[c].process (presence[c].process (clean + added * excite)) * out;
        }
    }
};
}

void registerVocalEffects (te::PluginManager& pm)
{
    pm.createBuiltInType<VocalLeveler>(); pm.createBuiltInType<HardLimiter>();
    pm.createBuiltInType<TubeCompressor>(); pm.createBuiltInType<VocalDynamics>(); pm.createBuiltInType<VocalEnhancer>();
}
std::vector<std::array<const char*, 3>> vocalEffectCatalogue()
{
    return {
        { VocalLeveler::xmlTypeName, VocalLeveler::getPluginName(), "Vocals" },
        { HardLimiter::xmlTypeName, HardLimiter::getPluginName(), "Dynamics" },
        { TubeCompressor::xmlTypeName, TubeCompressor::getPluginName(), "Vocals" },
        { VocalDynamics::xmlTypeName, VocalDynamics::getPluginName(), "Vocals" },
        { VocalEnhancer::xmlTypeName, VocalEnhancer::getPluginName(), "Vocals" }
    };
}
}
