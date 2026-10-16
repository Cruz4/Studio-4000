#include "Api.h"
#include "../SmartMix.h"
#include "../LoudnessMeterPlugin.h"

namespace s3
{
namespace
{
    using K = Rpc::Kind;

    juce::StringArray stringList (const var& v)
    {
        juce::StringArray list;

        if (auto* a = v.getArray())
            for (auto& item : *a)
                list.add (item.toString());

        return list;
    }

    /** Returns the plan, or applies it as one undo step when params.apply is true. */
    var finish (AppEngine& app, const var& planned, const var& params, const String& label)
    {
        if (! flag (params, "apply"))
            return planned;

        auto result = app.rpc.invoke ("batch.run", Obj().set ("label", label).set ("calls", planned["calls"]), "smart");
        app.pushSnapshotNow();

        if (auto* o = planned.getDynamicObject())
            o->setProperty ("applied", true);

        (void) result;
        return planned;
    }
}

void registerSmartApi (AppEngine& app)
{
    auto& rpc = app.rpc;

    rpc.add ("smart.analyze", K::read, "Mix health report: per-track loudness and peaks, and the rendered master's LUFS, LRA, correlation",
             "{master?: true}", [&app] (const var& p)
    {
        return SmartMix::analyze (app, flag (p, "master", true));
    });

    rpc.add ("smart.gainStage", K::read, "Plans (or applies) clip gain so each track hits a loudness before plug-ins",
             "{targetLufs?: -18, trackIds?, apply?}", [&app] (const var& p)
    {
        return finish (app, SmartMix::planGainStaging (app, num (p, "targetLufs", -18.0), stringList (p["trackIds"])), p, "Gain staging");
    });

    rpc.add ("smart.duck", K::read, "Plans (or applies) volume automation that dips a music track under speech or vocals",
             "{targetTrackId, keyTrackIds, depthDb?: 6, mergeMs?: 250, minMs?: 400, fadeMs?: 120, apply?}", [&app] (const var& p)
    {
        SmartMix::DuckSettings s;
        s.depthDb = juce::jlimit (1.0, 40.0, num (p, "depthDb", s.depthDb));
        s.mergeMs = juce::jlimit (0.0, 5000.0, num (p, "mergeMs", s.mergeMs));
        s.minMs = juce::jlimit (0.0, 10000.0, num (p, "minMs", s.minMs));
        s.fadeMs = juce::jlimit (5.0, 3000.0, num (p, "fadeMs", s.fadeMs));

        return finish (app, SmartMix::planAutoDuck (app, reqStr (p, "targetTrackId"), stringList (p["keyTrackIds"]), s), p, "Auto duck");
    });

    rpc.add ("smart.master", K::read, "Plans (or applies) a master limiter and gain to reach a loudness target",
             "{targetLufs?: -14, ceilingDb?: -1, apply?}", [&app] (const var& p)
    {
        return finish (app, SmartMix::planMaster (app, num (p, "targetLufs", -14.0), num (p, "ceilingDb", -1.0)), p, "Smart master");
    });

    rpc.add ("smart.mix", K::read, "One-click mix: gain staging, role balance, ducking and mastering, as one plan",
             "{trackLufs?: -18, masterLufs?: -14, ceilingDb?: -1, balance?, duck?, master?, apply?}", [&app] (const var& p)
    {
        return finish (app, SmartMix::planFullMix (app, p), p, "Smart Mix");
    });

    rpc.add ("smart.vocalChain", K::read, "Plans (or applies) a vocal chain: EQ, de-esser, compressor and a plate reverb send",
             "{trackId, style?: pop|warm|podcast, apply?}", [&app] (const var& p)
    {
        return finish (app, SmartMix::planVocalChain (app, reqStr (p, "trackId"), str (p, "style", "pop")), p, "Vocal chain");
    });

    rpc.add ("smart.resetLoudness", K::read, "Resets the master integrated loudness reading", "{}", [&app] (const var&)
    {
        if (auto* lm = app.getMasterLoudnessMeter())
            lm->resetIntegrated();

        return var (true);
    });
}
}
