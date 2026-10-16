#include "ProjectState.h"
#include "AppEngine.h"
#include "LoudnessMeterPlugin.h"
#include "Instruments.h"

namespace s3
{
String getTrackKind (const te::Track& t)
{
    if (t.isFolderTrack())
        return TrackKind::group;

    auto kind = t.state[TrackKind::property].toString();
    return kind.isNotEmpty() ? kind : String (TrackKind::audio);
}

bool isChannelStripPlugin (const te::Plugin& p)
{
    return dynamic_cast<const te::VolumeAndPanPlugin*> (&p) != nullptr
        || dynamic_cast<const te::LevelMeterPlugin*> (&p) != nullptr
        || dynamic_cast<const te::AuxSendPlugin*> (&p) != nullptr
        || dynamic_cast<const te::AuxReturnPlugin*> (&p) != nullptr
        || dynamic_cast<const LoudnessMeterPlugin*> (&p) != nullptr;
}

var describeParameter (te::AutomatableParameter& p)
{
    // NaN or infinity would make the JSON unreadable for the interface.
    auto finite = [] (float v) { return std::isfinite (v) ? v : 0.0f; };

    Obj o;
    o.set ("id", p.paramID)
     .set ("name", p.getParameterName())
     .set ("value", finite (p.getCurrentValue()))
     .set ("norm", finite (p.getCurrentNormalisedValue()))
     .set ("text", p.getCurrentValueAsString())
     .set ("min", finite (p.valueRange.start))
     .set ("max", finite (p.valueRange.end))
     .set ("automated", p.hasAutomationPoints());

    if (auto def = p.getDefaultValue())
        o.set ("def", finite (*def));

    const auto span = p.valueRange.end - p.valueRange.start;

    if (p.valueRange.interval >= 1.0f && span >= 1.0f && span <= 24.0f)
    {
        juce::Array<var> options;

        for (float v = p.valueRange.start; v <= p.valueRange.end + 0.001f; v += p.valueRange.interval)
            options.add (Obj().set ("value", v).set ("norm", p.valueRange.convertTo0to1 (v)).set ("label", p.valueToString (v)));

        o.set ("options", options);
    }

    return o;
}

var describePlugin (te::Plugin& p, int maxParams)
{
    juce::Array<var> params;
    auto all = p.getAutomatableParameters();

    for (int i = 0; i < juce::jmin (maxParams, all.size()); ++i)
        params.add (describeParameter (*all[i]));

    auto* ext = dynamic_cast<te::ExternalPlugin*> (&p);

    Obj o;
    o.set ("id", p.itemID.toString())
     .set ("type", p.getPluginType())
     .set ("name", displayNameFor (p))
     .set ("vendor", p.getVendor())
     .set ("enabled", p.isEnabled())
     .set ("external", ext != nullptr)
     .set ("synth", p.isSynth())
     .set ("loaded", ext == nullptr || ext->isEnabled())
     .set ("hasEditor", ext != nullptr)
     .set ("numParams", all.size())
     .set ("params", params)
     .set ("canSidechain", p.canSidechain())
     .set ("sidechain", p.getSidechainSourceID().isValid() ? var (p.getSidechainSourceID().toString()) : var());

    if (ext != nullptr)
        o.set ("uid", ext->desc.createIdentifierString());

    return o;
}

var describeClip (te::Clip& c)
{
    auto& edit = c.edit;
    auto pos = c.getPosition();

    Obj o;
    o.set ("id", c.itemID.toString())
     .set ("name", c.getName())
     .set ("start", pos.getStart().inSeconds())
     .set ("end", pos.getEnd().inSeconds())
     .set ("offset", pos.getOffset().inSeconds())
     .set ("colour", colourToString (c.getColour()))
     .set ("muted", c.isMuted())
     .set ("speed", c.getSpeedRatio())
     .set ("looping", c.isLooping());

    if (auto* ac = dynamic_cast<te::AudioClipBase*> (&c))
    {
        auto file = ac->getCurrentSourceFile();
        te::AudioFile af (edit.engine, file);

        o.set ("kind", "audio")
         .set ("file", file.getFullPathName())
         .set ("sourceLength", af.getLength())
         .set ("channels", af.getNumChannels())
         .set ("gainDb", ac->getGainDB())
         .set ("pan", ac->getPan())
         .set ("fadeIn", ac->getFadeIn().inSeconds())
         .set ("fadeOut", ac->getFadeOut().inSeconds())
         .set ("pitch", ac->getPitchChange())
         .set ("reversed", ac->getIsReversed())
         .set ("autoTempo", ac->getAutoTempo());

        if (c.hasAnyTakes())
        {
            juce::Array<var> names;

            for (auto& n : c.getTakeDescriptions())
                names.add (n);

            o.set ("takes", Obj().set ("count", c.getNumTakes (true)).set ("current", c.getCurrentTake()).set ("names", names));
        }
    }
    else if (auto* mc = dynamic_cast<te::MidiClip*> (&c))
    {
        juce::Array<var> notes;
        auto& ts = edit.tempoSequence;
        const auto clipStartBeat = mc->getContentStartBeat();

        for (auto* n : mc->getSequence().getNotes())
        {
            const auto startBeat = clipStartBeat + toDuration (n->getStartBeat());
            const auto endBeat = startBeat + n->getLengthBeats();
            const auto startTime = ts.toTime (startBeat).inSeconds();
            const auto endTime = ts.toTime (endBeat).inSeconds();

            notes.add (var (juce::Array<var> { n->getNoteNumber(), startTime, endTime - startTime, n->getVelocity(),
                                               n->getStartBeat().inBeats(), n->getLengthBeats().inBeats() }));
        }

        o.set ("kind", "midi").set ("notes", notes);

        if (c.hasAnyTakes())
            o.set ("takes", Obj().set ("count", c.getNumTakes (true)).set ("current", c.getCurrentTake()));
    }
    else
    {
        o.set ("kind", "other");
    }

    return o;
}

static var describeAutomation (te::Track& t)
{
    juce::Array<var> lanes;

    for (auto* p : t.pluginList)
    {
        for (auto* param : p->getAutomatableParameters())
        {
            auto& curve = param->getCurve();

            if (curve.getNumPoints() == 0)
                continue;

            juce::Array<var> points;

            for (int i = 0; i < curve.getNumPoints(); ++i)
                points.add (var (juce::Array<var> { curve.getPointTime (i).inSeconds(), curve.getPointValue (i), curve.getPointCurve (i) }));

            lanes.add (Obj().set ("pluginId", p->itemID.toString())
                            .set ("paramId", param->paramID)
                            .set ("name", p->getName() + " / " + param->getParameterName())
                            .set ("min", param->valueRange.start)
                            .set ("max", param->valueRange.end)
                            .set ("points", points));
        }
    }

    return lanes;
}

static String automationModeName (te::AutomationMode m)
{
    switch (m)
    {
        case te::AutomationMode::touch:  return "touch";
        case te::AutomationMode::latch:  return "latch";
        case te::AutomationMode::write:  return "write";
        case te::AutomationMode::read:
        default:                         return "read";
    }
}

var describeTrack (AppEngine& app, te::Track& t)
{
    auto& edit = t.edit;

    Obj o;
    o.set ("id", t.itemID.toString())
     .set ("name", t.getName())
     .set ("kind", getTrackKind (t))
     .set ("colour", colourToString (t.getColour()))
     .set ("mute", t.isMuted (false))
     .set ("solo", t.isSolo (false))
     .set ("parent", t.getParentFolderTrack() != nullptr ? var (t.getParentFolderTrack()->itemID.toString()) : var())
     .set ("automationMode", automationModeName (t.automationMode.get()))
     .set ("automation", describeAutomation (t));

    juce::Array<var> inserts, sends;

    for (auto* p : t.pluginList)
    {
        if (auto* send = dynamic_cast<te::AuxSendPlugin*> (p))
            sends.add (Obj().set ("id", send->itemID.toString())
                            .set ("bus", send->getBusNumber())
                            .set ("busName", edit.getAuxBusName (send->getBusNumber()))
                            .set ("gainDb", send->getGainDb())
                            .set ("enabled", send->isEnabled()));
        else if (auto* ret = dynamic_cast<te::AuxReturnPlugin*> (p))
            o.set ("returnBus", ret->busNumber.get());
        else if (! isChannelStripPlugin (*p))
            inserts.add (describePlugin (*p));
    }

    o.set ("plugins", inserts).set ("sends", sends);

    if (auto* at = dynamic_cast<te::AudioTrack*> (&t))
    {
        if (auto* vp = at->getVolumePlugin())
            o.set ("volumeDb", vp->getVolumeDb())
             .set ("pan", vp->getPan())
             .set ("volumePluginId", vp->itemID.toString());

        auto& out = at->getOutput();
        String output = out.getDestinationTrack() != nullptr ? out.getDestinationTrack()->itemID.toString()
                      : out.outputsToNone()                    ? String ("none")
                      : out.usesDefaultAudioOut()              ? String ("master")
                                                               : "device:" + out.getOutputName();
        o.set ("output", output);

        String inputName;
        bool armed = false;
        bool live = false;
        String monitor = "auto";

        for (auto* instance : edit.getAllInputDevices())
        {
            if (instance->getTargets().contains (at->itemID))
            {
                inputName = instance->getInputDevice().getName();
                armed = instance->isRecordingEnabled (at->itemID);
                live = live || instance->isLivePlayEnabled (*at);

                switch (instance->getInputDevice().getMonitorMode())
                {
                    case te::InputDevice::MonitorMode::on:  monitor = "on"; break;
                    case te::InputDevice::MonitorMode::off: monitor = "off"; break;
                    default: break;
                }

                if (instance->getInputDevice().isMidi() || armed)
                    break;
            }
        }

        if (auto own = at->state.getProperty ("s4monitor").toString(); own.isNotEmpty())
            monitor = own;

        o.set ("input", inputName).set ("armed", armed).set ("monitor", monitor).set ("live", live);

        juce::Array<var> clips;

        for (auto* c : at->getClips())
            clips.add (describeClip (*c));

        o.set ("clips", clips);
    }
    else if (auto* ft = dynamic_cast<te::FolderTrack*> (&t))
    {
        if (auto* vca = ft->getVolumePlugin())
            o.set ("volumeDb", vca->getVolumeDb())
             .set ("pan", vca->getPan())
             .set ("volumePluginId", vca->itemID.toString());

        o.set ("clips", array());
    }

    (void) app;
    return o;
}

static String countInName (te::Edit::CountIn c)
{
    using C = te::Edit::CountIn;

    switch (c)
    {
        case C::oneBar:  return "oneBar";
        case C::twoBar:  return "twoBars";
        case C::oneBeat: return "oneBeat";
        case C::twoBeat: return "twoBeats";
        case C::none:
        default:         return "none";
    }
}

var buildProjectSnapshot (AppEngine& app)
{
    auto& edit = app.edit();
    auto& ts = edit.tempoSequence;
    auto& transport = edit.getTransport();

    juce::Array<var> tracks;

    edit.visitAllTracksRecursive ([&] (te::Track& t)
    {
        if (t.isAudioTrack() || t.isFolderTrack())
            tracks.add (describeTrack (app, t));

        return true;
    });

    juce::Array<var> markers;

    for (auto* m : edit.getMarkerManager().getMarkers())
        markers.add (Obj().set ("id", m->itemID.toString())
                          .set ("number", m->getMarkerID())
                          .set ("name", m->getName())
                          .set ("time", m->getPosition().getStart().inSeconds())
                          .set ("colour", colourToString (m->getColour())));

    juce::Array<var> tempos;

    for (int i = 0; i < ts.getNumTempos(); ++i)
        if (auto* tempo = ts.getTempo (i))
            tempos.add (Obj().set ("beat", tempo->getStartBeat().inBeats())
                             .set ("time", ts.toTime (tempo->getStartBeat()).inSeconds())
                             .set ("bpm", tempo->getBpm()));

    auto* sig = ts.getTimeSig (0);

    Obj master;
    juce::Array<var> masterPlugins;

    for (auto* p : edit.getMasterPluginList())
        if (! isChannelStripPlugin (*p))
            masterPlugins.add (describePlugin (*p));

    master.set ("plugins", masterPlugins);

    if (auto vp = edit.getMasterVolumePlugin())
        master.set ("volumeDb", vp->getVolumeDb())
              .set ("pan", vp->getPan())
              .set ("volumePluginId", vp->itemID.toString());

    juce::Array<var> buses;

    for (int i = 0; i < 32; ++i)
    {
        auto name = edit.getAuxBusName (i);

        if (name.isNotEmpty())
            buses.add (Obj().set ("bus", i).set ("name", name));
    }

    auto& um = edit.getUndoManager();
    auto punch = transport.getLoopRange();

    return Obj().set ("name", app.getEditFile().getFileNameWithoutExtension())
                .set ("file", app.getEditFile().getFullPathName())
                .set ("dir", app.getProjectDir().getFullPathName())
                .set ("length", edit.getLength().inSeconds())
                .set ("bpm", ts.getTempo (0) != nullptr ? ts.getTempo (0)->getBpm() : 120.0)
                .set ("timeSig", var (juce::Array<var> { sig != nullptr ? sig->numerator.get() : 4, sig != nullptr ? sig->denominator.get() : 4 }))
                .set ("tempos", tempos)
                .set ("markers", markers)
                .set ("tracks", tracks)
                .set ("master", master)
                .set ("buses", buses)
                .set ("click", edit.clickTrackEnabled.get())
                .set ("clickRecordOnly", edit.clickTrackRecordingOnly.get())
                .set ("clickGainDb", edit.clickTrackGain.get())
                .set ("countIn", countInName (edit.getCountInMode()))
                .set ("punch", edit.recordingPunchInOut.get())
                .set ("loop", var (juce::Array<var> { punch.getStart().inSeconds(), punch.getEnd().inSeconds() }))
                .set ("looping", transport.looping.get())
                .set ("canUndo", um.canUndo())
                .set ("canRedo", um.canRedo())
                .set ("undoName", um.getUndoDescription())
                .set ("redoName", um.getRedoDescription())
                .set ("modified", edit.hasChangedSinceSaved())
                .set ("sampleRate", edit.engine.getDeviceManager().getSampleRate());
}
}
