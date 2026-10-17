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
        || dynamic_cast<const LoudnessMeterPlugin*> (&p) != nullptr
        || (bool) p.state["s4format"]
        || p.state["s4chain"].toString().isNotEmpty();
}

int chainMixPercent (const te::PluginList& list)
{
    for (auto* p : list)
        if (p != nullptr && p->state["s4chain"].toString() == "wet")
            for (auto* param : p->getAutomatableParameters())
                if (param->paramID == "mix")
                    return juce::roundToInt (param->getCurrentValue());

    return 100;
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

namespace
{
    const juce::Identifier clipGainTag { "s3clipGain" };

    te::VolumeAndPanPlugin* clipGainPlugin (te::AudioClipBase& ac, bool create)
    {
        auto* list = ac.getPluginList();

        if (list == nullptr)
            return nullptr;

        for (auto* plugin : list->getPlugins())
            if (auto* vol = dynamic_cast<te::VolumeAndPanPlugin*> (plugin))
                if (vol->state[clipGainTag])
                    return vol;

        if (! create)
            return nullptr;

        auto created = list->insertPlugin (te::VolumeAndPanPlugin::create(), -1);
        auto* vol = dynamic_cast<te::VolumeAndPanPlugin*> (created.get());

        if (vol == nullptr)
            return nullptr;

        vol->state.setProperty (clipGainTag, true, ac.getUndoManager());
        vol->setVolumeDb (0.0f);
        return vol;
    }

    te::AutomationCurve* clipGainCurve (te::AudioClipBase& ac, te::VolumeAndPanPlugin& vol, bool create)
    {
        auto* curves = ac.getAutomationCurveList (create);

        if (curves == nullptr)
            return nullptr;

        const te::AutomatableParameterID want { vol.itemID, vol.volParam->paramID };

        for (auto item : curves->getItems())
            if (item != nullptr && item->getDestID() == want)
                return &item->getCurve (te::CurveModifierType::absolute).curve;

        if (! create || vol.volParam == nullptr)
            return nullptr;

        auto mod = curves->addCurve (*vol.volParam);
        return mod != nullptr ? &mod->getCurve (te::CurveModifierType::absolute).curve : nullptr;
    }

    void clearClipGain (te::AudioClipBase& ac)
    {
        auto* vol = clipGainPlugin (ac, false);

        if (vol == nullptr)
            return;

        auto* um = ac.getUndoManager();

        if (auto* curve = clipGainCurve (ac, *vol, false))
            curve->clear (um);

        if (auto* curves = ac.getAutomationCurveList (false))
            for (int i = (int) curves->getItems().size(); --i >= 0;)
                if (curves->getItems()[(size_t) i] != nullptr && curves->getItems()[(size_t) i]->getDestID().paramID == vol->volParam->paramID)
                    curves->removeCurve (i);

        vol->deleteFromParent();
    }

    juce::Array<var> clipGainPointVars (te::AudioClipBase& ac)
    {
        juce::Array<var> out;
        auto* vol = clipGainPlugin (ac, false);
        auto* curve = vol != nullptr ? clipGainCurve (ac, *vol, false) : nullptr;

        if (curve == nullptr)
            return out;

        const double clipStart = ac.getPosition().getStart().inSeconds();
        const double content = ac.getContentStartBeat().inBeats();
        auto& ts = ac.edit.tempoSequence;

        for (int i = 0; i < curve->getNumPoints(); ++i)
        {
            const double beats = te::toBeats (curve->getPointPosition (i), ts).inBeats();
            const double time = ts.toTime (te::BeatPosition::fromBeats (content + beats)).inSeconds();
            const float db = te::volumeFaderPositionToDB (curve->getPointValue (i));
            out.add (var (juce::Array<var> { time - clipStart, std::round (db * 10.0) / 10.0 }));
        }

        return out;
    }
}

void setClipGainPoints (te::AudioClipBase& ac, const juce::Array<juce::var>& points)
{
    if (points.isEmpty())
    {
        clearClipGain (ac);
        return;
    }

    auto* vol = clipGainPlugin (ac, true);
    auto* curve = vol != nullptr ? clipGainCurve (ac, *vol, true) : nullptr;

    if (vol == nullptr || curve == nullptr || vol->volParam == nullptr)
        return;

    auto* um = ac.getUndoManager();
    curve->clear (um);

    const double clipStart = ac.getPosition().getStart().inSeconds();
    const double content = ac.getContentStartBeat().inBeats();
    auto& ts = ac.edit.tempoSequence;

    for (const auto& pt : points)
    {
        if (! pt.isArray() || pt.size() < 2)
            continue;

        const double local = (double) pt[0];
        const float db = juce::jlimit (-48.0f, 12.0f, (float) (double) pt[1]);
        const float fader = vol->volParam->valueRange.snapToLegalValue (te::decibelsToVolumeFaderPosition (db));
        const double beats = ts.toBeats (te::TimePosition::fromSeconds (clipStart + local)).inBeats() - content;
        curve->addPoint (te::BeatPosition::fromBeats (juce::jmax (0.0, beats)), fader, 0.0f, um);
    }
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

        juce::Array<var> clipPlugins;
        auto* list = ac->getPluginList();

        if (list != nullptr)
            for (auto* p : *list)
                if (p != nullptr && ! isChannelStripPlugin (*p))
                    clipPlugins.add (describePlugin (*p));

        o.set ("plugins", clipPlugins)
         .set ("fxMix", list != nullptr ? chainMixPercent (*list) : 100)
         .set ("kind", "audio")
         .set ("file", file.getFullPathName())
         .set ("sourceLength", af.getLength())
         .set ("channels", af.getNumChannels())
         .set ("gainDb", ac->getGainDB())
         .set ("gainPoints", clipGainPointVars (*ac))
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
     .set ("channels", (int) t.state.getProperty ("s4channels", 2) <= 1 ? 1 : 2)
     .set ("colour", colourToString (t.getColour()))
     .set ("mute", t.isMuted (false))
     .set ("solo", t.isSolo (false))
     .set ("parent", t.getParentFolderTrack() != nullptr ? var (t.getParentFolderTrack()->itemID.toString()) : var())
     .set ("automationMode", automationModeName (t.automationMode.get()))
     .set ("automation", describeAutomation (t))
     .set ("fxMix", chainMixPercent (t.pluginList));

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
        auto* bus = at->getParentFolderTrack();
        // A track inside a bus is heard through that bus, even when the bus is empty of effects.
        String output = bus != nullptr && bus->isSubmixFolder() ? bus->itemID.toString()
                      : out.getDestinationTrack() != nullptr    ? out.getDestinationTrack()->itemID.toString()
                      : out.outputsToNone()                     ? String ("none")
                      : out.usesDefaultAudioOut()               ? String ("master")
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
