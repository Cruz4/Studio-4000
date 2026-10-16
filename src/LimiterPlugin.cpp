#include "LimiterPlugin.h"

namespace s3
{
const char* LimiterPlugin::xmlTypeName = "s4000limiter";

LimiterPlugin::LimiterPlugin (te::PluginCreationInfo info) : te::Plugin (info)
{
    auto um = getUndoManager();

    inputGainValue.referTo (state, "inputGain", um, 0.0f);
    ceilingValue.referTo (state, "ceiling", um, -1.0f);
    releaseValue.referTo (state, "release", um, 120.0f);

    inputGain = addParam ("inputGain", "Input Gain", { 0.0f, 24.0f },
                          [] (float v) { return juce::String (v, 1) + " dB"; },
                          [] (const juce::String& s) { return s.getFloatValue(); });

    ceiling = addParam ("ceiling", "Ceiling", { -12.0f, 0.0f },
                        [] (float v) { return juce::String (v, 1) + " dB"; },
                        [] (const juce::String& s) { return s.getFloatValue(); });

    release = addParam ("release", "Release", { 10.0f, 1000.0f },
                        [] (float v) { return juce::String (juce::roundToInt (v)) + " ms"; },
                        [] (const juce::String& s) { return s.getFloatValue(); });

    inputGain->attachToCurrentValue (inputGainValue);
    ceiling->attachToCurrentValue (ceilingValue);
    release->attachToCurrentValue (releaseValue);
}

LimiterPlugin::~LimiterPlugin()
{
    notifyListenersOfDeletion();

    inputGain->detachFromCurrentValue();
    ceiling->detachFromCurrentValue();
    release->detachFromCurrentValue();
}

juce::ValueTree LimiterPlugin::create()
{
    juce::ValueTree v (te::IDs::PLUGIN);
    v.setProperty (te::IDs::type, xmlTypeName, nullptr);
    return v;
}

void LimiterPlugin::initialise (const te::PluginInitialisationInfo& info)
{
    sampleRate = info.sampleRate;
    lookahead = juce::jmax (1, (int) std::round (lookaheadSeconds * sampleRate));
    reset();
}

void LimiterPlugin::reset()
{
    for (auto& d : delay)
        d.assign ((size_t) lookahead + 1, 0.0f);

    maxQueue.clear();
    writePos = 0;
    sampleCounter = 0;
    gain = 1.0f;
}

void LimiterPlugin::applyToBuffer (const te::PluginRenderContext& fc)
{
    if (fc.destBuffer == nullptr || delay[0].empty())
        return;

    SCOPED_REALTIME_CHECK

    auto& buffer = *fc.destBuffer;
    const int numChannels = juce::jmin (2, buffer.getNumChannels());

    if (numChannels == 0)
        return;

    const float pre = juce::Decibels::decibelsToGain (inputGain->getCurrentValue());
    const float limit = juce::Decibels::decibelsToGain (ceiling->getCurrentValue());
    const float releaseCoef = 1.0f - std::exp (-1.0f / (float) (release->getCurrentValue() * 0.001 * sampleRate));
    const int size = (int) delay[0].size();

    float* ch[2] = { buffer.getWritePointer (0, fc.bufferStartSample),
                     buffer.getWritePointer (numChannels > 1 ? 1 : 0, fc.bufferStartSample) };
    float minGain = 1.0f;

    for (int i = 0; i < fc.bufferNumSamples; ++i)
    {
        float peak = 0.0f;
        float in[2];

        for (int c = 0; c < numChannels; ++c)
        {
            in[c] = ch[c][i] * pre;
            peak = juce::jmax (peak, std::abs (in[c]));
        }

        // sliding maximum over the lookahead window
        while (! maxQueue.empty() && maxQueue.back().second <= peak)
            maxQueue.pop_back();

        maxQueue.emplace_back ((int) (sampleCounter & 0x7fffffff), peak);

        while (! maxQueue.empty() && ((int) (sampleCounter & 0x7fffffff) - maxQueue.front().first) > lookahead)
            maxQueue.pop_front();

        const float windowPeak = maxQueue.front().second;
        const float target = windowPeak > limit ? limit / windowPeak : 1.0f;

        if (target < gain)
            gain = target;
        else
            gain += (target - gain) * releaseCoef;

        minGain = juce::jmin (minGain, gain);

        const int readPos = (writePos + 1) % size;

        for (int c = 0; c < numChannels; ++c)
        {
            auto& d = delay[c];
            d[(size_t) writePos] = in[c];
            ch[c][i] = juce::jlimit (-limit, limit, d[(size_t) readPos] * gain);
        }

        writePos = readPos;
        ++sampleCounter;
    }

    lastReductionDb = -juce::Decibels::gainToDecibels (minGain);
}
}
