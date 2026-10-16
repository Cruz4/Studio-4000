#include "Api.h"

namespace s3
{
namespace
{
    using K = Rpc::Kind;

    struct RenderJob
    {
        int id = 0;
        std::vector<te::Renderer::Parameters> queue;
        std::vector<String> labels;
        size_t index = 0;
        std::shared_ptr<te::EditRenderer::Handle> handle;
        juce::Array<var> files;
        juce::StringArray errors;
    };

    struct RenderJobs : private juce::Timer
    {
        explicit RenderJobs (AppEngine& a) : app (a) {}

        int start (std::vector<te::Renderer::Parameters> queue, std::vector<String> labels)
        {
            auto job = std::make_shared<RenderJob>();
            job->id = ++lastId;
            job->queue = std::move (queue);
            job->labels = std::move (labels);
            jobs[job->id] = job;
            next (job);
            startTimer (200);
            return job->id;
        }

        void cancel (int id)
        {
            if (auto it = jobs.find (id); it != jobs.end())
            {
                if (it->second->handle != nullptr)
                    it->second->handle->cancel();

                it->second->index = it->second->queue.size();
            }
        }

        bool isBusy() const     { return ! jobs.empty(); }

    private:
        void next (std::shared_ptr<RenderJob> job)
        {
            if (job->index >= job->queue.size())
            {
                app.emit ("render", Obj().set ("job", job->id).set ("state", "done").set ("files", job->files)
                                         .set ("errors", var (job->errors.joinIntoString ("\n"))));
                jobs.erase (job->id);
                return;
            }

            const auto& params = job->queue[job->index];
            params.destFile.getParentDirectory().createDirectory();

            app.emit ("render", Obj().set ("job", job->id).set ("state", "rendering")
                                     .set ("label", job->labels[job->index])
                                     .set ("step", (int) job->index + 1).set ("steps", (int) job->queue.size()).set ("progress", 0.0));

            job->handle = te::EditRenderer::render (params, [this, job] (tl::expected<juce::File, std::string> result)
            {
                juce::MessageManager::callAsync ([this, job, result]
                {
                    if (result.has_value())
                        job->files.add (result->getFullPathName());
                    else
                        job->errors.add (job->labels[job->index] + ": " + String (result.error()));

                    ++job->index;
                    job->handle.reset();
                    next (job);
                });
            });
        }

        void timerCallback() override
        {
            if (jobs.empty())
            {
                stopTimer();
                return;
            }

            for (auto& [id, job] : jobs)
                if (job->handle != nullptr)
                    app.emit ("render", Obj().set ("job", id).set ("state", "rendering")
                                             .set ("label", job->labels[std::min (job->index, job->labels.size() - 1)])
                                             .set ("step", (int) job->index + 1).set ("steps", (int) job->queue.size())
                                             .set ("progress", job->handle->getProgress()));
        }

        AppEngine& app;
        std::map<int, std::shared_ptr<RenderJob>> jobs;
        int lastId = 0;
    };

    juce::AudioFormat* formatFor (te::Engine& engine, const String& name)
    {
        auto& fm = engine.getAudioFileFormatManager();

        if (name == "flac")  return fm.getFlacFormat();
        if (name == "ogg")   return fm.getOggFormat();
        return fm.getWavFormat();
    }

    te::Renderer::Parameters baseParams (AppEngine& app, const var& p, const juce::File& dest)
    {
        auto& edit = app.edit();
        te::Renderer::Parameters r (edit);
        const auto format = str (p, "format", "wav");

        r.destFile = dest;
        r.audioFormat = formatFor (app.getEngine(), format);
        r.bitDepth = format == "ogg" ? 16 : juce::jlimit (16, 32, integer (p, "bitDepth", 24));
        r.sampleRateForAudio = num (p, "sampleRate", juce::jmax (44100.0, edit.engine.getDeviceManager().getSampleRate()));
        r.blockSizeForAudio = 512;
        r.quality = format == "ogg" ? juce::jlimit (0, 10, integer (p, "quality", 7)) : 0;
        r.canRenderInMono = false;
        r.checkNodesForAudio = false;
        r.usePlugins = true;
        r.ditheringEnabled = r.bitDepth < 24 && format != "ogg";
        r.endAllowance = duration (num (p, "tail", 2.0));

        const auto start = num (p, "start", 0.0);
        const auto end = has (p, "end") ? num (p, "end") : edit.getLength().inSeconds();

        if (end - start < 0.05)
            throw RpcError ("Nothing to export: the project is empty");

        r.time = { seconds (start), seconds (end) };

        if (has (p, "normalizeLufs"))
        {
            r.shouldNormaliseByLUFS = true;
            r.normaliseToLevelDb = (float) num (p, "normalizeLufs", -14.0);
            r.limitTruePeak = true;
            r.truePeakCeilingDb = (float) num (p, "truePeakDb", -1.0);
        }

        return r;
    }

    String extensionFor (const String& format)
    {
        return format == "flac" ? ".flac" : format == "ogg" ? ".ogg" : ".wav";
    }

    juce::BigInteger bitsWithParents (te::Edit& edit, te::Track& t)
    {
        juce::Array<te::Track*> tracks { &t };

        for (auto* parent = t.getParentFolderTrack(); parent != nullptr; parent = parent->getParentFolderTrack())
            tracks.add (parent);

        (void) edit;
        return te::toBitSet (tracks);
    }
}

void registerExportApi (AppEngine& app)
{
    auto jobs = std::make_shared<RenderJobs> (app);
    auto& rpc = app.rpc;

    rpc.add ("export.render", K::read,
             "Renders in the background. what: mix (with master chain) or stems (one file per track). Progress arrives as 'render' events",
             "{what?: mix|stems, format?: wav|flac|ogg, bitDepth?, sampleRate?, normalizeLufs?, truePeakDb?, start?, end?, tail?, name?, trackIds?}",
             [&app, jobs] (const var& p)
    {
        auto& edit = app.edit();
        app.save();

        const auto what = str (p, "what", "mix");
        const auto ext = extensionFor (str (p, "format", "wav"));
        const auto stamp = juce::Time::getCurrentTime().formatted ("%Y%m%d-%H%M");
        const auto name = juce::File::createLegalFileName (str (p, "name", app.getEditFile().getFileNameWithoutExtension()));
        auto dir = app.getBouncesDir();

        std::vector<te::Renderer::Parameters> queue;
        std::vector<String> labels;

        if (what == "stems")
        {
            auto stemDir = dir.getChildFile (name + " stems " + stamp);
            juce::Array<te::Track*> tracks;

            if (auto* ids = p["trackIds"].getArray())
                for (auto& id : *ids)
                    tracks.add (&app.track (id.toString()));
            else
                for (auto* t : te::getAudioTracks (edit))
                    tracks.add (t);

            for (auto* t : tracks)
            {
                auto r = baseParams (app, p, stemDir.getChildFile (juce::File::createLegalFileName (t->getName()) + ext));
                r.tracksToDo = bitsWithParents (edit, *t);
                r.useMasterPlugins = false;
                queue.push_back (r);
                labels.push_back (t->getName());
            }
        }
        else
        {
            auto r = baseParams (app, p, dir.getNonexistentChildFile (name + " " + stamp, ext, false));
            r.tracksToDo = te::toBitSet (te::getAllTracks (edit));
            r.useMasterPlugins = true;
            queue.push_back (r);
            labels.push_back ("Mixdown");
        }

        if (queue.empty())
            throw RpcError ("There are no tracks to export");

        return var (jobs->start (std::move (queue), std::move (labels)));
    });

    rpc.add ("export.cancel", K::read, "Cancels a render job", "{job}", [jobs] (const var& p)
    {
        jobs->cancel (integer (p, "job"));
        return var (true);
    });

    rpc.add ("project.archive", K::read, "Zips the project folder (audio included) into Bounces", "{}", [&app] (const var&)
    {
        app.save();

        auto dir = app.getProjectDir();
        auto zip = app.getBouncesDir().getNonexistentChildFile (app.getEditFile().getFileNameWithoutExtension() + " archive", ".zip", false);

        juce::Thread::launch ([&app, dir, zip]
        {
            juce::ZipFile::Builder builder;

            for (auto& f : dir.findChildFiles (juce::File::findFiles, true))
            {
                auto rel = f.getRelativePathFrom (dir);

                if (rel.startsWith ("autosave") || rel.startsWith ("Bounces"))
                    continue;

                builder.addFile (f, f.hasFileExtension ("wav;flac;ogg;mp3") ? 0 : 6, rel);
            }

            zip.getParentDirectory().createDirectory();
            bool ok = false;

            {
                juce::FileOutputStream out (zip);

                if (out.openedOk())
                    ok = builder.writeToStream (out, nullptr);
            }

            juce::MessageManager::callAsync ([&app, zip, ok]
            {
                app.emit ("archive", Obj().set ("ok", ok).set ("file", zip.getFullPathName()));
            });
        });

        return var (zip.getFullPathName());
    });

    rpc.add ("project.reveal", K::read, "Shows a file or the project folder in Explorer", "{file?}", [&app] (const var& p)
    {
        juce::File f (has (p, "file") ? str (p, "file") : app.getProjectDir().getFullPathName());
        f.revealToUser();
        return var (true);
    });
}
}
