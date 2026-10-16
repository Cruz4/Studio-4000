#pragma once

#include "Common.h"

namespace s3
{
class AppEngine;

/** Routes notes from the on-screen keyboard, computer-keyboard typing and hardware MIDI inputs.

    Armed instrument tracks hear and record their input device as usual. When nothing is armed, notes are
    played into the selected instrument track so it can be auditioned without arming.
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

private:
    AppEngine& app;
    String focusedTrackId;
    std::vector<std::shared_ptr<te::MidiInputDevice>> attached;
    juce::AbstractFifo fifo { 512 };
    std::array<juce::MidiMessage, 512> pending;

    te::AudioTrack* trackFor (const String& trackId) const;
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
