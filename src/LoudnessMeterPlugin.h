#pragma once

#include "Common.h"

namespace s3
{
/** ITU-R BS.1770-4 loudness measurement (momentary, short-term, gated integrated, sample peak).

    process() may run on the audio thread while the getters are read from the message thread.
*/
class LoudnessAnalyzer
{
public:
    void prepare (double sampleRate, int numChannels);
    void reset();
    void process (const float* const* channels, int numChannels, int numSamples);

    double getMomentaryLufs() const noexcept    { return momentary.load(); }
    double getShortTermLufs() const noexcept    { return shortTerm.load(); }
    double getIntegratedLufs() const;
    float getPeakDb() const noexcept;
    float getAndResetBlockPeakDb (int channel) noexcept;

    /** Momentary loudness of every 100 ms step (400 ms window), kept when recordHistory is set. */
    bool recordHistory = false;
    std::vector<float> momentaryHistory;

    static constexpr double silence = -120.0;

private:
    struct Biquad
    {
        double b0 = 1, b1 = 0, b2 = 0, a1 = 0, a2 = 0;
        double z1 = 0, z2 = 0;

        double process (double x) noexcept
        {
            auto y = b0 * x + z1;
            z1 = b1 * x - a1 * y + z2;
            z2 = b2 * x - a2 * y;
            return y;
        }
    };

    static constexpr int maxChannels = 8;
    static constexpr int numHistogramBins = 1000;   // -70 LUFS .. +30 LUFS in 0.1 LU steps

    double sampleRate = 48000.0;
    int channelsInUse = 2;
    std::array<Biquad, maxChannels> shelf, highPass;

    int samplesPerBlock = 4800;
    int samplesInBlock = 0;
    double blockEnergy = 0.0;
    std::array<double, 30> blockRing {};
    int ringIndex = 0, blocksSeen = 0;

    std::atomic<double> momentary { silence }, shortTerm { silence };
    std::array<std::atomic<uint32_t>, numHistogramBins> histogram {};
    std::array<std::atomic<float>, maxChannels> blockPeak {};
    std::atomic<float> overallPeak { 0.0f };

    void finishBlock();
};

/** A pass-through plug-in on the master bus that feeds the live loudness display. */
class LoudnessMeterPlugin : public te::Plugin
{
public:
    LoudnessMeterPlugin (te::PluginCreationInfo);
    ~LoudnessMeterPlugin() override;

    static const char* getPluginName()              { return "Loudness Meter"; }
    static const char* xmlTypeName;

    static juce::ValueTree create();

    juce::String getName() const override           { return getPluginName(); }
    juce::String getPluginType() override           { return xmlTypeName; }
    juce::String getShortName (int) override        { return "LUFS"; }
    juce::String getSelectableDescription() override { return getPluginName(); }
    juce::String getVendor() override               { return "Studio 4000"; }
    bool canBeDisabled() override                   { return false; }

    int getNumOutputChannelsGivenInputs (int numInputChannels) override { return numInputChannels; }
    BusLayout getBusses() const override            { return BusLayout::singlePassThrough(); }

    void initialise (const te::PluginInitialisationInfo&) override;
    void deinitialise() override                    {}
    void applyToBuffer (const te::PluginRenderContext&) override;

    void resetIntegrated()                          { resetRequested = true; }

    LoudnessAnalyzer analyzer;

private:
    std::atomic<bool> resetRequested { false };

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (LoudnessMeterPlugin)
};
}
