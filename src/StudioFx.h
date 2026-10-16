#pragma once

#include "Common.h"

namespace s3
{
/** One automatable parameter of a Studio 4000 effect. Choices make it a stepped list. */
struct FxParam
{
    String id;
    String name;
    float min, max, def;
    const char* unit = "";
    float centre = 0.0f;                  // skews the slider so this value sits in the middle
    juce::StringArray choices = {};
};

/** Transposed direct form II biquad; coefficients are computed in place, so retuning never allocates. */
struct Biquad
{
    enum Type { lowCut, lowShelf, bell, notch, highShelf, highCut };

    float b0 = 1.0f, b1 = 0.0f, b2 = 0.0f, a1 = 0.0f, a2 = 0.0f, s1 = 0.0f, s2 = 0.0f;

    /** RBJ cookbook designs; the editors draw their curves from the same formulas. */
    void design (int type, double sampleRate, double freq, double gainDb, double q);
    void highPass (double sampleRate, double freq, double q = 0.70710678)   { design (lowCut, sampleRate, freq, 0.0, q); }
    void reset()                    { s1 = s2 = 0.0f; }
    float process (float x)
    {
        const float y = b0 * x + s1;
        s1 = b1 * x - a1 * y + s2;
        s2 = b2 * x - a2 * y;
        return y;
    }
};

/** The most recent stereo audio passing a point in an effect, kept for the editors' displays.
    Written by the audio thread, read by the message thread; relaxed atomics are enough for a picture. */
class FxScope
{
public:
    static constexpr int size = 4096;

    void push (const float* left, const float* right, int numSamples);

    /** Copies the newest numSamples (at most size) of each channel, oldest first. */
    void read (std::vector<float>& left, std::vector<float>& right, int numSamples) const;

    /** Highest absolute sample since the last call. */
    float takePeak()                                    { return peak.exchange (0.0f, std::memory_order_relaxed); }

private:
    std::array<std::atomic<float>, size> left {}, right {};
    std::atomic<int> writePos { 0 };
    std::atomic<float> peak { 0.0f };
};

/** Keeps the largest value written since the last take(); for meters polled slower than the audio runs. */
struct PeakHold
{
    std::atomic<float> value { 0.0f };
    void note (float v)         { auto cur = value.load (std::memory_order_relaxed); while (v > cur && ! value.compare_exchange_weak (cur, v, std::memory_order_relaxed)) {} }
    float take()                { return value.exchange (0.0f, std::memory_order_relaxed); }
};

/** Shared plumbing for the built-in effects: parameters, stereo handling, tempo and live analysis. */
class StudioFxPlugin : public te::Plugin, private juce::Timer
{
public:
    StudioFxPlugin (te::PluginCreationInfo, std::vector<FxParam>, bool followsTempo = false);
    ~StudioFxPlugin() override;

    juce::String getVendor() override                                       { return "Studio 4000"; }
    int getNumOutputChannelsGivenInputs (int) override                      { return 2; }
    BusLayout getBusses() const override                                    { return BusLayout::singleStereoInOut(); }

    void initialise (const te::PluginInitialisationInfo&) override;
    void deinitialise() override                                            {}
    void reset() override                                                   { clear(); }
    void applyToBuffer (const te::PluginRenderContext&) override;

    /** Runs a stereo buffer through the effect outside the playback graph. */
    void processOffline (juce::AudioBuffer<float>&, double sampleRate);

    /** What the editor draws: levels in and out, optional spectra and a stereo scope, plus effect-specific readings. */
    var getTelemetry (bool spectrum, bool scope);

protected:
    float value (int index) const                                           { return params[(size_t) index]->getCurrentValue(); }
    int choice (int index) const                                            { return juce::roundToInt (value (index)); }

    virtual void prepare() {}
    virtual void clear() {}
    virtual void process (float* left, float* right, int numSamples) = 0;
    virtual void addTelemetry (juce::DynamicObject&) {}
    /** Delay and doubler keep sounding after the input stops. Everything else is replaced with silence. */
    virtual bool hasTail() const                                            { return false; }

    double sampleRate = 48000.0;
    int blockSize = 512;
    std::atomic<double> bpm { 120.0 };
    FxScope inputScope, outputScope;

private:
    void timerCallback() override;
    void run (float* left, float* right, int numSamples);

    std::vector<std::unique_ptr<juce::CachedValue<float>>> values;
    std::vector<te::AutomatableParameter::Ptr> params;
    std::vector<float> scratch;
};

#define S4_FX_IDENTITY(Class, typeName, displayName, shortName) \
    static const char* getPluginName()                  { return displayName; } \
    static constexpr const char* xmlTypeName = typeName; \
    juce::String getName() const override               { return displayName; } \
    juce::String getPluginType() override               { return xmlTypeName; } \
    juce::String getShortName (int) override            { return shortName; } \
    juce::String getSelectableDescription() override    { return displayName; }

//==============================================================================
/** Real-time pitch correction: detects the sung note and pulls it to the nearest note of a key and scale. */
class TunePlugin : public StudioFxPlugin
{
public:
    explicit TunePlugin (te::PluginCreationInfo);
    S4_FX_IDENTITY (TunePlugin, "s4000tune", "Pitch Correction", "Tune")

    /** Last detected pitch as a MIDI note number (0 when unvoiced), for display. */
    std::atomic<float> detectedNote { 0.0f };
    std::atomic<float> targetNote { 0.0f }, ratioNow { 1.0f };

    static int nearestScaleNote (float midi, int key, int scale);

private:
    void prepare() override;
    void clear() override;
    void process (float*, float*, int) override;
    void addTelemetry (juce::DynamicObject&) override;
    void analyse();

    static constexpr int decimation = 4, window = 512, hop = 64;
    std::vector<float> analysis, diff;
    int analysisFill = 0, decimCount = 0, sinceHop = 0;
    float decimAcc = 0.0f, lowpass = 0.0f;

    std::vector<float> delayL, delayR;
    int writePos = 0;
    float windowLength = 2048.0f, windowTarget = 2048.0f;
    double phase = 0.0;
    float ratio = 1.0f, targetRatio = 1.0f;
};

class GatePlugin : public StudioFxPlugin
{
public:
    explicit GatePlugin (te::PluginCreationInfo);
    S4_FX_IDENTITY (GatePlugin, "s4000gate", "Noise Gate", "Gate")

private:
    void clear() override { env = 0.0f; gain = 0.0f; holdLeft = 0; }
    void process (float*, float*, int) override;
    void addTelemetry (juce::DynamicObject&) override;
    float env = 0.0f, gain = 0.0f;
    int holdLeft = 0;
    PeakHold levelHold;
    std::atomic<float> gainNow { 0.0f };
};

class SaturatorPlugin : public StudioFxPlugin
{
public:
    explicit SaturatorPlugin (te::PluginCreationInfo);
    S4_FX_IDENTITY (SaturatorPlugin, "s4000saturator", "Saturator", "Sat")

private:
    void clear() override { lp[0] = lp[1] = 0.0f; dc[0] = dc[1] = dcIn[0] = dcIn[1] = 0.0f; }
    void process (float*, float*, int) override;
    float lp[2] {}, dc[2] {}, dcIn[2] {};
};

class StereoWidthPlugin : public StudioFxPlugin
{
public:
    explicit StereoWidthPlugin (te::PluginCreationInfo);
    S4_FX_IDENTITY (StereoWidthPlugin, "s4000width", "Stereo Width", "Width")

private:
    void clear() override { sideLow = 0.0f; }
    void process (float*, float*, int) override;
    float sideLow = 0.0f;
};

class TremoloPlugin : public StudioFxPlugin
{
public:
    explicit TremoloPlugin (te::PluginCreationInfo);
    S4_FX_IDENTITY (TremoloPlugin, "s4000tremolo", "Tremolo / Auto-pan", "Trem")

private:
    void clear() override { phase = 0.0; }
    void process (float*, float*, int) override;
    void addTelemetry (juce::DynamicObject&) override;
    double phase = 0.0;
    std::atomic<float> phaseNow { 0.0f };
};

class BitCrusherPlugin : public StudioFxPlugin
{
public:
    explicit BitCrusherPlugin (te::PluginCreationInfo);
    S4_FX_IDENTITY (BitCrusherPlugin, "s4000crusher", "Bit Crusher", "Crush")

private:
    void clear() override { held[0] = held[1] = 0.0f; counter = 0.0f; }
    void process (float*, float*, int) override;
    float held[2] {}, counter = 0.0f;
};

class TransientShaperPlugin : public StudioFxPlugin
{
public:
    explicit TransientShaperPlugin (te::PluginCreationInfo);
    S4_FX_IDENTITY (TransientShaperPlugin, "s4000transient", "Transient Shaper", "Trans")

private:
    void clear() override { fast = slow = hold = quick = 0.0f; }
    void process (float*, float*, int) override;
    void addTelemetry (juce::DynamicObject&) override;
    float fast = 0.0f, slow = 0.0f, hold = 0.0f, quick = 0.0f;
    PeakHold boostHold, cutHold;
};

class DoublerPlugin : public StudioFxPlugin
{
public:
    explicit DoublerPlugin (te::PluginCreationInfo);
    S4_FX_IDENTITY (DoublerPlugin, "s4000doubler", "Vocal Doubler", "Double")

private:
    bool hasTail() const override                                       { return true; }
    void prepare() override;
    void clear() override;
    void process (float*, float*, int) override;
    std::vector<float> line;
    int writePos = 0;
    double lfo[2] { 0.0, 0.37 };
};

class StereoDelayPlugin : public StudioFxPlugin
{
public:
    explicit StereoDelayPlugin (te::PluginCreationInfo);
    S4_FX_IDENTITY (StereoDelayPlugin, "s4000delay", "Stereo Delay", "Delay")

private:
    bool hasTail() const override                                       { return true; }
    void prepare() override;
    void clear() override;
    void process (float*, float*, int) override;
    void addTelemetry (juce::DynamicObject&) override;
    std::vector<float> line[2];
    int writePos = 0;
    float lowState[2] {}, highState[2] {};
    float smoothedDelay = 0.0f;
    std::atomic<float> delayMs { 0.0f };
};

class DeEsserPlugin : public StudioFxPlugin
{
public:
    explicit DeEsserPlugin (te::PluginCreationInfo);
    S4_FX_IDENTITY (DeEsserPlugin, "s4000deesser", "De-esser", "DeEss")

private:
    void clear() override;
    void process (float*, float*, int) override;
    void addTelemetry (juce::DynamicObject&) override;
    Biquad split[2], detector;
    float env = 0.0f, lastFreq = -1.0f;
    PeakHold sibilanceHold, reductionHold;
};

/** Eight-band parametric EQ: cuts with selectable slope, shelves, bells and notches. */
class EqPlugin : public StudioFxPlugin
{
public:
    explicit EqPlugin (te::PluginCreationInfo);
    S4_FX_IDENTITY (EqPlugin, "s4000eq", "Parametric EQ", "EQ")

    static constexpr int numBands = 8, paramsPerBand = 6, maxStages = 4;
    enum BandParam { on, type, freq, gain, q, slope };

private:
    void clear() override;
    void process (float*, float*, int) override;

    struct Band
    {
        Biquad stages[2][maxStages];
        float freq = -1.0f, gain = 0.0f, q = 0.0f;
        int type = -1, numStages = 1;
        double rate = 0.0;
    };

    std::array<Band, numBands> bands;
};

/** Feed-forward compressor with soft knee, peak or RMS detection, sidechain high-pass and parallel mix. */
class CompressorFx : public StudioFxPlugin
{
public:
    explicit CompressorFx (te::PluginCreationInfo);
    S4_FX_IDENTITY (CompressorFx, "s4000comp", "Compressor", "Comp")

    /** Gain change in dB for a detector level, before make-up: the transfer curve the editor draws. */
    static float staticGainDb (float levelDb, float thresholdDb, float ratio, float kneeDb);

private:
    void clear() override;
    void process (float*, float*, int) override;
    void addTelemetry (juce::DynamicObject&) override;

    Biquad sidechain;
    float lastHpf = -1.0f, meanSquare = 0.0f, reduction = 0.0f;
    PeakHold levelHold, reductionHold;
};

/** Registers every effect above with the engine. */
void registerStudioEffects (te::PluginManager&);

/** {type, display name, category} of every effect above, for the browser. */
std::vector<std::array<const char*, 3>> studioEffectCatalogue();
}
