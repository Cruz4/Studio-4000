#include "StudioFx.h"

namespace s3
{
namespace
{
    constexpr float pi = juce::MathConstants<float>::pi;

    inline float dbToGain (float db)        { return std::pow (10.0f, db * 0.05f); }
    inline float gainToDb (float g)         { return 20.0f * std::log10 (juce::jmax (1.0e-9f, g)); }

    /** One-pole smoothing coefficient for a time constant in milliseconds. */
    inline float coef (double sampleRate, double ms)
    {
        return ms <= 0.0 ? 1.0f : 1.0f - (float) std::exp (-1.0 / (ms * 0.001 * sampleRate));
    }

    /** One-pole low-pass coefficient for a cutoff in Hz. */
    inline float cutoff (double sampleRate, double hz)
    {
        return 1.0f - (float) std::exp (-2.0 * juce::MathConstants<double>::pi * hz / sampleRate);
    }

    inline float follow (float env, float in, float attack, float release)
    {
        return env + (in - env) * (in > env ? attack : release);
    }

    inline float readFrac (const std::vector<float>& line, int writePos, float delay)
    {
        const int size = (int) line.size();
        float pos = (float) writePos - delay;

        while (pos < 0.0f)
            pos += (float) size;

        const int i0 = (int) pos;
        const int i1 = (i0 + 1) % size;
        const float f = pos - (float) i0;
        return line[(size_t) (i0 % size)] * (1.0f - f) + line[(size_t) i1] * f;
    }

    const juce::StringArray noteNames { "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B" };
    const juce::StringArray offOn { "Off", "On" };

    /** Beats per cycle for the tempo-synced note values used by Tremolo and Stereo Delay. */
    struct NoteValue { const char* name; double beats; };
    const NoteValue delayNotes[] { { "Free", 0.0 }, { "1/2", 2.0 }, { "1/4 dotted", 1.5 }, { "1/4", 1.0 }, { "1/4 triplet", 2.0 / 3.0 },
                                   { "1/8 dotted", 0.75 }, { "1/8", 0.5 }, { "1/8 triplet", 1.0 / 3.0 }, { "1/16", 0.25 } };

    juce::StringArray noteValueNames()
    {
        juce::StringArray a;

        for (auto& n : delayNotes)
            a.add (n.name);

        return a;
    }
}

void Biquad::design (int type, double sampleRate, double freq, double gainDb, double q)
{
    const double w0 = 2.0 * juce::MathConstants<double>::pi * juce::jlimit (10.0, sampleRate * 0.45, freq) / sampleRate;
    const double cs = std::cos (w0), alpha = std::sin (w0) / (2.0 * juce::jmax (0.05, q));
    const double A = std::pow (10.0, gainDb / 40.0), sqA2 = 2.0 * std::sqrt (A) * alpha;
    double c[6];

    switch (type)
    {
        case lowCut:    c[0] = (1 + cs) / 2; c[1] = -(1 + cs); c[2] = (1 + cs) / 2; c[3] = 1 + alpha; c[4] = -2 * cs; c[5] = 1 - alpha; break;
        case highCut:   c[0] = (1 - cs) / 2; c[1] = 1 - cs;    c[2] = (1 - cs) / 2; c[3] = 1 + alpha; c[4] = -2 * cs; c[5] = 1 - alpha; break;
        case notch:     c[0] = 1; c[1] = -2 * cs; c[2] = 1; c[3] = 1 + alpha; c[4] = -2 * cs; c[5] = 1 - alpha; break;
        case lowShelf:
            c[0] = A * ((A + 1) - (A - 1) * cs + sqA2);
            c[1] = 2 * A * ((A - 1) - (A + 1) * cs);
            c[2] = A * ((A + 1) - (A - 1) * cs - sqA2);
            c[3] = (A + 1) + (A - 1) * cs + sqA2;
            c[4] = -2 * ((A - 1) + (A + 1) * cs);
            c[5] = (A + 1) + (A - 1) * cs - sqA2;
            break;
        case highShelf:
            c[0] = A * ((A + 1) + (A - 1) * cs + sqA2);
            c[1] = -2 * A * ((A - 1) + (A + 1) * cs);
            c[2] = A * ((A + 1) + (A - 1) * cs - sqA2);
            c[3] = (A + 1) - (A - 1) * cs + sqA2;
            c[4] = 2 * ((A - 1) - (A + 1) * cs);
            c[5] = (A + 1) - (A - 1) * cs - sqA2;
            break;
        case bell:
        default:
            c[0] = 1 + alpha * A; c[1] = -2 * cs; c[2] = 1 - alpha * A; c[3] = 1 + alpha / A; c[4] = -2 * cs; c[5] = 1 - alpha / A;
            break;
    }

    b0 = (float) (c[0] / c[3]);
    b1 = (float) (c[1] / c[3]);
    b2 = (float) (c[2] / c[3]);
    a1 = (float) (c[4] / c[3]);
    a2 = (float) (c[5] / c[3]);
}

//==============================================================================
void FxScope::push (const float* l, const float* r, int n)
{
    int pos = writePos.load (std::memory_order_relaxed);
    float highest = 0.0f;

    for (int i = 0; i < n; ++i)
    {
        left[(size_t) pos].store (l[i], std::memory_order_relaxed);
        right[(size_t) pos].store (r[i], std::memory_order_relaxed);
        highest = juce::jmax (highest, std::abs (l[i]), std::abs (r[i]));
        pos = (pos + 1) & (size - 1);
    }

    writePos.store (pos, std::memory_order_release);
    auto cur = peak.load (std::memory_order_relaxed);
    while (highest > cur && ! peak.compare_exchange_weak (cur, highest, std::memory_order_relaxed)) {}
}

void FxScope::read (std::vector<float>& l, std::vector<float>& r, int n) const
{
    n = juce::jlimit (0, size, n);
    l.resize ((size_t) n);
    r.resize ((size_t) n);
    int pos = (writePos.load (std::memory_order_acquire) - n) & (size - 1);

    for (int i = 0; i < n; ++i)
    {
        l[(size_t) i] = left[(size_t) pos].load (std::memory_order_relaxed);
        r[(size_t) i] = right[(size_t) pos].load (std::memory_order_relaxed);
        pos = (pos + 1) & (size - 1);
    }
}

//==============================================================================
StudioFxPlugin::StudioFxPlugin (te::PluginCreationInfo info, std::vector<FxParam> specs, bool followsTempo)
    : te::Plugin (info)
{
    auto* um = getUndoManager();

    for (auto& s : specs)
    {
        auto cv = std::make_unique<juce::CachedValue<float>>();
        cv->referTo (state, juce::Identifier (s.id), um, s.def);

        juce::NormalisableRange<float> range (s.min, s.max);

        if (! s.choices.isEmpty())
            range.interval = 1.0f;
        else if (s.centre > s.min && s.centre < s.max)
            range.setSkewForCentre (s.centre);

        const String unit (s.unit);
        const auto choices = s.choices;
        const float span = s.max - s.min;

        auto toText = [unit, choices, span] (float v) -> String
        {
            if (! choices.isEmpty())
                return choices[juce::jlimit (0, choices.size() - 1, juce::roundToInt (v))];

            const int decimals = span >= 100.0f ? 0 : span >= 10.0f ? 1 : 2;
            return String (v, decimals) + (unit.isEmpty() ? String() : " " + unit);
        };

        auto fromText = [choices] (const String& t) -> float
        {
            return choices.isEmpty() ? t.getFloatValue() : (float) juce::jmax (0, choices.indexOf (t));
        };

        te::AutomatableParameter::Ptr p = addParam (s.id, s.name, range, toText, fromText);
        p->attachToCurrentValue (*cv);
        params.push_back (p);
        values.push_back (std::move (cv));
    }

    if (followsTempo)
    {
        timerCallback();
        startTimerHz (4);
    }
}

StudioFxPlugin::~StudioFxPlugin()
{
    stopTimer();
    notifyListenersOfDeletion();

    for (auto& p : params)
        p->detachFromCurrentValue();
}

void StudioFxPlugin::timerCallback()
{
    bpm = edit.tempoSequence.getBpmAt (edit.getTransport().getPosition());
}

void StudioFxPlugin::initialise (const te::PluginInitialisationInfo& info)
{
    sampleRate = info.sampleRate > 0 ? info.sampleRate : 48000.0;
    blockSize = juce::jmax (32, info.blockSizeSamples);
    scratch.assign ((size_t) juce::jmax (blockSize, 8192), 0.0f);
    prepare();
    clear();
}

void StudioFxPlugin::applyToBuffer (const te::PluginRenderContext& fc)
{
    if (fc.destBuffer == nullptr || fc.bufferNumSamples <= 0)
        return;

    SCOPED_REALTIME_CHECK

    auto& buffer = *fc.destBuffer;
    const int channels = buffer.getNumChannels();

    if (channels == 0)
        return;

    float* left = buffer.getWritePointer (0, fc.bufferStartSample);

    if (channels > 1)
    {
        run (left, buffer.getWritePointer (1, fc.bufferStartSample), fc.bufferNumSamples);
        return;
    }

    const int n = juce::jmin (fc.bufferNumSamples, (int) scratch.size());
    std::copy (left, left + n, scratch.data());
    run (left, scratch.data(), n);

    for (int i = 0; i < n; ++i)
        left[i] = 0.5f * (left[i] + scratch[(size_t) i]);
}

void StudioFxPlugin::run (float* left, float* right, int n)
{
    // About −80 dBFS. Quieter than this is silence: a flat EQ must not turn a dirty or
    // foreign buffer into a steady level, and the meters must not paint that floor.
    constexpr float silence = 1.0e-4f;
    bool audible = false;

    for (int i = 0; i < n && ! audible; ++i)
        audible = std::abs (left[i]) >= silence || std::abs (right[i]) >= silence;

    if (! audible && ! hasTail())
    {
        juce::FloatVectorOperations::clear (left, n);
        juce::FloatVectorOperations::clear (right, n);
    }
    else
    {
        inputScope.push (left, right, n);
        process (left, right, n);
        outputScope.push (left, right, n);
        return;
    }

    inputScope.push (left, right, n);
    outputScope.push (left, right, n);
}

void StudioFxPlugin::processOffline (juce::AudioBuffer<float>& buffer, double rate)
{
    jassert (buffer.getNumChannels() == 2);
    sampleRate = rate;
    blockSize = 512;
    scratch.assign (8192, 0.0f);
    prepare();
    clear();

    for (int start = 0; start < buffer.getNumSamples(); start += blockSize)
        run (buffer.getWritePointer (0, start), buffer.getWritePointer (1, start),
             juce::jmin (blockSize, buffer.getNumSamples() - start));
}

//==============================================================================
namespace
{
    /** Magnitude spectrum of the newest 4096 samples as dBFS at log-spaced points from 20 Hz to 20 kHz. */
    juce::Array<var> spectrumOf (const FxScope& scope, double sampleRate, int points)
    {
        constexpr int order = 12, size = 1 << order;
        std::vector<float> l, r;
        scope.read (l, r, size);

        std::vector<float> data ((size_t) size * 2, 0.0f);

        for (int i = 0; i < size; ++i)
        {
            const float w = 0.5f - 0.5f * std::cos (2.0f * pi * (float) i / (float) (size - 1));
            data[(size_t) i] = 0.5f * (l[(size_t) i] + r[(size_t) i]) * w;
        }

        juce::dsp::FFT fft (order);
        fft.performFrequencyOnlyForwardTransform (data.data(), true);

        const double binHz = sampleRate / size;
        const float norm = 4.0f / (float) size;
        juce::Array<var> out;
        out.ensureStorageAllocated (points);

        for (int p = 0; p < points; ++p)
        {
            const double lo = 20.0 * std::pow (1000.0, (double) p / points);
            const double hi = 20.0 * std::pow (1000.0, (double) (p + 1) / points);
            const int b0 = juce::jlimit (1, size / 2 - 1, (int) std::floor (lo / binHz));
            const int b1 = juce::jlimit (b0, size / 2 - 1, (int) std::ceil (hi / binHz));
            float mag = 0.0f;

            for (int b = b0; b <= b1; ++b)
                mag = juce::jmax (mag, data[(size_t) b]);

            out.add (juce::roundToInt (juce::jmax (-120.0f, gainToDb (mag * norm)) * 10.0f) / 10.0);
        }

        return out;
    }

    double rounded (double v, double step = 0.01)       { return std::round (v / step) * step; }
}

var StudioFxPlugin::getTelemetry (bool spectrum, bool scope)
{
    auto* o = new juce::DynamicObject();
    var result (o);
    constexpr float silence = 1.0e-4f;      // −80 dBFS, meters
    constexpr float audible = 0.003162f;    // −50 dBFS, analyser. Hiss below this must not draw a wave.
    const float inPeak = inputScope.takePeak();
    const float outPeak = outputScope.takePeak();
    o->setProperty ("sampleRate", sampleRate);
    o->setProperty ("inDb", inPeak < silence ? -120.0 : rounded (gainToDb (inPeak), 0.1));
    o->setProperty ("outDb", outPeak < silence ? -120.0 : rounded (gainToDb (outPeak), 0.1));

    if (spectrum)
    {
        o->setProperty ("spectrumIn", inPeak < audible ? var (juce::Array<var>()) : var (spectrumOf (inputScope, sampleRate, 160)));
        o->setProperty ("spectrumOut", outPeak < audible ? var (juce::Array<var>()) : var (spectrumOf (outputScope, sampleRate, 160)));
    }

    if (scope)
    {
        std::vector<float> l, r;
        outputScope.read (l, r, 1024);
        juce::Array<var> left, right;
        double lr = 0.0, ll = 0.0, rr = 0.0;

        for (size_t i = 0; i < l.size(); ++i)
        {
            lr += l[i] * r[i];
            ll += l[i] * l[i];
            rr += r[i] * r[i];

            if (i % 2 == 0)
            {
                left.add (rounded (l[i], 0.001));
                right.add (rounded (r[i], 0.001));
            }
        }

        o->setProperty ("scopeL", left);
        o->setProperty ("scopeR", right);
        o->setProperty ("correlation", ll > 1.0e-9 && rr > 1.0e-9 ? rounded (lr / std::sqrt (ll * rr)) : 1.0);
    }

    addTelemetry (*o);
    return result;
}

//==============================================================================
namespace
{
    enum TuneParam { tuneKey, tuneScale, tuneSpeed, tuneAmount, tuneTolerance, tuneMix };

    const int scaleMasks[] = {
        0xfff,                                                                  // chromatic
        (1 << 0) | (1 << 2) | (1 << 4) | (1 << 5) | (1 << 7) | (1 << 9) | (1 << 11),   // major
        (1 << 0) | (1 << 2) | (1 << 3) | (1 << 5) | (1 << 7) | (1 << 8) | (1 << 10),   // natural minor
        (1 << 0) | (1 << 2) | (1 << 3) | (1 << 5) | (1 << 7) | (1 << 8) | (1 << 11),   // harmonic minor
        (1 << 0) | (1 << 2) | (1 << 4) | (1 << 7) | (1 << 9),                          // major pentatonic
        (1 << 0) | (1 << 3) | (1 << 5) | (1 << 7) | (1 << 10),                         // minor pentatonic
        (1 << 0) | (1 << 3) | (1 << 5) | (1 << 6) | (1 << 7) | (1 << 10),              // blues
        (1 << 0) | (1 << 2) | (1 << 3) | (1 << 5) | (1 << 7) | (1 << 9) | (1 << 10),   // dorian
        (1 << 0) | (1 << 2) | (1 << 4) | (1 << 5) | (1 << 7) | (1 << 9) | (1 << 10),   // mixolydian
    };
}

TunePlugin::TunePlugin (te::PluginCreationInfo info)
    : StudioFxPlugin (info, {
          { "key", "Key", 0, 11, 0, "", 0, noteNames },
          { "scale", "Scale", 0, 8, 1, "", 0, { "Chromatic", "Major", "Minor", "Harmonic minor", "Major pentatonic",
                                                 "Minor pentatonic", "Blues", "Dorian", "Mixolydian" } },
          { "speed", "Retune speed", 0, 400, 20, "ms", 60 },
          { "amount", "Amount", 0, 100, 100, "%" },
          { "tolerance", "Tolerance", 0, 50, 0, "cents" },
          { "mix", "Mix", 0, 100, 100, "%" } })
{
}

int TunePlugin::nearestScaleNote (float midi, int key, int scale)
{
    const int mask = scaleMasks[juce::jlimit (0, (int) std::size (scaleMasks) - 1, scale)];
    const int centre = juce::roundToInt (midi);
    int best = centre;
    float bestDistance = 1.0e9f;

    for (int n = centre - 6; n <= centre + 6; ++n)
    {
        const int degree = ((n - key) % 12 + 12) % 12;

        if ((mask & (1 << degree)) != 0 && std::abs ((float) n - midi) < bestDistance)
        {
            bestDistance = std::abs ((float) n - midi);
            best = n;
        }
    }

    return best;
}

void TunePlugin::prepare()
{
    analysis.assign (window, 0.0f);
    diff.assign (window / 2, 0.0f);
    windowLength = windowTarget = (float) (0.024 * sampleRate);
    delayL.assign ((size_t) (0.1 * sampleRate) + 8, 0.0f);
    delayR.assign (delayL.size(), 0.0f);
}

void TunePlugin::clear()
{
    std::fill (analysis.begin(), analysis.end(), 0.0f);
    std::fill (delayL.begin(), delayL.end(), 0.0f);
    std::fill (delayR.begin(), delayR.end(), 0.0f);
    analysisFill = decimCount = sinceHop = writePos = 0;
    decimAcc = lowpass = 0.0f;
    phase = 0.0;
    ratio = targetRatio = 1.0f;
    detectedNote = 0.0f;
}

void TunePlugin::analyse()
{
    const double rate = sampleRate / decimation;
    const int tauMin = juce::jmax (2, (int) (rate / 1100.0));
    const int tauMax = juce::jmin (window / 2 - 2, (int) (rate / 65.0));
    const int span = window - tauMax;

    float energy = 0.0f;

    for (int j = 0; j < window; ++j)
        energy += analysis[(size_t) j] * analysis[(size_t) j];

    if (energy / window < 1.0e-6f)   // quieter than about -60 dBFS: nothing to tune
    {
        detectedNote = targetNote = 0.0f;
        targetRatio = 1.0f;
        return;
    }

    diff[0] = 1.0f;
    float running = 0.0f;

    for (int tau = 1; tau <= tauMax; ++tau)
    {
        float d = 0.0f;

        for (int j = 0; j < span; ++j)
        {
            const float delta = analysis[(size_t) j] - analysis[(size_t) (j + tau)];
            d += delta * delta;
        }

        running += d;
        diff[(size_t) tau] = running > 0.0f ? d * (float) tau / running : 1.0f;
    }

    int found = -1;

    for (int tau = tauMin; tau < tauMax; ++tau)
    {
        if (diff[(size_t) tau] < 0.15f)
        {
            while (tau + 1 < tauMax && diff[(size_t) tau + 1] < diff[(size_t) tau])
                ++tau;

            found = tau;
            break;
        }
    }

    if (found < 0)
    {
        detectedNote = targetNote = 0.0f;
        targetRatio = 1.0f;
        return;
    }

    float tau = (float) found;
    const float a = diff[(size_t) found - 1], b = diff[(size_t) found], c = diff[(size_t) found + 1];
    const float denom = a - 2.0f * b + c;

    if (std::abs (denom) > 1.0e-9f)
        tau += 0.5f * (a - c) / denom;

    const float freq = (float) rate / tau;
    const float midi = 69.0f + 12.0f * std::log2 (freq / 440.0f);
    detectedNote = midi;

    // Keeping the two read heads a whole number of periods apart stops them comb-filtering a sung note.
    const float period = (float) sampleRate / freq;
    const float half = period * juce::jmax (1.0f, std::round ((float) (0.012 * sampleRate) / period));
    windowTarget = juce::jlimit ((float) (0.008 * sampleRate), (float) delayL.size() * 0.6f, 2.0f * half);

    const int target = nearestScaleNote (midi, choice (tuneKey), choice (tuneScale));
    targetNote = (float) target;
    float shift = (float) target - midi;

    if (std::abs (shift) * 100.0f < value (tuneTolerance))
        shift = 0.0f;

    shift *= value (tuneAmount) / 100.0f;
    targetRatio = std::pow (2.0f, shift / 12.0f);
}

void TunePlugin::process (float* left, float* right, int numSamples)
{
    if (delayL.empty())
        return;

    const float speed = coef (sampleRate, value (tuneSpeed));
    const float wet = value (tuneMix) / 100.0f;
    const int size = (int) delayL.size();

    for (int i = 0; i < numSamples; ++i)
    {
        const float l = left[i], r = right[i];

        // Pitch detection runs at a quarter of the sample rate on a gently low-passed mono signal.
        lowpass += 0.3f * (0.5f * (l + r) - lowpass);

        if (++decimCount >= decimation)
        {
            decimCount = 0;
            analysis[(size_t) analysisFill++] = lowpass;

            if (analysisFill == window)
            {
                analyse();
                std::memmove (analysis.data(), analysis.data() + hop, sizeof (float) * (window - hop));
                analysisFill = window - hop;
            }
        }

        ratio += (targetRatio - ratio) * speed;
        windowLength += (windowTarget - windowLength) * 0.0005f;

        // Two read heads sweep through a short delay at a speed set by the pitch ratio, crossfading so neither jump is heard.
        delayL[(size_t) writePos] = l;
        delayR[(size_t) writePos] = r;

        phase += (1.0 - ratio) / windowLength;
        phase -= std::floor (phase);

        const double phase2 = std::fmod (phase + 0.5, 1.0);
        const float d1 = 1.0f + (float) phase * windowLength, d2 = 1.0f + (float) phase2 * windowLength;
        const float w1 = std::sin (pi * (float) phase), w2 = std::sin (pi * (float) phase2);
        const float g1 = w1 * w1, g2 = w2 * w2;

        const float outL = readFrac (delayL, writePos, d1) * g1 + readFrac (delayL, writePos, d2) * g2;
        const float outR = readFrac (delayR, writePos, d1) * g1 + readFrac (delayR, writePos, d2) * g2;

        writePos = (writePos + 1) % size;

        left[i] = l + (outL - l) * wet;
        right[i] = r + (outR - r) * wet;
    }

    ratioNow.store (ratio, std::memory_order_relaxed);
}

void TunePlugin::addTelemetry (juce::DynamicObject& o)
{
    o.setProperty ("detectedNote", rounded (detectedNote.load()));
    o.setProperty ("targetNote", targetNote.load());
    o.setProperty ("correctionCents", rounded (1200.0 * std::log2 (juce::jmax (0.01f, ratioNow.load())), 0.1));
    o.setProperty ("scaleMask", scaleMasks[juce::jlimit (0, (int) std::size (scaleMasks) - 1, choice (tuneScale))]);
}

//==============================================================================
GatePlugin::GatePlugin (te::PluginCreationInfo info)
    : StudioFxPlugin (info, {
          { "threshold", "Threshold", -80, 0, -45, "dB" },
          { "range", "Range", -90, 0, -60, "dB" },
          { "attack", "Attack", 0.05f, 50, 1, "ms", 5 },
          { "hold", "Hold", 0, 500, 40, "ms", 80 },
          { "release", "Release", 5, 2000, 120, "ms", 200 } })
{
}

void GatePlugin::process (float* left, float* right, int numSamples)
{
    const float open = dbToGain (value (0)), close = open * 0.7f;
    const float floor = dbToGain (value (1));
    const float attack = coef (sampleRate, value (2)), release = coef (sampleRate, value (4));
    const float envRelease = coef (sampleRate, 10.0);
    const int holdSamples = (int) (value (3) * 0.001 * sampleRate);

    for (int i = 0; i < numSamples; ++i)
    {
        const float peak = juce::jmax (std::abs (left[i]), std::abs (right[i]));
        env = follow (env, peak, 1.0f, envRelease);

        if (env > open)
            holdLeft = holdSamples + 1;
        else if (env < close && holdLeft > 0)
            --holdLeft;

        const float target = holdLeft > 0 ? 1.0f : floor;
        gain += (target - gain) * (target > gain ? attack : release);
        left[i] *= gain;
        right[i] *= gain;
    }

    levelHold.note (env);
    gainNow.store (gain, std::memory_order_relaxed);
}

void GatePlugin::addTelemetry (juce::DynamicObject& o)
{
    o.setProperty ("levelDb", rounded (gainToDb (levelHold.take()), 0.1));
    o.setProperty ("gainDb", rounded (gainToDb (gainNow.load()), 0.1));
    o.setProperty ("open", holdLeft > 0);
}

//==============================================================================
SaturatorPlugin::SaturatorPlugin (te::PluginCreationInfo info)
    : StudioFxPlugin (info, {
          { "drive", "Drive", 0, 36, 6, "dB" },
          { "type", "Character", 0, 3, 0, "", 0, { "Tape", "Tube", "Hard clip", "Fuzz" } },
          { "tone", "Tone", -100, 100, 0, "%" },
          { "output", "Output", -24, 12, 0, "dB" },
          { "mix", "Mix", 0, 100, 100, "%" } })
{
}

void SaturatorPlugin::process (float* left, float* right, int numSamples)
{
    const float drive = dbToGain (value (0));
    const int type = choice (1);
    const float tilt = value (2) / 100.0f;
    const float makeup = dbToGain (value (3)) / std::sqrt (drive);
    const float wet = value (4) / 100.0f;
    const float toneCoef = cutoff (sampleRate, 1800.0);

    auto shape = [type] (float x)
    {
        switch (type)
        {
            case 1:  return x >= 0.0f ? std::tanh (x * 1.2f) / 1.2f : std::tanh (x * 0.8f) * 0.9f / 0.8f;
            case 2:  return juce::jlimit (-1.0f, 1.0f, x);
            case 3:  return (x >= 0.0f ? 1.0f : -1.0f) * (1.0f - std::exp (-3.0f * std::abs (x)));
            default: return std::tanh (x);
        }
    };

    float* ch[2] = { left, right };

    for (int c = 0; c < 2; ++c)
    {
        for (int i = 0; i < numSamples; ++i)
        {
            const float dry = ch[c][i];
            float y = shape (dry * drive);

            lp[c] += toneCoef * (y - lp[c]);
            y += tilt * ((y - lp[c]) - lp[c]) * 0.5f;

            const float blocked = y - dcIn[c] + 0.995f * dc[c];   // removes the offset the asymmetric curve adds
            dcIn[c] = y;
            dc[c] = blocked;

            ch[c][i] = dry + (blocked * makeup - dry) * wet;
        }
    }
}

//==============================================================================
StereoWidthPlugin::StereoWidthPlugin (te::PluginCreationInfo info)
    : StudioFxPlugin (info, {
          { "width", "Width", 0, 200, 120, "%" },
          { "bassMono", "Mono below", 0, 500, 120, "Hz" },
          { "output", "Output", -12, 12, 0, "dB" } })
{
}

void StereoWidthPlugin::process (float* left, float* right, int numSamples)
{
    const float width = value (0) / 100.0f;
    const float monoHz = value (1);
    const float a = monoHz > 1.0f ? cutoff (sampleRate, monoHz) : 0.0f;
    const float out = dbToGain (value (2));

    for (int i = 0; i < numSamples; ++i)
    {
        const float mid = 0.5f * (left[i] + right[i]);
        float side = 0.5f * (left[i] - right[i]);

        if (a > 0.0f)
        {
            sideLow += a * (side - sideLow);
            side -= sideLow;
        }

        side *= width;
        left[i] = (mid + side) * out;
        right[i] = (mid - side) * out;
    }
}

//==============================================================================
TremoloPlugin::TremoloPlugin (te::PluginCreationInfo info)
    : StudioFxPlugin (info, {
          { "mode", "Mode", 0, 1, 0, "", 0, { "Tremolo", "Auto-pan" } },
          { "rate", "Rate", 0.1f, 20, 4, "Hz", 3 },
          { "sync", "Sync", 0, 8, 0, "", 0, noteValueNames() },
          { "depth", "Depth", 0, 100, 60, "%" },
          { "shape", "Shape", 0, 2, 0, "", 0, { "Sine", "Triangle", "Square" } } }, true)
{
}

void TremoloPlugin::process (float* left, float* right, int numSamples)
{
    const int sync = choice (2);
    const double hz = sync > 0 ? bpm.load() / 60.0 / delayNotes[sync].beats : (double) value (1);
    const double step = hz / sampleRate;
    const float depth = value (3) / 100.0f;
    const int shape = choice (4);
    const bool pan = choice (0) == 1;

    for (int i = 0; i < numSamples; ++i)
    {
        const float p = (float) phase;
        float lfo = shape == 1 ? 1.0f - std::abs (2.0f * p - 1.0f)
                  : shape == 2 ? juce::jlimit (0.0f, 1.0f, 0.5f + 8.0f * std::sin (2.0f * pi * p))
                               : 0.5f + 0.5f * std::sin (2.0f * pi * p);

        if (pan)
        {
            const float angle = (1.0f + (lfo * 2.0f - 1.0f) * depth) * pi * 0.25f;
            left[i] *= std::cos (angle) * juce::MathConstants<float>::sqrt2;
            right[i] *= std::sin (angle) * juce::MathConstants<float>::sqrt2;
        }
        else
        {
            const float g = 1.0f - depth * (1.0f - lfo);
            left[i] *= g;
            right[i] *= g;
        }

        phase += step;
        phase -= std::floor (phase);
    }

    phaseNow.store ((float) phase, std::memory_order_relaxed);
}

void TremoloPlugin::addTelemetry (juce::DynamicObject& o)
{
    const int sync = choice (2);
    o.setProperty ("phase", rounded (phaseNow.load(), 0.001));
    o.setProperty ("rateHz", rounded (sync > 0 ? bpm.load() / 60.0 / delayNotes[sync].beats : (double) value (1)));
}

//==============================================================================
BitCrusherPlugin::BitCrusherPlugin (te::PluginCreationInfo info)
    : StudioFxPlugin (info, {
          { "bits", "Bits", 1, 16, 8 },
          { "downsample", "Downsample", 1, 40, 4, "x", 8 },
          { "mix", "Mix", 0, 100, 100, "%" },
          { "output", "Output", -24, 12, 0, "dB" } })
{
}

void BitCrusherPlugin::process (float* left, float* right, int numSamples)
{
    const float steps = std::pow (2.0f, value (0) - 1.0f);
    const float factor = juce::jmax (1.0f, value (1));
    const float wet = value (2) / 100.0f;
    const float out = dbToGain (value (3));

    for (int i = 0; i < numSamples; ++i)
    {
        counter += 1.0f;

        if (counter >= factor)
        {
            counter -= factor;
            held[0] = std::round (left[i] * steps) / steps;
            held[1] = std::round (right[i] * steps) / steps;
        }

        left[i] = (left[i] + (held[0] - left[i]) * wet) * out;
        right[i] = (right[i] + (held[1] - right[i]) * wet) * out;
    }
}

//==============================================================================
TransientShaperPlugin::TransientShaperPlugin (te::PluginCreationInfo info)
    : StudioFxPlugin (info, {
          { "attack", "Attack", -100, 100, 0, "%" },
          { "sustain", "Sustain", -100, 100, 0, "%" },
          { "output", "Output", -12, 12, 0, "dB" } })
{
}

void TransientShaperPlugin::process (float* left, float* right, int numSamples)
{
    const float attackAmount = value (0) / 100.0f, sustainAmount = value (1) / 100.0f;
    const float out = dbToGain (value (2));
    const float quickA = coef (sampleRate, 0.5), slowA = coef (sampleRate, 25.0);
    const float shortR = coef (sampleRate, 40.0), longR = coef (sampleRate, 300.0);

    for (int i = 0; i < numSamples; ++i)
    {
        const float peak = juce::jmax (std::abs (left[i]), std::abs (right[i]));
        fast = follow (fast, peak, quickA, shortR);
        slow = follow (slow, peak, slowA, shortR);
        hold = follow (hold, peak, quickA, longR);
        quick = follow (quick, peak, quickA, shortR);

        const float onset = gainToDb (fast + 1.0e-6f) - gainToDb (slow + 1.0e-6f);   // > 0 at hits
        const float tail = gainToDb (hold + 1.0e-6f) - gainToDb (quick + 1.0e-6f);   // > 0 as notes ring out
        const float shapeDb = juce::jlimit (-24.0f, 24.0f, 0.8f * (attackAmount * onset + sustainAmount * tail));
        const float g = dbToGain (shapeDb) * out;

        boostHold.note (shapeDb);
        cutHold.note (-shapeDb);
        left[i] *= g;
        right[i] *= g;
    }
}

void TransientShaperPlugin::addTelemetry (juce::DynamicObject& o)
{
    o.setProperty ("boostDb", rounded (boostHold.take(), 0.1));
    o.setProperty ("cutDb", rounded (cutHold.take(), 0.1));
}

//==============================================================================
DoublerPlugin::DoublerPlugin (te::PluginCreationInfo info)
    : StudioFxPlugin (info, {
          { "detune", "Detune", 0, 40, 12, "cents" },
          { "delay", "Delay", 5, 60, 18, "ms" },
          { "width", "Width", 0, 100, 100, "%" },
          { "mix", "Mix", 0, 100, 50, "%" } })
{
}

void DoublerPlugin::prepare()
{
    line.assign ((size_t) (0.16 * sampleRate) + 8, 0.0f);
}

void DoublerPlugin::clear()
{
    std::fill (line.begin(), line.end(), 0.0f);
    writePos = 0;
}

void DoublerPlugin::process (float* left, float* right, int numSamples)
{
    if (line.empty())
        return;

    const float base = value (1) * 0.001f * (float) sampleRate;
    const float width = value (2) / 100.0f;
    const float wet = value (3) / 100.0f * 0.8f;
    const double rates[2] { 0.61, 0.43 };
    float depth[2];

    // A delay swept by a sine at f Hz with depth D samples bends pitch by about 1731 * 2πfD / sr cents.
    for (int v = 0; v < 2; ++v)
        depth[v] = (float) (value (0) / 1731.0 * sampleRate / (2.0 * juce::MathConstants<double>::pi * rates[v]));

    const int size = (int) line.size();
    const float maxDelay = (float) size - 4.0f;

    for (int i = 0; i < numSamples; ++i)
    {
        line[(size_t) writePos] = 0.5f * (left[i] + right[i]);
        float voice[2];

        for (int v = 0; v < 2; ++v)
        {
            const float d = juce::jlimit (1.0f, maxDelay, base * (v == 0 ? 1.0f : 1.37f) + depth[v] * (1.0f + (float) std::sin (2.0 * juce::MathConstants<double>::pi * lfo[v])));
            voice[v] = readFrac (line, writePos, d);
            lfo[v] += rates[v] / sampleRate;
            lfo[v] -= std::floor (lfo[v]);
        }

        writePos = (writePos + 1) % size;

        const float l0 = 0.5f * (1.0f + width), r0 = 0.5f * (1.0f - width);
        left[i] += wet * (voice[0] * l0 + voice[1] * r0);
        right[i] += wet * (voice[0] * r0 + voice[1] * l0);
    }
}

//==============================================================================
StereoDelayPlugin::StereoDelayPlugin (te::PluginCreationInfo info)
    : StudioFxPlugin (info, {
          { "sync", "Sync", 0, 8, 6, "", 0, noteValueNames() },
          { "time", "Time (free)", 1, 2000, 350, "ms", 300 },
          { "feedback", "Feedback", 0, 95, 35, "%" },
          { "pingPong", "Ping-pong", 0, 1, 1, "", 0, offOn },
          { "lowCut", "Low cut", 20, 2000, 150, "Hz", 300 },
          { "highCut", "High cut", 1000, 20000, 7000, "Hz", 5000 },
          { "mix", "Mix", 0, 100, 25, "%" } }, true)
{
}

void StereoDelayPlugin::prepare()
{
    for (auto& l : line)
        l.assign ((size_t) (2.6 * sampleRate) + 8, 0.0f);
}

void StereoDelayPlugin::clear()
{
    for (auto& l : line)
        std::fill (l.begin(), l.end(), 0.0f);

    writePos = 0;
    lowState[0] = lowState[1] = highState[0] = highState[1] = 0.0f;
    smoothedDelay = 0.0f;
}

void StereoDelayPlugin::process (float* left, float* right, int numSamples)
{
    if (line[0].empty())
        return;

    const int sync = choice (0);
    const double seconds = sync > 0 ? delayNotes[sync].beats * 60.0 / bpm.load() : value (1) * 0.001;
    const int size = (int) line[0].size();
    const float target = juce::jlimit (1.0f, (float) size - 4.0f, (float) (seconds * sampleRate));
    const float feedback = value (2) / 100.0f;
    const bool pingPong = choice (3) == 1;
    const float lowA = cutoff (sampleRate, value (4)), highA = cutoff (sampleRate, value (5));
    const float wet = value (6) / 100.0f;

    if (smoothedDelay <= 0.0f)
        smoothedDelay = target;

    for (int i = 0; i < numSamples; ++i)
    {
        smoothedDelay += (target - smoothedDelay) * 0.0005f;
        float tap[2];

        for (int c = 0; c < 2; ++c)
        {
            const float x = readFrac (line[c], writePos, smoothedDelay);
            highState[c] += lowA * (x - highState[c]);
            lowState[c] += highA * ((x - highState[c]) - lowState[c]);
            tap[c] = lowState[c];
        }

        if (pingPong)
        {
            line[0][(size_t) writePos] = 0.5f * (left[i] + right[i]) + tap[1] * feedback;
            line[1][(size_t) writePos] = tap[0] * feedback;
        }
        else
        {
            line[0][(size_t) writePos] = left[i] + tap[0] * feedback;
            line[1][(size_t) writePos] = right[i] + tap[1] * feedback;
        }

        writePos = (writePos + 1) % size;
        left[i] += tap[0] * wet;
        right[i] += tap[1] * wet;
    }

    delayMs.store ((float) (smoothedDelay / sampleRate * 1000.0), std::memory_order_relaxed);
}

void StereoDelayPlugin::addTelemetry (juce::DynamicObject& o)
{
    const int sync = choice (0);
    o.setProperty ("delayMs", rounded (sync > 0 ? delayNotes[sync].beats * 60000.0 / bpm.load() : (double) value (1), 0.1));
    o.setProperty ("bpm", rounded (bpm.load(), 0.1));
}

//==============================================================================
DeEsserPlugin::DeEsserPlugin (te::PluginCreationInfo info)
    : StudioFxPlugin (info, {
          { "frequency", "Frequency", 2000, 12000, 6000, "Hz", 5500 },
          { "threshold", "Threshold", -60, 0, -30, "dB" },
          { "range", "Max reduction", 0, 24, 10, "dB" },
          { "listen", "Listen to S", 0, 1, 0, "", 0, offOn } })
{
}

void DeEsserPlugin::clear()
{
    for (auto& f : split)
        f.reset();

    detector.reset();
    env = 0.0f;
    lastFreq = -1.0f;
}

void DeEsserPlugin::process (float* left, float* right, int numSamples)
{
    const float freq = value (0);

    if (std::abs (freq - lastFreq) > 1.0f)
    {
        for (auto& f : split)
            f.highPass (sampleRate, freq);

        detector.highPass (sampleRate, freq);
        lastFreq = freq;
    }

    const float threshold = value (1), range = value (2);
    const bool listen = choice (3) == 1;
    const float attack = coef (sampleRate, 1.0), release = coef (sampleRate, 60.0);
    float* ch[2] = { left, right };

    for (int i = 0; i < numSamples; ++i)
    {
        env = follow (env, std::abs (detector.process (0.5f * (left[i] + right[i]))), attack, release);
        const float reduction = juce::jlimit (0.0f, range, gainToDb (env) - threshold);
        const float g = dbToGain (-reduction);
        reductionHold.note (reduction);

        for (int c = 0; c < 2; ++c)
        {
            const float x = ch[c][i];
            const float high = split[c].process (x);
            ch[c][i] = listen ? high * g : (x - high) + high * g;
        }
    }

    sibilanceHold.note (env);
}

void DeEsserPlugin::addTelemetry (juce::DynamicObject& o)
{
    o.setProperty ("sibilanceDb", rounded (gainToDb (sibilanceHold.take()), 0.1));
    o.setProperty ("reductionDb", rounded (reductionHold.take(), 0.1));
}

//==============================================================================
namespace
{
    std::vector<FxParam> eqParams()
    {
        const juce::StringArray types { "Low cut", "Low shelf", "Bell", "Notch", "High shelf", "High cut" };
        const juce::StringArray slopes { "12 dB/oct", "24 dB/oct", "36 dB/oct", "48 dB/oct" };
        struct Default { float on, type, freq, q; };
        const Default defaults[EqPlugin::numBands] {
            { 0, Biquad::lowCut, 40, 0.71f }, { 1, Biquad::lowShelf, 100, 0.71f }, { 1, Biquad::bell, 250, 1.0f }, { 1, Biquad::bell, 700, 1.0f },
            { 1, Biquad::bell, 2000, 1.0f }, { 1, Biquad::bell, 5000, 1.0f }, { 1, Biquad::highShelf, 10000, 0.71f }, { 0, Biquad::highCut, 18000, 0.71f } };

        std::vector<FxParam> p;

        for (int b = 0; b < EqPlugin::numBands; ++b)
        {
            const String n (b + 1), prefix ("b" + n);
            const auto& d = defaults[b];
            p.push_back ({ prefix + "on",    "Band " + n + " on",    0, 1, d.on, "", 0, offOn });
            p.push_back ({ prefix + "type",  "Band " + n + " type",  0, 5, d.type, "", 0, types });
            p.push_back ({ prefix + "freq",  "Band " + n + " freq",  20, 20000, d.freq, "Hz", 1000 });
            p.push_back ({ prefix + "gain",  "Band " + n + " gain",  -24, 24, 0, "dB" });
            p.push_back ({ prefix + "q",     "Band " + n + " Q",     0.1f, 18, d.q, "", 1 });
            p.push_back ({ prefix + "slope", "Band " + n + " slope", 0, 3, 0, "", 0, slopes });
        }

        p.push_back ({ "output", "Output", -24, 24, 0, "dB" });
        return p;
    }
}

EqPlugin::EqPlugin (te::PluginCreationInfo info)
    : StudioFxPlugin (info, eqParams())
{
}

void EqPlugin::clear()
{
    for (auto& b : bands)
    {
        for (auto& ch : b.stages)
            for (auto& s : ch)
                s.reset();

        b.freq = -1.0f;
    }
}

void EqPlugin::process (float* left, float* right, int numSamples)
{
    float* ch[2] = { left, right };

    for (int b = 0; b < numBands; ++b)
    {
        const int base = b * paramsPerBand;

        if (choice (base + on) == 0)
            continue;

        auto& band = bands[(size_t) b];
        const int type = choice (base + EqPlugin::type);
        const float f = value (base + freq), g = value (base + gain), qv = value (base + q);
        const bool cut = type == Biquad::lowCut || type == Biquad::highCut;
        const int stages = cut ? juce::jlimit (1, maxStages, choice (base + slope) + 1) : 1;

        if (! cut && type != Biquad::notch && std::abs (g) < 0.01f)
            continue;

        if (type != band.type || f != band.freq || g != band.gain || qv != band.q || stages != band.numStages || sampleRate != band.rate)
        {
            if (type != band.type || stages != band.numStages)
                for (auto& c : band.stages)
                    for (auto& s : c)
                        s.reset();

            for (auto& c : band.stages)
                for (int s = 0; s < stages; ++s)
                {
                    const auto keep1 = c[s].s1, keep2 = c[s].s2;
                    c[s].design (type, sampleRate, f, g, qv);
                    c[s].s1 = keep1;
                    c[s].s2 = keep2;
                }

            band.type = type; band.freq = f; band.gain = g; band.q = qv; band.numStages = stages; band.rate = sampleRate;
        }

        for (int c = 0; c < 2; ++c)
            for (int s = 0; s < stages; ++s)
            {
                auto& filter = band.stages[c][s];

                for (int i = 0; i < numSamples; ++i)
                    ch[c][i] = filter.process (ch[c][i]);
            }
    }

    const float out = dbToGain (value (numBands * paramsPerBand));

    if (std::abs (out - 1.0f) > 1.0e-4f)
        for (int c = 0; c < 2; ++c)
            juce::FloatVectorOperations::multiply (ch[c], out, numSamples);
}

//==============================================================================
namespace
{
    enum CompParam { compThreshold, compRatio, compKnee, compAttack, compRelease, compMakeup, compAuto, compDetect, compHpf, compMix };
}

CompressorFx::CompressorFx (te::PluginCreationInfo info)
    : StudioFxPlugin (info, {
          { "threshold", "Threshold", -60, 0, -18, "dB" },
          { "ratio", "Ratio", 1, 20, 4, ": 1", 4 },
          { "knee", "Knee", 0, 24, 6, "dB" },
          { "attack", "Attack", 0.05f, 200, 10, "ms", 10 },
          { "release", "Release", 5, 2000, 120, "ms", 150 },
          { "makeup", "Make-up", -12, 24, 0, "dB" },
          { "autoMakeup", "Auto make-up", 0, 1, 0, "", 0, offOn },
          { "detect", "Detection", 0, 1, 1, "", 0, { "Peak", "RMS" } },
          { "scHpf", "Sidechain HPF", 20, 500, 20, "Hz", 100 },
          { "mix", "Mix", 0, 100, 100, "%" } })
{
}

float CompressorFx::staticGainDb (float level, float threshold, float ratio, float knee)
{
    const float slope = 1.0f / juce::jmax (1.0f, ratio) - 1.0f;
    const float over = level - threshold;

    if (knee > 0.0f && 2.0f * std::abs (over) <= knee)
        return slope * (over + knee * 0.5f) * (over + knee * 0.5f) / (2.0f * knee);

    return over > 0.0f ? slope * over : 0.0f;
}

void CompressorFx::clear()
{
    sidechain.reset();
    lastHpf = -1.0f;
    meanSquare = reduction = 0.0f;
}

void CompressorFx::process (float* left, float* right, int numSamples)
{
    const float hpf = value (compHpf);

    if (hpf != lastHpf)
    {
        sidechain.highPass (sampleRate, hpf);
        lastHpf = hpf;
    }

    const float threshold = value (compThreshold), ratio = value (compRatio), knee = value (compKnee);
    const float attack = coef (sampleRate, value (compAttack)), release = coef (sampleRate, value (compRelease));
    const float rmsCoef = coef (sampleRate, 10.0);
    const bool rms = choice (compDetect) == 1, filtered = hpf > 21.0f;
    float makeup = value (compMakeup);

    if (choice (compAuto) == 1)
        makeup -= 0.5f * staticGainDb (0.0f, threshold, ratio, knee);

    const float wet = value (compMix) / 100.0f;
    float loudest = 0.0f, deepest = 0.0f;

    for (int i = 0; i < numSamples; ++i)
    {
        const float l = left[i], r = right[i];
        float key = filtered ? sidechain.process (0.5f * (l + r)) : juce::jmax (std::abs (l), std::abs (r));
        float level;

        if (rms)
        {
            meanSquare += (key * key - meanSquare) * rmsCoef;
            level = std::sqrt (meanSquare) * juce::MathConstants<float>::sqrt2;
        }
        else
        {
            level = std::abs (key);
        }

        const float levelDb = gainToDb (level);
        const float target = staticGainDb (levelDb, threshold, ratio, knee);
        reduction += (target - reduction) * (target < reduction ? attack : release);

        const float g = dbToGain (reduction + makeup);
        left[i] = l + (l * g - l) * wet;
        right[i] = r + (r * g - r) * wet;

        loudest = juce::jmax (loudest, level);
        deepest = juce::jmax (deepest, -reduction);
    }

    levelHold.note (loudest);
    reductionHold.note (deepest);
}

void CompressorFx::addTelemetry (juce::DynamicObject& o)
{
    o.setProperty ("levelDb", rounded (gainToDb (levelHold.take()), 0.1));
    o.setProperty ("grDb", rounded (reductionHold.take(), 0.1));
}

//==============================================================================
void registerStudioEffects (te::PluginManager& pm)
{
    pm.createBuiltInType<TunePlugin>();
    pm.createBuiltInType<GatePlugin>();
    pm.createBuiltInType<SaturatorPlugin>();
    pm.createBuiltInType<StereoWidthPlugin>();
    pm.createBuiltInType<TremoloPlugin>();
    pm.createBuiltInType<BitCrusherPlugin>();
    pm.createBuiltInType<TransientShaperPlugin>();
    pm.createBuiltInType<DoublerPlugin>();
    pm.createBuiltInType<StereoDelayPlugin>();
    pm.createBuiltInType<DeEsserPlugin>();
    pm.createBuiltInType<EqPlugin>();
    pm.createBuiltInType<CompressorFx>();
}

std::vector<std::array<const char*, 3>> studioEffectCatalogue()
{
    return {
        { EqPlugin::xmlTypeName,                EqPlugin::getPluginName(),              "EQ" },
        { CompressorFx::xmlTypeName,            CompressorFx::getPluginName(),          "Dynamics" },
        { TunePlugin::xmlTypeName,              TunePlugin::getPluginName(),            "Pitch" },
        { DeEsserPlugin::xmlTypeName,           DeEsserPlugin::getPluginName(),         "Dynamics" },
        { GatePlugin::xmlTypeName,              GatePlugin::getPluginName(),            "Dynamics" },
        { TransientShaperPlugin::xmlTypeName,   TransientShaperPlugin::getPluginName(), "Dynamics" },
        { SaturatorPlugin::xmlTypeName,         SaturatorPlugin::getPluginName(),       "Saturation" },
        { BitCrusherPlugin::xmlTypeName,        BitCrusherPlugin::getPluginName(),      "Saturation" },
        { StereoDelayPlugin::xmlTypeName,       StereoDelayPlugin::getPluginName(),     "Delay" },
        { DoublerPlugin::xmlTypeName,           DoublerPlugin::getPluginName(),         "Stereo" },
        { StereoWidthPlugin::xmlTypeName,       StereoWidthPlugin::getPluginName(),     "Stereo" },
        { TremoloPlugin::xmlTypeName,           TremoloPlugin::getPluginName(),         "Modulation" },
    };
}
}
