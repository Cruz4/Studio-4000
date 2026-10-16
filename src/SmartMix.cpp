#include "SmartMix.h"
#include "AppEngine.h"
#include "ProjectState.h"
#include "LimiterPlugin.h"
#include "LoudnessMeterPlugin.h"
#include "StudioFx.h"

namespace s3::SmartMix
{
namespace
{
    constexpr double stepSeconds = 0.1;     // LoudnessAnalyzer history resolution

    struct Measure
    {
        LoudnessAnalyzer analyzer;
        double sampleRate = 0.0;
        double cursor = 0.0;
        double sumLL = 0, sumRR = 0, sumLR = 0;
        double lowEnergy = 0, totalEnergy = 0;
        float lowState[2] {};
        float lowCoef = 0.0f;
        bool prepared = false;

        void prepare (double sr)
        {
            sampleRate = sr;
            analyzer.recordHistory = true;
            analyzer.prepare (sr, 2);
            lowCoef = 1.0f - std::exp (-2.0f * juce::MathConstants<float>::pi * 150.0f / (float) sr);
            prepared = true;
        }

        void feed (juce::AudioBuffer<float>& buffer, int numSamples, float gain)
        {
            const int channels = juce::jmin (2, buffer.getNumChannels());

            if (gain != 1.0f)
                buffer.applyGain (0, numSamples, gain);

            const float* ptrs[2] = { buffer.getReadPointer (0), buffer.getReadPointer (channels > 1 ? 1 : 0) };
            analyzer.process (ptrs, channels, numSamples);

            for (int i = 0; i < numSamples; ++i)
            {
                const float l = ptrs[0][i], r = ptrs[1][i];
                sumLL += l * l;
                sumRR += r * r;
                sumLR += l * r;

                for (int c = 0; c < channels; ++c)
                {
                    const float x = ptrs[c][i];
                    lowState[c] += lowCoef * (x - lowState[c]);
                    lowEnergy += lowState[c] * lowState[c];
                    totalEnergy += x * x;
                }
            }

            cursor += numSamples / sampleRate;
        }

        void feedSilence (double secondsToFeed)
        {
            if (! prepared || secondsToFeed <= 0)
                return;

            auto remaining = (juce::int64) std::round (secondsToFeed * sampleRate);
            juce::AudioBuffer<float> silence (2, 8192);
            silence.clear();

            while (remaining > 0)
            {
                const int n = (int) juce::jmin ((juce::int64) silence.getNumSamples(), remaining);
                const float* ptrs[2] = { silence.getReadPointer (0), silence.getReadPointer (1) };
                analyzer.process (ptrs, 2, n);
                remaining -= n;
            }

            cursor += secondsToFeed;
        }

        bool feedFile (te::Engine& engine, const juce::File& file, double sourceStart, double sourceLength, float gain)
        {
            std::unique_ptr<juce::AudioFormatReader> reader (engine.getAudioFileFormatManager().readFormatManager.createReaderFor (file));

            if (reader == nullptr)
                return false;

            if (! prepared)
                prepare (reader->sampleRate);

            auto pos = (juce::int64) (sourceStart * reader->sampleRate);
            auto end = juce::jmin (reader->lengthInSamples, pos + (juce::int64) (sourceLength * reader->sampleRate));
            juce::AudioBuffer<float> buffer ((int) juce::jmin (2u, reader->numChannels), 65536);

            while (pos < end)
            {
                const int n = (int) juce::jmin ((juce::int64) buffer.getNumSamples(), end - pos);
                reader->read (&buffer, 0, n, pos, true, buffer.getNumChannels() > 1);
                feed (buffer, n, gain);
                pos += n;
            }

            return true;
        }

        double integrated() const       { return analyzer.getIntegratedLufs(); }
        double peakDb() const           { return analyzer.getPeakDb(); }

        double correlation() const
        {
            const auto d = std::sqrt (sumLL * sumRR);
            return d > 1.0e-9 ? sumLR / d : 1.0;
        }

        double lowEndRatio() const      { return totalEnergy > 1.0e-9 ? lowEnergy / totalEnergy : 0.0; }

        double activeSeconds() const
        {
            int active = 0;

            for (auto m : analyzer.momentaryHistory)
                if (m > -50.0f)
                    ++active;

            return active * stepSeconds;
        }

        double loudnessRange() const
        {
            const auto& h = analyzer.momentaryHistory;
            std::vector<double> shortTerm;
            constexpr int window = 27;

            for (size_t i = 0; i + window <= h.size(); i += 10)
            {
                double e = 0;

                for (size_t j = i; j < i + window; ++j)
                    e += std::pow (10.0, (h[j] + 0.691) / 10.0);

                const auto lufs = -0.691 + 10.0 * std::log10 (e / window + 1.0e-12);

                if (lufs > -70.0)
                    shortTerm.push_back (lufs);
            }

            if (shortTerm.size() < 3)
                return 0.0;

            double e = 0;

            for (auto v : shortTerm)
                e += std::pow (10.0, (v + 0.691) / 10.0);

            const auto gate = -0.691 + 10.0 * std::log10 (e / (double) shortTerm.size()) - 20.0;
            std::vector<double> gated;

            for (auto v : shortTerm)
                if (v >= gate)
                    gated.push_back (v);

            if (gated.size() < 3)
                return 0.0;

            std::sort (gated.begin(), gated.end());
            auto at = [&] (double q) { return gated[(size_t) juce::jlimit (0, (int) gated.size() - 1, (int) std::round (q * (double) (gated.size() - 1)))]; };
            return at (0.95) - at (0.10);
        }
    };

    struct TrackResult
    {
        te::AudioTrack* track = nullptr;
        String role;
        std::shared_ptr<Measure> measure;
        bool rendered = false;
        bool hasAudio = false;
        juce::StringArray problems;
    };

    String inferRole (te::Track& t)
    {
        auto role = t.state["s3role"].toString();

        if (role.isNotEmpty())
            return role;

        if (getTrackKind (t) == TrackKind::fxReturn)
            return "return";

        auto n = t.getName().toLowerCase();

        if (n.contains ("vox") || n.contains ("vocal") || n.contains ("voice") || n.contains ("adlib") || n.contains ("sing"))
            return "vocal";

        if (n.contains ("host") || n.contains ("guest") || n.contains ("dialog") || n.contains ("speaker")
             || n.contains ("interview") || n.contains ("narrat") || n.contains ("podcast") || n.contains ("mic"))
            return "dialogue";

        if (n.contains ("kick") || n.contains ("snare") || n.contains ("drum") || n.contains ("hat") || n.contains ("perc")
             || n.contains ("overhead") || n.contains ("tom") || n.contains ("clap"))
            return "drums";

        if (n.contains ("bass") || n.contains ("808") || n.contains ("sub"))
            return "bass";

        return "music";
    }

    juce::File tempRenderFile (const String& name)
    {
        auto dir = juce::File::getSpecialLocation (juce::File::tempDirectory).getChildFile ("Studio4000");
        dir.createDirectory();
        return dir.getNonexistentChildFile (name, ".wav", false);
    }

    std::shared_ptr<Measure> renderAndMeasure (AppEngine& app, const juce::BigInteger& tracks, bool masterPlugins)
    {
        auto& edit = app.edit();
        const auto length = edit.getLength();

        if (length.inSeconds() < 0.1)
            return {};

        te::Renderer::Parameters r (edit);
        r.destFile = tempRenderFile ("analysis");
        r.audioFormat = edit.engine.getAudioFileFormatManager().getWavFormat();
        r.bitDepth = 32;
        r.sampleRateForAudio = 48000.0;
        r.blockSizeForAudio = 512;
        r.time = { te::TimePosition(), te::TimePosition() + length };
        r.tracksToDo = tracks;
        r.usePlugins = true;
        r.useMasterPlugins = masterPlugins;
        r.canRenderInMono = false;
        r.checkNodesForAudio = false;

        auto file = te::Renderer::renderToFile ("Analysing mix", r);

        if (! file.existsAsFile())
            return {};

        auto m = std::make_shared<Measure>();
        m->feedFile (edit.engine, file, 0.0, length.inSeconds() + 1.0, 1.0f);
        file.deleteFile();
        return m;
    }

    TrackResult analyzeTrack (AppEngine& app, te::AudioTrack& t)
    {
        TrackResult result;
        result.track = &t;
        result.role = inferRole (t);
        result.measure = std::make_shared<Measure>();

        auto clips = t.getClips();
        std::sort (clips.begin(), clips.end(), [] (te::Clip* a, te::Clip* b) { return a->getPosition().getStart() < b->getPosition().getStart(); });

        bool hasMidi = false;

        for (auto* c : clips)
        {
            if (c->isMuted())
                continue;

            if (dynamic_cast<te::MidiClip*> (c) != nullptr)
            {
                hasMidi = true;
                continue;
            }

            auto* ac = dynamic_cast<te::AudioClipBase*> (c);

            if (ac == nullptr)
                continue;

            auto file = ac->getCurrentSourceFile();

            if (! file.existsAsFile())
            {
                result.problems.add ("Missing audio file: " + file.getFileName());
                continue;
            }

            auto& m = *result.measure;
            const auto pos = ac->getPosition();
            const auto start = pos.getStart().inSeconds();

            if (m.prepared && start > m.cursor)
                m.feedSilence (start - m.cursor);
            else if (! m.prepared && start > 0)
            {
                std::unique_ptr<juce::AudioFormatReader> reader (app.getEngine().getAudioFileFormatManager().readFormatManager.createReaderFor (file));

                if (reader != nullptr)
                {
                    m.prepare (reader->sampleRate);
                    m.feedSilence (start);
                }
            }

            const auto skip = juce::jmax (0.0, m.cursor - start);
            const auto length = pos.getLength().inSeconds() - skip;

            if (length <= 0)
                continue;

            const auto speed = ac->getSpeedRatio();

            if (m.feedFile (app.getEngine(), file, (pos.getOffset().inSeconds() + skip) * speed, length * speed,
                            juce::Decibels::decibelsToGain (ac->getGainDB())))
                result.hasAudio = true;
        }

        if (! result.hasAudio && hasMidi)
        {
            if (auto rendered = renderAndMeasure (app, te::toBitSet (juce::Array<te::Track*> { &t }), false))
            {
                result.measure = rendered;
                result.rendered = true;
                result.hasAudio = true;
            }
        }

        return result;
    }

    std::vector<TrackResult> analyzeAllTracks (AppEngine& app)
    {
        std::vector<TrackResult> results;

        for (auto* t : te::getAudioTracks (app.edit()))
            if (getTrackKind (*t) != TrackKind::fxReturn)
                results.push_back (analyzeTrack (app, *t));

        return results;
    }

    var call (const String& method, const var& params)
    {
        return Obj().set ("method", method).set ("params", params);
    }

    var plan (const String& summary, const juce::Array<var>& details, const juce::Array<var>& calls)
    {
        return Obj().set ("summary", summary).set ("details", details).set ("calls", calls);
    }

    double round1 (double v)    { return std::round (v * 10.0) / 10.0; }

    float currentVolumeDb (te::Track& t)
    {
        if (auto* at = dynamic_cast<te::AudioTrack*> (&t))
            if (auto* vp = at->getVolumePlugin())
                return vp->getVolumeDb();

        return 0.0f;
    }

    String volumePluginId (te::AudioTrack& t)
    {
        if (auto* vp = t.getVolumePlugin())
            return vp->itemID.toString();

        return {};
    }
}

//==============================================================================
var analyze (AppEngine& app, bool includeMaster)
{
    auto& edit = app.edit();
    auto tracks = analyzeAllTracks (app);
    juce::Array<var> trackList, issues;

    auto issue = [&] (const char* level, const String& message, const String& trackId = {}, const String& fix = {})
    {
        issues.add (Obj().set ("level", level).set ("message", message).set ("trackId", trackId).set ("fix", fix));
    };

    std::map<String, std::vector<double>> byRole;

    for (auto& r : tracks)
    {
        auto& t = *r.track;
        const auto id = t.itemID.toString();

        Obj o;
        o.set ("id", id).set ("name", t.getName()).set ("role", r.role).set ("hasAudio", r.hasAudio)
         .set ("volumeDb", currentVolumeDb (t)).set ("muted", t.isMuted (false));

        for (auto& p : r.problems)
            issue ("error", t.getName() + ": " + p, id);

        if (! r.hasAudio)
        {
            if (t.getClips().isEmpty())
                issue ("info", t.getName() + " is empty", id);

            trackList.add (o);
            continue;
        }

        auto& m = *r.measure;
        const auto lufs = m.integrated();
        const auto peak = m.peakDb();

        o.set ("lufs", round1 (lufs)).set ("peakDb", round1 (peak)).set ("lra", round1 (m.loudnessRange()))
         .set ("activeSeconds", round1 (m.activeSeconds())).set ("rendered", r.rendered);

        if (! r.rendered && peak > -0.3)
            issue ("warning", t.getName() + " peaks at " + String (peak, 1) + " dBFS. The recording may be clipped; record with more headroom.", id);

        if (lufs < -40.0 && lufs > -70.0)
            issue ("warning", t.getName() + " is very quiet (" + String (lufs, 1) + " LUFS). Gain staging will lift it.", id, "smart.gainStage");

        if (lufs > -10.0)
            issue ("warning", t.getName() + " is very hot (" + String (lufs, 1) + " LUFS) and will push plug-ins into distortion.", id, "smart.gainStage");

        if (t.isMuted (false))
            issue ("info", t.getName() + " is muted and won't be heard", id);

        if (lufs > -70.0)
            byRole[r.role].push_back (lufs);

        for (auto* p : t.pluginList)
            if (auto* ext = dynamic_cast<te::ExternalPlugin*> (p))
                if (ext->getAudioPluginInstance() == nullptr)
                    issue ("error", t.getName() + ": the plug-in " + ext->getName() + " could not be loaded", id);

        trackList.add (o);
    }

    for (auto& [role, values] : byRole)
    {
        if (values.size() < 2)
            continue;

        auto [lo, hi] = std::minmax_element (values.begin(), values.end());

        if (*hi - *lo > 8.0 && role != "drums")
            issue ("info", "Your " + role + " tracks differ by " + String (*hi - *lo, 1) + " LU. Gain staging evens them out.", {}, "smart.gainStage");
    }

    Obj result;
    result.set ("tracks", trackList);

    if (includeMaster)
    {
        if (auto m = renderAndMeasure (app, te::toBitSet (te::getAllTracks (edit)), true))
        {
            const auto lufs = m->integrated();
            const auto peak = m->peakDb();
            const auto corr = m->correlation();
            const auto low = m->lowEndRatio();

            result.set ("master", Obj().set ("lufs", round1 (lufs)).set ("peakDb", round1 (peak)).set ("lra", round1 (m->loudnessRange()))
                                       .set ("correlation", std::round (corr * 100.0) / 100.0).set ("lowEndRatio", std::round (low * 100.0) / 100.0));

            if (peak > -0.1)
                issue ("error", "The master clips (peak " + String (peak, 1) + " dBFS). Add a limiter or lower the master.", {}, "smart.master");
            else if (peak > -1.0)
                issue ("warning", "Master peaks above -1 dBFS; streaming encoders may distort it.", {}, "smart.master");

            if (lufs < -20.0)
                issue ("info", "The mix is quiet for streaming (" + String (lufs, 1) + " LUFS; platforms play at about -14).", {}, "smart.master");
            else if (lufs > -8.0)
                issue ("warning", "The mix is very loud (" + String (lufs, 1) + " LUFS) and will be turned down by streaming services.", {}, "smart.master");

            if (corr < 0.0)
                issue ("error", "Strong phase cancellation: the mix will collapse in mono. Check stereo widening and polarity.");
            else if (corr < 0.3)
                issue ("warning", "Low stereo correlation (" + String (corr, 2) + "). Check the mix in mono.");

            if (low > 0.55)
                issue ("warning", "The low end dominates the mix. Try a high-pass on tracks that don't need sub frequencies.");
        }
        else
        {
            issue ("info", "The project is silent, so the master could not be measured.");
        }
    }

    if (issues.isEmpty())
        issue ("ok", "No problems found");

    result.set ("issues", issues);
    return result;
}

var planGainStaging (AppEngine& app, double targetLufs, const juce::StringArray& trackIds)
{
    juce::Array<var> details, calls;

    for (auto* t : te::getAudioTracks (app.edit()))
    {
        if (getTrackKind (*t) == TrackKind::fxReturn)
            continue;

        if (! trackIds.isEmpty() && ! trackIds.contains (t->itemID.toString()))
            continue;

        auto r = analyzeTrack (app, *t);

        if (! r.hasAudio)
            continue;

        const auto lufs = r.measure->integrated();

        if (lufs <= -69.0)
            continue;

        const auto delta = juce::jlimit (-24.0, 24.0, targetLufs - lufs);

        if (std::abs (delta) < 0.5)
            continue;

        details.add (Obj().set ("trackId", t->itemID.toString()).set ("name", t->getName())
                          .set ("before", round1 (lufs)).set ("after", round1 (lufs + delta)).set ("changeDb", round1 (delta)));

        if (r.rendered)
        {
            calls.add (call ("track.set", Obj().set ("id", t->itemID.toString())
                                               .set ("volumeDb", round1 (juce::jlimit (-60.0, 12.0, currentVolumeDb (*t) + delta)))));
            continue;
        }

        for (auto* c : t->getClips())
            if (auto* ac = dynamic_cast<te::AudioClipBase*> (c))
                calls.add (call ("clip.set", Obj().set ("id", ac->itemID.toString())
                                                  .set ("gainDb", round1 (juce::jlimit (-60.0, 24.0, (double) ac->getGainDB() + delta)))));
    }

    return plan (calls.isEmpty() ? "Every track is already within 0.5 LU of " + String (targetLufs, 0) + " LUFS"
                                 : "Gain stage " + String (details.size()) + " track(s) to " + String (targetLufs, 0) + " LUFS before plug-ins",
                 details, calls);
}

var planAutoDuck (AppEngine& app, const String& targetTrackId, const juce::StringArray& keyTrackIds, DuckSettings s)
{
    auto& target = app.audioTrack (targetTrackId);
    std::vector<bool> active;

    for (auto& id : keyTrackIds)
    {
        auto r = analyzeTrack (app, app.audioTrack (id));

        if (! r.hasAudio)
            continue;

        const auto& h = r.measure->analyzer.momentaryHistory;
        const auto gate = juce::jmax (-50.0, r.measure->integrated() - 15.0);

        if (active.size() < h.size())
            active.resize (h.size(), false);

        for (size_t i = 0; i < h.size(); ++i)
            if (h[i] > gate)
                active[i] = true;
    }

    // momentary history entry i covers [i*0.1 - 0.3, i*0.1 + 0.1]
    std::vector<std::pair<double, double>> regions;

    for (size_t i = 0; i < active.size(); ++i)
    {
        if (! active[i])
            continue;

        const auto start = juce::jmax (0.0, (double) i * stepSeconds - 0.3);
        auto end = (double) (i + 1) * stepSeconds;

        while (i + 1 < active.size() && active[i + 1])
            end = (double) (++i + 1) * stepSeconds;

        if (! regions.empty() && start - regions.back().second < (s.mergeMs + 2.0 * s.fadeMs) / 1000.0)
            regions.back().second = end;
        else
            regions.emplace_back (start, end);
    }

    regions.erase (std::remove_if (regions.begin(), regions.end(),
                                   [&] (auto& r) { return (r.second - r.first) * 1000.0 < s.minMs; }),
                   regions.end());

    const auto baseDb = (double) currentVolumeDb (target);
    const auto fade = s.fadeMs / 1000.0;
    auto pos = [] (double db) { return te::decibelsToVolumeFaderPosition ((float) db); };

    juce::Array<var> points, details;
    points.add (var (juce::Array<var> { 0.0, pos (baseDb), 0.0 }));

    for (auto& [start, end] : regions)
    {
        const auto rampStart = juce::jmax (0.0, start - fade);
        points.add (var (juce::Array<var> { rampStart, pos (baseDb), 0.0 }));
        points.add (var (juce::Array<var> { start, pos (baseDb - s.depthDb), 0.0 }));
        points.add (var (juce::Array<var> { end, pos (baseDb - s.depthDb), 0.0 }));
        points.add (var (juce::Array<var> { end + fade, pos (baseDb), 0.0 }));
        details.add (Obj().set ("start", round1 (start)).set ("end", round1 (end)));
    }

    juce::Array<var> calls;

    if (! regions.empty())
    {
        calls.add (call ("automation.setPoints", Obj().set ("pluginId", volumePluginId (target)).set ("paramId", "volume").set ("points", points)));
        calls.add (call ("track.set", Obj().set ("id", targetTrackId).set ("automationMode", "read")));
    }

    return plan (regions.empty() ? "No speech or vocal activity found to duck under"
                                 : "Duck " + target.getName() + " by " + String (s.depthDb, 0) + " dB in " + String ((int) regions.size()) + " place(s)",
                 details, calls);
}

var planMaster (AppEngine& app, double targetLufs, double ceilingDb)
{
    auto& edit = app.edit();
    auto m = renderAndMeasure (app, te::toBitSet (te::getAllTracks (edit)), true);

    if (m == nullptr || m->integrated() <= -69.0)
        return plan ("The project is silent, so there is nothing to master", {}, {});

    const auto measured = m->integrated();
    const auto delta = targetLufs - measured;

    LimiterPlugin* limiter = nullptr;

    for (auto* p : edit.getMasterPluginList())
        if (auto* l = dynamic_cast<LimiterPlugin*> (p))
            limiter = l;

    const double currentGain = limiter != nullptr ? limiter->inputGain->getCurrentValue() : 0.0;
    const double newGain = juce::jlimit (0.0, 18.0, currentGain + delta);
    const double remainder = (currentGain + delta) - newGain;

    juce::Array<var> calls, details;
    auto params = Obj().set ("inputGain", round1 (newGain)).set ("ceiling", round1 (ceilingDb)).set ("release", 120.0);

    if (limiter == nullptr)
    {
        calls.add (call ("plugin.add", Obj().set ("trackId", "master").set ("plugin", LimiterPlugin::xmlTypeName).set ("params", params)));
    }
    else
    {
        calls.add (call ("plugin.setParam", Obj().set ("id", limiter->itemID.toString()).set ("paramId", "inputGain").set ("value", round1 (newGain))));
        calls.add (call ("plugin.setParam", Obj().set ("id", limiter->itemID.toString()).set ("paramId", "ceiling").set ("value", round1 (ceilingDb))));
    }

    if (auto vp = edit.getMasterVolumePlugin())
    {
        const auto newMaster = juce::jlimit (-60.0, 0.0, juce::jmin (0.0, (double) vp->getVolumeDb()) + juce::jmin (0.0, remainder));

        if (std::abs (newMaster - vp->getVolumeDb()) > 0.05)
            calls.add (call ("master.set", Obj().set ("volumeDb", round1 (newMaster))));
    }

    details.add (Obj().set ("measuredLufs", round1 (measured)).set ("targetLufs", targetLufs)
                      .set ("limiterGainDb", round1 (newGain)).set ("ceilingDb", ceilingDb).set ("peakDb", round1 (m->peakDb())));

    return plan ("Master from " + String (measured, 1) + " to about " + String (targetLufs, 0) + " LUFS with a " + String (ceilingDb, 1) + " dB ceiling",
                 details, calls);
}

var planFullMix (AppEngine& app, const var& options)
{
    auto& edit = app.edit();
    const auto trackTarget = num (options, "trackLufs", -18.0);
    const auto masterTarget = num (options, "masterLufs", -14.0);
    const auto ceiling = num (options, "ceilingDb", -1.0);

    juce::Array<var> calls, steps;

    auto append = [&] (const String& title, const var& p)
    {
        if (auto* list = p["calls"].getArray())
            calls.addArray (*list);

        steps.add (Obj().set ("title", title).set ("summary", p["summary"]).set ("details", p["details"]));
    };

    append ("Gain staging", planGainStaging (app, trackTarget, {}));

    if (flag (options, "balance", true))
    {
        static const std::map<String, double> offsets { { "vocal", 0.0 }, { "dialogue", 0.0 }, { "drums", -3.0 },
                                                        { "bass", -4.0 }, { "music", -7.0 }, { "return", -2.0 } };
        juce::Array<var> balanceCalls, details;

        for (auto* t : te::getAudioTracks (edit))
        {
            const auto role = inferRole (*t);
            auto it = offsets.find (role);
            const auto db = it != offsets.end() ? it->second : -6.0;
            balanceCalls.add (call ("track.set", Obj().set ("id", t->itemID.toString()).set ("volumeDb", db)));
            details.add (Obj().set ("name", t->getName()).set ("role", role).set ("volumeDb", db));
        }

        append ("Balance", plan ("Set faders by role (lead parts up front, backing parts under)", details, balanceCalls));
    }

    juce::StringArray dialogue, music;

    for (auto* t : te::getAudioTracks (edit))
    {
        const auto role = inferRole (*t);

        if (role == "dialogue")
            dialogue.add (t->itemID.toString());
        else if (role == "music")
            music.add (t->itemID.toString());
    }

    if (flag (options, "duck", ! dialogue.isEmpty()) && ! dialogue.isEmpty())
        for (auto& m : music)
            append ("Ducking", planAutoDuck (app, m, dialogue, {}));

    // Mastering is measured with the earlier steps applied, then rolled back.
    if (flag (options, "master", true))
    {
        auto& um = edit.getUndoManager();
        um.beginNewTransaction ("Smart Mix preview");
        app.beginBatch ("Smart Mix preview");

        bool applied = true;

        try
        {
            for (auto& c : calls)
                app.rpc.invoke (c["method"].toString(), c["params"], "preview");
        }
        catch (...)
        {
            applied = false;
        }

        auto master = planMaster (app, masterTarget, ceiling);
        app.endBatch();
        um.undoCurrentTransactionOnly();
        app.markProjectChanged();

        if (applied)
            append ("Mastering", master);
    }

    return Obj().set ("summary", "Smart Mix: " + String (steps.size()) + " step(s), " + String (calls.size()) + " change(s)")
                .set ("steps", steps)
                .set ("calls", calls);
}

var planVocalChain (AppEngine& app, const String& trackId, const String& style)
{
    auto* at = dynamic_cast<te::AudioTrack*> (&app.track (trackId));

    if (at == nullptr || getTrackKind (*at) == TrackKind::fxReturn)
        throw RpcError ("A vocal chain goes on an audio track");

    struct Shape { double lowFreq, lowGain, mudGain, presenceFreq, presenceGain, airGain, thresholdDb, ratio, attackMs, releaseMs, sendDb; };
    const Shape s = style == "warm"    ? Shape { 90.0, -4.0, -2.5, 3000.0, 1.0, 1.5, -20.0, 3.0, 15.0, 150.0, -14.0 }
                  : style == "podcast" ? Shape { 120.0, -10.0, -3.0, 3200.0, 3.0, 1.0, -22.0, 3.5, 8.0, 120.0, 0.0 }
                  :                      Shape { 100.0, -6.0, -2.0, 3500.0, 2.5, 3.0, -18.0, 4.0, 10.0, 100.0, -12.0 };
    const String styleName = style == "warm" || style == "podcast" ? style : String ("pop");

    te::Plugin* eq = nullptr;
    te::Plugin* comp = nullptr;
    te::Plugin* deess = nullptr;
    bool hasSend = false;

    for (auto* p : at->pluginList)
    {
        if ((dynamic_cast<te::EqualiserPlugin*> (p) != nullptr || dynamic_cast<EqPlugin*> (p) != nullptr) && eq == nullptr)           eq = p;
        if ((dynamic_cast<te::CompressorPlugin*> (p) != nullptr || dynamic_cast<CompressorFx*> (p) != nullptr) && comp == nullptr)    comp = p;
        if (dynamic_cast<DeEsserPlugin*> (p) != nullptr && deess == nullptr)                                                          deess = p;
        if (dynamic_cast<te::AuxSendPlugin*> (p) != nullptr)                                                                          hasSend = true;
       #if TRACKTION_AIR_WINDOWS
        if (dynamic_cast<te::AirWindowsDeEss*> (p) != nullptr && deess == nullptr)     deess = p;
       #endif
    }

    const bool classicEq = dynamic_cast<te::EqualiserPlugin*> (eq) != nullptr;
    const bool classicComp = dynamic_cast<te::CompressorPlugin*> (comp) != nullptr;

    juce::Array<var> calls, details;

    auto configure = [&] (te::Plugin* existing, const String& type, int index, const String& label, const String& what, const var& params)
    {
        if (existing != nullptr)
        {
            if (auto* o = params.getDynamicObject())
                for (auto& prop : o->getProperties())
                    calls.add (call ("plugin.setParam", Obj().set ("id", existing->itemID.toString()).set ("paramId", prop.name.toString())
                                                             .set ("value", prop.value)));
        }
        else
        {
            calls.add (call ("plugin.add", Obj().set ("trackId", trackId).set ("plugin", type).set ("index", index).set ("params", params)));
        }

        details.add (Obj().set ("plugin", label).set ("action", existing != nullptr ? "tune" : "add").set ("what", what));
    };

    const String eqWhat = "Low cut, low shelf " + String (s.lowGain, 0) + " dB at " + String (s.lowFreq, 0) + " Hz, " + String (s.mudGain, 1) + " dB at 300 Hz, "
                        + String (s.presenceGain, 1) + " dB presence at " + String (s.presenceFreq / 1000.0, 1) + " kHz, " + String (s.airGain, 1) + " dB air";

    if (classicEq)
        configure (eq, te::EqualiserPlugin::xmlTypeName, 0, "Classic EQ", eqWhat,
                   Obj().set ("Low-pass freq", s.lowFreq).set ("Low-pass gain", s.lowGain)
                        .set ("Mid freq 1", 300.0).set ("Mid gain 1", s.mudGain).set ("Mid Q 1", 1.0)
                        .set ("Mid freq 2", s.presenceFreq).set ("Mid gain 2", s.presenceGain).set ("Mid Q 2", 0.8)
                        .set ("High-pass freq", 10000.0).set ("High-pass gain", s.airGain));
    else
        configure (eq, EqPlugin::xmlTypeName, 0, "Parametric EQ", eqWhat,
                   Obj().set ("b1on", 1).set ("b1type", Biquad::lowCut).set ("b1freq", s.lowFreq * 0.7).set ("b1slope", 1)
                        .set ("b2on", 1).set ("b2type", Biquad::lowShelf).set ("b2freq", s.lowFreq).set ("b2gain", s.lowGain)
                        .set ("b3on", 1).set ("b3type", Biquad::bell).set ("b3freq", 300.0).set ("b3gain", s.mudGain).set ("b3q", 1.0)
                        .set ("b5on", 1).set ("b5type", Biquad::bell).set ("b5freq", s.presenceFreq).set ("b5gain", s.presenceGain).set ("b5q", 0.8)
                        .set ("b7on", 1).set ("b7type", Biquad::highShelf).set ("b7freq", 10000.0).set ("b7gain", s.airGain));

    if (deess == nullptr)
    {
        calls.add (call ("plugin.add", Obj().set ("trackId", trackId).set ("plugin", String (DeEsserPlugin::xmlTypeName)).set ("index", 1)
                                          .set ("params", Obj().set ("threshold", -32.0).set ("range", 8.0))));
        details.add (Obj().set ("plugin", "De-esser").set ("action", "add").set ("what", "Tames harsh S and T sounds above 6 kHz"));
    }

    const String compWhat = String (s.ratio, 1) + ":1 at " + String (s.thresholdDb, 0) + " dB, " + String (s.attackMs, 0) + " ms attack, "
                          + String (s.releaseMs, 0) + " ms release";

    if (classicComp)
        configure (comp, te::CompressorPlugin::xmlTypeName, 2, "Classic Compressor", compWhat,
                   Obj().set ("threshold", juce::Decibels::decibelsToGain (s.thresholdDb)).set ("ratio", 1.0 / s.ratio)
                        .set ("attack", s.attackMs).set ("release", s.releaseMs));
    else
        configure (comp, CompressorFx::xmlTypeName, 2, "Compressor", compWhat + ", auto make-up",
                   Obj().set ("threshold", s.thresholdDb).set ("ratio", s.ratio).set ("knee", 6.0)
                        .set ("attack", s.attackMs).set ("release", s.releaseMs).set ("autoMakeup", 1).set ("detect", 1));

    if (s.sendDb < 0.0 && ! hasSend)
    {
        int bus = -1;

        for (auto* t : te::getAudioTracks (app.edit()))
        {
            if (getTrackKind (*t) != TrackKind::fxReturn)
                continue;

            int trackBus = -1;
            bool reverb = false;

            for (auto* p : t->pluginList)
            {
                if (auto* r = dynamic_cast<te::AuxReturnPlugin*> (p))  trackBus = r->busNumber;
                if (dynamic_cast<te::ReverbPlugin*> (p) != nullptr)    reverb = true;
            }

            if (reverb && trackBus >= 0)
            {
                bus = trackBus;
                break;
            }
        }

        if (bus >= 0)
        {
            calls.add (call ("send.add", Obj().set ("trackId", trackId).set ("bus", bus).set ("gainDb", s.sendDb)));
        }
        else
        {
            calls.add (call ("bus.create", Obj().set ("name", "Vocal Plate").set ("effect", "reverb")));
            calls.add (call ("send.add", Obj().set ("trackId", trackId).set ("bus", "$" + String (calls.size() - 1)).set ("gainDb", s.sendDb)));
        }

        details.add (Obj().set ("plugin", "Reverb send").set ("action", "add").set ("what", String (s.sendDb, 0) + " dB to a plate reverb"));
    }

    calls.add (call ("track.set", Obj().set ("id", trackId).set ("role", styleName == "podcast" ? "dialogue" : "vocal")));

    return plan ("Vocal chain (" + styleName + ") on " + at->getName(), details, calls);
}
}
