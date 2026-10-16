#include "Api.h"
#include "../LiveMidi.h"

namespace s3
{
namespace
{
    using K = Rpc::Kind;

    var toList (const juce::StringArray& a)
    {
        juce::Array<var> list;

        for (auto& s : a)
            list.add (s);

        return list;
    }

    template <typename T>
    var toNumberList (const juce::Array<T>& a)
    {
        juce::Array<var> list;

        for (auto v : a)
            list.add (v);

        return list;
    }
}

void registerDeviceApi (AppEngine& app)
{
    auto& rpc = app.rpc;

    rpc.add ("devices.get", K::read, "Audio driver, devices, sample rate, buffer size, latency, inputs", "{}", [&app] (const var&)
    {
        auto& tdm = app.getEngine().getDeviceManager();
        auto& dm = tdm.deviceManager;
        auto setup = dm.getAudioDeviceSetup();

        juce::Array<var> types;

        for (auto* type : dm.getAvailableDeviceTypes())
        {
            type->scanForDevices();
            types.add (Obj().set ("name", type->getTypeName())
                            .set ("inputs", toList (type->getDeviceNames (true)))
                            .set ("outputs", toList (type->getDeviceNames (false))));
        }

        Obj current;

        if (auto* d = dm.getCurrentAudioDevice())
        {
            const double sr = d->getCurrentSampleRate();
            current.set ("name", d->getName())
                   .set ("type", d->getTypeName())
                   .set ("sampleRate", sr)
                   .set ("bufferSize", d->getCurrentBufferSizeSamples())
                   .set ("sampleRates", toNumberList (d->getAvailableSampleRates()))
                   .set ("bufferSizes", toNumberList (d->getAvailableBufferSizes()))
                   .set ("inputLatencyMs", sr > 0 ? d->getInputLatencyInSamples() * 1000.0 / sr : 0.0)
                   .set ("outputLatencyMs", sr > 0 ? d->getOutputLatencyInSamples() * 1000.0 / sr : 0.0)
                   .set ("hasControlPanel", d->hasControlPanel());
        }

        juce::Array<var> waveInputs, midiInputs, waveOutputs;

        for (int i = 0; i < tdm.getNumWaveInDevices(); ++i)
            if (auto* w = tdm.getWaveInDevice (i))
                waveInputs.add (Obj().set ("name", w->getName()).set ("enabled", w->isEnabled()).set ("stereo", w->isStereoPair()));

        for (int i = 0; i < tdm.getNumWaveOutDevices(); ++i)
            if (auto* w = tdm.getWaveOutDevice (i))
                waveOutputs.add (Obj().set ("name", w->getName()).set ("enabled", w->isEnabled()));

        for (int i = 0; i < tdm.getNumMidiInDevices(); ++i)
            if (auto m = tdm.getMidiInDevice (i))
                midiInputs.add (Obj().set ("name", m->getName()).set ("enabled", m->isEnabled())
                                     .set ("virtual", m->getDeviceType() != te::InputDevice::physicalMidiDevice));

        auto* defaultOut = tdm.getDefaultWaveOutDevice();

        return var (Obj().set ("type", dm.getCurrentAudioDeviceType())
                         .set ("input", setup.inputDeviceName)
                         .set ("output", setup.outputDeviceName)
                         .set ("types", types)
                         .set ("current", current)
                         .set ("waveInputs", waveInputs)
                         .set ("waveOutputs", waveOutputs)
                         .set ("midiInputs", midiInputs)
                         .set ("masterOutput", defaultOut != nullptr ? var (defaultOut->getName()) : var())
                         .set ("cpu", tdm.getCpuUsage()));
    });

    rpc.add ("devices.setMasterOutput", K::read, "Chooses which output pair the master bus plays through", "{name}", [&app] (const var& p)
    {
        auto& tdm = app.getEngine().getDeviceManager();
        auto name = reqStr (p, "name");

        for (int i = 0; i < tdm.getNumWaveOutDevices(); ++i)
        {
            if (auto* w = tdm.getWaveOutDevice (i); w != nullptr && w->getName() == name)
            {
                if (! w->isEnabled())
                    w->setEnabled (true);

                tdm.setDefaultWaveOutDevice (w->getDeviceID());
                app.markProjectChanged();
                return var (true);
            }
        }

        throw RpcError ("Output not found: " + name);
    });

    rpc.add ("midi.focus", K::read, "Chooses the instrument track that hardware keyboards play when nothing is armed", "{trackId}",
             [&app] (const var& p)
    {
        app.midi().setFocusedTrack (str (p, "trackId"));
        return var (true);
    });

    rpc.add ("midi.live", K::read, "Plays a note live, as from a keyboard (on-screen or computer keys)",
             "{note, velocity?: 1-127, on?: bool, trackId?}", [&app] (const var& p)
    {
        const int note = juce::jlimit (0, 127, integer (p, "note", 60));
        const auto velocity = (juce::uint8) juce::jlimit (1, 127, integer (p, "velocity", 100));
        const auto message = flag (p, "on", true) ? juce::MidiMessage::noteOn (1, note, velocity)
                                                  : juce::MidiMessage::noteOff (1, note);
        return var (app.midi().play (message, str (p, "trackId")));
    });

    rpc.add ("midi.panic", K::read, "Stops every sounding live note", "{}", [&app] (const var&)
    {
        app.midi().allNotesOff();
        return var (true);
    });

    rpc.add ("devices.set", K::read, "Changes the audio driver or device settings", "{type?, input?, output?, sampleRate?, bufferSize?}",
             [&app] (const var& p)
    {
        auto& dm = app.getEngine().getDeviceManager().deviceManager;

        if (has (p, "type") && str (p, "type") != dm.getCurrentAudioDeviceType())
        {
            dm.setCurrentAudioDeviceType (str (p, "type"), true);
            app.settings().setValue ("audioDeviceType", str (p, "type"));
            app.settings().saveIfNeeded();
        }

        auto setup = dm.getAudioDeviceSetup();

        if (has (p, "input"))       setup.inputDeviceName = str (p, "input");
        if (has (p, "output"))      setup.outputDeviceName = str (p, "output");
        if (has (p, "sampleRate"))  setup.sampleRate = num (p, "sampleRate");
        if (has (p, "bufferSize"))  setup.bufferSize = integer (p, "bufferSize");

        setup.useDefaultInputChannels = true;
        setup.useDefaultOutputChannels = true;

        auto error = dm.setAudioDeviceSetup (setup, true);

        if (error.isNotEmpty())
            throw RpcError (error);

        app.markProjectChanged();
        return var (true);
    });

    rpc.add ("devices.controlPanel", K::read, "Opens the driver's own control panel (ASIO)", "{}", [&app] (const var&)
    {
        if (auto* d = app.getEngine().getDeviceManager().deviceManager.getCurrentAudioDevice())
            if (d->hasControlPanel())
                return var (d->showControlPanel());

        return var (false);
    });

    rpc.add ("devices.showPanel", K::read, "Opens the native audio and MIDI device settings window", "{}", [&app] (const var&)
    {
        auto& dm = app.getEngine().getDeviceManager().deviceManager;
        auto selector = std::make_unique<juce::AudioDeviceSelectorComponent> (dm, 0, 64, 0, 64, true, true, true, false);
        selector->setSize (560, 520);

        juce::DialogWindow::LaunchOptions o;
        o.content.setOwned (selector.release());
        o.dialogTitle = "Audio & MIDI Devices";
        o.dialogBackgroundColour = juce::Colour (0xff0b0d12);
        o.escapeKeyTriggersCloseButton = true;
        o.useNativeTitleBar = true;
        o.resizable = true;
        o.launchAsync();
        return var (true);
    });

    rpc.add ("devices.setInput", K::read, "Enables a physical input or splits a stereo pair into mono inputs", "{name, enabled?, stereo?}",
             [&app] (const var& p)
    {
        auto& tdm = app.getEngine().getDeviceManager();
        auto name = reqStr (p, "name");

        for (int i = 0; i < tdm.getNumWaveInDevices(); ++i)
        {
            if (auto* w = tdm.getWaveInDevice (i); w != nullptr && w->getName() == name)
            {
                if (has (p, "enabled"))  w->setEnabled (flag (p, "enabled"));
                if (has (p, "stereo"))   w->setStereoPair (flag (p, "stereo"));
                app.markProjectChanged();
                return var (true);
            }
        }

        for (int i = 0; i < tdm.getNumMidiInDevices(); ++i)
        {
            if (auto m = tdm.getMidiInDevice (i); m != nullptr && m->getName() == name)
            {
                if (has (p, "enabled"))
                    m->setEnabled (flag (p, "enabled"));

                return var (true);
            }
        }

        throw RpcError ("Input not found: " + name);
    });
}
}
