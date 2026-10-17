#include "SuiteFx.h"

namespace s3
{
namespace
{
    constexpr float pi = juce::MathConstants<float>::pi;
    const juce::StringArray offOn { "Off", "On" };
    const juce::StringArray filterModes { "Low-pass", "High-pass", "Band-pass" };
    const juce::StringArray lfoShapes { "Sine", "Triangle", "Square" };

    inline float dbToGain (float db) { return std::pow (10.0f, db * 0.05f); }
    inline float coef (double sampleRate, double ms)
    {
        return ms <= 0.0 ? 1.0f : 1.0f - (float) std::exp (-1.0 / (ms * 0.001 * sampleRate));
    }

    inline float lfoAt (float phase, int shape)
    {
        if (shape == 1)
            return 1.0f - std::abs (2.0f * phase - 1.0f);

        if (shape == 2)
            return phase < 0.5f ? 1.0f : 0.0f;

        return 0.5f + 0.5f * std::sin (2.0f * pi * phase);
    }

    /** Topology-preserving state-variable filter. mode: 0 low-pass, 1 high-pass, 2 band-pass. */
    struct Svf
    {
        float g = 0.0f, k = 1.0f, a1 = 1.0f, a2 = 0.0f, a3 = 0.0f, ic1 = 0.0f, ic2 = 0.0f;

        void set (double sampleRate, double hz, double q)
        {
            g = (float) std::tan (juce::MathConstants<double>::pi * juce::jlimit (15.0, sampleRate * 0.45, hz) / sampleRate);
            k = 1.0f / (float) juce::jmax (0.15, q);
            a1 = 1.0f / (1.0f + g * (g + k));
            a2 = g * a1;
            a3 = g * a2;
        }

        float process (float v0, int mode)
        {
            const float v3 = v0 - ic2;
            const float v1 = a1 * ic1 + a2 * v3;
            const float v2 = ic2 + a2 * ic1 + a3 * v3;
            ic1 = 2.0f * v1 - ic1;
            ic2 = 2.0f * v2 - ic2;
            const float hp = v0 - k * v1 - v2;
            return mode == 1 ? hp : mode == 2 ? v1 : v2;
        }

        void reset() { ic1 = ic2 = 0.0f; }
    };

    struct Delay
    {
        std::vector<float> buf;
        int write = 0;

        void resize (int n)
        {
            buf.assign ((size_t) juce::jmax (8, n), 0.0f);
            write = 0;
        }

        void clear()
        {
            std::fill (buf.begin(), buf.end(), 0.0f);
            write = 0;
        }

        void push (float x)
        {
            if (buf.empty())
                return;

            buf[(size_t) write] = x;
            write = (write + 1) % (int) buf.size();
        }

        float read (float delaySamples) const
        {
            const int size = (int) buf.size();

            if (size == 0)
                return 0.0f;

            float pos = (float) write - juce::jlimit (1.0f, (float) (size - 2), delaySamples);

            while (pos < 0.0f)
                pos += (float) size;

            const int i0 = (int) pos % size;
            const int i1 = (i0 + 1) % size;
            const float f = pos - std::floor (pos);
            return buf[(size_t) i0] * (1.0f - f) + buf[(size_t) i1] * f;
        }
    };

    inline void designShelf (Biquad& b, int type, double sampleRate, double freq, double gainDb)
    {
        const auto s1 = b.s1, s2 = b.s2;
        b.design (type, sampleRate, freq, gainDb, 0.707);
        b.s1 = s1;
        b.s2 = s2;
    }
}

//==============================================================================
class AutoFilterPlugin : public StudioFxPlugin
{
public:
    explicit AutoFilterPlugin (te::PluginCreationInfo info)
        : StudioFxPlugin (info, {
              { "cutoff", "Cutoff", 40, 12000, 500, "Hz", 800 },
              { "range", "Range", 0, 8000, 3500, "Hz", 1500 },
              { "resonance", "Resonance", 0.3f, 8, 0.8f, "", 1 },
              { "attack", "Attack", 0.1f, 200, 8, "ms", 10 },
              { "release", "Release", 5, 800, 180, "ms", 80 },
              { "mode", "Mode", 0, 2, 0, "", 0, filterModes },
              { "mix", "Mix", 0, 100, 100, "%" } }) {}

    S4_FX_IDENTITY (AutoFilterPlugin, "s4000autofilter", "Auto Filter", "A.Filt")

private:
    void clear() override { env = 0.0f; for (auto& f : svf) f.reset(); }
    void process (float* left, float* right, int n) override
    {
        const float base = value (0), range = value (1), q = value (2);
        const float atk = coef (sampleRate, value (3)), rel = coef (sampleRate, value (4));
        const int mode = choice (5);
        const float wet = value (6) / 100.0f;

        for (int i = 0; i < n; ++i)
        {
            const float key = juce::jmax (std::abs (left[i]), std::abs (right[i]));
            const float open = juce::jlimit (0.0f, 1.0f, key * 3.0f);
            env += (open - env) * (open > env ? atk : rel);
            const float hz = base + env * range;
            float* ch[2] = { left, right };

            for (int c = 0; c < 2; ++c)
            {
                svf[c].set (sampleRate, hz, q);
                const float dry = ch[c][i];
                ch[c][i] = dry + (svf[c].process (dry, mode) - dry) * wet;
            }
        }
    }

    Svf svf[2];
    float env = 0.0f;
};

class AutoPanPlugin : public StudioFxPlugin
{
public:
    explicit AutoPanPlugin (te::PluginCreationInfo info)
        : StudioFxPlugin (info, {
              { "rate", "Rate", 0.05f, 12, 1.5f, "Hz", 2 },
              { "depth", "Depth", 0, 100, 80, "%" },
              { "shape", "Shape", 0, 2, 0, "", 0, lfoShapes } }) {}

    S4_FX_IDENTITY (AutoPanPlugin, "s4000autopan", "Auto Pan", "A.Pan")

private:
    void clear() override { phase = 0.0; }
    void process (float* left, float* right, int n) override
    {
        const double step = (double) value (0) / sampleRate;
        const float depth = value (1) / 100.0f;
        const int shape = choice (2);

        for (int i = 0; i < n; ++i)
        {
            const float lfo = lfoAt ((float) phase, shape) * 2.0f - 1.0f;
            const float angle = (1.0f + lfo * depth) * pi * 0.25f;
            left[i] *= std::cos (angle) * juce::MathConstants<float>::sqrt2;
            right[i] *= std::sin (angle) * juce::MathConstants<float>::sqrt2;
            phase += step;
            phase -= std::floor (phase);
        }
    }

    double phase = 0.0;
};

class ChannelStripPlugin : public StudioFxPlugin
{
public:
    explicit ChannelStripPlugin (te::PluginCreationInfo info)
        : StudioFxPlugin (info, {
              { "input", "Input", -24, 24, 0, "dB" },
              { "pan", "Pan", -100, 100, 0, "%" },
              { "low", "Low", -18, 18, 0, "dB" },
              { "mid", "Mid", -18, 18, 0, "dB" },
              { "high", "High", -18, 18, 0, "dB" },
              { "highpass", "High-pass", 20, 400, 20, "Hz", 80 },
              { "width", "Width", 0, 200, 100, "%" },
              { "phase", "Phase", 0, 1, 0, "", 0, offOn },
              { "output", "Output", -24, 24, 0, "dB" } }) {}

    S4_FX_IDENTITY (ChannelStripPlugin, "s4000channel", "Channel Strip", "Chan")

private:
    void clear() override { for (auto& row : bands) for (auto& b : row) b.reset(); hpF = lowG = midG = highG = -999.0f; }
    void process (float* left, float* right, int n) override;

    Biquad bands[2][4];
    float hpF = -999.0f, lowG = -999.0f, midG = -999.0f, highG = -999.0f;
};

class ChannelStrip2Plugin : public StudioFxPlugin
{
public:
    explicit ChannelStrip2Plugin (te::PluginCreationInfo info)
        : StudioFxPlugin (info, {
              { "gateThreshold", "Gate Threshold", -80, 0, -55, "dB" },
              { "gateRelease", "Gate Release", 5, 500, 80, "ms", 50 },
              { "compThreshold", "Comp Threshold", -40, 0, -16, "dB" },
              { "compRatio", "Comp Ratio", 1, 12, 3, ": 1", 3 },
              { "compAttack", "Comp Attack", 0.1f, 80, 8, "ms", 8 },
              { "compRelease", "Comp Release", 10, 800, 120, "ms", 80 },
              { "low", "Low", -18, 18, 0, "dB" },
              { "mid", "Mid", -18, 18, 0, "dB" },
              { "high", "High", -18, 18, 0, "dB" },
              { "output", "Output", -24, 24, 0, "dB" } }) {}

    S4_FX_IDENTITY (ChannelStrip2Plugin, "s4000channel2", "Channel Strip 2", "Chan 2")

private:
    void clear() override { gate = 1.0f; comp = 0.0f; for (auto& row : bands) for (auto& b : row) b.reset(); lowG = midG = highG = -999.0f; }
    void process (float* left, float* right, int n) override;

    Biquad bands[2][3];
    float gate = 1.0f, comp = 0.0f, lowG = -999.0f, midG = -999.0f, highG = -999.0f;
};

class DjEqPlugin : public StudioFxPlugin
{
public:
    explicit DjEqPlugin (te::PluginCreationInfo info)
        : StudioFxPlugin (info, {
              { "low", "Low", -24, 8, 0, "dB" },
              { "mid", "Mid", -24, 8, 0, "dB" },
              { "high", "High", -24, 8, 0, "dB" },
              { "lowFreq", "Low freq", 40, 400, 180, "Hz", 120 },
              { "highFreq", "High freq", 1000, 12000, 3500, "Hz", 2500 } }) {}

    S4_FX_IDENTITY (DjEqPlugin, "s4000djeq", "DJ EQ", "DJ EQ")

private:
    void clear() override { for (auto& row : bands) for (auto& b : row) b.reset(); mark = -999.0f; }
    void process (float* left, float* right, int n) override;

    Biquad bands[2][3];
    float mark = -999.0f;
};

class DualFilterPlugin : public StudioFxPlugin
{
public:
    explicit DualFilterPlugin (te::PluginCreationInfo info)
        : StudioFxPlugin (info, {
              { "aCutoff", "A Cutoff", 30, 18000, 400, "Hz", 800 },
              { "aResonance", "A Resonance", 0.3f, 8, 0.8f, "", 1 },
              { "aMode", "A Mode", 0, 2, 1, "", 0, filterModes },
              { "bCutoff", "B Cutoff", 30, 18000, 4000, "Hz", 1500 },
              { "bResonance", "B Resonance", 0.3f, 8, 0.8f, "", 1 },
              { "bMode", "B Mode", 0, 2, 0, "", 0, filterModes },
              { "routing", "Routing", 0, 1, 0, "", 0, { "Series", "Parallel" } },
              { "mix", "Mix", 0, 100, 100, "%" } }) {}

    S4_FX_IDENTITY (DualFilterPlugin, "s4000dualfilter", "Dual Filter", "2 Filt")

private:
    void clear() override { for (auto& f : a) f.reset(); for (auto& f : b) f.reset(); }
    void process (float* left, float* right, int n) override
    {
        const float wet = value (7) / 100.0f;
        const bool parallel = choice (6) == 1;

        for (int c = 0; c < 2; ++c)
        {
            a[c].set (sampleRate, value (0), value (1));
            b[c].set (sampleRate, value (3), value (4));
        }
        const int modeA = choice (2), modeB = choice (5);

        for (int i = 0; i < n; ++i)
        {
            float* ch[2] = { left, right };

            for (int c = 0; c < 2; ++c)
            {
                const float dry = ch[c][i];
                const float fa = a[c].process (dry, modeA);
                const float fb = parallel ? b[c].process (dry, modeB) : b[c].process (fa, modeB);
                const float y = parallel ? 0.5f * (fa + fb) : fb;
                ch[c][i] = dry + (y - dry) * wet;
            }
        }
    }

    Svf a[2], b[2];
};

class ExpanderPlugin : public StudioFxPlugin
{
public:
    explicit ExpanderPlugin (te::PluginCreationInfo info)
        : StudioFxPlugin (info, {
              { "threshold", "Threshold", -70, 0, -35, "dB" },
              { "ratio", "Ratio", 1, 8, 2, ": 1", 2 },
              { "attack", "Attack", 0.1f, 100, 5, "ms", 5 },
              { "release", "Release", 5, 1000, 150, "ms", 80 },
              { "range", "Range", 0, 60, 24, "dB" } }) {}

    S4_FX_IDENTITY (ExpanderPlugin, "s4000expander", "Expander", "Expand")

private:
    void clear() override { env = gain = 0.0f; }
    void process (float* left, float* right, int n) override
    {
        const float threshold = value (0), ratio = value (1), range = value (4);
        const float atk = coef (sampleRate, value (2)), rel = coef (sampleRate, value (3));

        for (int i = 0; i < n; ++i)
        {
            const float level = juce::jmax (std::abs (left[i]), std::abs (right[i]));
            env += (level - env) * (level > env ? atk : rel);
            const float db = 20.0f * std::log10 (juce::jmax (1.0e-7f, env));
            const float under = threshold - db;
            const float cut = under > 0.0f ? juce::jmin (range, under * (1.0f - 1.0f / ratio)) : 0.0f;
            gain += (cut - gain) * (cut > gain ? rel : atk);
            const float g = dbToGain (-gain);
            left[i] *= g;
            right[i] *= g;
        }
    }

    float env = 0.0f, gain = 0.0f;
};

class FlangerPlugin : public StudioFxPlugin
{
public:
    explicit FlangerPlugin (te::PluginCreationInfo info)
        : StudioFxPlugin (info, {
              { "rate", "Rate", 0.05f, 8, 0.4f, "Hz", 0.8 },
              { "depth", "Depth", 0, 100, 60, "%" },
              { "feedback", "Feedback", 0, 90, 40, "%" },
              { "mix", "Mix", 0, 100, 40, "%" } }) {}

    S4_FX_IDENTITY (FlangerPlugin, "s4000flanger", "Flanger", "Flange")

private:
    bool hasTail() const override { return true; }
    void prepare() override { for (auto& d : line) d.resize ((int) (sampleRate * 0.02)); }
    void clear() override { phase = 0.0; for (auto& d : line) d.clear(); }
    void process (float* left, float* right, int n) override
    {
        const double step = (double) value (0) / sampleRate;
        const float depth = value (1) / 100.0f;
        const float feedback = value (2) / 100.0f * 0.95f;
        const float wet = value (3) / 100.0f;
        float* ch[2] = { left, right };

        for (int i = 0; i < n; ++i)
        {
            const float lfo = 0.5f + 0.5f * std::sin (2.0f * pi * (float) phase);
            const float delay = (0.0004f + 0.006f * depth * lfo) * (float) sampleRate;

            for (int c = 0; c < 2; ++c)
            {
                const float delayed = line[c].read (delay);
                const float dry = ch[c][i];
                line[c].push (std::tanh (dry + delayed * feedback));
                ch[c][i] = dry + (delayed - dry) * wet;
            }

            phase += step;
            phase -= std::floor (phase);
        }
    }

    Delay line[2];
    double phase = 0.0;
};

class MonoDelayPlugin : public StudioFxPlugin
{
public:
    explicit MonoDelayPlugin (te::PluginCreationInfo info)
        : StudioFxPlugin (info, {
              { "time", "Time", 1, 2000, 280, "ms", 250 },
              { "feedback", "Feedback", 0, 95, 35, "%" },
              { "tone", "Tone", 800, 16000, 6000, "Hz", 3000 },
              { "mix", "Mix", 0, 100, 30, "%" } }) {}

    S4_FX_IDENTITY (MonoDelayPlugin, "s4000monodelay", "Mono Delay", "M.Delay")

private:
    bool hasTail() const override { return true; }
    void prepare() override { line.resize ((int) (sampleRate * 2.5)); }
    void clear() override { line.clear(); tone = 0.0f; }
    void process (float* left, float* right, int n) override
    {
        const float delay = juce::jmax (1.0f, value (0) * 0.001f * (float) sampleRate);
        const float feedback = value (1) / 100.0f;
        const float toneCoef = 1.0f - (float) std::exp (-2.0 * pi * (double) value (2) / sampleRate);
        const float wet = value (3) / 100.0f;

        for (int i = 0; i < n; ++i)
        {
            const float dryL = left[i], dryR = right[i];
            const float delayed = line.read (delay);
            tone += toneCoef * (delayed - tone);
            line.push (std::tanh (0.5f * (dryL + dryR) + tone * feedback));
            left[i] = dryL + (tone - dryL) * wet;
            right[i] = dryR + (tone - dryR) * wet;
        }
    }

    Delay line;
    float tone = 0.0f;
};

class OverdrivePlugin : public StudioFxPlugin
{
public:
    explicit OverdrivePlugin (te::PluginCreationInfo info)
        : StudioFxPlugin (info, {
              { "drive", "Drive", 0, 36, 12, "dB" },
              { "tone", "Tone", 400, 12000, 4500, "Hz", 2000 },
              { "output", "Output", -24, 12, -6, "dB" },
              { "mix", "Mix", 0, 100, 100, "%" } }) {}

    S4_FX_IDENTITY (OverdrivePlugin, "s4000overdrive", "Overdrive", "Drive")

private:
    void clear() override { tone[0] = tone[1] = 0.0f; }
    void process (float* left, float* right, int n) override
    {
        const float drive = dbToGain (value (0));
        const float a = 1.0f - (float) std::exp (-2.0 * pi * (double) value (1) / sampleRate);
        const float out = dbToGain (value (2));
        const float wet = value (3) / 100.0f;
        float* ch[2] = { left, right };

        for (int c = 0; c < 2; ++c)
            for (int i = 0; i < n; ++i)
            {
                const float dry = ch[c][i];
                const float clipped = std::tanh (dry * drive);
                tone[c] += a * (clipped - tone[c]);
                ch[c][i] = (dry + (tone[c] - dry) * wet) * out;
            }
    }

    float tone[2] {};
};

class RingModPlugin : public StudioFxPlugin
{
public:
    explicit RingModPlugin (te::PluginCreationInfo info)
        : StudioFxPlugin (info, {
              { "frequency", "Frequency", 1, 4000, 440, "Hz", 200 },
              { "mix", "Mix", 0, 100, 50, "%" } }) {}

    S4_FX_IDENTITY (RingModPlugin, "s4000ringmod", "Ring Modulator", "Ring")

private:
    void clear() override { phase = 0.0; }
    void process (float* left, float* right, int n) override
    {
        const double step = (double) value (0) / sampleRate;
        const float wet = value (1) / 100.0f;

        for (int i = 0; i < n; ++i)
        {
            const float carrier = std::sin (2.0f * pi * (float) phase);
            left[i] = left[i] * (1.0f - wet) + left[i] * carrier * wet;
            right[i] = right[i] * (1.0f - wet) + right[i] * carrier * wet;
            phase += step;
            phase -= std::floor (phase);
        }
    }

    double phase = 0.0;
};

class SignalGeneratorPlugin : public StudioFxPlugin
{
public:
    explicit SignalGeneratorPlugin (te::PluginCreationInfo info)
        : StudioFxPlugin (info, {
              { "wave", "Wave", 0, 4, 0, "", 0, { "Sine", "Square", "Saw", "Noise", "Sweep" } },
              { "frequency", "Frequency", 20, 8000, 440, "Hz", 400 },
              { "level", "Level", -60, 0, -12, "dB" },
              { "mix", "Mix", 0, 100, 100, "%" } }) {}

    S4_FX_IDENTITY (SignalGeneratorPlugin, "s4000siggen", "Signal Generator", "Sig")

private:
    bool hasTail() const override { return true; }
    void clear() override { phase = sweep = 0.0; seed = 0x1234567u; }
    void process (float* left, float* right, int n) override
    {
        const int wave = choice (0);
        const double hz = (double) value (1);
        const float level = dbToGain (value (2));
        const float wet = value (3) / 100.0f;
        const double step = hz / sampleRate;

        for (int i = 0; i < n; ++i)
        {
            float g = 0.0f;

            if (wave == 1)
                g = phase < 0.5 ? 1.0f : -1.0f;
            else if (wave == 2)
                g = (float) (2.0 * phase - 1.0);
            else if (wave == 3)
            {
                seed = seed * 1664525u + 1013904223u;
                g = ((seed >> 8) & 0xffff) / 32768.0f - 1.0f;
            }
            else if (wave == 4)
            {
                const double f = 20.0 * std::pow (hz / 20.0, sweep);
                g = std::sin (2.0f * pi * (float) phase);
                sweep += 1.0 / (sampleRate * 3.0);
                phase += f / sampleRate;
                if (sweep >= 1.0)
                    sweep = 0.0;
            }
            else
                g = std::sin (2.0f * pi * (float) phase);

            if (wave != 4)
                phase += step;

            phase -= std::floor (phase);
            g *= level;
            left[i] = left[i] * (1.0f - wet) + g * wet;
            right[i] = right[i] * (1.0f - wet) + g * wet;
        }
    }

    double phase = 0.0, sweep = 0.0;
    juce::uint32 seed = 1;
};

class TiltEqPlugin : public StudioFxPlugin
{
public:
    explicit TiltEqPlugin (te::PluginCreationInfo info)
        : StudioFxPlugin (info, {
              { "tilt", "Tilt", -12, 12, 0, "dB" },
              { "pivot", "Pivot", 80, 8000, 800, "Hz", 1000 },
              { "output", "Output", -18, 18, 0, "dB" } }) {}

    S4_FX_IDENTITY (TiltEqPlugin, "s4000tilteq", "Tilt EQ", "Tilt")

private:
    void clear() override { for (auto& row : shelf) for (auto& b : row) b.reset(); lastTilt = lastPivot = -999.0f; }
    void process (float* left, float* right, int n) override
    {
        const float tilt = value (0), pivot = value (1), out = dbToGain (value (2));

        if (tilt != lastTilt || pivot != lastPivot)
        {
            for (int c = 0; c < 2; ++c)
            {
                designShelf (shelf[c][0], Biquad::lowShelf, sampleRate, pivot, -tilt);
                designShelf (shelf[c][1], Biquad::highShelf, sampleRate, pivot, tilt);
            }

            lastTilt = tilt;
            lastPivot = pivot;
        }

        float* ch[2] = { left, right };

        if (std::abs (tilt) > 0.05f)
            for (int c = 0; c < 2; ++c)
                for (int i = 0; i < n; ++i)
                    ch[c][i] = shelf[c][1].process (shelf[c][0].process (ch[c][i]));

        if (std::abs (out - 1.0f) > 1.0e-4f)
            for (int c = 0; c < 2; ++c)
                juce::FloatVectorOperations::multiply (ch[c], out, n);
    }

    Biquad shelf[2][2];
    float lastTilt = -999.0f, lastPivot = -999.0f;
};

class UtilityPlugin : public StudioFxPlugin
{
public:
    explicit UtilityPlugin (te::PluginCreationInfo info)
        : StudioFxPlugin (info, {
              { "gain", "Gain", -60, 24, 0, "dB" },
              { "pan", "Pan", -100, 100, 0, "%" },
              { "width", "Width", 0, 200, 100, "%" },
              { "mono", "Mono", 0, 1, 0, "", 0, offOn },
              { "invertL", "Invert L", 0, 1, 0, "", 0, offOn },
              { "invertR", "Invert R", 0, 1, 0, "", 0, offOn },
              { "swap", "Swap", 0, 1, 0, "", 0, offOn } }) {}

    S4_FX_IDENTITY (UtilityPlugin, "s4000utility", "Utility", "Util")

private:
    void clear() override {}
    void process (float* left, float* right, int n) override
    {
        const float gain = dbToGain (value (0));
        const float pan = value (1) / 100.0f;
        const float angle = (pan + 1.0f) * pi * 0.25f;
        const float lG = std::cos (angle) * juce::MathConstants<float>::sqrt2 * gain * (choice (4) == 1 ? -1.0f : 1.0f);
        const float rG = std::sin (angle) * juce::MathConstants<float>::sqrt2 * gain * (choice (5) == 1 ? -1.0f : 1.0f);
        const float width = value (2) / 100.0f;
        const bool mono = choice (3) == 1, swap = choice (6) == 1;

        for (int i = 0; i < n; ++i)
        {
            float l = left[i] * lG, r = right[i] * rG;
            const float mid = 0.5f * (l + r);
            float side = 0.5f * (l - r) * width;
            l = mid + side;
            r = mid - side;

            if (mono)
                l = r = mid;

            if (swap)
                std::swap (l, r);

            left[i] = l;
            right[i] = r;
        }
    }
};

class ResonantFilterPlugin : public StudioFxPlugin
{
public:
    explicit ResonantFilterPlugin (te::PluginCreationInfo info)
        : StudioFxPlugin (info, {
              { "cutoff", "Cutoff", 30, 18000, 2000, "Hz", 800 },
              { "resonance", "Resonance", 0.3f, 10, 0.9f, "", 1 },
              { "mode", "Mode", 0, 2, 0, "", 0, filterModes },
              { "drive", "Drive", 0, 24, 0, "dB" },
              { "mix", "Mix", 0, 100, 100, "%" } }) {}

    S4_FX_IDENTITY (ResonantFilterPlugin, "s4000resofilter", "Resonant Filter", "Filter")

private:
    void clear() override { for (auto& f : svf) f.reset(); }
    void process (float* left, float* right, int n) override
    {
        const float drive = dbToGain (value (3));
        const float wet = value (4) / 100.0f;
        const int mode = choice (2);
        svf[0].set (sampleRate, value (0), value (1));
        svf[1].set (sampleRate, value (0), value (1));
        float* ch[2] = { left, right };

        for (int c = 0; c < 2; ++c)
            for (int i = 0; i < n; ++i)
            {
                const float dry = ch[c][i];
                const float y = svf[c].process (std::tanh (dry * drive), mode);
                ch[c][i] = dry + (y - dry) * wet;
            }
    }

    Svf svf[2];
};

//==============================================================================
void ChannelStripPlugin::process (float* left, float* right, int n)
{
    const float in = dbToGain (value (0)), out = dbToGain (value (8));
    const float pan = value (1) / 100.0f;
    const float angle = (pan + 1.0f) * pi * 0.25f;
    const float lG = std::cos (angle) * juce::MathConstants<float>::sqrt2;
    const float rG = std::sin (angle) * juce::MathConstants<float>::sqrt2;
    const float low = value (2), mid = value (3), high = value (4), hp = value (5);
    const float width = value (6) / 100.0f;
    const float phase = choice (7) == 1 ? -1.0f : 1.0f;

    if (low != lowG || mid != midG || high != highG || hp != hpF)
    {
        for (int c = 0; c < 2; ++c)
        {
            designShelf (bands[c][0], Biquad::lowShelf, sampleRate, 120.0, low);
            designShelf (bands[c][1], Biquad::bell, sampleRate, 1000.0, mid);
            designShelf (bands[c][2], Biquad::highShelf, sampleRate, 8000.0, high);
            designShelf (bands[c][3], Biquad::lowCut, sampleRate, hp, 0.0);
        }

        lowG = low; midG = mid; highG = high; hpF = hp;
    }

    const bool eq = std::abs (low) > 0.05f || std::abs (mid) > 0.05f || std::abs (high) > 0.05f;
    const bool hipass = hp > 25.0f;
    float* ch[2] = { left, right };

    for (int i = 0; i < n; ++i)
    {
        float s[2] = { ch[0][i] * in, ch[1][i] * in };

        for (int c = 0; c < 2; ++c)
        {
            if (hipass) s[c] = bands[c][3].process (s[c]);
            if (eq)      s[c] = bands[c][2].process (bands[c][1].process (bands[c][0].process (s[c])));
        }

        const float midM = 0.5f * (s[0] + s[1]);
        const float side = 0.5f * (s[0] - s[1]) * width;
        ch[0][i] = (midM + side) * lG * out * phase;
        ch[1][i] = (midM - side) * rG * out * phase;
    }
}

void ChannelStrip2Plugin::process (float* left, float* right, int n)
{
    const float gateThresh = dbToGain (value (0));
    const float gateRel = coef (sampleRate, value (1));
    const float compThresh = value (2), ratio = juce::jmax (1.0f, value (3));
    const float atk = coef (sampleRate, value (4)), rel = coef (sampleRate, value (5));
    const float low = value (6), mid = value (7), high = value (8), out = dbToGain (value (9));

    if (low != lowG || mid != midG || high != highG)
    {
        for (int c = 0; c < 2; ++c)
        {
            designShelf (bands[c][0], Biquad::lowShelf, sampleRate, 120.0, low);
            designShelf (bands[c][1], Biquad::bell, sampleRate, 1200.0, mid);
            designShelf (bands[c][2], Biquad::highShelf, sampleRate, 7000.0, high);
        }

        lowG = low; midG = mid; highG = high;
    }

    const bool eq = std::abs (low) > 0.05f || std::abs (mid) > 0.05f || std::abs (high) > 0.05f;

    for (int i = 0; i < n; ++i)
    {
        const float key = juce::jmax (std::abs (left[i]), std::abs (right[i]));
        const float open = key > gateThresh ? 1.0f : 0.0f;
        gate += (open - gate) * (open > gate ? 0.2f : gateRel);

        const float db = 20.0f * std::log10 (juce::jmax (1.0e-7f, key));
        const float over = db - compThresh;
        const float target = over > 0.0f ? over * (1.0f / ratio - 1.0f) : 0.0f;
        comp += (target - comp) * (target < comp ? atk : rel);
        const float g = dbToGain (comp) * gate;

        float l = left[i] * g, r = right[i] * g;

        if (eq)
        {
            l = bands[0][2].process (bands[0][1].process (bands[0][0].process (l)));
            r = bands[1][2].process (bands[1][1].process (bands[1][0].process (r)));
        }

        left[i] = l * out;
        right[i] = r * out;
    }
}

void DjEqPlugin::process (float* left, float* right, int n)
{
    const float low = value (0), mid = value (1), high = value (2);
    const float lowHz = value (3), highHz = value (4);
    const float stamp = low + mid * 0.01f + high * 0.0001f + lowHz + highHz * 0.001f;

    if (stamp != mark)
    {
        for (int c = 0; c < 2; ++c)
        {
            if (low <= -23.5f)
                designShelf (bands[c][0], Biquad::lowCut, sampleRate, lowHz, 0.0);
            else
                designShelf (bands[c][0], Biquad::lowShelf, sampleRate, lowHz, low);

            if (mid <= -23.5f)
                designShelf (bands[c][1], Biquad::notch, sampleRate, 1000.0, 0.0);
            else
                designShelf (bands[c][1], Biquad::bell, sampleRate, 1000.0, mid);

            if (high <= -23.5f)
                designShelf (bands[c][2], Biquad::highCut, sampleRate, highHz, 0.0);
            else
                designShelf (bands[c][2], Biquad::highShelf, sampleRate, highHz, high);
        }

        mark = stamp;
    }

    const bool useLow = std::abs (low) > 0.05f || low <= -23.5f;
    const bool useMid = std::abs (mid) > 0.05f || mid <= -23.5f;
    const bool useHigh = std::abs (high) > 0.05f || high <= -23.5f;
    float* ch[2] = { left, right };

    for (int c = 0; c < 2; ++c)
        for (int i = 0; i < n; ++i)
        {
            float s = ch[c][i];
            if (useLow)  s = bands[c][0].process (s);
            if (useMid)  s = bands[c][1].process (s);
            if (useHigh) s = bands[c][2].process (s);
            ch[c][i] = s;
        }
}

//==============================================================================
namespace
{
    constexpr int maxVoices = 12;

    inline float midiHz (int note)
    {
        return 440.0f * std::pow (2.0f, (note - 69) / 12.0f);
    }

    inline float polyblep (float t, float dt)
    {
        if (dt <= 0.0f)
            return 0.0f;

        if (t < dt)
        {
            t /= dt;
            return t + t - t * t - 1.0f;
        }

        if (t > 1.0f - dt)
        {
            t = (t - 1.0f) / dt;
            return t * t + t + t + 1.0f;
        }

        return 0.0f;
    }

    struct Voice
    {
        int note = -1, stage = 0;
        float vel = 0.0f, env = 0.0f, fenv = 0.0f;
        float p1 = 0.0f, p2 = 0.0f, last = 0.0f;
        Svf filter;

        bool busy() const { return stage != 0; }

        void start (int n, float v)
        {
            note = n;
            vel = v;
            stage = 1;
            env = 0.0f;
            fenv = 0.0f;
            filter.reset();
        }

        void release()
        {
            if (stage != 0)
                stage = 4;
        }
    };

    struct Event { int at, kind, note; float vel; };
}

class FmSynthPlugin : public StudioFxPlugin
{
public:
    explicit FmSynthPlugin (te::PluginCreationInfo info)
        : StudioFxPlugin (info, {
              { "ratio", "Ratio", 0.25f, 12, 2, "", 2 },
              { "index", "Index", 0, 8, 1.6f, "", 1 },
              { "feedback", "Feedback", 0, 90, 15, "%" },
              { "attack", "Attack", 0.001f, 2, 0.01f, "s", 0.05f },
              { "decay", "Decay", 0.01f, 4, 0.8f, "s", 0.3f },
              { "release", "Release", 0.01f, 4, 0.4f, "s", 0.2f },
              { "level", "Level", -36, 6, -8, "dB" } }) {}

    S4_FX_IDENTITY (FmSynthPlugin, "s4000fm", "FM Synth", "FM")
    bool isSynth() override { return true; }
    bool producesAudioWhenNoAudioInput() override { return true; }
    bool noTail() override { return false; }
    void applyToBuffer (const te::PluginRenderContext& fc) override;

private:
    void clear() override { for (auto& v : voices) v = {}; }
    void process (float* left, float* right, int n) override { render (left, right, n); }
    void render (float*, float*, int);

    Voice voices[maxVoices];
    Event events[64] {};
    int eventCount = 0;
};

class AnalogPolyPlugin : public StudioFxPlugin
{
public:
    explicit AnalogPolyPlugin (te::PluginCreationInfo info)
        : StudioFxPlugin (info, {
              { "cutoff", "Cutoff", 40, 12000, 900, "Hz", 800 },
              { "resonance", "Resonance", 0.3f, 8, 0.8f, "", 1 },
              { "env", "Env amount", 0, 100, 55, "%" },
              { "detune", "Detune", 0, 40, 8, "cents" },
              { "mix", "Osc 2", 0, 100, 50, "%" },
              { "attack", "Attack", 0.001f, 2, 0.01f, "s", 0.05f },
              { "decay", "Decay", 0.01f, 4, 0.4f, "s", 0.2f },
              { "sustain", "Sustain", 0, 100, 70, "%" },
              { "release", "Release", 0.01f, 5, 0.35f, "s", 0.2f },
              { "level", "Level", -36, 6, -8, "dB" } }) {}

    S4_FX_IDENTITY (AnalogPolyPlugin, "s4000poly", "Analog Poly", "Poly")
    bool isSynth() override { return true; }
    bool producesAudioWhenNoAudioInput() override { return true; }
    bool noTail() override { return false; }
    void applyToBuffer (const te::PluginRenderContext& fc) override;

private:
    void clear() override { for (auto& v : voices) v = {}; }
    void process (float*, float*, int) override {}
    void render (float*, float*, int);

    Voice voices[maxVoices];
    Event events[64] {};
    int eventCount = 0;
};

namespace
{
    void collectMidi (const te::PluginRenderContext& fc, Event* events, int& count, int numSamples, double sampleRate)
    {
        count = 0;

        if (fc.bufferForMidiMessages == nullptr || fc.destBuffer == nullptr)
            return;

        for (auto& message : *fc.bufferForMidiMessages)
        {
            if (count >= 64)
                break;

            const int at = juce::jlimit (0, juce::jmax (0, numSamples - 1),
                                          juce::roundToInt (message.getTimeStamp() * sampleRate) - fc.bufferStartSample);

            if (message.isNoteOn())
                events[count++] = { at, 1, message.getNoteNumber(), message.getFloatVelocity() };
            else if (message.isNoteOff())
                events[count++] = { at, 0, message.getNoteNumber(), 0.0f };
            else if (message.isAllNotesOff() || message.isAllSoundOff())
                events[count++] = { at, 2, 0, 0.0f };
        }
    }

    Voice* allocateVoice (Voice* voices)
    {
        Voice* quiet = &voices[0];

        for (int i = 0; i < maxVoices; ++i)
        {
            if (! voices[i].busy())
                return &voices[i];

            if (voices[i].env < quiet->env)
                quiet = &voices[i];
        }

        return quiet;
    }

    void dispatch (Voice* voices, const Event& e)
    {
        if (e.kind == 2)
        {
            for (int i = 0; i < maxVoices; ++i)
                voices[i].release();

            return;
        }

        if (e.kind == 1)
        {
            if (auto* v = allocateVoice (voices))
                v->start (e.note, juce::jlimit (0.05f, 1.0f, e.vel));

            return;
        }

        for (int i = 0; i < maxVoices; ++i)
            if (voices[i].note == e.note)
                voices[i].release();
    }

    float advanceAmp (Voice& v, float attack, float decay, float sustain, float release, double sampleRate)
    {
        const float a = coef (sampleRate, attack * 1000.0);
        const float d = coef (sampleRate, decay * 1000.0);
        const float r = coef (sampleRate, release * 1000.0);

        if (v.stage == 1)
        {
            v.env += (1.0f - v.env) * a;
            if (v.env > 0.99f)
                v.stage = 2;
        }
        else if (v.stage == 2)
        {
            v.env += (sustain - v.env) * d;
            if (std::abs (v.env - sustain) < 0.01f)
                v.stage = 3;
        }
        else if (v.stage == 4)
        {
            v.env += (0.0f - v.env) * r;
            if (v.env < 0.0008f)
                v.stage = 0;
        }

        return v.env;
    }

    template <typename Render>
    void renderBlock (const te::PluginRenderContext& fc, Voice* voices, Event* events, int& eventCount,
                      double sampleRate, Render render)
    {
        if (fc.destBuffer == nullptr || fc.bufferNumSamples <= 0)
            return;

        if (fc.bufferForMidiMessages != nullptr && fc.bufferForMidiMessages->isAllNotesOff)
            for (int i = 0; i < maxVoices; ++i)
                voices[i].release();

        collectMidi (fc, events, eventCount, fc.bufferNumSamples, sampleRate);
        auto& buffer = *fc.destBuffer;
        const int channels = buffer.getNumChannels();

        if (channels <= 0)
            return;

        float* left = buffer.getWritePointer (0, fc.bufferStartSample);
        float* right = channels > 1 ? buffer.getWritePointer (1, fc.bufferStartSample) : left;
        juce::FloatVectorOperations::clear (left, fc.bufferNumSamples);

        if (channels > 1)
            juce::FloatVectorOperations::clear (right, fc.bufferNumSamples);

        render (left, right, fc.bufferNumSamples);
    }
}

void FmSynthPlugin::applyToBuffer (const te::PluginRenderContext& fc)
{
    renderBlock (fc, voices, events, eventCount, sampleRate, [this] (float* l, float* r, int n) { render (l, r, n); });
}

void FmSynthPlugin::render (float* left, float* right, int n)
{
    const float ratio = value (0), index = value (1), feedback = value (2) / 100.0f;
    const float attack = value (3), decay = value (4), release = value (5);
    const float level = dbToGain (value (6)) * 0.2f;
    int ev = 0;

    for (int i = 0; i < n; ++i)
    {
        while (ev < eventCount && events[ev].at <= i)
            dispatch (voices, events[ev++]);

        float sum = 0.0f;

        for (auto& v : voices)
        {
            if (! v.busy())
                continue;

            const float amp = advanceAmp (v, attack, decay, 0.0f, release, sampleRate);
            const float hz = midiHz (v.note);
            const float dt = hz / (float) sampleRate;
            const float mod = std::sin (2.0f * pi * v.p2);
            v.p2 += dt * ratio;
            v.p2 -= std::floor (v.p2);
            const float fm = (mod + v.last * feedback) * index * amp;
            v.last = mod;
            const float car = std::sin (2.0f * pi * v.p1 + fm);
            v.p1 += dt;
            v.p1 -= std::floor (v.p1);
            sum += car * amp * v.vel;
        }

        left[i] = right[i] = std::tanh (sum) * level;
    }
}

void AnalogPolyPlugin::applyToBuffer (const te::PluginRenderContext& fc)
{
    renderBlock (fc, voices, events, eventCount, sampleRate, [this] (float* l, float* r, int n) { render (l, r, n); });
}

void AnalogPolyPlugin::render (float* left, float* right, int n)
{
    const float cutoff = value (0), q = value (1), envAmt = value (2) / 100.0f;
    const float detune = value (3), osc2 = value (4) / 100.0f;
    const float attack = value (5), decay = value (6), sustain = value (7) / 100.0f, release = value (8);
    const float level = dbToGain (value (9)) * 0.18f;
    int ev = 0;

    for (int i = 0; i < n; ++i)
    {
        while (ev < eventCount && events[ev].at <= i)
            dispatch (voices, events[ev++]);

        float sum = 0.0f;

        for (auto& v : voices)
        {
            if (! v.busy())
                continue;

            const float amp = advanceAmp (v, attack, decay, sustain, release, sampleRate);
            v.fenv += ((v.stage == 4 ? 0.0f : 1.0f) - v.fenv) * coef (sampleRate, v.stage == 1 ? 5.0 : 280.0);
            const float hz = midiHz (v.note);
            const float dt1 = hz / (float) sampleRate;
            const float dt2 = hz * std::pow (2.0f, detune / 1200.0f) / (float) sampleRate;
            float s1 = (2.0f * v.p1 - 1.0f) - polyblep (v.p1, dt1);
            float s2 = (2.0f * v.p2 - 1.0f) - polyblep (v.p2, dt2);
            v.p1 += dt1; v.p1 -= std::floor (v.p1);
            v.p2 += dt2; v.p2 -= std::floor (v.p2);
            const float mixed = s1 * (1.0f - osc2) + s2 * osc2;
            const float hzF = cutoff * std::pow (2.0f, envAmt * v.fenv * 3.0f);
            v.filter.set (sampleRate, hzF, q);
            sum += v.filter.process (mixed, 0) * amp * v.vel;
        }

        left[i] = right[i] = std::tanh (sum) * level;
    }
}

//==============================================================================
void registerSuite (te::PluginManager& pm)
{
    pm.createBuiltInType<AutoFilterPlugin>();
    pm.createBuiltInType<AutoPanPlugin>();
    pm.createBuiltInType<ChannelStripPlugin>();
    pm.createBuiltInType<ChannelStrip2Plugin>();
    pm.createBuiltInType<DjEqPlugin>();
    pm.createBuiltInType<DualFilterPlugin>();
    pm.createBuiltInType<ExpanderPlugin>();
    pm.createBuiltInType<FlangerPlugin>();
    pm.createBuiltInType<MonoDelayPlugin>();
    pm.createBuiltInType<OverdrivePlugin>();
    pm.createBuiltInType<RingModPlugin>();
    pm.createBuiltInType<SignalGeneratorPlugin>();
    pm.createBuiltInType<TiltEqPlugin>();
    pm.createBuiltInType<UtilityPlugin>();
    pm.createBuiltInType<ResonantFilterPlugin>();
    pm.createBuiltInType<FmSynthPlugin>();
    pm.createBuiltInType<AnalogPolyPlugin>();
}

std::vector<std::array<const char*, 3>> suiteEffectCatalogue()
{
    return {
        { AutoFilterPlugin::xmlTypeName,      AutoFilterPlugin::getPluginName(),      "Filter" },
        { AutoPanPlugin::xmlTypeName,         AutoPanPlugin::getPluginName(),         "Modulation" },
        { ChannelStripPlugin::xmlTypeName,    ChannelStripPlugin::getPluginName(),    "Dynamics" },
        { ChannelStrip2Plugin::xmlTypeName,   ChannelStrip2Plugin::getPluginName(),   "Dynamics" },
        { DjEqPlugin::xmlTypeName,            DjEqPlugin::getPluginName(),            "EQ" },
        { DualFilterPlugin::xmlTypeName,      DualFilterPlugin::getPluginName(),      "Filter" },
        { ExpanderPlugin::xmlTypeName,        ExpanderPlugin::getPluginName(),        "Dynamics" },
        { FlangerPlugin::xmlTypeName,         FlangerPlugin::getPluginName(),         "Modulation" },
        { MonoDelayPlugin::xmlTypeName,       MonoDelayPlugin::getPluginName(),       "Delay" },
        { OverdrivePlugin::xmlTypeName,       OverdrivePlugin::getPluginName(),       "Saturation" },
        { RingModPlugin::xmlTypeName,         RingModPlugin::getPluginName(),         "Modulation" },
        { SignalGeneratorPlugin::xmlTypeName, SignalGeneratorPlugin::getPluginName(), "Utility" },
        { TiltEqPlugin::xmlTypeName,          TiltEqPlugin::getPluginName(),          "EQ" },
        { UtilityPlugin::xmlTypeName,         UtilityPlugin::getPluginName(),         "Utility" },
        { ResonantFilterPlugin::xmlTypeName,  ResonantFilterPlugin::getPluginName(),  "Filter" },
    };
}

std::vector<std::array<const char*, 3>> suiteSynthCatalogue()
{
    return {
        { FmSynthPlugin::xmlTypeName,     FmSynthPlugin::getPluginName(),     "Keys" },
        { AnalogPolyPlugin::xmlTypeName,  AnalogPolyPlugin::getPluginName(),  "Keys" },
    };
}
}
