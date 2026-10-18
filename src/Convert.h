#pragma once

#include "Common.h"

namespace s3
{
class AppEngine;

/** A note in beats relative to the start of its clip. */
struct ConvertedNote
{
    int pitch = 60;
    double beat = 0;
    double length = 0.25;
    int velocity = 100;
};

/** Turns a stretch of an audio file into MIDI notes (hum, vocal or monophonic instrument). */
juce::Array<ConvertedNote> audioToMidiNotes (te::Engine&,
                                             const juce::File& file,
                                             double fileStartSeconds,
                                             double lengthSeconds,
                                             te::TempoSequence&,
                                             double clipStartSeconds);

/** Renders one track (synth + its effects, no master) to a WAV and returns the file. */
juce::File bounceTrackToWav (AppEngine&, te::AudioTrack&, te::TimeRange, const String& name);

var notesToVar (const juce::Array<ConvertedNote>&);
void applyConvertedNotes (te::MidiClip&, const juce::Array<ConvertedNote>&);
}
