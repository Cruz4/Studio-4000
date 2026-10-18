#pragma once

#include "Common.h"
#include "Convert.h"
#include <deque>

namespace s3
{
class AppEngine;

/** Routes notes from the on-screen keyboard, computer-keyboard typing and hardware MIDI inputs.

    Armed instrument tracks hear and record their input device as usual. When nothing is armed, notes are
    played into the selected instrument track so it can be auditioned without arming.

    Every note is also kept for a short time so Capture MIDI can drop a take you already played.
*/
class LiveMidi : private te::PhysicalMidiInputDevice::Listener,
                 private juce::ChangeListener,
                 private juce::AsyncUpdater
{
public:
    explicit LiveMidi (AppEngine&);
    ~LiveMidi() override;

    void setFocusedTrack (const String& trackId)     { focusedTrackId = trackId; }
    String getFocusedTrack() const                   { return focusedTrackId; }

    /** Plays a message typed in the interface; returns the track it went to, or empty. */
    String play (const juce::MidiMessage&, const String& trackId);
    void allNotesOff();

    void editChanged();

    te::AudioTrack* trackFor (const String& trackId) const;

    /** Notes from the last `windowSeconds` of playing, placed on the timeline. */
    juce::Array<ConvertedNote> captureNotes (double windowSeconds, te::TempoSequence&, double& startOut, double& endOut);

private:
    AppEngine& app;
    String focusedTrackId;
    std::vector<std::shared_ptr<te::MidiInputDevice>> attached;
    juce::AbstractFifo fifo { 512 };
    std::array<juce::MidiMessage, 512> pending;

    struct Heard
    {
        juce::MidiMessage message;
        double time = 0;          // transport seconds while playing, otherwise wall-clock seconds
        bool onTimeline = false;
    };
    std::deque<Heard> heard;
    static constexpr double keepSeconds = 45.0;

    void remember (const juce::MidiMessage&);
    bool anyArmedInstrumentTrack() const;
    te::VirtualMidiInputDevice* allMidiIns() const;

    void attach();
    void detach();

    void handleIncomingMidiMessage (const juce::MidiMessage&) override;
    void handleAsyncUpdate() override;
    void changeListenerCallback (juce::ChangeBroadcaster*) override;

    JUCE_DECLARE_NON_COPYABLE (LiveMidi)
};
}
