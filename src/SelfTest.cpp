#include "SelfTest.h"
#include "LoudnessMeterPlugin.h"
#include "StudioFx.h"
#include "Instruments.h"

namespace s3
{
namespace
{
    juce::File writeTestTone (const juce::File& file, bool speechLike, double seconds, double sampleRate = 48000.0)
    {
        juce::AudioBuffer<float> buffer (2, (int) (seconds * sampleRate));

        for (int i = 0; i < buffer.getNumSamples(); ++i)
        {
            const double t = i / sampleRate;
            float v = 0.0f;

            if (speechLike)
            {
                // 1.2 s phrases with 1.6 s pauses, harmonic-rich like a voice
                const bool on = std::fmod (t, 2.8) < 1.2;
                const double env = on ? std::sin (juce::MathConstants<double>::pi * std::fmod (t, 2.8) / 1.2) : 0.0;

                for (int h = 1; h <= 6; ++h)
                    v += (float) (std::sin (2.0 * juce::MathConstants<double>::pi * 180.0 * h * t) / h);

                v *= (float) (0.25 * env);
            }
            else
            {
                for (double f : { 110.0, 220.0, 277.18, 329.63 })
                    v += (float) (0.12 * std::sin (2.0 * juce::MathConstants<double>::pi * f * t));
            }

            buffer.setSample (0, i, v);
            buffer.setSample (1, i, v);
        }

        file.deleteFile();
        juce::WavAudioFormat wav;
        std::unique_ptr<juce::OutputStream> out (file.createOutputStream().release());

        if (auto writer = wav.createWriterFor (out, juce::AudioFormatWriterOptions{}.withSampleRate (sampleRate)
                                                                                    .withNumChannels (2)
                                                                                    .withBitsPerSample (24)))
            writer->writeFromAudioSampleBuffer (buffer, 0, buffer.getNumSamples());

        return file;
    }

    double measureFileLufs (te::Engine& engine, const juce::File& file)
    {
        std::unique_ptr<juce::AudioFormatReader> reader (engine.getAudioFileFormatManager().readFormatManager.createReaderFor (file));

        if (reader == nullptr)
            return LoudnessAnalyzer::silence;

        LoudnessAnalyzer a;
        a.prepare (reader->sampleRate, 2);
        juce::AudioBuffer<float> buffer (2, 32768);

        for (juce::int64 pos = 0; pos < reader->lengthInSamples; pos += buffer.getNumSamples())
        {
            const int n = (int) juce::jmin ((juce::int64) buffer.getNumSamples(), reader->lengthInSamples - pos);
            reader->read (&buffer, 0, n, pos, true, true);
            const float* ptrs[2] = { buffer.getReadPointer (0), buffer.getReadPointer (1) };
            a.process (ptrs, 2, n);
        }

        return a.getIntegratedLufs();
    }
}

SelfTest::SelfTest (AppEngine& a, const String& commandLine, std::function<void (int)> onFinished)
    : app (a), finished (std::move (onFinished))
{
    auto reportArg = commandLine.fromFirstOccurrenceOf ("--report=", false, false).upToFirstOccurrenceOf (" ", false, false).unquoted();
    reportFile = reportArg.isNotEmpty() ? juce::File (reportArg)
                                        : juce::File::getSpecialLocation (juce::File::currentExecutableFile).getSiblingFile ("selftest-report.json");

    workDir = juce::File::getSpecialLocation (juce::File::tempDirectory).getChildFile ("Studio4000 selftest");
    workDir.deleteRecursively();
    workDir.createDirectory();

    app.sendEvent = [this] (const String& type, const var& payload)
    {
        if (type == "render" && payload["state"].toString() == "done" && (int) payload["job"] == waitingForJob)
        {
            waitingForJob = -1;

            if (auto* files = payload["files"].getArray())
                renderedFiles.addArray (*files);

            check ("render job " + payload["job"].toString() + " finished",
                   payload["errors"].toString().isEmpty(), payload["errors"].toString());
        }
    };

    startTimer (50);
}

SelfTest::~SelfTest()
{
    stopTimer();
    app.sendEvent = nullptr;
}

var SelfTest::call (const String& method, const var& params)
{
    auto r = app.rpc.call (method, params, "selftest");

    if (! (bool) r["ok"])
        check (method, false, r["error"].toString());

    return r["result"];
}

void SelfTest::check (const String& name, bool ok, const String& detail)
{
    if (! ok)
        ++failures;

    results.add (Obj().set ("check", name).set ("ok", ok).set ("detail", detail));
    std::cout << (ok ? "[ ok ] " : "[FAIL] ") << name << (detail.isNotEmpty() ? "  (" + detail + ")" : String()) << std::endl;
}

void SelfTest::timerCallback()
{
    if (waitingForJob >= 0)
    {
        if (juce::Time::getMillisecondCounter() - waitStarted > 180000)
        {
            check ("render finished in time", false);
            waitingForJob = -1;
        }

        return;
    }

    stopTimer();

    try
    {
        if (! runStep())
        {
            finish();
            return;
        }
    }
    catch (const std::exception& e)
    {
        check ("step " + String (step), false, e.what());
    }

    ++step;
    startTimer (50);
}

bool SelfTest::runStep()
{
    switch (step)
    {
        case 0:
        {
            call ("project.new", Obj().set ("name", "Selftest").set ("dir", workDir.getFullPathName()).set ("template", "vocal").set ("bpm", 100));
            auto snap = app.rpc.invoke ("project.get", {}, "selftest");
            check ("project created from the vocal template", snap["tracks"].getArray() != nullptr && snap["tracks"].getArray()->size() >= 6,
                   String (snap["tracks"].getArray() != nullptr ? snap["tracks"].getArray()->size() : 0) + " tracks");

            for (auto& t : *snap["tracks"].getArray())
                ids[t["name"].toString()] = t["id"].toString();

            return true;
        }

        case 1:
        {
            auto voice = writeTestTone (workDir.getChildFile ("voice.wav"), true, 12.0);
            auto music = writeTestTone (workDir.getChildFile ("music.wav"), false, 12.0);

            ids["voiceClip"] = call ("clip.importAudio", Obj().set ("trackId", ids["Lead Vocal"]).set ("file", voice.getFullPathName()).set ("start", 0.0)).toString();
            ids["musicClip"] = call ("clip.importAudio", Obj().set ("trackId", ids["Beat"]).set ("file", music.getFullPathName()).set ("start", 0.0)).toString();
            check ("audio imported", ids["voiceClip"].isNotEmpty() && ids["musicClip"].isNotEmpty());
            check ("imported audio copied into the project", app.getProjectDir().getChildFile ("Imported").getChildFile ("voice.wav").existsAsFile());

            auto peaks = call ("media.peaks", Obj().set ("file", app.getProjectDir().getChildFile ("Imported/voice.wav").getFullPathName()));
            check ("waveform peaks computed", peaks["data"].toString().length() > 1000);
            return true;
        }

        case 2:
        {
            auto right = call ("clip.split", Obj().set ("id", ids["musicClip"]).set ("time", 6.0));
            check ("clip split", right.toString().isNotEmpty());
            call ("clip.set", Obj().set ("id", ids["musicClip"]).set ("fadeIn", 0.5).set ("gainDb", -2.0));
            auto dup = call ("clip.duplicate", Obj().set ("id", right.toString()));
            check ("clip duplicated", dup.toString().isNotEmpty());
            call ("clip.delete", Obj().set ("id", dup.toString()));

            {
                auto& slipped = app.clip (right.toString());
                const auto before = slipped.getPosition().getOffset().inSeconds();
                call ("clip.slip", Obj().set ("id", right.toString()).set ("offset", before + 0.25));
                check ("clip slipped", std::abs (slipped.getPosition().getOffset().inSeconds() - (before + 0.25)) < 0.001);
            }

            auto plugins = call ("plugins.list");
            auto count = plugins["plugins"].getArray() != nullptr ? plugins["plugins"].getArray()->size() : 0;
            check ("built-in effects available", count > 100, String (count) + " effects");

            auto comp = call ("plugin.add", Obj().set ("trackId", ids["Beat"]).set ("plugin", te::CompressorPlugin::xmlTypeName));
            check ("compressor inserted", comp["id"].toString().isNotEmpty());

            String airwindows;

            for (auto& p : *plugins["plugins"].getArray())
                if (p["vendor"].toString() == "Airwindows") { airwindows = p["id"].toString(); break; }

            auto aw = call ("plugin.add", Obj().set ("trackId", ids["Beat"]).set ("plugin", airwindows));
            check ("Airwindows effect inserted", aw["id"].toString().isNotEmpty(), airwindows);

            auto param = call ("plugin.setParam", Obj().set ("id", comp["id"]).set ("paramId", comp["params"][0]["id"]).set ("norm", 0.4));
            check ("plug-in parameter set", std::abs ((double) param["norm"] - 0.4) < 0.05, param["text"].toString());

            {
                auto eq = call ("plugin.add", Obj().set ("trackId", ids["Beat"]).set ("plugin", EqPlugin::xmlTypeName));
                auto set = call ("plugin.setParams", Obj().set ("id", eq["id"]).set ("values", Obj().set ("b3freq", 420.0).set ("b3gain", -4.5).set ("b3q", 2.0)));
                auto all = call ("plugin.params", Obj().set ("id", eq["id"]));
                double freq = 0, gain = 0;
                bool hasDefaults = all.size() > 0;

                for (auto& p : *all.getArray())
                {
                    if (p["id"].toString() == "b3freq") freq = p["value"];
                    if (p["id"].toString() == "b3gain") gain = p["value"];
                    hasDefaults = hasDefaults && p.hasProperty ("def");
                }

                auto t = call ("plugin.telemetry", Obj().set ("id", eq["id"]).set ("spectrum", true).set ("scope", true));
                check ("editor API: set several parameters, read defaults and live telemetry",
                       set.size() == 3 && std::abs (freq - 420.0) < 0.5 && std::abs (gain + 4.5) < 0.01 && hasDefaults
                         && t["spectrumOut"].size() == 0 && (double) t["inDb"] <= -80.0
                         && t["scopeL"].size() == 512 && t.hasProperty ("inDb"),
                       String (set.size()) + " set, " + String (all.size()) + " params, spectrum " + String (t["spectrumOut"].size())
                         + " points, in " + t["inDb"].toString() + " dB, scope " + String (t["scopeL"].size()));
            }

            {
                constexpr double rate = 48000.0;
                auto& cache = app.currentEdit()->getPluginCache();
                String failed;
                int good = 0;

                for (auto& fx : studioEffectCatalogue())
                {
                    auto plugin = cache.createNewPlugin (fx[0], {});
                    auto* studio = dynamic_cast<StudioFxPlugin*> (plugin.get());
                    juce::AudioBuffer<float> buffer (2, (int) rate);
                    juce::Random random (1);

                    for (int i = 0; i < buffer.getNumSamples(); ++i)
                    {
                        const float s = 0.3f * std::sin (juce::MathConstants<float>::twoPi * 220.0f * (float) i / (float) rate)
                                      + 0.05f * (random.nextFloat() * 2.0f - 1.0f);
                        buffer.setSample (0, i, s);
                        buffer.setSample (1, i, 0.9f * s);
                    }

                    if (studio != nullptr)
                        studio->processOffline (buffer, rate);

                    bool finite = true;
                    double energy = 0.0;

                    for (int ch = 0; ch < 2; ++ch)
                        for (int i = 0; i < buffer.getNumSamples(); ++i)
                        {
                            const auto v = buffer.getSample (ch, i);
                            finite = finite && std::isfinite (v);
                            energy += (double) v * v;
                        }

                    if (studio != nullptr && finite && energy > 1.0)
                        ++good;
                    else
                        failed << fx[1] << " ";
                }

                check ("Studio 4000 effects process audio", failed.isEmpty(),
                       failed.isEmpty() ? String (good) + " effects" : "failed: " + failed);

                auto plugin = cache.createNewPlugin (TunePlugin::xmlTypeName, {});
                auto* tune = dynamic_cast<TunePlugin*> (plugin.get());
                juce::AudioBuffer<float> buffer (2, (int) rate * 2);

                for (int i = 0; i < buffer.getNumSamples(); ++i)
                {
                    const float s = 0.4f * std::sin (juce::MathConstants<float>::twoPi * 450.0f * (float) i / (float) rate);
                    buffer.setSample (0, i, s);
                    buffer.setSample (1, i, s);
                }

                if (tune != nullptr)
                    tune->processOffline (buffer, rate);

                int crossings = 0;
                const int from = (int) rate, to = (int) (rate * 1.75);

                for (int i = from + 1; i < to; ++i)
                    if (buffer.getSample (0, i - 1) < 0.0f && buffer.getSample (0, i) >= 0.0f)
                        ++crossings;

                const double hz = crossings / ((to - from) / rate);
                check ("pitch correction pulls 450 Hz to A (440 Hz)", tune != nullptr && std::abs (hz - 440.0) < 4.0,
                       String (hz, 1) + " Hz, detected note " + (tune != nullptr ? String (tune->detectedNote.load(), 2) : String()));

                auto sine = [rate] (float hzIn, float amp, int samples)
                {
                    juce::AudioBuffer<float> b (2, samples);

                    for (int i = 0; i < samples; ++i)
                    {
                        const float s = amp * std::sin (juce::MathConstants<float>::twoPi * hzIn * (float) i / (float) rate);
                        b.setSample (0, i, s);
                        b.setSample (1, i, s);
                    }

                    return b;
                };

                auto tailDb = [] (const juce::AudioBuffer<float>& b)
                {
                    const int n = b.getNumSamples();
                    return juce::Decibels::gainToDecibels (b.getMagnitude (0, n / 2, n / 2));
                };

                auto setParam = [] (te::Plugin& p, const char* id, float v)
                {
                    if (auto param = p.getAutomatableParameterByID (id))
                        param->setParameter (v, juce::dontSendNotification);
                };

                // +12 dB bell at 1 kHz lifts a 1 kHz tone by 12 dB and leaves 100 Hz alone.
                auto eqPlugin = cache.createNewPlugin (EqPlugin::xmlTypeName, {});
                auto* eq = dynamic_cast<EqPlugin*> (eqPlugin.get());
                double boost = 0.0, lowShift = 99.0;
                int spectrumPeakHz = 0;

                if (eq != nullptr)
                {
                    setParam (*eq, "b4freq", 1000.0f);
                    setParam (*eq, "b4gain", 12.0f);
                    setParam (*eq, "b4q", 1.0f);

                    auto mid = sine (1000.0f, 0.1f, (int) rate);
                    eq->processOffline (mid, rate);
                    boost = tailDb (mid) - juce::Decibels::gainToDecibels (0.1f);

                    auto spectrum = eq->getTelemetry (true, false)["spectrumOut"];
                    double best = -999.0;

                    for (int i = 0; i < spectrum.size(); ++i)
                        if ((double) spectrum[i] > best)
                        {
                            best = spectrum[i];
                            spectrumPeakHz = juce::roundToInt (20.0 * std::pow (1000.0, (i + 0.5) / spectrum.size()));
                        }

                    auto low = sine (100.0f, 0.1f, (int) rate);
                    eq->processOffline (low, rate);
                    lowShift = tailDb (low) - juce::Decibels::gainToDecibels (0.1f);
                }

                check ("parametric EQ shapes the spectrum it reports",
                       eq != nullptr && std::abs (boost - 12.0) < 0.6 && std::abs (lowShift) < 0.6 && spectrumPeakHz > 900 && spectrumPeakHz < 1120,
                       "1 kHz +" + String (boost, 2) + " dB, 100 Hz " + String (lowShift, 2) + " dB, analyser peak " + String (spectrumPeakHz) + " Hz");

                // -6 dBFS into -20 dB threshold at 4:1 with a hard knee: 14 dB over becomes 3.5 dB, about -16.5 dBFS out.
                auto compPlugin = cache.createNewPlugin (CompressorFx::xmlTypeName, {});
                auto* comp = dynamic_cast<CompressorFx*> (compPlugin.get());
                double outDb = 0.0, gr = 0.0;

                if (comp != nullptr)
                {
                    setParam (*comp, "threshold", -20.0f);
                    setParam (*comp, "ratio", 4.0f);
                    setParam (*comp, "knee", 0.0f);
                    setParam (*comp, "detect", 0.0f);
                    setParam (*comp, "attack", 1.0f);
                    setParam (*comp, "release", 50.0f);

                    auto loud = sine (1000.0f, 0.5f, (int) rate);
                    comp->processOffline (loud, rate);
                    outDb = tailDb (loud);
                    gr = (double) comp->getTelemetry (false, false)["grDb"];
                }

                check ("compressor follows its transfer curve", comp != nullptr && std::abs (outDb + 16.5) < 1.0 && std::abs (gr - 10.5) < 1.0,
                       "out " + String (outDb, 2) + " dBFS, gain reduction " + String (gr, 1) + " dB");
            }

            {
                String failed;
                int good = 0;

                for (auto& entry : instrumentCatalogue())
                {
                    auto plugin = createInstrument (*app.currentEdit(), entry.id);
                    auto* sampler = dynamic_cast<te::SamplerPlugin*> (plugin.get());
                    const bool ok = plugin != nullptr && displayNameFor (*plugin) == entry.name
                                 && (! entry.id.startsWith ("kit:") || (sampler != nullptr && sampler->getNumSounds() > 0));

                    if (ok) ++good;
                    else    failed << entry.name << " ";
                }

                check ("built-in instruments load", failed.isEmpty(),
                       failed.isEmpty() ? String (good) + " instruments" : "failed: " + failed);
            }
            return true;
        }

        case 3:
        {
            auto ids2 = call ("track.add", Obj().set ("kind", "instrument").set ("name", "Synth"));
            ids["Synth"] = ids2[0].toString();
            auto midi = call ("clip.addMidi", Obj().set ("trackId", ids["Synth"]).set ("start", 0.0).set ("end", 9.6));
            call ("midi.setNotes", Obj().set ("clipId", midi).set ("notes", var (juce::Array<var> {
                var (juce::Array<var> { 60, 0.0, 1.0, 100 }), var (juce::Array<var> { 64, 1.0, 1.0, 100 }),
                var (juce::Array<var> { 67, 2.0, 2.0, 90 }) })));
            auto snap = app.rpc.invoke ("project.get", {}, "selftest");
            bool found = false;

            for (auto& t : *snap["tracks"].getArray())
                if (t["id"].toString() == ids["Synth"])
                    found = t["clips"][0]["notes"].getArray() != nullptr && t["clips"][0]["notes"].getArray()->size() == 3;

            check ("instrument track with MIDI notes", found);

            {
                auto played = call ("midi.live", Obj().set ("note", 60).set ("velocity", 100).set ("trackId", ids["Synth"]));
                call ("midi.live", Obj().set ("note", 60).set ("on", false).set ("trackId", ids["Synth"]));
                check ("live MIDI plays the chosen instrument track", played.toString() == ids["Synth"], played.toString());
            }

            {
                auto noteTimes = [this, &midi]
                {
                    auto s = app.rpc.invoke ("project.get", {}, "selftest");
                    for (auto& t : *s["tracks"].getArray())
                        for (auto& c : *t["clips"].getArray())
                            if (c["id"] == midi)
                                return std::pair<double, double> ((double) c["notes"][1][1], (double) c["notes"][1][4]);
                    return std::pair<double, double> (-1.0, -1.0);
                };

                const auto before = noteTimes();
                call ("clip.move", Obj().set ("id", midi).set ("start", 2.0));
                const auto after = noteTimes();
                call ("clip.move", Obj().set ("id", midi).set ("start", 0.0));
                check ("MIDI notes move with their clip",
                       std::abs (after.first - before.first - 2.0) < 0.001 && std::abs (after.second - before.second) < 0.001,
                       juce::String (before.first) + " -> " + juce::String (after.first));
            }

            auto lead = snap["tracks"][1];

            for (auto& t : *snap["tracks"].getArray())
                if (t["id"].toString() == ids["Lead Vocal"])
                    lead = t;

            call ("automation.addPoint", Obj().set ("pluginId", lead["volumePluginId"]).set ("paramId", "volume").set ("time", 1.0).set ("db", 0.0));
            call ("automation.addPoint", Obj().set ("pluginId", lead["volumePluginId"]).set ("paramId", "volume").set ("time", 4.0).set ("db", -6.0));
            snap = app.rpc.invoke ("project.get", {}, "selftest");

            for (auto& t : *snap["tracks"].getArray())
                if (t["id"].toString() == ids["Lead Vocal"])
                    check ("volume automation written", t["automation"].getArray() != nullptr && t["automation"].getArray()->size() == 1);

            call ("marker.add", Obj().set ("time", 4.8).set ("name", "Chorus"));
            call ("transport.setLoop", Obj().set ("start", 0.0).set ("end", 4.8).set ("enabled", true));
            call ("transport.setClick", Obj().set ("enabled", true));
            call ("track.arm", Obj().set ("id", ids["Lead Vocal"]).set ("armed", true));
            snap = app.rpc.invoke ("project.get", {}, "selftest");

            for (auto& t : *snap["tracks"].getArray())
                if (t["id"].toString() == ids["Lead Vocal"])
                    check ("track armed for recording", (bool) t["armed"], "input " + t["input"].toString());

            call ("track.arm", Obj().set ("id", ids["Lead Vocal"]).set ("armed", false));

            String sharedInput;

            for (auto& t : *snap["tracks"].getArray())
                if (t["id"].toString() == ids["Lead Vocal"])
                    sharedInput = t["input"].toString();

            if (sharedInput.isNotEmpty())
            {
                call ("track.setInput", Obj().set ("id", ids["Beat"]).set ("input", sharedInput));
                call ("track.setMonitor", Obj().set ("id", ids["Lead Vocal"]).set ("mode", "on"));
                snap = app.rpc.invoke ("project.get", {}, "selftest");
                bool leadLive = false, beatLive = true;

                for (auto& t : *snap["tracks"].getArray())
                {
                    if (t["id"].toString() == ids["Lead Vocal"]) leadLive = (bool) t["live"];
                    if (t["id"].toString() == ids["Beat"])       beatLive = (bool) t["live"];
                }

                check ("monitoring stays on its own track", leadLive && ! beatLive, "shared input " + sharedInput);
                call ("track.setMonitor", Obj().set ("id", ids["Lead Vocal"]).set ("mode", "auto"));
                call ("track.setInput", Obj().set ("id", ids["Beat"]).set ("input", ""));
            }

            return true;
        }

        case 4:
        {
            auto report = call ("smart.analyze", Obj().set ("master", true));
            check ("mix analysed", report["master"]["lufs"].isDouble() && (double) report["master"]["lufs"] > -60.0,
                   "master " + report["master"]["lufs"].toString() + " LUFS");

            auto duck = call ("smart.duck", Obj().set ("targetTrackId", ids["Beat"])
                                                 .set ("keyTrackIds", var (juce::Array<var> { ids["Lead Vocal"] })));
            check ("ducking plan found the vocal phrases", duck["details"].getArray() != nullptr && duck["details"].getArray()->size() >= 4,
                   duck["summary"].toString());

            auto mix = call ("smart.mix", Obj().set ("apply", true));
            check ("Smart Mix applied", (bool) mix["applied"], mix["summary"].toString());

            auto snap = app.rpc.invoke ("project.get", {}, "selftest");
            bool hasLimiter = false;

            for (auto& p : *snap["master"]["plugins"].getArray())
                hasLimiter = hasLimiter || p["type"].toString() == "s4000limiter";

            check ("master limiter added by Smart Mix", hasLimiter);

            call ("edit.undo");
            snap = app.rpc.invoke ("project.get", {}, "selftest");
            bool limiterAfterUndo = false;

            for (auto& p : *snap["master"]["plugins"].getArray())
                limiterAfterUndo = limiterAfterUndo || p["type"].toString() == "s4000limiter";

            check ("Smart Mix undoes as one step", ! limiterAfterUndo);
            call ("edit.redo");

            {
                juce::ValueTree legacy (te::IDs::PLUGIN);
                legacy.setProperty (te::IDs::type, "s3030limiter", nullptr);
                auto loaded = app.currentEdit()->getPluginCache().createNewPlugin (legacy);
                check ("Studio 3030 limiter loads under the new name",
                       loaded != nullptr && loaded->getPluginType() == "s4000limiter" && legacy[te::IDs::type].toString() == "s4000limiter");
            }

            auto voiceIds = call ("track.add", Obj().set ("kind", "audio").set ("name", "Voice 2"));
            auto chain = call ("smart.vocalChain", Obj().set ("trackId", voiceIds[0]).set ("style", "pop").set ("apply", true));
            snap = app.rpc.invoke ("project.get", {}, "selftest");
            int inserts = 0, sends = 0;

            for (auto& t : *snap["tracks"].getArray())
                if (t["id"].toString() == voiceIds[0].toString())
                {
                    inserts = t["plugins"].getArray() != nullptr ? t["plugins"].getArray()->size() : 0;
                    sends = t["sends"].getArray() != nullptr ? t["sends"].getArray()->size() : 0;
                }

            check ("vocal chain applied", (bool) chain["applied"] && inserts >= 3 && sends == 1,
                   String (inserts) + " inserts, " + String (sends) + " send");
            return true;
        }

        case 5:
        {
            call ("project.save");
            auto file = app.getEditFile();
            auto before = app.rpc.invoke ("project.get", {}, "selftest")["tracks"].getArray()->size();
            call ("project.open", Obj().set ("file", file.getFullPathName()));
            auto after = app.rpc.invoke ("project.get", {}, "selftest")["tracks"].getArray()->size();
            check ("project saves and reopens", before == after, String (before) + " -> " + String (after) + " tracks");
            return true;
        }

        case 6:
        {
            waitingForJob = (int) call ("export.render", Obj().set ("what", "mix").set ("format", "wav").set ("normalizeLufs", -14.0).set ("end", 12.0));
            waitStarted = juce::Time::getMillisecondCounter();
            return true;
        }

        case 7:
        {
            const juce::File mixFile (renderedFiles.isEmpty() ? String() : renderedFiles.getLast().toString());
            check ("mixdown written", mixFile.existsAsFile(), mixFile.getFileName());

            if (mixFile.existsAsFile())
            {
                auto lufs = measureFileLufs (app.getEngine(), mixFile);
                check ("mixdown normalised to -14 LUFS", std::abs (lufs + 14.0) < 1.5, String (lufs, 2) + " LUFS");
            }

            waitingForJob = (int) call ("export.render", Obj().set ("what", "stems").set ("format", "flac").set ("bitDepth", 24).set ("end", 12.0));
            waitStarted = juce::Time::getMillisecondCounter();
            return true;
        }

        case 8:
        {
            int stems = 0;

            for (auto& f : renderedFiles)
                if (f.toString().endsWithIgnoreCase (".flac") && juce::File (f.toString()).existsAsFile())
                    ++stems;

            check ("stems exported as FLAC", stems >= 4, String (stems) + " stems");

            auto context = call ("ai.context");
            check ("assistant context available", context.toString().contains ("Lead Vocal"));
            auto tools = call ("ai.tools");
            check ("assistant tools described", tools.getArray() != nullptr && tools.getArray()->size() > 20);
            return true;
        }

        default:
            return false;
    }
}

void SelfTest::finish()
{
    auto report = Obj().set ("passed", failures == 0).set ("failures", failures).set ("checks", results)
                       .set ("project", app.getEditFile().getFullPathName())
                       .set ("time", juce::Time::getCurrentTime().toISO8601 (true));

    reportFile.replaceWithText (juce::JSON::toString (report, false));
    std::cout << (failures == 0 ? "SELFTEST PASSED" : "SELFTEST FAILED") << " (" << results.size() << " checks, "
              << failures << " failed)" << std::endl;

    finished (failures == 0 ? 0 : 1);
}
}
