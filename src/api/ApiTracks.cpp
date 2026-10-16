#include "Api.h"

namespace s3
{
namespace
{
    using K = Rpc::Kind;

    const juce::uint32 palette[] = { 0xff7c5cff, 0xff00d1ff, 0xff21e6a5, 0xffffc857, 0xffff6b8b,
                                     0xff9b8cff, 0xff4dd4ff, 0xff7dffcf, 0xffffa25c, 0xffe86bff };

    te::AutomationMode automationModeFromName (const String& s)
    {
        if (s == "touch") return te::AutomationMode::touch;
        if (s == "latch") return te::AutomationMode::latch;
        if (s == "write") return te::AutomationMode::write;
        return te::AutomationMode::read;
    }

    te::InputDeviceInstance* findInstance (te::Edit& edit, const String& deviceName)
    {
        for (auto* in : edit.getAllInputDevices())
            if (in->getInputDevice().getName() == deviceName)
                return in;

        return nullptr;
    }

    void clearTrackInputs (te::Edit& edit, te::AudioTrack& t)
    {
        for (auto* in : edit.getAllInputDevices())
            if (in->getTargets().contains (t.itemID))
                [[maybe_unused]] auto r = in->removeTarget (t.itemID, &edit.getUndoManager());
    }

    te::Track* lastChildOf (te::FolderTrack& folder)
    {
        auto subs = folder.getAllSubTracks (false);
        return subs.isEmpty() ? nullptr : subs.getLast();
    }
}

juce::Colour nextTrackColour (te::Edit& edit)
{
    int count = 0;
    edit.visitAllTracksRecursive ([&] (te::Track& t) { if (t.isAudioTrack() || t.isFolderTrack()) ++count; return true; });
    return juce::Colour (palette[(size_t) count % std::size (palette)]);
}

void assignDefaultInput (AppEngine& app, te::AudioTrack& t, bool midi)
{
    auto& edit = app.edit();
    edit.getTransport().ensureContextAllocated();

    te::InputDeviceInstance* chosen = nullptr;

    for (auto* in : edit.getAllInputDevices())
    {
        auto type = in->getInputDevice().getDeviceType();
        const bool isMidiDevice = type == te::InputDevice::physicalMidiDevice || type == te::InputDevice::virtualMidiDevice;
        const bool isWave = type == te::InputDevice::waveDevice;

        if ((midi && isMidiDevice) || (! midi && isWave))
        {
            chosen = in;

            if (! midi && dynamic_cast<te::WaveInputDevice*> (&in->getInputDevice()) != nullptr)
                break;

            // "All MIDI Ins" takes every keyboard plus notes typed in the interface.
            if (auto* v = dynamic_cast<te::VirtualMidiInputDevice*> (&in->getInputDevice()); midi && v != nullptr && v->useAllInputs)
                break;
        }
    }

    if (chosen != nullptr)
        [[maybe_unused]] auto r = chosen->setTarget (t.itemID, false, &edit.getUndoManager(), 0);
}

te::Track::Ptr createTrack (AppEngine& app, const String& kind, const String& name, te::Track* insertAfter, te::FolderTrack* parent, te::Track* insertBefore)
{
    auto& edit = app.edit();

    te::TrackInsertPoint ip = insertBefore != nullptr ? te::TrackInsertPoint (*insertBefore, true)
                            : insertAfter != nullptr  ? te::TrackInsertPoint (insertAfter->getParentFolderTrack(), insertAfter)
                            : parent != nullptr       ? te::TrackInsertPoint (parent, lastChildOf (*parent))
                                                      : te::TrackInsertPoint::getEndOfTracks (edit);
    te::Track::Ptr track;

    if (kind == TrackKind::group)
    {
        track = edit.insertNewFolderTrack (ip, nullptr, true);
    }
    else
    {
        auto at = edit.insertNewAudioTrack (ip, nullptr, true);
        track = at;

        if (at != nullptr)
        {
            at->state.setProperty (TrackKind::property, kind, &edit.getUndoManager());

            if (kind == TrackKind::instrument)
            {
                insertPlugin (app, at->pluginList, "kit:piano", 0);
                assignDefaultInput (app, *at, true);
            }
            else if (kind == TrackKind::audio)
            {
                assignDefaultInput (app, *at, false);
            }

            at->state.setProperty ("s4monitor", "auto", &edit.getUndoManager());
        }
    }

    if (track == nullptr)
        throw RpcError ("Could not create the track");

    track->setName (name.isNotEmpty() ? name : (kind == TrackKind::group ? "Group" : kind == TrackKind::instrument ? "Instrument" : "Audio"));
    track->setColour (nextTrackColour (edit));
    return track;
}

te::PluginList& pluginListFor (AppEngine& app, const String& trackIdOrMaster)
{
    if (trackIdOrMaster.isEmpty() || trackIdOrMaster == "master")
        return app.edit().getMasterPluginList();

    return app.track (trackIdOrMaster).pluginList;
}

int createReturnBus (AppEngine& app, const String& name, const String& effectType, te::Track* insertAfter, te::Track* insertBefore)
{
    auto& edit = app.edit();
    int bus = 0;

    while (bus < 31 && edit.getAuxBusName (bus).isNotEmpty())
        ++bus;

    edit.setAuxBusName (bus, name);

    auto t = createTrack (app, TrackKind::fxReturn, name, insertAfter, nullptr, insertBefore);

    if (auto* at = dynamic_cast<te::AudioTrack*> (t.get()))
    {
        if (auto ret = edit.getPluginCache().createNewPlugin (te::AuxReturnPlugin::xmlTypeName, {}))
        {
            if (auto* r = dynamic_cast<te::AuxReturnPlugin*> (ret.get()))
                r->busNumber = bus;

            at->pluginList.insertPlugin (ret, 0, nullptr);
        }

        if (effectType.isNotEmpty())
            insertPlugin (app, at->pluginList, effectType, 1);
    }

    return bus;
}

void registerTrackApi (AppEngine& app)
{
    auto& rpc = app.rpc;

    rpc.add ("track.add", K::write, "Adds tracks", "{kind?: audio|instrument|group, name?, afterId?, beforeId?, parentId?, count?}",
             [&app] (const var& p)
    {
        auto kind = str (p, "kind", TrackKind::audio);
        auto* after = app.findTrack (str (p, "afterId"));
        auto* before = app.findTrack (str (p, "beforeId"));
        auto* parent = dynamic_cast<te::FolderTrack*> (app.findTrack (str (p, "parentId")));
        juce::Array<var> ids;

        for (int i = 0; i < juce::jlimit (1, 64, integer (p, "count", 1)); ++i)
        {
            auto name = str (p, "name");

            if (integer (p, "count", 1) > 1)
                name = (name.isNotEmpty() ? name : String ("Track")) + " " + String (i + 1);

            auto t = createTrack (app, kind, name, after, parent, before);
            after = t.get();
            ids.add (t->itemID.toString());
        }

        return var (ids);
    });

    rpc.add ("track.remove", K::write, "Deletes a track", "{id}", [&app] (const var& p)
    {
        app.edit().deleteTrack (&app.track (reqStr (p, "id")));
        return var (true);
    });

    rpc.add ("track.duplicate", K::write, "Duplicates a track with its clips and plug-ins", "{id}", [&app] (const var& p)
    {
        auto& t = app.track (reqStr (p, "id"));
        auto copy = app.edit().copyTrack (&t, te::TrackInsertPoint (t, false));

        if (copy == nullptr)
            throw RpcError ("Could not duplicate the track");

        copy->setName (t.getName() + " copy");
        return var (copy->itemID.toString());
    });

    rpc.add ("track.move", K::write, "Moves a track after another, or into a group", "{id, afterId?, parentId?}", [&app] (const var& p)
    {
        auto& t = app.track (reqStr (p, "id"));
        auto* after = app.findTrack (str (p, "afterId"));
        auto* parent = dynamic_cast<te::FolderTrack*> (app.findTrack (str (p, "parentId")));

        if (parent == nullptr && after != nullptr)
            parent = after->getParentFolderTrack();

        if (parent != nullptr && (parent == &t || parent->isAChildOf (t)))
            throw RpcError ("A group can't be moved into itself");

        app.edit().moveTrack (&t, te::TrackInsertPoint (parent, after));
        return var (true);
    });

    rpc.add ("track.set", K::write, "Changes track properties",
             "{id, name?, colour?, mute?, solo?, volumeDb?, pan?, output?: master|none|trackId|device:<output name>, automationMode?, role?}",
             [&app] (const var& p)
    {
        auto& t = app.track (reqStr (p, "id"));

        if (has (p, "name"))    t.setName (str (p, "name"));
        if (has (p, "colour"))  t.setColour (colourFromString (str (p, "colour"), t.getColour()));
        if (has (p, "mute"))    t.setMute (flag (p, "mute"));
        if (has (p, "solo"))    t.setSolo (flag (p, "solo"));
        if (has (p, "role"))    t.state.setProperty ("s3role", str (p, "role"), &app.edit().getUndoManager());
        if (has (p, "automationMode"))  t.automationMode = automationModeFromName (str (p, "automationMode"));

        te::VolumeAndPanPlugin* vp = nullptr;

        if (auto* at = dynamic_cast<te::AudioTrack*> (&t))      vp = at->getVolumePlugin();
        else if (auto* ft = dynamic_cast<te::FolderTrack*> (&t)) vp = ft->getVolumePlugin();

        if (vp != nullptr)
        {
            if (has (p, "volumeDb"))  vp->setVolumeDb (juce::jlimit (-100.0f, 15.0f, (float) num (p, "volumeDb")));
            if (has (p, "pan"))       vp->setPan (juce::jlimit (-1.0f, 1.0f, (float) num (p, "pan")));
        }

        if (has (p, "output"))
        {
            auto* at = dynamic_cast<te::AudioTrack*> (&t);

            if (at == nullptr)
                throw RpcError ("Only audio tracks have a routable output");

            auto out = str (p, "output");

            if (out == "master")
                at->getOutput().setOutputToDefaultDevice (false);
            else if (out == "none")
                at->getOutput().setOutputToNone();
            else if (out.startsWith ("device:"))
            {
                auto& tdm = app.getEngine().getDeviceManager();
                auto name = out.fromFirstOccurrenceOf (":", false, false);
                te::WaveOutputDevice* device = nullptr;

                for (int i = 0; i < tdm.getNumWaveOutDevices(); ++i)
                    if (auto* w = tdm.getWaveOutDevice (i); w != nullptr && w->getName() == name)
                        device = w;

                if (device == nullptr)
                    throw RpcError ("Output not found: " + name);

                at->getOutput().setOutputToDeviceID (device->getDeviceID());
            }
            else
            {
                auto& dest = app.audioTrack (out);

                if (&dest == at || dest.getOutput().feedsInto (at))
                    throw RpcError ("That routing would create a feedback loop");

                at->getOutput().setOutputToTrack (&dest);
            }
        }

        return var (true);
    });

    rpc.add ("track.arm", K::read, "Arms or disarms a track for recording", "{id, armed}", [&app] (const var& p)
    {
        auto& edit = app.edit();
        auto& t = app.audioTrack (reqStr (p, "id"));
        const bool arm = flag (p, "armed", true);
        bool found = false;

        edit.getTransport().ensureContextAllocated();

        for (auto* in : edit.getAllInputDevices())
        {
            if (in->getTargets().contains (t.itemID))
            {
                in->setRecordingEnabled (t.itemID, arm);
                found = true;
            }
        }

        if (! found && arm)
        {
            assignDefaultInput (app, t, getTrackKind (t) == TrackKind::instrument);

            for (auto* in : edit.getAllInputDevices())
            {
                if (in->getTargets().contains (t.itemID))
                {
                    in->setRecordingEnabled (t.itemID, true);
                    found = true;
                }
            }
        }

        if (! found && arm)
            throw RpcError ("No input is available. Pick an input device in Settings > Audio.");

        app.markProjectChanged();
        return var (true);
    });

    rpc.add ("track.setInput", K::write, "Chooses the input device for a track (empty for none)", "{id, input}", [&app] (const var& p)
    {
        auto& edit = app.edit();
        auto& t = app.audioTrack (reqStr (p, "id"));
        auto name = str (p, "input");
        bool wasArmed = false;

        for (auto* in : edit.getAllInputDevices())
            if (in->getTargets().contains (t.itemID) && in->isRecordingEnabled (t.itemID))
                wasArmed = true;

        clearTrackInputs (edit, t);

        if (name.isNotEmpty())
        {
            auto* in = findInstance (edit, name);

            if (in == nullptr)
                throw RpcError ("Input not found: " + name);

            auto r = in->setTarget (t.itemID, false, &edit.getUndoManager(), 0);

            if (! r)
                throw RpcError (r.error());

            if (wasArmed)
                in->setRecordingEnabled (t.itemID, true);
        }

        return var (true);
    });

    rpc.add ("track.setMonitor", K::write, "Input monitoring for this track only: auto (hear the input only while this track is recording), on (always), off (never)", "{id, mode}",
             [&app] (const var& p)
    {
        auto& edit = app.edit();
        auto& t = app.audioTrack (reqStr (p, "id"));
        auto mode = str (p, "mode", "auto");

        if (mode != "on" && mode != "off")
            mode = "auto";

        t.state.setProperty ("s4monitor", mode, &edit.getUndoManager());
        edit.restartPlayback();
        return var (true);
    });

    rpc.add ("master.set", K::write, "Master fader", "{volumeDb?, pan?}", [&app] (const var& p)
    {
        if (auto vp = app.edit().getMasterVolumePlugin())
        {
            if (has (p, "volumeDb"))  vp->setVolumeDb (juce::jlimit (-100.0f, 15.0f, (float) num (p, "volumeDb")));
            if (has (p, "pan"))       vp->setPan (juce::jlimit (-1.0f, 1.0f, (float) num (p, "pan")));
        }

        return var (true);
    });

    rpc.add ("bus.create", K::write, "Creates an FX return bus with an effect", "{name, effect?: reverb|delay|chorus|none, afterId?, beforeId?}",
             [&app] (const var& p)
    {
        auto effect = str (p, "effect", "reverb");
        String type = effect == "delay"  ? te::DelayPlugin::xmlTypeName
                    : effect == "chorus" ? te::ChorusPlugin::xmlTypeName
                    : effect == "none"   ? ""
                                         : te::ReverbPlugin::xmlTypeName;

        return var (createReturnBus (app, str (p, "name", "FX"), type,
                                     app.findTrack (str (p, "afterId")), app.findTrack (str (p, "beforeId"))));
    });

    rpc.add ("send.add", K::write, "Sends a track to an FX return bus", "{trackId, bus, gainDb?}", [&app] (const var& p)
    {
        auto& t = app.audioTrack (reqStr (p, "trackId"));
        const int bus = integer (p, "bus", 0);

        for (auto* existing : t.pluginList)
            if (auto* s = dynamic_cast<te::AuxSendPlugin*> (existing))
                if (s->getBusNumber() == bus)
                    throw RpcError ("This track already sends to that bus");

        auto plugin = t.pluginList.insertPlugin (te::AuxSendPlugin::create(), -1);
        auto* send = dynamic_cast<te::AuxSendPlugin*> (plugin.get());

        if (send == nullptr)
            throw RpcError ("Could not add the send");

        send->busNumber = bus;
        send->setGainDb ((float) num (p, "gainDb", -12.0));
        return var (send->itemID.toString());
    });

    rpc.add ("send.set", K::write, "Changes a send level or bypass", "{id, gainDb?, enabled?}", [&app] (const var& p)
    {
        auto* send = dynamic_cast<te::AuxSendPlugin*> (&app.plugin (reqStr (p, "id")));

        if (send == nullptr)
            throw RpcError ("Not a send");

        if (has (p, "gainDb"))   send->setGainDb (juce::jlimit (-100.0f, 6.0f, (float) num (p, "gainDb")));
        if (has (p, "enabled"))  send->setEnabled (flag (p, "enabled"));
        return var (true);
    });

    rpc.add ("send.remove", K::write, "Removes a send", "{id}", [&app] (const var& p)
    {
        app.plugin (reqStr (p, "id")).deleteFromParent();
        return var (true);
    });

    rpc.add ("group.create", K::write, "Creates a submix group and moves tracks into it", "{name?, trackIds}", [&app] (const var& p)
    {
        auto* ids = p["trackIds"].getArray();
        te::Track* first = (ids != nullptr && ! ids->isEmpty()) ? app.findTrack ((*ids)[0].toString()) : nullptr;
        auto group = createTrack (app, TrackKind::group, str (p, "name", "Group"),
                                  first != nullptr ? first->getSiblingTrack (-1, false) : nullptr);
        auto* folder = dynamic_cast<te::FolderTrack*> (group.get());

        if (ids != nullptr && folder != nullptr)
            for (auto& id : *ids)
                if (auto* t = app.findTrack (id.toString()); t != nullptr && t != folder)
                    app.edit().moveTrack (t, te::TrackInsertPoint (folder, lastChildOf (*folder)));

        return var (group->itemID.toString());
    });
}
}
