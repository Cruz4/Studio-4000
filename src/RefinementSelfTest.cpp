#include "RefinementSelfTest.h"
#include "StudioFx.h"
#include "ProjectState.h"
#include "api/Api.h"
#include "MonoSum.h"
#include <iostream>
#include <set>

namespace s3
{
int runRefinementSelfTest (AppEngine& app, const juce::File& manifest)
{
    int failures = 0;
    auto check = [&] (const String& name, bool ok, const String& detail = {})
    {
        if (!ok) ++failures;
        std::cout << (ok ? "[ ok ] " : "[FAIL] ") << name << " " << detail << std::endl;
    };
    auto call = [&] (const String& method, const var& p = var()) { return app.rpc.invoke (method, p, "selftest"); };
    auto directory = juce::File::getSpecialLocation (juce::File::tempDirectory).getNonexistentChildFile ("Studio4000 refinements", "", false);
    directory.createDirectory();
    try
    {
        call ("project.new", Obj().set ("dir", directory.getFullPathName()).set ("name", "Refinements").set ("template", "empty"));
        auto track = call ("track.add", Obj().set ("kind", "audio").set ("name", "Effect checks"))[0].toString();
        auto banks = juce::JSON::parse (manifest.loadFileAsString());
        check ("preset manifest exists", banks.isObject());
        int factoryCount = 0, presetCount = 0;
        const auto catalogue = builtInPluginCatalogue();
        for (auto& entry : *catalogue.getArray())
        {
            if ((bool) entry["synth"]) continue;
            const auto type = entry["id"].toString();
            auto added = call ("plugin.add", Obj().set ("trackId", track).set ("plugin", type));
            const auto id = added["id"].toString();
            auto defaults = call ("plugin.factoryPreset", Obj().set ("id", id));
            bool valid = defaults.isObject();
            auto& plugin = app.plugin (id);
            if (auto* obj = defaults.getDynamicObject())
                for (auto& item : obj->getProperties())
                {
                    auto param = plugin.getAutomatableParameterByID (item.name.toString());
                    valid = valid && param != nullptr && std::isfinite ((double) item.value);
                }
            if (valid) ++factoryCount;
            else check ("factory settings: " + type, false);
            te::Plugin::Ptr tested (&app.plugin (id));
            tested->deleteFromParent();
        }
        check ("every bundled effect has real factory settings", factoryCount >= 200, String (factoryCount));
        if (auto* object = banks.getDynamicObject())
            for (auto& bank : object->getProperties())
            {
                auto type = bank.name.toString();
                auto plugin = app.edit().getPluginCache().createNewPlugin (type, {});
                if (plugin == nullptr) { check ("preset processor " + type, false); continue; }
                if (auto* list = bank.value.getArray()) for (auto& preset : *list)
                {
                    bool valid = true;
                    String detail;
                    if (auto* values = preset["values"].getDynamicObject()) for (auto& item : values->getProperties())
                    {
                        auto param = plugin->getAutomatableParameterByID (item.name.toString());
                        const float v = (float) (double) item.value;
                        if (param == nullptr || !std::isfinite (v) || v < param->valueRange.start - .0001f || v > param->valueRange.end + .0001f)
                        { valid = false; detail << item.name.toString() << "=" << String (v) << " "; }
                    }
                    if (valid) ++presetCount;
                    else check (type + ": " + preset["name"].toString(), false, detail);
                }
            }
        check ("curated presets use valid real units and parameter IDs", presetCount >= 300, String (presetCount));

        const auto chainCatalogue = juce::JSON::parse (manifest.getSiblingFile ("track-chains.test.json").loadFileAsString());
        check ("track chain catalogue has 96 complete chains", chainCatalogue.isArray() && chainCatalogue.size() == 96);
        auto chainTrack = call ("track.add", Obj().set ("kind", "audio").set ("name", "Chain validation"))[0].toString();
        int chainCount = 0;
        std::map<String, int> categories;
        if (auto* chains = chainCatalogue.getArray()) for (auto& chain : *chains)
        {
            auto result = call ("chain.applyPreset", Obj().set ("trackId", chainTrack).set ("name", chain["name"]).set ("plugins", chain["plugins"]).set ("replace", true));
            bool settingsMatch = result["ids"].size() == chain["plugins"].size();
            for (int i = 0; i < result["ids"].size(); ++i)
            {
                auto& effect = app.plugin (result["ids"][i].toString());
                auto spec = chain["plugins"][i];
                settingsMatch = settingsMatch && effect.getPluginType() == spec["type"].toString();
                if (auto* values = spec["values"].getDynamicObject()) for (auto& item : values->getProperties())
                {
                    auto param = effect.getAutomatableParameterByID (item.name.toString());
                    const double value = (double) item.value;
                    settingsMatch = settingsMatch && param != nullptr && std::abs (param->getCurrentValue() - value) <= std::max (.001, std::abs (value) * .00001);
                }
            }
            check ("track chain applies real native settings: " + chain["name"].toString(), settingsMatch);
            ++chainCount; ++categories[chain["category"].toString()];
        }
        bool countsMatch = categories.size() == 8;
        for (auto& count : categories) countsMatch = countsMatch && count.second == 12;
        check ("every track-chain category contains twelve presets", chainCount == 96 && countsMatch);
        auto oldEffects = describeTrack (app, app.track (chainTrack))["plugins"];
        app.edit().getUndoManager().clearUndoHistory();
        call ("chain.applyPreset", Obj().set ("trackId", chainTrack).set ("plugins", chainCatalogue[0]["plugins"]).set ("replace", true));
        call ("edit.undo");
        check ("replacing a chain undoes as one step", juce::JSON::toString (describeTrack (app, app.track (chainTrack))["plugins"]) == juce::JSON::toString (oldEffects));
        call ("edit.redo");
        const auto beforeInvalid = juce::JSON::toString (describeTrack (app, app.track (chainTrack))["plugins"]);
        auto invalid = juce::JSON::parse ("[{\"type\":\"s4000comp\",\"values\":{\"notAParameter\":1}}]");
        auto rejected = app.rpc.call ("chain.applyPreset", Obj().set ("trackId", chainTrack).set ("plugins", invalid).set ("replace", true), "selftest");
        check ("invalid chain never removes the existing effects", !(bool) rejected["ok"] && beforeInvalid == juce::JSON::toString (describeTrack (app, app.track (chainTrack))["plugins"]));
        auto instrumentChainTrack = call ("track.add", Obj().set ("kind", "instrument").set ("name", "Instrument chain validation"))[0].toString();
        auto synthID = call ("plugin.add", Obj().set ("trackId", instrumentChainTrack).set ("plugin", "4osc"))["id"].toString();
        call ("chain.applyPreset", Obj().set ("trackId", instrumentChainTrack).set ("plugins", chainCatalogue[0]["plugins"]).set ("replace", true));
        check ("factory chains preserve the instrument", app.plugin (synthID).isSynth());
        call ("track.remove", Obj().set ("id", chainTrack));
        call ("track.remove", Obj().set ("id", instrumentChainTrack));

        auto make = [&] (const char* type) { return app.edit().getPluginCache().createNewPlugin (type, {}); };
        auto set = [&] (te::Plugin& p, const char* id, float v)
        {
            auto param = p.getAutomatableParameterByID (id);
            if (param == nullptr) throw RpcError ("Missing test parameter: " + String (id));
            param->setParameter (v, juce::dontSendNotification);
        };
        auto tone = [] (double sr, float hz, float amplitude, int seconds = 3)
        {
            juce::AudioBuffer<float> b (2, (int) sr * seconds);
            for (int i = 0; i < b.getNumSamples(); ++i)
                for (int c = 0; c < 2; ++c) b.setSample (c, i, amplitude * std::sin ((float) (juce::MathConstants<double>::twoPi * hz * i / sr)));
            return b;
        };
        auto rms = [] (const juce::AudioBuffer<float>& b) { return b.getRMSLevel (0, b.getNumSamples() / 2, b.getNumSamples() / 2); };
        auto process = [&] (te::Plugin& p, juce::AudioBuffer<float>& b, double rate)
        {
            auto* fx = dynamic_cast<StudioFxPlugin*> (&p);
            if (fx == nullptr) throw RpcError ("Processor has no offline test path");
            fx->processOffline (b, rate);
        };
        for (double rate : { 32000.0, 44100.0, 48000.0, 96000.0 })
        {
            const auto label = String ((int) rate) + " Hz ";
            auto mono = make ("s4000utility"); set (*mono, "mono", 1);
            juce::AudioBuffer<float> stereoCheck (2, 256);
            for (int i = 0; i < 256; ++i) { stereoCheck.setSample (0, i, .4f); stereoCheck.setSample (1, i, -.2f); }
            process (*mono, stereoCheck, rate);
            bool averaged = true;
            for (int i = 0; i < 256; ++i) for (int ch = 0; ch < 2; ++ch) averaged = averaged && std::abs (stereoCheck.getSample (ch, i) - .1f) < .000001f;
            check (label + "mono check averages L and R into both outputs", averaged);
            for (int i = 0; i < 256; ++i) { stereoCheck.setSample (0, i, .3f); stereoCheck.setSample (1, i, -.3f); }
            process (*mono, stereoCheck, rate);
            check (label + "mono check reveals opposite-polarity cancellation", stereoCheck.getMagnitude (0, 256) < .000001f);
            auto limiter = make ("s4000hardlimit"); set (*limiter, "input", 18); set (*limiter, "ceiling", -6);
            auto loud = tone (rate, 700, 4); process (*limiter, loud, rate);
            check (label + "hard limiter enforces sample ceiling", loud.getMagnitude (0, loud.getNumSamples()) <= std::pow (10.0f, -.3f) + .00001f);
            auto leveler = make ("s4000leveler"); set (*leveler, "target", -24); set (*leveler, "range", 18); set (*leveler, "release", 300);
            auto quiet = tone (rate, 220, .02f, 5); process (*leveler, quiet, rate);
            const float level = juce::Decibels::gainToDecibels (rms (quiet));
            check (label + "leveler converges to RMS target", std::abs (level + 24) < .5f, String (level));
            auto noise = tone (rate, 220, .001f); process (*leveler, noise, rate);
            check (label + "leveler does not lift noise below its floor", std::abs (rms (noise) - .0007071f) < .000001f);
            auto tube = make ("s4000tubecomp"); set (*tube, "drive", 0); set (*tube, "ratio", 1);
            auto dry = tone (rate, 220, .7f); process (*tube, dry, rate);
            set (*tube, "ratio", 6); auto compressed = tone (rate, 220, .7f); process (*tube, compressed, rate);
            check (label + "tube compressor reduces sustained peaks", rms (compressed) < rms (dry) * .63f);
            auto dynamics = make ("s4000vocaldynamics"); auto floor = tone (rate, 1000, .001f); process (*dynamics, floor, rate);
            check (label + "dynamics attenuates pauses by its expansion curve", rms (floor) < .00025f && rms (floor) > .00010f, String (rms (floor), 8));
            auto enhancer = make ("s4000vocalenhancer"); set (*enhancer, "highpass", 20); set (*enhancer, "presence", 6); set (*enhancer, "air", 0); set (*enhancer, "excite", 0); set (*enhancer, "output", 0);
            auto presence = tone (rate, 3500, .1f); process (*enhancer, presence, rate);
            const float boost = juce::Decibels::gainToDecibels (rms (presence) / .0707107f);
            check (label + "enhancer presence is a measured 6 dB lift", std::abs (boost - 6) < .3f, String (boost));
            for (const char* type : { "s4000leveler", "s4000hardlimit", "s4000tubecomp", "s4000vocaldynamics", "s4000vocalenhancer" })
            {
                auto p = make (type);
                for (bool maximum : { false, true })
                {
                    for (auto* param : p->getAutomatableParameters()) param->setParameter (maximum ? param->valueRange.end : param->valueRange.start, juce::dontSendNotification);
                    auto b = tone (rate, 997, .6f, 1); process (*p, b, rate);
                    bool finite = true;
                    for (int c = 0; c < 2; ++c) for (int i = 0; i < b.getNumSamples(); ++i) finite = finite && std::isfinite (b.getSample (c, i));
                    check (label + type + (maximum ? " maximum controls remain finite" : " minimum controls remain finite"), finite);
                }
            }
        }

        // Exercise the exact batch RPC used by Alt-drag, at overlapping positions
        // and across tracks, then undo and redo the finished drop.
        auto midiTrack = call ("track.add", Obj().set ("kind", "instrument").set ("name", "Copy source"))[0].toString();
        auto target = call ("track.add", Obj().set ("kind", "instrument").set ("name", "Copy destination"))[0].toString();
        auto source = call ("clip.addMidi", Obj().set ("trackId", midiTrack).set ("start", 1).set ("end", 3)).toString();
        juce::Array<var> calls;
        for (int i = 0; i < 24; ++i) calls.add (Obj().set ("method", "clip.duplicate").set ("params", Obj().set ("id", source).set ("start", i % 3 == 0 ? 1.0 : i * .25).set ("trackId", i % 2 ? target : midiTrack)));
        auto copies = call ("batch.run", Obj().set ("label", "Copy clips").set ("calls", calls));
        std::set<std::string> unique;
        bool valid = copies.size() == 24;
        for (int i = 0; i < copies.size(); ++i)
        {
            const auto id = copies[i].toString(); unique.insert (id.toStdString());
            auto& copy = app.clip (id);
            valid = valid && copy.getClipTrack()->itemID.toString() == (i % 2 ? target : midiTrack)
                && std::abs (copy.getPosition().getStart().inSeconds() - (i % 3 == 0 ? 1.0 : i * .25)) < .000001;
        }
        check ("Alt-drag batch copies keep unique IDs, tracks and positions", valid && unique.size() == 24 && !unique.count (source.toStdString()));
        call ("edit.undo"); check ("duplicate drop undoes as one action", app.audioTrack (target).getClips().isEmpty());
        call ("edit.redo"); check ("duplicate drop redoes as one action", app.audioTrack (target).getClips().size() == 12);
        auto destination = call ("track.add", Obj().set ("kind", "audio").set ("name", "Audio copy destination"))[0].toString();
        const auto audioFile = app.getAudioDir().getChildFile ("copy-source.wav");
        {
            auto samples = tone (48000, 220, .2f);
            juce::WavAudioFormat format;
            std::unique_ptr<juce::OutputStream> out (audioFile.createOutputStream().release());
            auto writer = format.createWriterFor (out, juce::AudioFormatWriterOptions{}.withSampleRate (48000).withNumChannels (2).withBitsPerSample (24));
            if (writer == nullptr || !writer->writeFromAudioSampleBuffer (samples, 0, samples.getNumSamples())) throw RpcError ("Could not write audio-copy fixture");
        }
        auto audio = call ("clip.importAudio", Obj().set ("trackId", track).set ("file", audioFile.getFullPathName()).set ("start", 2)).toString();
        call ("clip.set", Obj().set ("id", audio).set ("fadeIn", .2).set ("fadeOut", .3).set ("fadeInBend", .4).set ("gainDb", -3.0));
        call ("clip.setGainPoints", Obj().set ("id", audio).set ("points", juce::JSON::parse ("[[0,-3],[1,0],[2,-6]]")));
        call ("clip.setPanPoints", Obj().set ("id", audio).set ("points", juce::JSON::parse ("[[0,-0.2],[2,0.2]]")));
        call ("plugin.add", Obj().set ("clipId", audio).set ("plugin", "s4000comp"));
        calls.clear();
        for (int i = 0; i < 24; ++i) calls.add (Obj().set ("method", "clip.duplicate").set ("params", Obj().set ("id", audio).set ("start", i % 3 == 0 ? 2.0 : i * .25).set ("trackId", i % 2 ? destination : track)));
        copies = call ("batch.run", Obj().set ("label", "Copy audio clips").set ("calls", calls));
        unique.clear(); valid = copies.size() == 24;
        std::function<void (const juce::ValueTree&)> collectIDs = [&] (const juce::ValueTree& state)
        {
            if (state.hasProperty (te::IDs::id)) valid = unique.insert (state[te::IDs::id].toString().toStdString()).second && valid;
            for (auto child : state) collectIDs (child);
        };
        collectIDs (app.clip (audio).state);
        for (int i = 0; i < copies.size(); ++i)
        {
            auto& copy = app.clip (copies[i].toString());
            collectIDs (copy.state);
            auto* ac = dynamic_cast<te::AudioClipBase*> (&copy);
            const auto description = describeClip (copy);
            valid = valid && ac != nullptr && description["gainPoints"].size() == 3 && description["panPoints"].size() == 2
                && std::abs ((double) description["fadeIn"] - .2) < .001
                && std::abs ((double) description["fadeInBend"] - .4) < .001
                && std::abs (ac->getGainDB() + 3) < .001
                && std::abs (copy.getPosition().getLength().inSeconds() - 3) < .001
                && copy.getClipTrack()->itemID.toString() == (i % 2 ? destination : track);
        }
        check ("audio Alt-drag preserves fades, envelopes and effect IDs without collisions", valid, String ((int) unique.size()) + " independent IDs");
        check ("audio Alt-drag leaves original in place", std::abs (app.clip (audio).getPosition().getStart().inSeconds() - 2) < .00001);
        call ("edit.undo"); check ("audio drop undoes as one action", app.audioTrack (destination).getClips().isEmpty());
        call ("edit.redo"); check ("audio drop redoes as one action", app.audioTrack (destination).getClips().size() == 12);

        auto fadedCopy = call ("clip.duplicate", Obj().set ("id", audio).set ("trackId", destination).set ("start", 2.5).set ("fadeIn", .7).set ("fadeOut", .6)).toString();
        auto faded = describeClip (app.clip (fadedCopy));
        check ("copy drop immediately stores its overlap fades", std::abs ((double) faded["fadeIn"] - .7) < .0001 && std::abs ((double) faded["fadeOut"] - .6) < .0001);
        check ("copy overlap fades do not change the original", std::abs ((double) describeClip (app.clip (audio))["fadeIn"] - .2) < .0001);

        auto splitTrack = call ("track.add", Obj().set ("kind", "audio").set ("name", "Split range audio"))[0].toString();
        call ("clip.importAudio", Obj().set ("trackId", splitTrack).set ("file", audioFile.getFullPathName()).set ("start", 2));
        auto splitMidi = call ("track.add", Obj().set ("kind", "instrument").set ("name", "Split range MIDI"))[0].toString();
        call ("clip.addMidi", Obj().set ("trackId", splitMidi).set ("start", 1).set ("end", 6));
        app.edit().getUndoManager().clearUndoHistory();
        calls.clear();
        for (double boundary : { 4.0, 3.0 }) calls.add (Obj().set ("method", "clip.splitAt").set ("params", Obj().set ("time", boundary)));
        call ("batch.run", Obj().set ("label", "Split at selection boundaries").set ("calls", calls));
        check ("selection boundaries split audio and MIDI across tracks", app.audioTrack (splitTrack).getClips().size() == 3 && app.audioTrack (splitMidi).getClips().size() == 3);
        check ("splitting an existing boundary is a no-op", (int) call ("clip.splitAt", Obj().set ("time", 3)) == 0);
        call ("edit.undo");
        check ("both selection boundaries undo as one action", app.audioTrack (splitTrack).getClips().size() == 1 && app.audioTrack (splitMidi).getClips().size() == 1);
        call ("edit.redo");

        auto bus = call ("track.add", Obj().set ("kind", "group").set ("name", "Print bus"))[0].toString();
        auto printSource = call ("track.add", Obj().set ("kind", "audio").set ("name", "Print source").set ("parentId", bus))[0].toString();
        auto printClip = call ("clip.importAudio", Obj().set ("trackId", printSource).set ("file", audioFile.getFullPathName()).set ("start", 1)).toString();
        dynamic_cast<te::WaveAudioClip&> (app.clip (printClip)).setUsesProxy (false);
        auto printEQ = call ("plugin.add", Obj().set ("trackId", printSource).set ("plugin", "s4000eq"))["id"].toString();
        call ("plugin.setParam", Obj().set ("id", printEQ).set ("paramId", "output").set ("value", -6));
        auto busEQ = call ("plugin.add", Obj().set ("trackId", bus).set ("plugin", "s4000eq"))["id"].toString();
        call ("plugin.setParam", Obj().set ("id", busEQ).set ("paramId", "output").set ("value", -12));
        call ("track.set", Obj().set ("id", printSource).set ("volumeDb", -3));
        call ("track.set", Obj().set ("id", bus).set ("volumeDb", -5));
        app.edit().getUndoManager().clearUndoHistory();
        auto printed = call ("track.bounce", Obj().set ("id", printSource).set ("tailSeconds", .5));
        auto& printedTrack = app.audioTrack (printed["trackId"].toString());
        check ("bounce creates a track directly under its source", printedTrack.state.getParent() == app.track (printSource).state.getParent() && printedTrack.state.getParent().indexOf (printedTrack.state) == printedTrack.state.getParent().indexOf (app.track (printSource).state) + 1);
        check ("bounce has no duplicate insert chain and mutes the editable source", describeTrack (app, printedTrack)["plugins"].size() == 0 && app.track (printSource).isMuted (false));
        check ("bounce preserves the source timeline position", std::abs (app.clip (printed["clipId"].toString()).getPosition().getStart().inSeconds() - 1) < .0001);
        std::unique_ptr<juce::AudioFormatReader> printedReader (app.getEngine().getAudioFileFormatManager().readFormatManager.createReaderFor (juce::File (printed["file"].toString())));
        bool rendered = printedReader && printedReader->lengthInSamples > 48000;
        double levelDb = -100;
        if (rendered)
        {
            juce::AudioBuffer<float> renderedSamples (2, 24000);
            printedReader->read (&renderedSamples, 0, 24000, 24000, true, true);
            levelDb = juce::Decibels::gainToDecibels (renderedSamples.getRMSLevel (0, 0, 24000) / (.2f / std::sqrt (2.0f)));
            rendered = std::abs (levelDb + 9) < .5;
        }
        check ("bounce bakes track EQ and fader without baking the parent twice", rendered, String (levelDb, 3) + " dB");
        check ("bounce restores the parent effects", app.plugin (busEQ).isEnabled());
        call ("edit.undo");
        check ("bounce undoes as one step", app.findTrack (printed["trackId"].toString()) == nullptr && !app.track (printSource).isMuted (false), "track removed=" + String (app.findTrack (printed["trackId"].toString()) == nullptr ? 1 : 0) + " source muted=" + String (app.track (printSource).isMuted (false) ? 1 : 0));
        call ("edit.redo");
        check ("bounce redo restores its rendered track", app.findTrack (printed["trackId"].toString()) != nullptr);

        app.edit().getUndoManager().clearUndoHistory();
        auto groupPrinted = call ("track.bounce", Obj().set ("id", bus).set ("tailSeconds", .5));
        auto& groupPrintedTrack = app.audioTrack (groupPrinted["trackId"].toString());
        const auto groupPrintedDescription = describeTrack (app, groupPrintedTrack);
        check ("group bounce creates its FX print outside and directly after the bus",
               groupPrintedTrack.getParentFolderTrack() == app.track (bus).getParentFolderTrack()
                   && groupPrintedTrack.state.getParent().indexOf (groupPrintedTrack.state) == app.track (bus).state.getParent().indexOf (app.track (bus).state) + 1);
        check ("group bounce labels the baked track and mutes the editable bus",
               groupPrintedDescription["bouncedFrom"].toString() == bus && (bool) groupPrintedDescription["bouncedGroup"]
                   && groupPrintedTrack.getName().contains ("group FX print") && app.track (bus).isMuted (false));
        std::unique_ptr<juce::AudioFormatReader> groupPrintedReader (app.getEngine().getAudioFileFormatManager().readFormatManager.createReaderFor (juce::File (groupPrinted["file"].toString())));
        check ("group bounce renders its child audio through the bus effects", groupPrintedReader != nullptr && groupPrintedReader->lengthInSamples > 48000);
        call ("edit.undo");
        check ("group bounce undoes the printed track and source mute together", app.findTrack (groupPrinted["trackId"].toString()) == nullptr && ! app.track (bus).isMuted (false));
        call ("edit.redo");
        check ("group bounce redo restores the print and bus mute", app.findTrack (groupPrinted["trackId"].toString()) != nullptr && app.track (bus).isMuted (false));

        auto monoReturn = call ("track.add", Obj().set ("kind", "return").set ("name", "Mono return"))[0].toString();
        for (auto id : { printSource, splitMidi, bus, monoReturn })
        {
            const auto before = describeTrack (app, app.track (id));
            call ("track.set", Obj().set ("id", id).set ("sumToMono", true));
            const auto on = describeTrack (app, app.track (id));
            check ("mono check is available on " + on["kind"].toString() + " tracks", (bool) on["sumToMono"] && before["channels"] == on["channels"] && before["plugins"].size() == on["plugins"].size());
            call ("track.set", Obj().set ("id", id).set ("sumToMono", false));
            check ("mono check restores stereo on " + on["kind"].toString() + " tracks", !sumsToMono (app.track (id).pluginList));
        }
        call ("master.set", Obj().set ("sumToMono", true));
        check ("master mono check is exposed in the session", (bool) call ("project.get")["master"]["sumToMono"]);
        call ("master.set", Obj().set ("sumToMono", false));
        check ("master mono check restores stereo", !sumsToMono (app.edit().getMasterPluginList()));
        call ("track.set", Obj().set ("id", printSource).set ("sumToMono", true));
        call ("chain.applyPreset", Obj().set ("trackId", printSource).set ("plugins", chainCatalogue[0]["plugins"]).set ("replace", true));
        check ("replacing effects preserves the independent mono check", sumsToMono (app.track (printSource).pluginList));
        call ("track.set", Obj().set ("id", printSource).set ("sumToMono", false));

    }
    catch (const std::exception& e) { check ("refinement test completes", false, e.what()); }
    std::cout << (failures ? "REFINEMENT SELFTEST FAILED" : "REFINEMENT SELFTEST PASSED") << std::endl;
    return failures ? 1 : 0;
}
}
