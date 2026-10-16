#include "LoudnessMeterPlugin.h"

namespace s3
{
namespace
{
    double energyToLufs (double energy)
    {
        return energy > 1.0e-12 ? -0.691 + 10.0 * std::log10 (energy) : LoudnessAnalyzer::silence;
    }

    double lufsToEnergy (double lufs)
    {
        return std::pow (10.0, (lufs + 0.691) / 10.0);
    }

    float gainToDb (float g)
    {
        return g > 1.0e-6f ? 20.0f * std::log10 (g) : -120.0f;
    }
}

void LoudnessAnalyzer::prepare (double newSampleRate, int numChannels)
{
    sampleRate = newSampleRate > 0 ? newSampleRate : 48000.0;
    channelsInUse = juce::jlimit (1, maxChannels, numChannels);
    samplesPerBlock = juce::jmax (1, juce::roundToInt (sampleRate * 0.1));

    // K-weighting stage 1: high shelf
    {
        const double f0 = 1681.974450955533, gain = 3.999843853973347, q = 0.7071752369554196;
        const double k = std::tan (juce::MathConstants<double>::pi * f0 / sampleRate);
        const double vh = std::pow (10.0, gain / 20.0);
        const double vb = std::pow (vh, 0.4996667741545416);
        const double a0 = 1.0 + k / q + k * k;

        for (auto& f : shelf)
        {
            f.b0 = (vh + vb * k / q + k * k) / a0;
            f.b1 = 2.0 * (k * k - vh) / a0;
            f.b2 = (vh - vb * k / q + k * k) / a0;
            f.a1 = 2.0 * (k * k - 1.0) / a0;
            f.a2 = (1.0 - k / q + k * k) / a0;
        }
    }

    // K-weighting stage 2: high pass
    {
        const double f0 = 38.13547087602444, q = 0.5003270373238773;
        const double k = std::tan (juce::MathConstants<double>::pi * f0 / sampleRate);
        const double a0 = 1.0 + k / q + k * k;

        for (auto& f : highPass)
        {
            f.b0 = 1.0;
            f.b1 = -2.0;
            f.b2 = 1.0;
            f.a1 = 2.0 * (k * k - 1.0) / a0;
            f.a2 = (1.0 - k / q + k * k) / a0;
        }
    }

    reset();
}

void LoudnessAnalyzer::reset()
{
    for (auto& f : shelf)     f.z1 = f.z2 = 0;
    for (auto& f : highPass)  f.z1 = f.z2 = 0;

    samplesInBlock = 0;
    blockEnergy = 0;
    blockRing.fill (0.0);
    ringIndex = 0;
    blocksSeen = 0;
    momentary = silence;
    shortTerm = silence;
    overallPeak = 0.0f;

    for (auto& h : histogram)  h = 0;
    for (auto& p : blockPeak)  p = 0.0f;

    momentaryHistory.clear();
}

void LoudnessAnalyzer::process (const float* const* channels, int numChannels, int numSamples)
{
    numChannels = juce::jmin (numChannels, channelsInUse, maxChannels);

    for (int c = 0; c < numChannels; ++c)
    {
        float peak = 0.0f;

        for (int i = 0; i < numSamples; ++i)
            peak = juce::jmax (peak, std::abs (channels[c][i]));

        if (peak > blockPeak[(size_t) c].load())
            blockPeak[(size_t) c] = peak;

        if (peak > overallPeak.load())
            overallPeak = peak;
    }

    int pos = 0;

    while (pos < numSamples)
    {
        const int todo = juce::jmin (numSamples - pos, samplesPerBlock - samplesInBlock);

        for (int c = 0; c < numChannels; ++c)
        {
            auto& s = shelf[(size_t) c];
            auto& h = highPass[(size_t) c];
            const float* data = channels[c] + pos;
            double sum = 0;

            for (int i = 0; i < todo; ++i)
            {
                const double y = h.process (s.process ((double) data[i]));
                sum += y * y;
            }

            // BS.1770 weights: L, R, C = 1.0; LFE (index 3) is excluded; surrounds = 1.41
            const double weight = c < 3 ? 1.0 : (c == 3 ? 0.0 : 1.41);
            blockEnergy += sum * weight;
        }

        samplesInBlock += todo;
        pos += todo;

        if (samplesInBlock >= samplesPerBlock)
            finishBlock();
    }
}

void LoudnessAnalyzer::finishBlock()
{
    blockRing[(size_t) ringIndex] = blockEnergy / (double) samplesPerBlock;
    ringIndex = (ringIndex + 1) % (int) blockRing.size();
    ++blocksSeen;
    blockEnergy = 0;
    samplesInBlock = 0;

    auto meanOfLast = [this] (int n)
    {
        n = juce::jmin (n, blocksSeen);
        double sum = 0;

        for (int i = 1; i <= n; ++i)
            sum += blockRing[(size_t) ((ringIndex - i + (int) blockRing.size()) % (int) blockRing.size())];

        return n > 0 ? sum / n : 0.0;
    };

    const double m = energyToLufs (meanOfLast (4));
    momentary = m;
    shortTerm = energyToLufs (meanOfLast (30));

    if (recordHistory)
        momentaryHistory.push_back ((float) m);

    if (blocksSeen >= 4 && m > -70.0)
    {
        const int bin = juce::jlimit (0, numHistogramBins - 1, (int) ((m + 70.0) * 10.0));
        histogram[(size_t) bin].fetch_add (1);
    }
}

double LoudnessAnalyzer::getIntegratedLufs() const
{
    std::array<uint32_t, numHistogramBins> counts;

    for (size_t i = 0; i < counts.size(); ++i)
        counts[i] = histogram[i].load();

    auto binLufs = [] (size_t i) { return -70.0 + ((double) i + 0.5) / 10.0; };

    double energySum = 0;
    uint64_t total = 0;

    for (size_t i = 0; i < counts.size(); ++i)
    {
        energySum += counts[i] * lufsToEnergy (binLufs (i));
        total += counts[i];
    }

    if (total == 0)
        return silence;

    const double relativeGate = energyToLufs (energySum / (double) total) - 10.0;

    energySum = 0;
    total = 0;

    for (size_t i = 0; i < counts.size(); ++i)
    {
        if (binLufs (i) < relativeGate)
            continue;

        energySum += counts[i] * lufsToEnergy (binLufs (i));
        total += counts[i];
    }

    return total > 0 ? energyToLufs (energySum / (double) total) : silence;
}

float LoudnessAnalyzer::getPeakDb() const noexcept
{
    return gainToDb (overallPeak.load());
}

float LoudnessAnalyzer::getAndResetBlockPeakDb (int channel) noexcept
{
    if (channel < 0 || channel >= maxChannels)
        return -120.0f;

    return gainToDb (blockPeak[(size_t) channel].exchange (0.0f));
}

//==============================================================================
const char* LoudnessMeterPlugin::xmlTypeName = "s4000loudness";

LoudnessMeterPlugin::LoudnessMeterPlugin (te::PluginCreationInfo info) : te::Plugin (info) {}

LoudnessMeterPlugin::~LoudnessMeterPlugin()
{
    notifyListenersOfDeletion();
}

juce::ValueTree LoudnessMeterPlugin::create()
{
    juce::ValueTree v (te::IDs::PLUGIN);
    v.setProperty (te::IDs::type, xmlTypeName, nullptr);
    return v;
}

void LoudnessMeterPlugin::initialise (const te::PluginInitialisationInfo& info)
{
    analyzer.prepare (info.sampleRate, 2);
}

void LoudnessMeterPlugin::applyToBuffer (const te::PluginRenderContext& fc)
{
    if (fc.destBuffer == nullptr)
        return;

    if (resetRequested.exchange (false))
        analyzer.reset();

    const int numChannels = juce::jmin (2, fc.destBuffer->getNumChannels());
    const float* channels[2] = {};

    for (int c = 0; c < numChannels; ++c)
        channels[c] = fc.destBuffer->getReadPointer (c, fc.bufferStartSample);

    analyzer.process (channels, numChannels, fc.bufferNumSamples);
}
}
