#include "LiveMidi.h"
#include "AppEngine.h"
#include "ProjectState.h"

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

String LiveMidi::play (const juce::MidiMessage& m, const String& trackId)
{
    if (app.currentEdit() == nullptr)
        return {};

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
