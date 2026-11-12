#pragma once
#include "Common.h"
namespace s3
{
// Fixed sample bins keep completed waveform history stationary as the take grows.
inline var recordingPreviews (te::Edit& edit, const var& request = {})
{
    juce::Array<var> previews;
    const double rate = edit.engine.getDeviceManager().getSampleRate();
    if (rate <= 0) return previews;
    for (auto* input : edit.getAllInputDevices())
    {
        if (input->getInputDevice().isMidi()) continue;
        for (auto target : input->getTargets())
        {
            if (! input->isRecording (target)) continue;
            const auto file = input->getRecordingFile (target);
            if (file == juce::File() || (has (request, "file") && str (request, "file") != file.getFullPathName())) continue;
            const auto thumbnail = edit.engine.getRecordingThumbnailManager().getThumbnailFor (file);
            const auto& thumb = *thumbnail->thumb;
            const auto samples = thumbnail->getRecordedSampleCount();
            const double length = samples / rate, bps = rate / 1024.0;
            const int channels = juce::jlimit (1, 2, thumb.getNumChannels());
            const int available = (int) ((samples + 1023) / 1024);
            const int begin = has (request, "fromBin") ? juce::jlimit (0, available, integer (request, "fromBin")) : juce::jmax (0, available - 2048);
            const int end = juce::jmin (available, begin + 2048);
            juce::Array<var> data;
            data.ensureStorageAllocated ((end - begin) * channels * 2);
            for (int bin = begin; bin < end; ++bin)
                for (int channel = 0; channel < channels; ++channel)
                {
                    float low = 0, high = 0;
                    thumb.getApproximateMinMax (bin / bps, (bin + 1) / bps, channel, low, high);
                    data.add ((int) std::lround (juce::jlimit (-1.0f, 1.0f, low) * 127));
                    data.add ((int) std::lround (juce::jlimit (-1.0f, 1.0f, high) * 127));
                }
            previews.add (Obj().set ("trackId", target.toString()).set ("file", file.getFullPathName())
                              .set ("start", thumbnail->punchInTime.inSeconds()).set ("length", length)
                              .set ("channels", channels).set ("binsPerSecond", bps).set ("startBin", begin).set ("data", data));
        }
    }
    return previews;
}
}
