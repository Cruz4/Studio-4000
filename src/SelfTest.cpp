#include "SelfTest.h"
#include "api/Api.h"
#include "LoudnessMeterPlugin.h"
#include "StudioFx.h"
#include "SuiteFx.h"
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

    bool sockWrite (juce::StreamingSocket& socket, const void* data, int n)
    {
        auto* p = static_cast<const char*> (data);
        int sent = 0;

        while (sent < n)
        {
            if (socket.waitUntilReady (false, 5000) != 1)
                return false;

            auto wrote = socket.write (p + sent, n - sent);
            if (wrote <= 0)
                return false;

            sent += wrote;
        }

        return true;
    }

    bool sockRead (juce::StreamingSocket& socket, void* dest, int n, int timeoutMs)
    {
        auto* p = static_cast<char*> (dest);
        int got = 0;
        auto deadline = juce::Time::getMillisecondCounter() + (juce::uint32) timeoutMs;

        while (got < n)
        {
            auto now = juce::Time::getMillisecondCounter();
            if (now >= deadline)
                return false;

            if (socket.waitUntilReady (true, (int) (deadline - now)) != 1)
                return false;

            auto r = socket.read (p + got, n - got, false);
            if (r <= 0)
                return false;

            got += r;
        }

        return true;
    }

    /** A minimal masked WebSocket client, enough to act as a host and a guest against the in-app relay. */
    struct WsClient
    {
        std::unique_ptr<juce::StreamingSocket> socket;

        bool connect (int port)
        {
            socket = std::make_unique<juce::StreamingSocket>();
            if (! socket->connect ("127.0.0.1", port, 3000))
                return false;

            auto req = "GET / HTTP/1.1\r\nHost: 127.0.0.1:" + juce::String (port)
                     + "\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                       "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n";

            if (! sockWrite (*socket, req.toRawUTF8(), req.getNumBytesAsUTF8()))
                return false;

            juce::String header;
            char ch = 0;

            while (header.length() < 4096 && sockRead (*socket, &ch, 1, 3000))
            {
                header += ch;
                if (header.endsWith ("\r\n\r\n"))
                    return header.contains ("101");
            }

            return false;
        }

        bool sendText (const juce::String& text)
        {
            auto len = text.getNumBytesAsUTF8();
            juce::MemoryOutputStream frame;
            frame.writeByte ((char) 0x81);
            const uint8_t mask[4] = { 0x11, 0x22, 0x33, 0x44 };

            if (len < 126)
                frame.writeByte ((char) (0x80 | (int) len));
            else if (len <= 65535)
            {
                frame.writeByte ((char) (0x80 | 126));
                frame.writeByte ((char) ((len >> 8) & 0xff));
                frame.writeByte ((char) (len & 0xff));
            }
            else
            {
                frame.writeByte ((char) (0x80 | 127));
                for (int i = 7; i >= 0; --i)
                    frame.writeByte ((char) ((len >> (i * 8)) & 0xff));
            }

            frame.write (mask, 4);
            auto* raw = text.toRawUTF8();

            for (size_t i = 0; i < len; ++i)
                frame.writeByte ((char) (raw[i] ^ mask[i % 4]));

            return sockWrite (*socket, frame.getData(), (int) frame.getDataSize());
        }

        juce::String readText (int timeoutMs)
        {
            auto deadline = juce::Time::getMillisecondCounter() + (juce::uint32) timeoutMs;

            while (juce::Time::getMillisecondCounter() < deadline)
            {
                auto left = (int) (deadline - juce::Time::getMillisecondCounter());
                uint8_t hdr[2];
                if (! sockRead (*socket, hdr, 2, left))
                    return {};

                auto op = hdr[0] & 0x0f;
                uint64_t len = hdr[1] & 0x7f;

                if (len == 126)
                {
                    uint8_t ext[2];
                    if (! sockRead (*socket, ext, 2, 3000))
                        return {};
                    len = ((uint64_t) ext[0] << 8) | ext[1];
                }
                else if (len == 127)
                {
                    uint8_t ext[8];
                    if (! sockRead (*socket, ext, 8, 3000))
                        return {};
                    len = 0;
                    for (auto b : ext)
                        len = (len << 8) | b;
                }

                if (len > 2 * 1024 * 1024)
                    return {};

                juce::MemoryBlock payload ((size_t) len, true);
                if (len > 0 && ! sockRead (*socket, payload.getData(), (int) len, 8000))
                    return {};

                if (op == 0x8)
                    return {};

                if (op == 0x1)
                    return juce::String::fromUTF8 ((const char*) payload.getData(), (int) payload.getSize());
            }

            return {};
        }

        var readType (const juce::String& type, int timeoutMs)
        {
            auto deadline = juce::Time::getMillisecondCounter() + (juce::uint32) timeoutMs;

            while (juce::Time::getMillisecondCounter() < deadline)
            {
                auto text = readText ((int) (deadline - juce::Time::getMillisecondCounter()));
                if (text.isEmpty())
                    return {};

                auto msg = juce::JSON::parse (text);
                if (msg["type"].toString() == type)
                    return msg;
            }

            return {};
        }

        void close()
        {
            if (socket != nullptr)
                socket->close();
        }
    };
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

            check ("a template audio track is stereo", (int) snap["tracks"][0]["channels"] == 2);

            auto monoIds = call ("track.add", Obj().set ("kind", "audio").set ("name", "Mono Voice").set ("channels", 1));
            auto busIds = call ("track.add", Obj().set ("kind", "group").set ("name", "Mono Bus").set ("channels", 1));
            const String monoId = monoIds[0].toString();
            const String busId = busIds[0].toString();
            auto again = app.rpc.invoke ("project.get", {}, "selftest");
            int monoCh = -1, busCh = -1;

            for (auto& t : *again["tracks"].getArray())
            {
                if (t["name"].toString() == "Mono Voice") monoCh = (int) t["channels"];
                if (t["name"].toString() == "Mono Bus")   busCh = (int) t["channels"];
            }

            check ("a new audio track can be mono", monoCh == 1, String (monoCh));
            check ("a new bus can be mono", busCh == 1, String (busCh));

            auto tone = writeTestTone (workDir.getChildFile ("mono-voice.wav"), true, 1.0);
            call ("clip.importAudio", Obj().set ("trackId", monoId).set ("file", tone.getFullPathName()).set ("start", 0.0));
            auto* monoClip = dynamic_cast<te::AudioClipBase*> (app.audioTrack (monoId).getClips().getFirst());
            check ("a stereo file on a mono track plays one channel", monoClip != nullptr && monoClip->getActiveChannelConfiguration().isMono());

            call ("track.set", Obj().set ("id", monoId).set ("channels", 2));
            check ("switching the track to stereo restores both channels", monoClip != nullptr && ! monoClip->getActiveChannelConfiguration().isMono());
            call ("track.set", Obj().set ("id", monoId).set ("channels", 1));
            check ("switching the track back to mono plays one channel", monoClip != nullptr && monoClip->getActiveChannelConfiguration().isMono());

            int summers = 0;

            if (auto* bus = dynamic_cast<te::FolderTrack*> (app.findTrack (busId)))
                for (int i = 0; i < bus->pluginList.size(); ++i)
                    if (bus->pluginList[i] != nullptr && (bool) bus->pluginList[i]->state["s4format"])
                        ++summers;

            check ("a mono bus sums to one channel", summers == 1, String (summers));
            call ("track.set", Obj().set ("id", busId).set ("channels", 2));
            summers = 0;

            if (auto* bus = dynamic_cast<te::FolderTrack*> (app.findTrack (busId)))
                for (int i = 0; i < bus->pluginList.size(); ++i)
                    if (bus->pluginList[i] != nullptr && (bool) bus->pluginList[i]->state["s4format"])
                        ++summers;

            check ("a stereo bus leaves both channels", summers == 0, String (summers));

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

            call ("chain.setMix", Obj().set ("trackId", ids["Lead Vocal"]).set ("mix", 35));
            call ("chain.setMix", Obj().set ("clipId", ids["voiceClip"]).set ("mix", 15));
            auto mixed = app.rpc.invoke ("project.get", {}, "selftest");
            double trackMix = -1, clipMix = -1;
            bool leaked = false;

            for (auto& t : *mixed["tracks"].getArray())
            {
                if (t["name"].toString() != "Lead Vocal")
                    continue;

                trackMix = (double) t["fxMix"];

                if (auto* plugs = t["plugins"].getArray())
                    for (auto& pl : *plugs)
                        if (pl["type"].toString().contains ("chain"))
                            leaked = true;

                if (auto* clips = t["clips"].getArray())
                    for (auto& c : *clips)
                        if (c["id"].toString() == ids["voiceClip"])
                            clipMix = (double) c["fxMix"];
            }

            check ("a track effect chain has its own wet/dry", std::abs (trackMix - 35.0) < 0.5, String (trackMix, 1));
            check ("a clip effect chain has its own wet/dry", std::abs (clipMix - 15.0) < 0.5, String (clipMix, 1));
            check ("the wet/dry control stays out of the effect list", ! leaked);

            int dryAt = -1, wetAt = -1, volAt = -1;
            auto& vocal = app.audioTrack (ids["Lead Vocal"]);

            for (int i = 0; i < vocal.pluginList.size(); ++i)
            {
                auto* p = vocal.pluginList[i];

                if (p == nullptr)
                    continue;

                if (p->state["s4chain"].toString() == "dry") dryAt = i;
                if (p->state["s4chain"].toString() == "wet") wetAt = i;
                if (dynamic_cast<te::VolumeAndPanPlugin*> (p) != nullptr) volAt = i;
            }

            check ("track wet/dry wraps the effects", dryAt >= 0 && wetAt > dryAt && (volAt < 0 || wetAt < volAt),
                   String (dryAt) + " " + String (wetAt) + " " + String (volAt));
            call ("chain.setMix", Obj().set ("trackId", ids["Lead Vocal"]).set ("mix", 100));
            call ("chain.setMix", Obj().set ("clipId", ids["voiceClip"]).set ("mix", 100));
            return true;
        }

        case 2:
        {
            juce::Array<var> panPts;
            panPts.add (juce::Array<var> { 0.25, -0.5 });
            panPts.add (juce::Array<var> { 1.5, 0.75 });
            call ("clip.setPanPoints", Obj().set ("id", ids["musicClip"]).set ("points", panPts));
            juce::Array<var> gainPts;
            gainPts.add (juce::Array<var> { 0.0, -6.0 });
            call ("clip.setGainPoints", Obj().set ("id", ids["musicClip"]).set ("points", gainPts));
            call ("clip.setGainPoints", Obj().set ("id", ids["musicClip"]).set ("points", juce::Array<var>()));

            double firstPan = 99;
            int panCount = -1, gainCount = -1;
            auto panned = call ("project.get");

            if (auto* tracks = panned["tracks"].getArray())
                for (auto& t : *tracks)
                    if (auto* clips = t["clips"].getArray())
                        for (auto& c : *clips)
                            if (c["id"].toString() == ids["musicClip"])
                            {
                                if (auto* pts = c["panPoints"].getArray())
                                {
                                    panCount = pts->size();
                                    if (panCount > 0)
                                        firstPan = (double) pts->getReference (0)[1];
                                }

                                if (auto* pts = c["gainPoints"].getArray())
                                    gainCount = pts->size();
                            }

            check ("a clip can draw a pan line", panCount == 2 && std::abs (firstPan + 0.5) < 0.02, String (panCount) + " " + String (firstPan));
            check ("clearing clip gain keeps the pan line", gainCount == 0 && panCount == 2);
            call ("clip.setPanPoints", Obj().set ("id", ids["musicClip"]).set ("points", juce::Array<var>()));

            auto right = call ("clip.split", Obj().set ("id", ids["musicClip"]).set ("time", 6.0));
            check ("clip split", right.toString().isNotEmpty());
            call ("clip.set", Obj().set ("id", ids["musicClip"]).set ("fadeIn", 0.5).set ("gainDb", -2.0));
            call ("clip.set", Obj().set ("id", ids["musicClip"]).set ("fadeInBend", -0.75));

            if (auto* faded = dynamic_cast<te::AudioClipBase*> (&app.clip (ids["musicClip"])))
            {
                auto described = describeClip (*faded);
                check ("a fade curve can bend without losing its length",
                       std::abs (faded->getFadeIn().inSeconds()) < 0.001
                       && std::abs ((double) described["fadeIn"] - 0.5) < 0.02
                       && std::abs ((double) described["fadeInBend"] + 0.75) < 0.02);
            }
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

            {
                constexpr double rate = 48000.0;
                auto& cache = app.currentEdit()->getPluginCache();
                String failed;
                int good = 0;

                for (auto& entry : suiteSynthCatalogue())
                {
                    auto plugin = cache.createNewPlugin (entry[0], {});
                    juce::AudioBuffer<float> buffer (2, (int) rate);
                    buffer.clear();
                    te::MidiMessageArray midi;
                    auto note = juce::MidiMessage::noteOn (1, 60, (juce::uint8) 100);
                    note.setTimeStamp (0.0);
                    midi.addMidiMessage (note, 0);

                    if (plugin != nullptr)
                    {
                        plugin->initialise ({ {}, rate, 512 });
                        te::PluginRenderContext context (&buffer, 0, buffer.getNumSamples(), &midi, 0.0,
                                                         te::timeRangeFromSeconds (juce::Range<double> (0.0, 1.0)),
                                                         true, false, true, false);
                        plugin->applyToBuffer (context);
                    }

                    double energy = 0.0;

                    for (int i = 0; i < buffer.getNumSamples(); ++i)
                    {
                        const auto v = buffer.getSample (0, i);
                        energy += (double) v * v;
                    }

                    if (plugin != nullptr && plugin->isSynth() && std::isfinite (energy) && energy > 1.0)
                        ++good;
                    else
                        failed << entry[1] << " energy " << String (energy, 3) << " ";
                }

                check ("FM and analog synths play a held note", failed.isEmpty(),
                       failed.isEmpty() ? String (good) + " synths" : "failed: " + failed);
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
                auto printed = call ("clip.bounce", Obj().set ("id", midi.toString()));
                check ("MIDI prints to an audio clip", printed["clipId"].toString().isNotEmpty()
                       && juce::File (printed["file"].toString()).existsAsFile(), printed["file"].toString());
                ids["printedClip"] = printed["clipId"].toString();
                ids["printedTrack"] = printed["trackId"].toString();
            }

            {
                juce::AudioBuffer<float> a440 (1, 48000);
                for (int i = 0; i < a440.getNumSamples(); ++i)
                    a440.setSample (0, i, 0.35f * std::sin (2.0 * juce::MathConstants<double>::pi * 440.0 * i / 48000.0));
                auto toneFile = workDir.getChildFile ("a440.wav");
                if (auto* wav = app.getEngine().getAudioFileFormatManager().getWavFormat())
                    if (auto out = toneFile.createOutputStream())
                        if (auto w = std::unique_ptr<juce::AudioFormatWriter> (wav->createWriterFor (out.release(), 48000.0, 1, 16, {}, 0)))
                            w->writeFromAudioSampleBuffer (a440, 0, a440.getNumSamples());
                auto hum = call ("clip.importAudio", Obj().set ("trackId", ids["Lead Vocal"]).set ("file", toneFile.getFullPathName()).set ("start", 20.0));
                auto toMidi = call ("clip.toMidi", Obj().set ("id", hum.toString()));
                int pitch = -1;
                if (auto* n = toMidi["notes"].getArray(); n != nullptr && ! n->isEmpty())
                    pitch = (int) (*n)[0][0];
                check ("audio turns into MIDI near A4", pitch >= 67 && pitch <= 71, "pitch " + String (pitch));
            }

            {
                call ("midi.live", Obj().set ("note", 64).set ("velocity", 100).set ("trackId", ids["Synth"]));
                call ("midi.live", Obj().set ("note", 64).set ("on", false).set ("trackId", ids["Synth"]));
                auto caught = call ("midi.capture", Obj().set ("trackId", ids["Synth"]).set ("seconds", 10));
                check ("capture MIDI keeps notes you already played", caught["clipId"].toString().isNotEmpty(),
                       caught["clipId"].toString());
            }

            call ("track.setCue", Obj().set ("id", ids["Beat"]).set ("cue", true));
            {
                auto snapCue = app.rpc.invoke ("project.get", {}, "selftest");
                bool cueOn = false;
                for (auto& t : *snapCue["tracks"].getArray())
                    if (t["id"].toString() == ids["Beat"])
                        cueOn = (bool) t["cue"];
                check ("a track can join the guest cue mix", cueOn);
            }

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
            call ("transport.setLoop", Obj().set ("start", 0.0).set ("end", 0.0));
            snap = app.rpc.invoke ("project.get", {}, "selftest");
            check ("clearing the loop removes the range", (double) snap["loop"][1] - (double) snap["loop"][0] < 0.05 && ! (bool) snap["looping"]);
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

            juce::File wavMix;

            for (int i = renderedFiles.size(); --i >= 0;)
                if (renderedFiles[i].toString().endsWithIgnoreCase (".wav"))
                {
                    wavMix = renderedFiles[i].toString();
                    break;
                }

            const auto mp3Mix = wavMix.withFileExtension ("mp3");
            const auto mp3Error = wavMix.existsAsFile() ? transcodeWavToMp3 (app.getEngine(), wavMix, mp3Mix) : String ("no wav");
            check ("a mixdown can be written as MP3", mp3Error.isEmpty() && mp3Mix.existsAsFile() && mp3Mix.getSize() > 1000, mp3Error);

            auto context = call ("ai.context");
            check ("assistant context available", context.toString().contains ("Lead Vocal"));
            auto tools = call ("ai.tools");
            check ("assistant tools described", tools.getArray() != nullptr && tools.getArray()->size() > 20);
            return true;
        }

        case 9:
        {
            auto relay = call ("collab.relay");
            auto port = (int) relay["port"];
            check ("session connection is open", (bool) relay["running"] && port > 0, relay["local"].toString());

            WsClient host, guest;
            auto up = port > 0 && host.connect (port) && guest.connect (port);
            check ("host and guest reach the session", up);

            if (up)
            {
                auto blob = juce::String::repeatedString ("A", 100000);
                host.sendText (juce::JSON::toString (Obj().set ("type", "join").set ("room", "SELF01").set ("name", "Host").set ("role", "host").set ("password", ""), true));
                auto hostWelcome = host.readType ("welcome", 4000);
                guest.sendText (juce::JSON::toString (Obj().set ("type", "join").set ("room", "SELF01").set ("name", "Guest").set ("role", "guest").set ("password", ""), true));
                auto guestWelcome = guest.readType ("welcome", 4000);
                check ("guest is welcomed into the host's room", hostWelcome.isObject() && guestWelcome.isObject());

                guest.sendText (juce::JSON::toString (Obj().set ("type", "to").set ("target", "*").set ("data", Obj().set ("kind", "blob").set ("n", "G" + blob)), true));
                auto atHost = host.readType ("from", 8000);
                host.sendText (juce::JSON::toString (Obj().set ("type", "to").set ("target", "*").set ("data", Obj().set ("kind", "blob").set ("n", "H" + blob)), true));
                auto atGuest = guest.readType ("from", 8000);
                auto hostBlob = atHost["data"]["n"].toString();
                auto guestBlob = atGuest["data"]["n"].toString();
                check ("a large message survives the round trip",
                       hostBlob.startsWith ("G") && hostBlob.length() > 100000 && guestBlob.startsWith ("H") && guestBlob.length() > 100000,
                       String (hostBlob.length()) + " / " + String (guestBlob.length()));

                guest.close();
                WsClient again;
                auto rejoined = again.connect (port)
                    && again.sendText (juce::JSON::toString (Obj().set ("type", "join").set ("room", "SELF01").set ("name", "Guest").set ("role", "guest").set ("password", ""), true));
                auto second = rejoined ? again.readType ("welcome", 4000) : var();
                auto refused = rejoined ? juce::String() : juce::String ("could not connect");
                if (second.isVoid() && rejoined)
                {
                    // readType only returns the matching type; an error frame means the room died.
                    refused = "the room refused the second join";
                }
                check ("the same guest can join again", second.isObject() && second["type"].toString() == "welcome", refused);
                again.close();
                host.close();
            }

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
