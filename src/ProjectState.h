#pragma once

#include "Common.h"

namespace s3
{
class AppEngine;

/** Track kinds shown in the UI. Stored on the track state as "s3kind". */
namespace TrackKind
{
    inline const juce::Identifier property { "s3kind" };
    inline const char* audio = "audio";
    inline const char* instrument = "instrument";
    inline const char* fxReturn = "return";
    inline const char* group = "group";
}

String getTrackKind (const te::Track&);

/** True for the volume/pan and meter plug-ins every track carries, which the UI shows as faders. */
bool isChannelStripPlugin (const te::Plugin&);
int chainMixPercent (const te::PluginList&);

var describePlugin (te::Plugin&, int maxParams = 128);
var describeParameter (te::AutomatableParameter&);
var describeClip (te::Clip&);

/** Replaces an audio clip's gain envelope. Points are [seconds from the clip start, dB]. An empty list clears it. */
void setClipGainPoints (te::AudioClipBase&, const juce::Array<juce::var>& points);
var describeTrack (AppEngine&, te::Track&);

/** The full project model the UI renders from. */
var buildProjectSnapshot (AppEngine&);
}
