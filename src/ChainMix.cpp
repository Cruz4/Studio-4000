#include "ChainMix.h"

namespace s3
{
namespace
{
    te::PluginList* ownerList (te::Plugin& plugin)
    {
        if (auto* track = plugin.getOwnerTrack())
            return &track->pluginList;

        if (auto* clip = plugin.getOwnerClip())
            return clip->getPluginList();

        return nullptr;
    }

    int chainLatencySamples (te::Plugin& wet, ChainDryPlugin& dry, double sampleRate)
    {
        auto* list = ownerList (wet);

        if (list == nullptr || sampleRate <= 0.0)
            return 0;

        bool between = false;
        double seconds = 0.0;

        for (auto* plugin : *list)
        {
            if (plugin == &dry)
            {
                between = true;
                continue;
            }

            if (plugin == &wet)
                break;

            if (between && plugin != nullptr)
                seconds += plugin->getLatencySeconds();
        }

        return juce::jmax (0, juce::roundToInt (seconds * sampleRate));
    }
}

const char* ChainDryPlugin::xmlTypeName = "s4000chaindry";

ChainDryPlugin::ChainDryPlugin (te::PluginCreationInfo info) : te::Plugin (info)
{
    state.setProperty ("s4chain", "dry", nullptr);
}

ChainDryPlugin::~ChainDryPlugin()
{
    notifyListenersOfDeletion();
}

void ChainDryPlugin::initialise (const te::PluginInitialisationInfo& info)
{
    sampleRate = info.sampleRate > 0.0 ? info.sampleRate : 48000.0;
    const int cap = juce::jmax (info.blockSizeSamples * 8, juce::roundToInt (sampleRate * 4.0));
    ring.setSize (2, cap, false, true, true);
    writePos = 0;
    filled = 0;
}

void ChainDryPlugin::reset()
{
    ring.clear();
    writePos = 0;
    filled = 0;
}

void ChainDryPlugin::applyToBuffer (const te::PluginRenderContext& fc)
{
    if (fc.destBuffer == nullptr || fc.bufferNumSamples <= 0 || ring.getNumSamples() <= 0)
        return;

    const int n = fc.bufferNumSamples;
    const int cap = ring.getNumSamples();
    const float* left = fc.destBuffer->getReadPointer (0, fc.bufferStartSample);
    const float* right = fc.destBuffer->getNumChannels() > 1 ? fc.destBuffer->getReadPointer (1, fc.bufferStartSample) : left;

    for (int i = 0; i < n; ++i)
    {
        ring.setSample (0, writePos, left[i]);
        ring.setSample (1, writePos, right[i]);
        writePos = (writePos + 1) % cap;
    }

    filled = juce::jmin (cap, filled + n);
}

void ChainDryPlugin::copyInput (float* left, float* right, int numSamples, int latencySamples, int blockSamples, int offset) const
{
    const int cap = ring.getNumSamples();

    if (left == nullptr || cap <= 0 || numSamples <= 0)
        return;

    int latency = juce::jmax (0, latencySamples);

    if (filled < blockSamples + latency)
        latency = juce::jmax (0, filled - blockSamples);

    int pos = writePos - blockSamples - latency + offset;

    while (pos < 0)
        pos += cap;

    pos %= cap;

    for (int i = 0; i < numSamples; ++i)
    {
        left[i] = ring.getSample (0, pos);
        if (right != nullptr)
            right[i] = ring.getSample (1, pos);
        pos = (pos + 1) % cap;
    }
}

const char* ChainWetPlugin::xmlTypeName = "s4000chainwet";

ChainWetPlugin::ChainWetPlugin (te::PluginCreationInfo info) : te::Plugin (info)
{
    state.setProperty ("s4chain", "wet", nullptr);
    mixValue.referTo (state, "mix", getUndoManager(), 100.0f);
    mix = addParam ("mix", "Wet", juce::NormalisableRange<float> (0.0f, 100.0f, 0.1f),
                    [] (float v) { return juce::String (juce::roundToInt (v)) + "%"; },
                    [] (const juce::String& text) { return text.getFloatValue(); });
    mix->attachToCurrentValue (mixValue);
}

ChainWetPlugin::~ChainWetPlugin()
{
    if (mix != nullptr)
        mix->detachFromCurrentValue();

    notifyListenersOfDeletion();
}

void ChainWetPlugin::initialise (const te::PluginInitialisationInfo& info)
{
    sampleRate = info.sampleRate > 0.0 ? info.sampleRate : 48000.0;
    const float wet = mix != nullptr ? juce::jlimit (0.0f, 1.0f, mix->getCurrentValue() / 100.0f) : 1.0f;
    smoothed.reset (sampleRate, 0.02);
    smoothed.setCurrentAndTargetValue (wet);
}

void ChainWetPlugin::reset()
{
    const float wet = mix != nullptr ? juce::jlimit (0.0f, 1.0f, mix->getCurrentValue() / 100.0f) : 1.0f;
    smoothed.setCurrentAndTargetValue (wet);
}

void ChainWetPlugin::applyToBuffer (const te::PluginRenderContext& fc)
{
    if (fc.destBuffer == nullptr || fc.bufferNumSamples <= 0 || mix == nullptr)
        return;

    smoothed.setTargetValue (juce::jlimit (0.0f, 1.0f, mix->getCurrentValue() / 100.0f));

    if (smoothed.getCurrentValue() >= 0.999f && smoothed.getTargetValue() >= 0.999f)
        return;

    auto* list = ownerList (*this);
    ChainDryPlugin* dry = nullptr;

    if (list != nullptr)
        for (auto* plugin : *list)
            if (auto* tap = dynamic_cast<ChainDryPlugin*> (plugin))
            {
                dry = tap;
                break;
            }

    if (dry == nullptr)
        return;

    const int n = fc.bufferNumSamples;
    const int channels = fc.destBuffer->getNumChannels();
    float* left = fc.destBuffer->getWritePointer (0, fc.bufferStartSample);
    float* right = channels > 1 ? fc.destBuffer->getWritePointer (1, fc.bufferStartSample) : nullptr;
    const int latency = chainLatencySamples (*this, *dry, sampleRate);

    for (int done = 0; done < n;)
    {
        const int chunk = juce::jmin (512, n - done);
        float dryL[512], dryR[512];
        dry->copyInput (dryL, right != nullptr ? dryR : nullptr, chunk, latency, n, done);

        for (int i = 0; i < chunk; ++i)
        {
            const float wet = smoothed.getNextValue();
            const float dryGain = 1.0f - wet;
            left[done + i] = dryL[i] * dryGain + left[done + i] * wet;

            if (right != nullptr)
                right[done + i] = dryR[i] * dryGain + right[done + i] * wet;
        }

        done += chunk;
    }
}
}
