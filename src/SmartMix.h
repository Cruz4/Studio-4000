#pragma once

#include "Common.h"

namespace s3
{
class AppEngine;

/** Offline mixing assistance. Every operation returns a plan of ordinary RPC calls
    ({ summary, details, calls }) so the UI can preview it and apply it as one undo step.
*/
namespace SmartMix
{
    struct DuckSettings
    {
        double depthDb = 6.0;
        double mergeMs = 250.0;
        double minMs = 400.0;
        double fadeMs = 120.0;
    };

    /** Loudness, peak, activity and a list of mix health issues. Set includeMaster to render the mix. */
    var analyze (AppEngine&, bool includeMaster);

    var planGainStaging (AppEngine&, double targetLufs, const juce::StringArray& trackIds);
    var planAutoDuck (AppEngine&, const String& targetTrackId, const juce::StringArray& keyTrackIds, DuckSettings);
    var planMaster (AppEngine&, double targetLufs, double ceilingDb);

    /** Gain staging, role-based balance, dialogue-over-music ducking and mastering in one plan. */
    var planFullMix (AppEngine&, const var& options);

    /** EQ, de-esser, compressor and a reverb send tuned for a voice. style: pop, warm or podcast. */
    var planVocalChain (AppEngine&, const String& trackId, const String& style);
}
}
