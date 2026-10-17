#pragma once

#include "Common.h"

namespace s3
{
/** Copies the audio entering a track or clip effect chain, so the mix plug-in can blend it back. */
class ChainDryPlugin : public te::Plugin
{
public:
    ChainDryPlugin (te::PluginCreationInfo);
    ~ChainDryPlugin() override;

    static const char* getPluginName()              { return "Chain dry"; }
    static const char* xmlTypeName;

    juce::String getName() const override           { return getPluginName(); }
    juce::String getPluginType() override           { return xmlTypeName; }
    juce::String getShortName (int) override        { return "Dry"; }
    juce::String getSelectableDescription() override { return getPluginName(); }
    juce::String getVendor() override               { return "Studio 4000"; }

    int getNumOutputChannelsGivenInputs (int numInputs) override { return juce::jmax (1, numInputs); }
    BusLayout getBusses() const override            { return BusLayout::singlePassThrough(); }

    void initialise (const te::PluginInitialisationInfo&) override;
    void deinitialise() override                    {}
    void reset() override;
    void applyToBuffer (const te::PluginRenderContext&) override;

    /** Copies input from this block. `offset` is how far into the block the destination starts. */
    void copyInput (float* left, float* right, int numSamples, int latencySamples, int blockSamples, int offset) const;

private:
    double sampleRate = 48000.0;
    juce::AudioBuffer<float> ring;
    int writePos = 0;
    int filled = 0;
};

/** Blends the chain's output with the dry copy. 100 is fully effected. */
class ChainWetPlugin : public te::Plugin
{
public:
    ChainWetPlugin (te::PluginCreationInfo);
    ~ChainWetPlugin() override;

    static const char* getPluginName()              { return "Chain mix"; }
    static const char* xmlTypeName;

    juce::String getName() const override           { return getPluginName(); }
    juce::String getPluginType() override           { return xmlTypeName; }
    juce::String getShortName (int) override        { return "Mix"; }
    juce::String getSelectableDescription() override { return getPluginName(); }
    juce::String getVendor() override               { return "Studio 4000"; }

    int getNumOutputChannelsGivenInputs (int numInputs) override { return juce::jmax (1, numInputs); }
    BusLayout getBusses() const override            { return BusLayout::singlePassThrough(); }

    void initialise (const te::PluginInitialisationInfo&) override;
    void deinitialise() override                    {}
    void reset() override;
    void applyToBuffer (const te::PluginRenderContext&) override;

private:
    te::AutomatableParameter::Ptr mix;
    juce::CachedValue<float> mixValue;
    juce::SmoothedValue<float> smoothed;
    double sampleRate = 48000.0;
};
}
