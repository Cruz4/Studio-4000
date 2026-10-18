#include "Api.h"

namespace s3
{
namespace
{
    using K = Rpc::Kind;

    te::ClipTrack& clipTrack (AppEngine& app, const String& id)
    {
        if (auto* ct = dynamic_cast<te::ClipTrack*> (&app.track (id)))
            return *ct;

        throw RpcError ("That track can't hold clips");
    }

    te::AudioClipBase& audioClip (AppEngine& app, const String& id)
    {
        if (auto* ac = dynamic_cast<te::AudioClipBase*> (&app.clip (id)))
            return *ac;

        throw RpcError ("Not an audio clip");
    }

    te::MidiClip& midiClip (AppEngine& app, const String& id)
    {
        if (auto* mc = dynamic_cast<te::MidiClip*> (&app.clip (id)))
            return *mc;

        throw RpcError ("Not a MIDI clip");
    }

    te::AudioFadeCurve::Type fadeType (const String& s)
    {
        if (s == "convex")   return te::AudioFadeCurve::convex;
        if (s == "concave")  return te::AudioFadeCurve::concave;
        if (s == "scurve")   return te::AudioFadeCurve::sCurve;
        return te::AudioFadeCurve::linear;
    }

    float sourcePeakDb (te::Engine& engine, te::AudioClipBase& clip)
    {
        std::unique_ptr<juce::AudioFormatReader> reader (engine.getAudioFileFormatManager().readFormatManager
                                                             .createReaderFor (clip.getCurrentSourceFile()));
        if (reader == nullptr)
            return -100.0f;

        const auto pos = clip.getPosition();
        const auto speed = clip.getSpeedRatio();
        const auto start = (juce::int64) (pos.getOffset().inSeconds() * speed * reader->sampleRate);
        const auto length = (juce::int64) (pos.getLength().inSeconds() * speed * reader->sampleRate);

        juce::Range<float> ranges[2];
        const int channels = juce::jmin (2, (int) reader->numChannels);
        reader->readMaxLevels (start, length, ranges, channels);

        float peak = 0.0f;

        for (int c = 0; c < channels; ++c)
            peak = juce::jmax (peak, std::abs (ranges[c].getStart()), std::abs (ranges[c].getEnd()));

        return juce::Decibels::gainToDecibels (peak, -100.0f);
    }

    juce::File importIntoProject (AppEngine& app, const juce::File& source)
    {
        if (source.isAChildOf (app.getProjectDir()))
            return source;

        auto dir = app.getProjectDir().getChildFile ("Imported");
        dir.createDirectory();
        auto dest = dir.getChildFile (source.getFileName());

        if (dest.existsAsFile() && dest.getSize() == source.getSize())
            return dest;

        dest = dir.getNonexistentChildFile (source.getFileNameWithoutExtension(), source.getFileExtension(), false);

        if (! source.copyFileTo (dest))
            throw RpcError ("Could not copy " + source.getFileName() + " into the project");

        return dest;
    }

    void setMidiNotes (te::MidiClip& mc, const var& notes, juce::UndoManager* um)
    {
        auto& seq = mc.getSequence();
        seq.removeAllNotes (um);

        if (auto* list = notes.getArray())
        {
            for (auto& n : *list)
            {
                const int pitch = juce::jlimit (0, 127, (int) n[0]);
                const double beat = juce::jmax (0.0, (double) n[1]);
                const double len = juce::jmax (1.0 / 64.0, (double) n[2]);
                const int vel = juce::jlimit (1, 127, n.size() > 3 ? (int) n[3] : 100);
                seq.addNote (pitch, te::BeatPosition::fromBeats (beat), te::BeatDuration::fromBeats (len), vel, 0, um);
            }
        }
    }
}

void registerClipApi (AppEngine& app)
{
    auto& rpc = app.rpc;

    rpc.add ("clip.importAudio", K::write, "Imports an audio file onto a track (copied into the project)", "{trackId, file, start?}",
             [&app] (const var& p)
    {
        auto& ct = clipTrack (app, reqStr (p, "trackId"));
        auto file = importIntoProject (app, juce::File (reqStr (p, "file")));
        te::AudioFile af (app.getEngine(), file);

        if (! af.isValid())
            throw RpcError ("Unsupported or unreadable audio file: " + file.getFileName());

        const auto start = num (p, "start", 0.0);
        te::ClipPosition pos { { seconds (start), duration (af.getLength()) } };
        auto clip = ct.insertWaveClip (file.getFileNameWithoutExtension(), file, pos, false);

        if (clip == nullptr)
            throw RpcError ("Could not insert the clip");

        // A mono track plays one channel. A stereo track keeps a stereo file stereo.
        const bool monoTrack = (int) ct.state.getProperty ("s4channels", 2) <= 1;
        clip->setActiveChannelConfiguration (monoTrack || af.getNumChannels() < 2
                                                 ? te::ChannelConfiguration::mono()
                                                 : te::ChannelConfiguration::stereo());

        return var (clip->itemID.toString());
    });

    rpc.add ("clip.addMidi", K::write, "Creates an empty MIDI clip", "{trackId, start, end, name?}", [&app] (const var& p)
    {
        auto& ct = clipTrack (app, reqStr (p, "trackId"));
        const auto s = reqNum (p, "start"), e = juce::jmax (s + 0.1, reqNum (p, "end"));
        auto clip = ct.insertMIDIClip (str (p, "name", "MIDI"), { seconds (s), seconds (e) }, nullptr);

        if (clip == nullptr)
            throw RpcError ("Could not create the MIDI clip");

        if (has (p, "notes"))
            setMidiNotes (*clip, p["notes"], &app.edit().getUndoManager());

        return var (clip->itemID.toString());
    });

    rpc.add ("clip.move", K::write, "Moves a clip in time and optionally to another track", "{id, start, trackId?}", [&app] (const var& p)
    {
        auto& c = app.clip (reqStr (p, "id"));

        if (has (p, "trackId"))
        {
            auto& dest = clipTrack (app, str (p, "trackId"));

            if (c.getClipTrack() != &dest && ! c.moveTo (dest))
                throw RpcError ("The clip can't go on that track");
        }

        c.setStart (seconds (reqNum (p, "start")), false, true);
        return var (true);
    });

    rpc.add ("clip.trim", K::write, "Trims the clip edges without moving its content", "{id, start?, end?}", [&app] (const var& p)
    {
        auto& c = app.clip (reqStr (p, "id"));

        if (has (p, "start"))
        {
            const auto newStart = juce::jmin (num (p, "start"), c.getPosition().getEnd().inSeconds() - 0.01);
            c.setStart (seconds (newStart), true, false);
        }

        if (has (p, "end"))
        {
            const auto newEnd = juce::jmax (num (p, "end"), c.getPosition().getStart().inSeconds() + 0.01);
            c.setEnd (seconds (newEnd), true);
        }

        return var (true);
    });

    rpc.add ("clip.slip", K::write, "Slides the audio inside a clip without moving the clip (positive = later material)", "{id, offset}",
             [&app] (const var& p)
    {
        auto& c = app.clip (reqStr (p, "id"));
        c.setOffset (tracktion::TimeDuration::fromSeconds (juce::jmax (0.0, reqNum (p, "offset"))));
        return var (true);
    });

    rpc.add ("clip.split", K::write, "Splits a clip at a time", "{id, time}", [&app] (const var& p)
    {
        auto& c = app.clip (reqStr (p, "id"));
        auto* ct = c.getClipTrack();
        const auto t = reqNum (p, "time");

        if (ct == nullptr || ! c.getPosition().time.containsInclusive (seconds (t)))
            throw RpcError ("The split point is outside the clip");

        auto* right = ct->splitClip (c, seconds (t));
        return right != nullptr ? var (right->itemID.toString()) : var();
    });

    rpc.add ("clip.splitAt", K::write, "Splits every clip under the time on the given tracks (all tracks if omitted)", "{time, trackIds?}",
             [&app] (const var& p)
    {
        const auto t = seconds (reqNum (p, "time"));
        juce::Array<te::ClipTrack*> tracks;

        if (auto* ids = p["trackIds"].getArray())
        {
            for (auto& id : *ids)
                tracks.add (&clipTrack (app, id.toString()));
        }
        else
        {
            for (auto* at : te::getAudioTracks (app.edit()))
                tracks.add (at);
        }

        int count = 0;

        for (auto* ct : tracks)
            for (auto* c : ct->getClips())
                if (c->getPosition().time.contains (t) && ct->splitClip (*c, t) != nullptr)
                    ++count;

        return var (count);
    });

    rpc.add ("clip.delete", K::write, "Deletes clips", "{id} or {ids}", [&app] (const var& p)
    {
        juce::StringArray ids;

        if (auto* list = p["ids"].getArray())
            for (auto& v : *list)
                ids.add (v.toString());
        else
            ids.add (reqStr (p, "id"));

        for (auto& id : ids)
            app.clip (id).removeFromParent();

        return var (true);
    });

    rpc.add ("clip.duplicate", K::write, "Copies a clip, by default right after itself", "{id, start?}", [&app] (const var& p)
    {
        auto& c = app.clip (reqStr (p, "id"));
        auto copy = te::duplicateClip (c);

        if (copy == nullptr)
            throw RpcError ("Could not duplicate the clip");

        copy->setStart (seconds (num (p, "start", c.getPosition().getEnd().inSeconds())), false, true);
        return var (copy->itemID.toString());
    });

    rpc.add ("clip.setGainPoints", K::write, "Sets the clip gain envelope. Points are [seconds from the clip start, dB]; an empty list clears it",
             "{id, points}", [&app] (const var& p)
    {
        auto& ac = audioClip (app, reqStr (p, "id"));
        juce::Array<var> points;

        if (auto* list = p["points"].getArray())
            for (const auto& pt : *list)
                points.add (pt);

        setClipGainPoints (ac, points);
        return var (true);
    });

    rpc.add ("clip.setPanPoints", K::write, "Sets the clip pan envelope. Points are [seconds from the clip start, pan from -1 to 1]; an empty list clears it",
             "{id, points}", [&app] (const var& p)
    {
        auto& ac = audioClip (app, reqStr (p, "id"));
        juce::Array<var> points;

        if (auto* list = p["points"].getArray())
            for (const auto& pt : *list)
                points.add (pt);

        setClipPanPoints (ac, points);
        return var (true);
    });

    rpc.add ("clip.set", K::write, "Changes clip properties",
             "{id, name?, colour?, muted?, gainDb?, pan?, fadeIn?, fadeOut?, fadeInType?, fadeOutType?, fadeInBend?, fadeOutBend?, pitch?, reversed?, autoTempo?, take?}",
             [&app] (const var& p)
    {
        auto& c = app.clip (reqStr (p, "id"));

        if (has (p, "name"))    c.setName (str (p, "name"));
        if (has (p, "colour"))  c.setColour (colourFromString (str (p, "colour"), c.getColour()));
        if (has (p, "muted"))   c.setMuted (flag (p, "muted"));
        if (has (p, "take"))    c.setCurrentTake (integer (p, "take"));

        if (auto* ac = dynamic_cast<te::AudioClipBase*> (&c))
        {
            if (has (p, "gainDb"))      ac->setGainDB (juce::jlimit (-60.0f, 24.0f, (float) num (p, "gainDb")));
            if (has (p, "pan"))         ac->setPan (juce::jlimit (-1.0f, 1.0f, (float) num (p, "pan")));
            if (has (p, "fadeIn"))      ac->setFadeIn (duration (num (p, "fadeIn")));
            if (has (p, "fadeOut"))     ac->setFadeOut (duration (num (p, "fadeOut")));
            if (has (p, "fadeInBend"))  ac->state.setProperty ("s4000FadeInBend", juce::jlimit (-1.0, 1.0, num (p, "fadeInBend")), ac->getUndoManager());
            if (has (p, "fadeOutBend")) ac->state.setProperty ("s4000FadeOutBend", juce::jlimit (-1.0, 1.0, num (p, "fadeOutBend")), ac->getUndoManager());
            if (has (p, "fadeInType"))  { ac->state.removeProperty ("s4000FadeInBend", ac->getUndoManager()); ac->setFadeInType (fadeType (str (p, "fadeInType"))); }
            if (has (p, "fadeOutType")) { ac->state.removeProperty ("s4000FadeOutBend", ac->getUndoManager()); ac->setFadeOutType (fadeType (str (p, "fadeOutType"))); }

            if (has (p, "fadeIn") || has (p, "fadeOut") || has (p, "fadeInBend") || has (p, "fadeOutBend") || has (p, "fadeInType") || has (p, "fadeOutType"))
                syncClipFadeShape (*ac);
            if (has (p, "reversed"))    ac->setIsReversed (flag (p, "reversed"));

            if (has (p, "pitch"))
            {
                ac->setTimeStretchMode (te::TimeStretcher::soundtouchBetter);
                ac->setPitchChange ((float) num (p, "pitch"));
            }

            if (has (p, "autoTempo"))
            {
                ac->setTimeStretchMode (te::TimeStretcher::soundtouchBetter);
                ac->setAutoTempo (flag (p, "autoTempo"));
            }
        }

        return var (true);
    });

    rpc.add ("clip.stretch", K::write, "Time-stretches an audio clip to a new length, keeping pitch", "{id, length}", [&app] (const var& p)
    {
        auto& ac = audioClip (app, reqStr (p, "id"));
        const auto oldLength = ac.getPosition().getLength().inSeconds();
        const auto newLength = juce::jlimit (0.05, 3600.0, reqNum (p, "length"));

        ac.setTimeStretchMode (te::TimeStretcher::soundtouchBetter);
        ac.setAutoTempo (false);
        ac.setSpeedRatio (juce::jlimit (0.1, 10.0, ac.getSpeedRatio() * oldLength / newLength));
        ac.setLength (duration (newLength), true);
        return var (true);
    });

    rpc.add ("clip.normalize", K::write, "Sets clip gain so its peak reaches a level", "{id, peakDb?}", [&app] (const var& p)
    {
        auto& ac = audioClip (app, reqStr (p, "id"));
        const auto peak = sourcePeakDb (app.getEngine(), ac);

        if (peak <= -99.0f)
            throw RpcError ("The clip is silent");

        ac.setGainDB (juce::jlimit (-60.0f, 24.0f, (float) num (p, "peakDb", -1.0) - peak));
        return var (ac.getGainDB());
    });

    rpc.add ("clip.comp", K::write, "Comping: uses a take for a time range of a multi-take clip", "{id, start, end, take}",
             [&app] (const var& p)
    {
        auto* c = &app.clip (reqStr (p, "id"));
        auto* ct = c->getClipTrack();
        const auto s = seconds (reqNum (p, "start")), e = seconds (reqNum (p, "end"));

        if (ct == nullptr || ! c->hasAnyTakes())
            throw RpcError ("That clip has no takes to comp from");

        if (c->getPosition().time.contains (s) && s > c->getPosition().getStart())
            if (auto* right = ct->splitClip (*c, s))
                c = right;

        if (c->getPosition().time.contains (e))
            ct->splitClip (*c, e);

        c->setCurrentTake (integer (p, "take"));
        return var (c->itemID.toString());
    });

    rpc.add ("clip.flattenTakes", K::write, "Deletes unused takes from a clip", "{id}", [&app] (const var& p)
    {
        if (auto* wc = dynamic_cast<te::WaveAudioClip*> (&app.clip (reqStr (p, "id"))))
            wc->deleteAllUnusedTakes (false);

        return var (true);
    });

    rpc.add ("edit.deleteRange", K::write, "Removes everything in a time range, optionally closing the gap", "{start, end, trackIds?, ripple?}",
             [&app] (const var& p)
    {
        auto& edit = app.edit();
        const te::TimeRange range { seconds (reqNum (p, "start")), seconds (reqNum (p, "end")) };
        juce::Array<te::ClipTrack*> tracks;

        if (auto* ids = p["trackIds"].getArray())
            for (auto& id : *ids)
                tracks.add (&clipTrack (app, id.toString()));
        else
            for (auto* at : te::getAudioTracks (edit))
                tracks.add (at);

        for (auto* ct : tracks)
        {
            ct->deleteRegion (range, nullptr);

            if (flag (p, "ripple"))
                for (auto* c : ct->getClips())
                    if (c->getPosition().getStart() >= range.getEnd())
                        c->setStart (c->getPosition().getStart() - range.getLength(), false, true);
        }

        return var (true);
    });

    rpc.add ("midi.setNotes", K::write, "Replaces all notes of a MIDI clip. Beats are relative to the clip start",
             "{clipId, notes: [[pitch, beat, lengthBeats, velocity]]}", [&app] (const var& p)
    {
        setMidiNotes (midiClip (app, reqStr (p, "clipId")), p["notes"], &app.edit().getUndoManager());
        return var (true);
    });

    rpc.add ("midi.addNote", K::write, "Adds a note to a MIDI clip", "{clipId, pitch, beat, length, velocity?}", [&app] (const var& p)
    {
        auto& mc = midiClip (app, reqStr (p, "clipId"));
        mc.getSequence().addNote (juce::jlimit (0, 127, integer (p, "pitch", 60)),
                                  te::BeatPosition::fromBeats (juce::jmax (0.0, num (p, "beat"))),
                                  te::BeatDuration::fromBeats (juce::jmax (1.0 / 64.0, num (p, "length", 1.0))),
                                  juce::jlimit (1, 127, integer (p, "velocity", 100)), 0, &app.edit().getUndoManager());
        return var (true);
    });

    rpc.add ("midi.removeNotes", K::write, "Removes notes by index", "{clipId, indices}", [&app] (const var& p)
    {
        auto& seq = midiClip (app, reqStr (p, "clipId")).getSequence();
        juce::Array<te::MidiNote*> toRemove;

        if (auto* list = p["indices"].getArray())
            for (auto& i : *list)
                if (auto* n = seq.getNote ((int) i))
                    toRemove.add (n);

        for (auto* n : toRemove)
            seq.removeNote (*n, &app.edit().getUndoManager());

        return var (toRemove.size());
    });

    rpc.add ("midi.quantize", K::write, "Quantizes note starts to a grid (in beats, e.g. 0.25 for 1/16)", "{clipId, grid?, strength?}",
             [&app] (const var& p)
    {
        auto& seq = midiClip (app, reqStr (p, "clipId")).getSequence();
        const double grid = juce::jmax (1.0 / 64.0, num (p, "grid", 0.25));
        const double strength = juce::jlimit (0.0, 1.0, num (p, "strength", 1.0));

        for (auto* n : seq.getNotes())
        {
            const auto start = n->getStartBeat().inBeats();
            const auto target = std::round (start / grid) * grid;
            n->setStartAndLength (te::BeatPosition::fromBeats (start + (target - start) * strength), n->getLengthBeats(),
                                  &app.edit().getUndoManager());
        }

        return var (true);
    });

    rpc.add ("midi.transpose", K::write, "Transposes every note", "{clipId, semitones}", [&app] (const var& p)
    {
        auto& seq = midiClip (app, reqStr (p, "clipId")).getSequence();
        const int shift = integer (p, "semitones");

        for (auto* n : seq.getNotes())
            n->setNoteNumber (juce::jlimit (0, 127, n->getNoteNumber() + shift), &app.edit().getUndoManager());

        return var (true);
    });
}
}
