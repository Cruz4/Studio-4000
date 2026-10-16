#pragma once

#include "Common.h"

namespace s3
{
/** A lookahead brickwall limiter used by Smart Master and available in the effects browser. */
class LimiterPlugin : public te::Plugin
{
public:
    LimiterPlugin (te::PluginCreationInfo);
    ~LimiterPlugin() override;

    static const char* getPluginName()              { return "Brickwall Limiter"; }
    static const char* xmlTypeName;

    static juce::ValueTree create();

    juce::String getName() const override           { return getPluginName(); }
    juce::String getPluginType() override           { return xmlTypeName; }
    juce::String getShortName (int) override        { return "Limit"; }
    juce::String getSelectableDescription() override { return getPluginName(); }
    juce::String getVendor() override               { return "Studio 4000"; }

    int getNumOutputChannelsGivenInputs (int numInputChannels) override { return juce::jmin (numInputChannels, 2); }
    BusLayout getBusses() const override            { return BusLayout::singleStereoInOut(); }
    double getLatencySeconds() override             { return lookaheadSeconds; }

    void initialise (const te::PluginInitialisationInfo&) override;
    void deinitialise() override                    {}
    void reset() override;
    void applyToBuffer (const te::PluginRenderContext&) override;

    juce::CachedValue<float> inputGainValue, ceilingValue, releaseValue;
    te::AutomatableParameter::Ptr inputGain, ceiling, release;

    /** Gain reduction of the last block, in dB (positive number). */
    std::atomic<float> lastReductionDb { 0.0f };

private:
    static constexpr double lookaheadSeconds = 0.005;

    double sampleRate = 48000.0;
    int lookahead = 240;
    std::vector<float> delay[2];
    std::vector<float> peakWindow;
    std::deque<std::pair<int, float>> maxQueue;
    int writePos = 0;
    juce::int64 sampleCounter = 0;
    float gain = 1.0f;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (LimiterPlugin)
};
}
