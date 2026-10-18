#include "Convert.h"
#include "AppEngine.h"

namespace s3
{
namespace
{
    constexpr int yinWindow = 2048;
    constexpr int yinHop = 512;
    constexpr float yinThreshold = 0.15f;
    constexpr double minNoteSeconds = 0.07;
    constexpr double maxGapSeconds = 0.05;
    constexpr float splitSemitones = 0.8f;

    float yinFrequency (const float* x, int n, double sampleRate)
    {
        if (n < 64)
            return 0.0f;

        const int maxTau = n / 2;
        std::vector<float> diff ((size_t) maxTau + 1, 0.0f);

        for (int tau = 1; tau <= maxTau; ++tau)
        {
            double sum = 0;

            for (int i = 0; i < n - tau; ++i)
            {
                const double d = (double) x[i] - (double) x[i + tau];
                sum += d * d;
            }

            diff[(size_t) tau] = (float) sum;
        }

        float running = 0.0f;
        int found = 0;

        for (int tau = 1; tau <= maxTau; ++tau)
        {
            running += diff[(size_t) tau];
            const float cmnd = running > 1.0e-12f ? diff[(size_t) tau] * (float) tau / running : 1.0f;
            diff[(size_t) tau] = cmnd;

            if (tau > 2 && found == 0 && cmnd < yinThreshold && diff[(size_t) tau] <= diff[(size_t) tau - 1])
                found = tau;
        }

        if (found < 2 || found >= maxTau)
            return 0.0f;

        const float a = diff[(size_t) found - 1], b = diff[(size_t) found], c = diff[(size_t) found + 1];
        const float denom = a - 2.0f * b + c;
        float tau = (float) found;

        if (std::abs (denom) > 1.0e-9f)
            tau += 0.5f * (a - c) / denom;

        if (tau < 2.0f)
            return 0.0f;

        const float freq = (float) (sampleRate / (double) tau);
        return (freq >= 50.0f && freq <= 2000.0f) ? freq : 0.0f;
    }

    float rmsOf (const float* x, int n)
    {
        double s = 0;

        for (int i = 0; i < n; ++i)
            s += (double) x[i] * (double) x[i];

        return n > 0 ? (float) std::sqrt (s / n) : 0.0f;
    }

    juce::Array<te::Track*> trackWithParents (te::AudioTrack& t)
    {
        juce::Array<te::Track*> tracks { &t };

        for (auto* parent = t.getParentFolderTrack(); parent != nullptr; parent = parent->getParentFolderTrack())
            tracks.add (parent);

        return tracks;
    }
}

juce::Array<ConvertedNote> audioToMidiNotes (te::Engine& engine,
                                             const juce::File& file,
                                             double fileStartSeconds,
                                             double lengthSeconds,
                                             te::TempoSequence& tempos,
                                             double clipStartSeconds)
{
    std::unique_ptr<juce::AudioFormatReader> reader (engine.getAudioFileFormatManager().readFormatManager.createReaderFor (file));
    juce::Array<ConvertedNote> notes;

    if (reader == nullptr || reader->lengthInSamples <= 0 || reader->sampleRate < 1000.0)
        return notes;

    const double sr = reader->sampleRate;
    const auto startSample = (juce::int64) std::llround (juce::jmax (0.0, fileStartSeconds) * sr);
    const auto want = (juce::int64) std::llround (juce::jmax (0.05, lengthSeconds) * sr);
    const auto available = juce::jmax<juce::int64> (0, reader->lengthInSamples - startSample);
    const auto total = juce::jmin (want, available);

    if (total < yinWindow)
        return notes;

    juce::AudioBuffer<float> block (1, yinWindow);
    int openPitch = -1;
    double openStart = 0;
    float openRms = 0;
    int openFrames = 0;
    double lastVoiced = -1;

    auto flush = [&] (double endTime)
    {
        if (openPitch < 0)
            return;

        const double dur = endTime - openStart;

        if (dur >= minNoteSeconds)
        {
            ConvertedNote n;
            n.pitch = openPitch;
            n.beat = tempos.toBeats (te::TimePosition::fromSeconds (clipStartSeconds + openStart)).inBeats()
                   - tempos.toBeats (te::TimePosition::fromSeconds (clipStartSeconds)).inBeats();
            const double endBeat = tempos.toBeats (te::TimePosition::fromSeconds (clipStartSeconds + endTime)).inBeats()
                                 - tempos.toBeats (te::TimePosition::fromSeconds (clipStartSeconds)).inBeats();
            n.length = juce::jmax (1.0 / 64.0, endBeat - n.beat);
            n.velocity = juce::jlimit (1, 127, juce::roundToInt (juce::jmap (juce::Decibels::gainToDecibels (openRms / (float) juce::jmax (1, openFrames), -60.0f),
                                                                            -48.0f, -6.0f, 48.0f, 118.0f)));
            notes.add (n);
        }

        openPitch = -1;
        openFrames = 0;
        openRms = 0;
    };

    for (juce::int64 pos = 0; pos + yinWindow <= total; pos += yinHop)
    {
        reader->read (&block, 0, yinWindow, startSample + pos, true, true);
        const float* x = block.getReadPointer (0);
        const float freq = yinFrequency (x, yinWindow, sr);
        const double t = (double) pos / sr;
        const float level = rmsOf (x, yinWindow);

        if (freq <= 0.0f || level < 0.004f)
        {
            if (openPitch >= 0 && (lastVoiced < 0 || t - lastVoiced > maxGapSeconds))
                flush (lastVoiced >= 0 ? lastVoiced : t);

            continue;
        }

        lastVoiced = t + (double) yinHop / sr;
        const float midi = 69.0f + 12.0f * std::log2 (freq / 440.0f);
        const int pitch = juce::jlimit (0, 127, juce::roundToInt (midi));

        if (openPitch < 0)
        {
            openPitch = pitch;
            openStart = t;
            openRms = level;
            openFrames = 1;
        }
        else if (std::abs ((float) pitch - (float) openPitch) >= splitSemitones && std::abs (midi - (float) openPitch) >= splitSemitones)
        {
            flush (t);
            openPitch = pitch;
            openStart = t;
            openRms = level;
            openFrames = 1;
        }
        else
        {
            openRms += level;
            ++openFrames;
        }
    }

    flush (lastVoiced >= 0 ? lastVoiced : (double) total / sr);
    return notes;
}

juce::File bounceTrackToWav (AppEngine& app, te::AudioTrack& track, te::TimeRange range, const String& name)
{
    auto& edit = app.edit();
    auto dest = app.getBouncesDir().getNonexistentChildFile (juce::File::createLegalFileName (name), ".wav", false);
    dest.getParentDirectory().createDirectory();

    if (range.getLength().inSeconds() < 0.05)
        throw RpcError ("Nothing to print: that range is empty");

    te::Renderer::Parameters r (edit);
    r.destFile = dest;
    r.audioFormat = app.getEngine().getAudioFileFormatManager().getWavFormat();
    r.bitDepth = 24;
    r.sampleRateForAudio = juce::jmax (44100.0, edit.engine.getDeviceManager().getSampleRate());
    r.blockSizeForAudio = 512;
    r.tracksToDo = te::toBitSet (trackWithParents (track));
    r.time = range;
    r.usePlugins = true;
    r.useMasterPlugins = false;
    r.canRenderInMono = false;
    r.checkNodesForAudio = false;
    r.endAllowance = te::TimeDuration::fromSeconds (0.4);

    const te::Edit::ScopedRenderStatus busy (edit, true);
    te::Renderer::renderToFile ("Print to audio", r);

    if (! dest.existsAsFile() || dest.getSize() < 64)
        throw RpcError ("Printing to audio didn't write a file");

    return dest;
}

var notesToVar (const juce::Array<ConvertedNote>& notes)
{
    juce::Array<var> out;

    for (auto& n : notes)
        out.add (var (juce::Array<var> { n.pitch, n.beat, n.length, n.velocity }));

    return out;
}

void applyConvertedNotes (te::MidiClip& mc, const juce::Array<ConvertedNote>& notes)
{
    auto* um = &mc.edit.getUndoManager();
    auto& seq = mc.getSequence();
    seq.removeAllNotes (um);

    for (auto& n : notes)
        seq.addNote (n.pitch, te::BeatPosition::fromBeats (n.beat), te::BeatDuration::fromBeats (n.length), n.velocity, 0, um);
}
}
