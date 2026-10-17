#include "Api.h"
#include "../StudioFx.h"

namespace s3
{
void registerAllApis (AppEngine& app)
{
    registerProjectApi (app);
    registerTransportApi (app);
    registerTrackApi (app);
    registerClipApi (app);
    registerPluginApi (app);
    registerAutomationApi (app);
    registerExportApi (app);
    registerSmartApi (app);
    registerAiApi (app);
    registerDeviceApi (app);
}

namespace
{
    using K = Rpc::Kind;

    void setRole (te::Track& t, const char* role)
    {
        t.state.setProperty ("s3role", role, nullptr);
    }

    void applyTemplate (AppEngine& app, const String& id)
    {
        auto& edit = app.edit();

        for (auto* t : te::getAudioTracks (edit))
            edit.deleteTrack (t);

        auto addAudio = [&] (const String& name, const char* role) -> te::Track::Ptr
        {
            auto t = createTrack (app, TrackKind::audio, name);
            setRole (*t, role);
            return t;
        };

        auto addInstrument = [&] (const String& name, const char* role) -> te::Track::Ptr
        {
            auto t = createTrack (app, TrackKind::instrument, name);
            setRole (*t, role);
            return t;
        };

        auto send = [&] (te::Track::Ptr t, int bus, float gainDb)
        {
            if (auto* at = dynamic_cast<te::AudioTrack*> (t.get()))
            {
                auto p = at->pluginList.insertPlugin (te::AuxSendPlugin::create(), -1);

                if (auto* s = dynamic_cast<te::AuxSendPlugin*> (p.get()))
                {
                    s->busNumber = bus;
                    s->setGainDb (gainDb);
                }
            }
        };

        if (id == "vocal")
        {
            edit.tempoSequence.getTempo (0)->setBpm (90.0);
            addAudio ("Beat", "music");
            auto lead = addAudio ("Lead Vocal", "vocal");
            auto dbl = addAudio ("Double", "vocal");
            auto adlib = addAudio ("Adlibs", "vocal");
            const int plate = createReturnBus (app, "Plate", te::ReverbPlugin::xmlTypeName);
            const int echo = createReturnBus (app, "Echo", te::DelayPlugin::xmlTypeName);

            for (auto& t : { lead, dbl, adlib })
            {
                insertPlugin (app, t->pluginList, EqPlugin::xmlTypeName, 0);
                insertPlugin (app, t->pluginList, CompressorFx::xmlTypeName, 1);
                send (t, plate, -12.0f);
            }

            send (lead, echo, -18.0f);
        }
        else if (id == "band")
        {
            for (auto [name, role] : { std::pair { "Kick", "drums" }, { "Snare", "drums" }, { "Overheads", "drums" },
                                       { "Bass", "bass" }, { "Guitar L", "music" }, { "Guitar R", "music" },
                                       { "Keys", "music" }, { "Vocal", "vocal" } })
                addAudio (name, role);

            const int room = createReturnBus (app, "Room", te::ReverbPlugin::xmlTypeName);

            for (auto* t : te::getAudioTracks (edit))
                if (getTrackKind (*t) == TrackKind::audio)
                    send (t, room, -20.0f);
        }
        else if (id == "beat")
        {
            edit.tempoSequence.getTempo (0)->setBpm (140.0);
            addInstrument ("Drums", "drums");
            addInstrument ("808", "bass");
            addInstrument ("Keys", "music");
            addInstrument ("Lead", "music");
            addAudio ("Samples", "music");
            addAudio ("Vocal", "vocal");
            createReturnBus (app, "Space", te::ReverbPlugin::xmlTypeName);
        }
        else if (id == "podcast")
        {
            auto host = addAudio ("Host", "dialogue");
            auto guest = addAudio ("Guest", "dialogue");
            addAudio ("Music", "music");

            for (auto& t : { host, guest })
            {
                auto eq = insertPlugin (app, t->pluginList, EqPlugin::xmlTypeName, 0);
                insertPlugin (app, t->pluginList, DeEsserPlugin::xmlTypeName, 1);
                auto comp = insertPlugin (app, t->pluginList, CompressorFx::xmlTypeName, 2);

                auto set = [] (te::Plugin& p, const char* id, float v)
                {
                    if (auto param = p.getAutomatableParameterByID (id))
                        param->setParameter (v, juce::dontSendNotification);
                };

                set (*eq, "b1on", 1.0f);
                set (*eq, "b1freq", 80.0f);
                set (*eq, "b1slope", 1.0f);
                set (*comp, "threshold", -24.0f);
                set (*comp, "ratio", 3.0f);
                set (*comp, "autoMakeup", 1.0f);
            }
        }
        else
        {
            addAudio ("Audio 1", "music");
        }
    }

    var resolveBatchRefs (const var& v, const juce::Array<var>& results)
    {
        if (v.isString())
        {
            const auto s = v.toString();

            if (s.length() < 2 || s[0] != '$' || ! juce::CharacterFunctions::isDigit (s[1]))
                return v;

            int i = 1, index = 0;

            while (i < s.length() && juce::CharacterFunctions::isDigit (s[i]))
                index = index * 10 + (s[i++] - '0');

            if (! juce::isPositiveAndBelow (index, results.size()))
                throw RpcError ("Reference " + s + " points to a call that hasn't run yet");

            var current = results[index];

            while (i < s.length())
            {
                if (s[i] == '.')
                {
                    int j = i + 1;

                    while (j < s.length() && (juce::CharacterFunctions::isLetterOrDigit (s[j]) || s[j] == '_'))
                        ++j;

                    current = current[juce::Identifier (s.substring (i + 1, j))];
                    i = j;
                }
                else if (s[i] == '[')
                {
                    const int j = s.indexOfChar (i, ']');

                    if (j < 0)
                        throw RpcError ("Malformed reference " + s);

                    current = current[s.substring (i + 1, j).getIntValue()];
                    i = j + 1;
                }
                else
                {
                    throw RpcError ("Malformed reference " + s);
                }
            }

            return current;
        }

        if (auto* array = v.getArray())
        {
            juce::Array<var> out;

            for (auto& item : *array)
                out.add (resolveBatchRefs (item, results));

            return out;
        }

        if (auto* object = v.getDynamicObject())
        {
            auto copy = new juce::DynamicObject();

            for (auto& prop : object->getProperties())
                copy->setProperty (prop.name, resolveBatchRefs (prop.value, results));

            return var (copy);
        }

        return v;
    }

    // `lengthSeconds` <= 0 reads the whole file. `requestedBins` <= 0 keeps the cheap 200-pair overview.
    // A zoomed view asks for about one pair per pixel of the visible span; the pair count is capped.
    var computePeaks (te::Engine& engine, const juce::File& file, double startSeconds, double lengthSeconds, int requestedBins)
    {
        static std::map<String, var> cache;
        const int ask = requestedBins > 0 ? juce::jlimit (32, 8000, requestedBins) : 200;
        const auto key = file.getFullPathName() + ":" + String (file.getLastModificationTime().toMilliseconds())
                        + ":" + String (startSeconds, 3) + ":" + String (lengthSeconds, 3) + ":" + String (ask);

        if (auto it = cache.find (key); it != cache.end())
            return it->second;

        std::unique_ptr<juce::AudioFormatReader> reader (engine.getAudioFileFormatManager().readFormatManager.createReaderFor (file));

        if (reader == nullptr)
            throw RpcError ("Cannot read audio file: " + file.getFileName());

        const double fileLength = reader->sampleRate > 0.0 ? (double) reader->lengthInSamples / reader->sampleRate : 0.0;
        const double start = lengthSeconds > 0.0 ? juce::jlimit (0.0, fileLength, startSeconds) : 0.0;
        double length = lengthSeconds > 0.0 ? juce::jmin (lengthSeconds, fileLength - start) : fileLength;

        if (length <= 0.0)
            length = fileLength;

        int binsPerSecond = ask;
        constexpr int maxBins = 12000;
        int totalBins = juce::jmax (1, (int) std::ceil (length * binsPerSecond));

        if (totalBins > maxBins)
        {
            binsPerSecond = juce::jmax (32, (int) std::floor ((double) maxBins / juce::jmax (0.001, length)));
            totalBins = juce::jmax (1, (int) std::ceil (length * binsPerSecond));
        }

        const auto startSample = (juce::int64) std::llround (start * reader->sampleRate);
        const int samplesPerBin = juce::jmax (1, (int) std::llround (reader->sampleRate / (double) binsPerSecond));
        const int numChannels = juce::jmin (2, (int) reader->numChannels);

        juce::MemoryBlock data ((size_t) totalBins * 2);
        auto* out = static_cast<int8_t*> (data.getData());

        constexpr int binsPerChunk = 512;
        juce::AudioBuffer<float> buffer (numChannels, binsPerChunk * samplesPerBin);

        for (int bin = 0; bin < totalBins; bin += binsPerChunk)
        {
            const auto sampleStart = startSample + (juce::int64) bin * samplesPerBin;
            const auto num = (int) juce::jmin ((juce::int64) buffer.getNumSamples(), reader->lengthInSamples - sampleStart);

            if (num <= 0)
            {
                for (int b = bin; b < totalBins; ++b)
                    out[b * 2] = out[b * 2 + 1] = 0;

                break;
            }

            reader->read (&buffer, 0, num, sampleStart, true, numChannels > 1);

            for (int b = 0; b < binsPerChunk && bin + b < totalBins; ++b)
            {
                float lo = 0.0f, hi = 0.0f;
                const int s0 = b * samplesPerBin;
                const int s1 = juce::jmin (num, s0 + samplesPerBin);

                for (int c = 0; c < numChannels; ++c)
                {
                    auto* d = buffer.getReadPointer (c);

                    for (int s = s0; s < s1; ++s)
                    {
                        lo = juce::jmin (lo, d[s]);
                        hi = juce::jmax (hi, d[s]);
                    }
                }

                out[(bin + b) * 2]     = (int8_t) juce::jlimit (-127, 127, (int) std::round (lo * 127.0f));
                out[(bin + b) * 2 + 1] = (int8_t) juce::jlimit (-127, 127, (int) std::round (hi * 127.0f));
            }
        }

        var result = Obj().set ("file", file.getFullPathName())
                          .set ("binsPerSecond", binsPerSecond)
                          .set ("start", start)
                          .set ("length", length)
                          .set ("sampleRate", reader->sampleRate)
                          .set ("channels", (int) reader->numChannels)
                          .set ("data", juce::Base64::toBase64 (data.getData(), data.getSize()));

        if (cache.size() > 64)
            cache.clear();

        cache[key] = result;
        return result;
    }
}

void registerProjectApi (AppEngine& app)
{
    auto& rpc = app.rpc;

    rpc.add ("app.describe", K::read, "Lists every method with its parameters", "{}",
             [&app] (const var&) { return app.rpc.describe(); });

    rpc.add ("app.info", K::read, "Version, paths and the open project", "{}", [&app] (const var&)
    {
        juce::Array<var> recent;

        for (auto& r : juce::StringArray::fromLines (app.settings().getValue ("recentProjects")))
            if (juce::File (r).existsAsFile())
                recent.add (Obj().set ("file", r).set ("name", juce::File (r).getFileNameWithoutExtension())
                                 .set ("modified", juce::File (r).getLastModificationTime().toISO8601 (true)));

        const auto versionFile = juce::File::getSpecialLocation (juce::File::currentApplicationFile).getSiblingFile ("version.json");
        const auto commit = juce::JSON::parse (versionFile.loadFileAsString())["commit"].toString().trim().toLowerCase();

        return var (Obj().set ("version", JUCE_APPLICATION_VERSION_STRING)
                         .set ("commit", commit)
                         .set ("projectsDir", defaultProjectsDir().getFullPathName())
                         .set ("dataDir", appDataDir().getFullPathName())
                         .set ("hasProject", app.currentEdit() != nullptr)
                         .set ("recent", recent)
                         .set ("onboarded", app.settings().getBoolValue ("onboarded", false)));
    });

    rpc.add ("project.get", K::read, "The full project model: tracks, clips, plug-ins, automation, tempo, markers", "{}",
             [&app] (const var&) { return buildProjectSnapshot (app); });

    rpc.add ("project.new", K::read, "Creates a project from a template", "{name, dir?, template?: blank|vocal|band|beat|podcast, bpm?}",
             [&app] (const var& p)
    {
        auto dir = has (p, "dir") ? juce::File (str (p, "dir")) : defaultProjectsDir();
        app.createProject (dir, str (p, "name", "Untitled Session"));
        applyTemplate (app, str (p, "template", "blank"));

        if (has (p, "bpm"))
            app.edit().tempoSequence.getTempo (0)->setBpm (juce::jlimit (20.0, 400.0, num (p, "bpm")));

        app.edit().getUndoManager().clearUndoHistory();
        app.save();
        app.pushSnapshotNow();
        return var (app.getEditFile().getFullPathName());
    });

    rpc.add ("project.open", K::read, "Opens a project file", "{file}", [&app] (const var& p)
    {
        app.openProject (juce::File (reqStr (p, "file")));
        return var (true);
    });

    rpc.add ("project.save", K::read, "Saves the project", "{}", [&app] (const var&)
    {
        app.save();
        return var (true);
    });

    rpc.add ("project.recover", K::read, "Restores the newer autosave of the open project", "{}", [&app] (const var&)
    {
        app.recoverFromAutosave();
        return var (true);
    });

    rpc.add ("project.saveCopy", K::read, "Saves a copy of the project file under a new name in the same folder", "{name}",
             [&app] (const var& p)
    {
        auto target = app.getProjectDir().getChildFile (juce::File::createLegalFileName (reqStr (p, "name")) + projectFileExtension);
        te::EditFileOperations (app.edit()).writeToFile (target, false);
        return var (target.getFullPathName());
    });

    rpc.add ("edit.undo", K::read, "Undo the last change", "{}", [&app] (const var&)
    {
        app.edit().undo();
        app.pushSnapshotNow();
        return var (true);
    });

    rpc.add ("edit.redo", K::read, "Redo", "{}", [&app] (const var&)
    {
        app.edit().redo();
        app.pushSnapshotNow();
        return var (true);
    });

    rpc.add ("edit.history", K::read, "The undo and redo action names, newest undo first", "{}", [&app] (const var&)
    {
        auto& um = app.edit().getUndoManager();
        juce::Array<var> undo, redo;

        for (auto& s : um.getUndoDescriptions()) undo.add (s);
        for (auto& s : um.getRedoDescriptions()) redo.add (s);

        return Obj().set ("undo", undo).set ("redo", redo);
    });

    rpc.add ("edit.jump", K::read, "Undoes or redoes several steps. Positive steps undo; negative steps redo", "{steps}",
             [&app] (const var& p)
    {
        auto& um = app.edit().getUndoManager();
        const int steps = integer (p, "steps", 0);

        if (steps > 0)
            for (int i = 0; i < steps && um.canUndo(); ++i)
                um.undo();
        else
            for (int i = 0; i < -steps && um.canRedo(); ++i)
                um.redo();

        app.pushSnapshotNow();
        return var (true);
    });

    rpc.add ("project.setTempo", K::write, "Sets the song tempo (first tempo point)", "{bpm}", [&app] (const var& p)
    {
        app.edit().tempoSequence.getTempo (0)->setBpm (juce::jlimit (20.0, 400.0, reqNum (p, "bpm")));
        return var (true);
    });

    rpc.add ("project.setTimeSig", K::write, "Sets the time signature", "{numerator, denominator}", [&app] (const var& p)
    {
        if (auto* sig = app.edit().tempoSequence.getTimeSig (0))
            sig->setStringTimeSig (String (integer (p, "numerator", 4)) + "/" + String (integer (p, "denominator", 4)));

        return var (true);
    });

    rpc.add ("tempo.add", K::write, "Adds a tempo change", "{time, bpm}", [&app] (const var& p)
    {
        auto& ts = app.edit().tempoSequence;
        auto t = ts.insertTempo (seconds (reqNum (p, "time")));

        if (t != nullptr)
            t->setBpm (juce::jlimit (20.0, 400.0, reqNum (p, "bpm")));

        return var (true);
    });

    rpc.add ("tempo.remove", K::write, "Removes a tempo change by index (not the first)", "{index}", [&app] (const var& p)
    {
        auto& ts = app.edit().tempoSequence;
        const int index = integer (p, "index", -1);

        if (index <= 0 || index >= ts.getNumTempos())
            throw RpcError ("Invalid tempo index");

        ts.removeTempo (index, false);
        return var (true);
    });

    rpc.add ("marker.add", K::write, "Adds a marker", "{time, name?}", [&app] (const var& p)
    {
        auto& mm = app.edit().getMarkerManager();
        auto m = mm.createMarker (-1, seconds (reqNum (p, "time")), te::TimeDuration(), nullptr);

        if (m != nullptr && has (p, "name"))
            m->setName (str (p, "name"));

        return m != nullptr ? var (m->itemID.toString()) : var();
    });

    rpc.add ("marker.set", K::write, "Renames or moves a marker", "{id, name?, time?}", [&app] (const var& p)
    {
        for (auto* m : app.edit().getMarkerManager().getMarkers())
        {
            if (m->itemID.toString() == reqStr (p, "id"))
            {
                if (has (p, "name")) m->setName (str (p, "name"));
                if (has (p, "time")) m->setStart (seconds (num (p, "time")), false, true);
                return var (true);
            }
        }

        throw RpcError ("Marker not found");
    });

    rpc.add ("marker.remove", K::write, "Deletes a marker", "{id}", [&app] (const var& p)
    {
        for (auto* m : app.edit().getMarkerManager().getMarkers())
        {
            if (m->itemID.toString() == reqStr (p, "id"))
            {
                m->removeFromParent();
                return var (true);
            }
        }

        throw RpcError ("Marker not found");
    });

    rpc.add ("media.peaks", K::read,
             "Waveform min/max pairs for an audio file. Omit start, length and binsPerSecond for a 200-pair overview; pass a visible range and about one pair per pixel when zoomed in",
             "{file, start?, length?, binsPerSecond?}",
             [&app] (const var& p)
    {
        return computePeaks (app.getEngine(), juce::File (reqStr (p, "file")),
                             num (p, "start", 0.0), num (p, "length", 0.0), integer (p, "binsPerSecond", 0));
    });

    rpc.add ("media.info", K::read, "Length, rate and channels of an audio file", "{file}", [&app] (const var& p)
    {
        te::AudioFile af (app.getEngine(), juce::File (reqStr (p, "file")));

        if (! af.isValid())
            throw RpcError ("Not a readable audio file");

        return var (Obj().set ("length", af.getLength()).set ("sampleRate", af.getSampleRate()).set ("channels", af.getNumChannels()));
    });

    rpc.add ("media.list", K::read, "Audio files in the project folders", "{}", [&app] (const var&)
    {
        juce::Array<var> files;

        for (auto* sub : { "Audio", "Imported", "Bounces" })
            for (auto& f : app.getProjectDir().getChildFile (sub).findChildFiles (juce::File::findFiles, false, "*.wav;*.flac;*.ogg;*.mp3;*.aif;*.aiff"))
                files.add (Obj().set ("file", f.getFullPathName()).set ("name", f.getFileName()).set ("folder", sub)
                                .set ("size", (double) f.getSize()));

        return var (files);
    });

    rpc.add ("media.writeFile", K::read, "Writes base64 data into the project's Imported folder (used for collaboration transfers)",
             "{name, data, append?}", [&app] (const var& p)
    {
        auto f = app.getProjectDir().getChildFile ("Imported").getChildFile (juce::File::createLegalFileName (reqStr (p, "name")));
        juce::MemoryOutputStream decoded;

        if (! juce::Base64::convertFromBase64 (decoded, reqStr (p, "data")))
            throw RpcError ("Invalid base64");

        if (! flag (p, "append"))
            f.deleteFile();

        juce::FileOutputStream out (f);

        if (! out.openedOk())
            throw RpcError ("Cannot write " + f.getFullPathName());

        out.write (decoded.getData(), decoded.getDataSize());
        return var (f.getFullPathName());
    });

    rpc.add ("media.readFile", K::read, "Reads a chunk of a project media file as base64", "{file, offset?, length?}", [&app] (const var& p)
    {
        juce::File f (reqStr (p, "file"));

        if (! f.isAChildOf (app.getProjectDir()))
            throw RpcError ("Only files inside the project folder can be read");

        juce::FileInputStream in (f);

        if (! in.openedOk())
            throw RpcError ("Cannot read " + f.getFileName());

        const auto offset = (juce::int64) num (p, "offset", 0);
        const auto length = (int) juce::jmin ((juce::int64) num (p, "length", 512 * 1024), in.getTotalLength() - offset);
        in.setPosition (offset);

        juce::MemoryBlock block;
        in.readIntoMemoryBlock (block, juce::jmax (0, length));

        return var (Obj().set ("data", juce::Base64::toBase64 (block.getData(), block.getSize()))
                         .set ("total", (double) in.getTotalLength())
                         .set ("name", f.getFileName()));
    });

    rpc.add ("settings.get", K::read, "Reads a user setting", "{key}", [&app] (const var& p)
    {
        auto key = reqStr (p, "key");

        if (key.startsWithIgnoreCase ("secret"))
            throw RpcError ("That setting is not readable");

        return var (app.settings().getValue (key));
    });

    rpc.add ("settings.set", K::read, "Writes a user setting", "{key, value}", [&app] (const var& p)
    {
        auto key = reqStr (p, "key");

        if (key.startsWithIgnoreCase ("secret"))
            throw RpcError ("That setting is not writable");

        app.settings().setValue (key, p["value"].toString());
        app.settings().saveIfNeeded();
        return var (true);
    });

    rpc.add ("batch.run", K::read, "Runs several write calls as one undo step; rolls back if any call fails. "
                                   "A string param \"$N\", \"$N.field\" or \"$N[0]\" is replaced by the result of call N (0-based), "
                                   "e.g. track.add returns [id] so a later call can use \"$0[0]\"",
             "{label, calls: [{method, params}]}", [&app] (const var& p)
    {
        auto* calls = p["calls"].getArray();

        if (calls == nullptr)
            throw RpcError ("calls must be an array");

        app.beginBatch (str (p, "label", "Batch"));
        juce::Array<var> results;

        try
        {
            for (auto& c : *calls)
            {
                auto method = c["method"].toString();

                if (method == "batch.run")
                    throw RpcError ("Nested batches are not allowed");

                results.add (app.rpc.invoke (method, resolveBatchRefs (c["params"], results), "batch"));
            }
        }
        catch (...)
        {
            app.endBatch();
            app.edit().getUndoManager().undoCurrentTransactionOnly();
            app.markProjectChanged();
            throw;
        }

        app.endBatch();
        return var (results);
    });
}
}
