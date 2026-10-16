#include "Api.h"

namespace s3
{
namespace
{
    using K = Rpc::Kind;

    std::vector<double> markerTimes (te::Edit& edit)
    {
        std::vector<double> times;

        for (auto* m : edit.getMarkerManager().getMarkers())
            times.push_back (m->getPosition().getStart().inSeconds());

        std::sort (times.begin(), times.end());
        return times;
    }
}

void registerTransportApi (AppEngine& app)
{
    auto& rpc = app.rpc;

    rpc.add ("transport.play", K::read, "Starts playback", "{from?}", [&app] (const var& p)
    {
        auto& t = app.edit().getTransport();

        if (has (p, "from"))
            t.setPosition (seconds (num (p, "from")));

        t.play (false);
        return var (true);
    });

    rpc.add ("transport.stop", K::read, "Stops playback or recording. A second stop returns to the start position", "{}", [&app] (const var&)
    {
        auto& t = app.edit().getTransport();

        if (! t.isPlaying())
            t.setPosition (te::TimePosition());
        else
            t.stop (false, false);

        return var (true);
    });

    rpc.add ("transport.toggle", K::read, "Play/stop", "{}", [&app] (const var&)
    {
        auto& t = app.edit().getTransport();

        if (t.isPlaying())
            t.stop (false, false);
        else
            t.play (false);

        return var (t.isPlaying());
    });

    rpc.add ("transport.record", K::read, "Starts recording on armed tracks (or stops if already recording)", "{}", [&app] (const var&)
    {
        auto& t = app.edit().getTransport();

        if (t.isRecording())
        {
            t.stop (false, true);
            return var (false);
        }

        bool anyArmed = false;

        for (auto* in : app.edit().getAllInputDevices())
            for (auto target : in->getTargets())
                anyArmed = anyArmed || in->isRecordingEnabled (target);

        if (! anyArmed)
            throw RpcError ("Arm a track before recording");

        t.record (false);
        return var (true);
    });

    rpc.add ("transport.discardTake", K::read, "Stops recording and throws the take away", "{}", [&app] (const var&)
    {
        app.edit().getTransport().stop (true, true);
        return var (true);
    });

    rpc.add ("transport.setPosition", K::read, "Moves the playhead", "{time}", [&app] (const var& p)
    {
        app.edit().getTransport().setPosition (seconds (reqNum (p, "time")));
        return var (true);
    });

    rpc.add ("transport.nudge", K::read, "Moves the playhead by a number of bars", "{bars}", [&app] (const var& p)
    {
        auto& edit = app.edit();
        auto& t = edit.getTransport();
        auto& ts = edit.tempoSequence;
        auto sig = ts.getTimeSig (0);
        const double beatsPerBar = sig != nullptr ? sig->numerator.get() : 4.0;
        auto beat = ts.toBeats (t.getPosition()).inBeats() + num (p, "bars", 1.0) * beatsPerBar;
        beat = std::round (beat / beatsPerBar) * beatsPerBar;
        t.setPosition (ts.toTime (te::BeatPosition::fromBeats (juce::jmax (0.0, beat))));
        return var (true);
    });

    rpc.add ("transport.jumpMarker", K::read, "Jumps to the next or previous marker", "{direction: 1|-1}", [&app] (const var& p)
    {
        auto& t = app.edit().getTransport();
        const auto now = t.getPosition().inSeconds();
        const bool forward = num (p, "direction", 1.0) > 0;
        auto times = markerTimes (app.edit());

        if (forward)
        {
            for (auto time : times)
                if (time > now + 0.01) { t.setPosition (seconds (time)); return var (time); }

            t.setPosition (te::TimePosition() + app.edit().getLength());
        }
        else
        {
            for (auto it = times.rbegin(); it != times.rend(); ++it)
                if (*it < now - 0.25) { t.setPosition (seconds (*it)); return var (*it); }

            t.setPosition (te::TimePosition());
        }

        return var (t.getPosition().inSeconds());
    });

    rpc.add ("transport.setLoop", K::write, "Sets the loop/punch range and optionally enables looping", "{start, end, enabled?}",
             [&app] (const var& p)
    {
        auto& t = app.edit().getTransport();
        const auto s = reqNum (p, "start"), e = reqNum (p, "end");

        if (e - s < 0.05)
            throw RpcError ("Loop range is too short");

        t.setLoopRange ({ seconds (s), seconds (e) });

        if (has (p, "enabled"))
            t.looping = flag (p, "enabled");

        return var (true);
    });

    rpc.add ("transport.setLooping", K::read, "Turns cycle/loop playback on or off. Loop recording stacks takes", "{enabled}",
             [&app] (const var& p)
    {
        app.edit().getTransport().looping = flag (p, "enabled");
        app.markProjectChanged();
        return var (true);
    });

    rpc.add ("transport.setPunch", K::write, "Punch-in/out: records only inside the loop range", "{enabled}", [&app] (const var& p)
    {
        app.edit().recordingPunchInOut = flag (p, "enabled");
        return var (true);
    });

    rpc.add ("transport.setClick", K::write, "Metronome settings", "{enabled?, recordOnly?, gainDb?}", [&app] (const var& p)
    {
        auto& edit = app.edit();

        if (has (p, "enabled"))     edit.clickTrackEnabled = flag (p, "enabled");
        if (has (p, "recordOnly"))  edit.clickTrackRecordingOnly = flag (p, "recordOnly");
        if (has (p, "gainDb"))      edit.clickTrackGain = juce::Decibels::decibelsToGain ((float) num (p, "gainDb"));

        return var (true);
    });

    rpc.add ("transport.setCountIn", K::write, "Count-in before recording", "{mode: none|oneBar|twoBars|oneBeat|twoBeats}",
             [&app] (const var& p)
    {
        auto mode = str (p, "mode", "none");
        using C = te::Edit::CountIn;

        app.edit().setCountInMode (mode == "oneBar"   ? C::oneBar
                                 : mode == "twoBars"  ? C::twoBar
                                 : mode == "oneBeat"  ? C::oneBeat
                                 : mode == "twoBeats" ? C::twoBeat
                                                      : C::none);
        return var (true);
    });
}
}
