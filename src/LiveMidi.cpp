#include "LiveMidi.h"
#include "AppEngine.h"
#include "ProjectState.h"

#include <map>

namespace s3
{
LiveMidi::LiveMidi (AppEngine& a) : app (a)
{
    auto& dm = app.getEngine().getDeviceManager();
    dm.addChangeListener (this);

    // "All MIDI Ins" monitors constantly by default, which would make every instrument track sound at once.
    if (! app.settings().getBoolValue ("allMidiInsMonitorSet", false))
    {
        if (auto* all = allMidiIns())
            all->setMonitorMode (te::InputDevice::MonitorMode::automatic);

        app.settings().setValue ("allMidiInsMonitorSet", true);
    }

    attach();
}

LiveMidi::~LiveMidi()
{
    app.getEngine().getDeviceManager().removeChangeListener (this);
    detach();
    cancelPendingUpdate();
}

void LiveMidi::editChanged()
{
    focusedTrackId.clear();
}

te::AudioTrack* LiveMidi::trackFor (const String& trackId) const
{
    if (app.currentEdit() == nullptr || trackId.isEmpty())
        return nullptr;

    auto* t = dynamic_cast<te::AudioTrack*> (app.findTrack (trackId));
    return t != nullptr && getTrackKind (*t) == TrackKind::instrument ? t : nullptr;
}

bool LiveMidi::anyArmedInstrumentTrack() const
{
    auto* edit = app.currentEdit();

    if (edit == nullptr)
        return false;

    for (auto* in : edit->getAllInputDevices())
    {
        auto type = in->getInputDevice().getDeviceType();

        if (type != te::InputDevice::physicalMidiDevice && type != te::InputDevice::virtualMidiDevice)
            continue;

        for (auto target : in->getTargets())
            if (in->isRecordingEnabled (target))
                return true;
    }

    return false;
}

te::VirtualMidiInputDevice* LiveMidi::allMidiIns() const
{
    for (auto& d : app.getEngine().getDeviceManager().getMidiInDevices())
        if (auto* v = dynamic_cast<te::VirtualMidiInputDevice*> (d.get()); v != nullptr && v->useAllInputs)
            return v;

    return nullptr;
}

void LiveMidi::remember (const juce::MidiMessage& m)
{
    if (! (m.isNoteOn() || m.isNoteOff() || m.isAllNotesOff()))
        return;

    Heard h;
    h.message = m;
    h.onTimeline = false;
    h.time = juce::Time::getMillisecondCounterHiRes() * 0.001;

    if (auto* edit = app.currentEdit())
    {
        auto& t = edit->getTransport();

        if (t.isPlaying() || t.isRecording())
        {
            h.time = t.getPosition().inSeconds();
            h.onTimeline = true;
        }
    }

    heard.push_back (h);

    const double oldest = h.time - keepSeconds;

    while (! heard.empty() && heard.front().time < oldest)
        heard.pop_front();
}

juce::Array<ConvertedNote> LiveMidi::captureNotes (double windowSeconds, te::TempoSequence& tempos, double& startOut, double& endOut)
{
    juce::Array<ConvertedNote> notes;
    startOut = 0;
    endOut = 0;

    if (heard.empty())
        return notes;

    const Heard last = heard.back();
    const double from = last.time - windowSeconds;
    std::vector<Heard> slice;

    for (auto& h : heard)
        if (h.time >= from)
            slice.push_back (h);

    if (slice.empty())
        return notes;

    const bool onTimeline = last.onTimeline;
    double origin = slice.front().time;

    if (! onTimeline)
    {
        origin = slice.front().time;
        const double playhead = app.currentEdit() != nullptr ? app.edit().getTransport().getPosition().inSeconds() : 0.0;
        const double span = juce::jmax (0.25, last.time - origin);
        origin = juce::jmax (0.0, playhead - span);
    }
    else
        origin = slice.front().time;

    startOut = onTimeline ? slice.front().time : origin;
    endOut = startOut;

    std::map<int, Heard> ons;

    auto absTime = [&] (const Heard& h)
    {
        return onTimeline ? h.time : startOut + (h.time - slice.front().time);
    };

    auto beatOf = [&] (double seconds)
    {
        const double absBeat = tempos.toBeats (te::TimePosition::fromSeconds (juce::jmax (0.0, seconds))).inBeats();
        const double originBeat = tempos.toBeats (te::TimePosition::fromSeconds (startOut)).inBeats();
        return juce::jmax (0.0, absBeat - originBeat);
    };

    auto close = [&] (int pitch, const Heard& off)
    {
        auto it = ons.find (pitch);

        if (it == ons.end())
            return;

        ConvertedNote n;
        n.pitch = pitch;
        n.beat = beatOf (absTime (it->second));
        const double offBeat = beatOf (absTime (off));
        n.length = juce::jmax (1.0 / 64.0, offBeat - n.beat);
        n.velocity = juce::jlimit (1, 127, (int) it->second.message.getVelocity());
        notes.add (n);
        endOut = juce::jmax (endOut, absTime (off));
        ons.erase (it);
    };

    for (auto& h : slice)
    {
        if (h.message.isNoteOn() && h.message.getVelocity() > 0)
            ons[h.message.getNoteNumber()] = h;
        else if (h.message.isNoteOff() || (h.message.isNoteOn() && h.message.getVelocity() == 0))
            close (h.message.getNoteNumber(), h);
        else if (h.message.isAllNotesOff())
        {
            const auto left = ons;
            for (auto& [pitch, on] : left)
            { juce::ignoreUnused (on); close (pitch, h); }
        }
    }

    Heard tail = last;
    tail.time = last.time + 0.15;

    const auto leftover = ons;
    for (auto& [pitch, on] : leftover)
    { juce::ignoreUnused (on); close (pitch, tail); }

    if (endOut <= startOut)
        endOut = startOut + 0.5;

    return notes;
}

String LiveMidi::play (const juce::MidiMessage& m, const String& trackId)
{
    if (app.currentEdit() == nullptr)
        return {};

    remember (m);
    app.edit().getTransport().ensureContextAllocated();

    if (anyArmedInstrumentTrack())
    {
        if (auto* all = allMidiIns(); all != nullptr && all->isEnabled())
        {
            all->handleIncomingMidiMessage (m, {});
            return "armed";
        }
    }

    if (auto* t = trackFor (trackId.isNotEmpty() ? trackId : focusedTrackId))
    {
        t->injectLiveMidiMessage (m, {});
        return t->itemID.toString();
    }

    return {};
}

void LiveMidi::allNotesOff()
{
    if (auto* edit = app.currentEdit())
        for (auto* t : te::getAudioTracks (*edit))
            for (int ch = 1; ch <= 16; ++ch)
                t->injectLiveMidiMessage (juce::MidiMessage::allNotesOff (ch), {});
}

//==============================================================================
void LiveMidi::attach()
{
    for (auto& d : app.getEngine().getDeviceManager().getMidiInDevices())
    {
        if (auto* p = dynamic_cast<te::PhysicalMidiInputDevice*> (d.get()))
        {
            p->addListener (this);
            attached.push_back (d);
        }
    }
}

void LiveMidi::detach()
{
    for (auto& d : attached)
        if (auto* p = dynamic_cast<te::PhysicalMidiInputDevice*> (d.get()))
            p->removeListener (this);

    attached.clear();
}

void LiveMidi::changeListenerCallback (juce::ChangeBroadcaster*)
{
    auto now = app.getEngine().getDeviceManager().getMidiInDevices();

    if (now.size() == attached.size() && std::equal (now.begin(), now.end(), attached.begin(), attached.end()))
        return;

    detach();
    attach();
}

void LiveMidi::handleIncomingMidiMessage (const juce::MidiMessage& m)
{
    if (m.isSysEx() || m.isActiveSense() || m.isMidiClock())
        return;

    fifo.write (1).forEach ([&] (int index) { pending[(size_t) index] = m; });
    triggerAsyncUpdate();
}

void LiveMidi::handleAsyncUpdate()
{
    std::vector<juce::MidiMessage> messages;
    fifo.read (fifo.getNumReady()).forEach ([&] (int index) { messages.push_back (pending[(size_t) index]); });

    for (auto& m : messages)
    {
        auto copy = m;
        copy.setTimeStamp (0);
        remember (copy);
    }

    // Armed tracks already hear their input device directly.
    if (app.currentEdit() == nullptr || anyArmedInstrumentTrack())
        return;

    auto* t = trackFor (focusedTrackId);

    if (t == nullptr)
        return;

    for (auto* in : app.edit().getAllInputDevices())
        if (in->getTargets().contains (t->itemID) && in->isLivePlayEnabled (*t))
            return;

    for (auto& m : messages)
    {
        auto copy = m;
        copy.setTimeStamp (0);
        t->injectLiveMidiMessage (copy, {});
    }
}
}
