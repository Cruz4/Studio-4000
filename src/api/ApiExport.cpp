#include "Api.h"

#if JUCE_WINDOWS
 #include <mfapi.h>
 #include <mfidl.h>
 #include <mfreadwrite.h>
#endif

namespace s3
{
namespace
{
    int mp3RateFor (double sampleRate)
    {
        if (std::abs (sampleRate - 44100.0) < 1.0 || sampleRate < 46000.0)
            return 44100;

        return 48000;
    }

    struct ReaderSource : juce::AudioSource
    {
        explicit ReaderSource (juce::AudioFormatReader& r) : reader (r) {}
        void prepareToPlay (int, double) override {}
        void releaseResources() override {}
        void getNextAudioBlock (const juce::AudioSourceChannelInfo& info) override
        {
            reader.read (info.buffer, info.startSample, info.numSamples, pos, true, true);
            pos += info.numSamples;
        }
        juce::AudioFormatReader& reader;
        juce::int64 pos = 0;
    };
}

juce::String transcodeWavToMp3 (te::Engine& engine, const juce::File& wav, const juce::File& mp3)
{
   #if ! JUCE_WINDOWS
    juce::ignoreUnused (engine, wav, mp3);
    return "MP3 export is available on Windows.";
   #else
    std::unique_ptr<juce::AudioFormatReader> reader (engine.getAudioFileFormatManager().readFormatManager.createReaderFor (wav));

    if (reader == nullptr || reader->lengthInSamples <= 0)
        return "Couldn't read the rendered audio.";

    const int channels = juce::jlimit (1, 2, (int) reader->numChannels);
    const int dstRate = mp3RateFor (reader->sampleRate);
    const bool resample = std::abs (reader->sampleRate - dstRate) > 1.0;
    const int bitrate = channels == 1 ? 192000 : 320000;
    const auto outSamples = (juce::int64) std::llround (reader->lengthInSamples * (double) dstRate / reader->sampleRate);

    const HRESULT com = CoInitializeEx (nullptr, COINIT_MULTITHREADED);
    const bool releaseCom = com == S_OK;
    bool mediaStarted = false;

    struct Stop
    {
        bool releaseCom;
        bool& mediaStarted;
        ~Stop()
        {
            if (mediaStarted)
                MFShutdown();

            if (releaseCom)
                CoUninitialize();
        }
    };

    Stop shutdown { releaseCom, mediaStarted };

    if (FAILED (MFStartup (MF_VERSION, MFSTARTUP_NOSOCKET)))
        return "Couldn't start the MP3 encoder.";

    mediaStarted = true;
    mp3.getParentDirectory().createDirectory();
    mp3.deleteFile();

    IMFSinkWriter* writer = nullptr;

    if (FAILED (MFCreateSinkWriterFromURL (mp3.getFullPathName().toWideCharPointer(), nullptr, nullptr, &writer)) || writer == nullptr)
        return "Couldn't create the MP3 file.";

    juce::ErasedScopeGuard releaseWriter ([writer] { writer->Release(); });
    IMFMediaType* outType = nullptr;

    if (FAILED (MFCreateMediaType (&outType)) || outType == nullptr)
        return "Couldn't create the MP3 file.";

    juce::ErasedScopeGuard releaseOut ([outType] { outType->Release(); });
    outType->SetGUID (MF_MT_MAJOR_TYPE, MFMediaType_Audio);
    outType->SetGUID (MF_MT_SUBTYPE, MFAudioFormat_MP3);
    outType->SetUINT32 (MF_MT_AUDIO_NUM_CHANNELS, (UINT32) channels);
    outType->SetUINT32 (MF_MT_AUDIO_SAMPLES_PER_SECOND, (UINT32) dstRate);
    outType->SetUINT32 (MF_MT_AUDIO_AVG_BYTES_PER_SECOND, (UINT32) (bitrate / 8));

    DWORD stream = 0;

    if (FAILED (writer->AddStream (outType, &stream)))
        return "This PC can't encode MP3.";

    IMFMediaType* inType = nullptr;

    if (FAILED (MFCreateMediaType (&inType)) || inType == nullptr)
        return "Couldn't create the MP3 file.";

    juce::ErasedScopeGuard releaseIn ([inType] { inType->Release(); });
    inType->SetGUID (MF_MT_MAJOR_TYPE, MFMediaType_Audio);
    inType->SetGUID (MF_MT_SUBTYPE, MFAudioFormat_PCM);
    inType->SetUINT32 (MF_MT_AUDIO_NUM_CHANNELS, (UINT32) channels);
    inType->SetUINT32 (MF_MT_AUDIO_SAMPLES_PER_SECOND, (UINT32) dstRate);
    inType->SetUINT32 (MF_MT_AUDIO_BITS_PER_SAMPLE, 16);
    inType->SetUINT32 (MF_MT_AUDIO_BLOCK_ALIGNMENT, (UINT32) (channels * 2));
    inType->SetUINT32 (MF_MT_AUDIO_AVG_BYTES_PER_SECOND, (UINT32) (dstRate * channels * 2));

    if (FAILED (writer->SetInputMediaType (stream, inType, nullptr)) || FAILED (writer->BeginWriting()))
        return "This PC can't encode MP3.";

    ReaderSource source (*reader);
    juce::ResamplingAudioSource resampler (&source, false, channels);
    resampler.prepareToPlay (4096, dstRate);
    resampler.setResamplingRatio (resample ? reader->sampleRate / (double) dstRate : 1.0);

    juce::AudioBuffer<float> block (channels, 4096);
    std::vector<juce::int16> pcm ((size_t) 4096 * (size_t) channels);
    juce::int64 done = 0;

    while (done < outSamples)
    {
        const int n = (int) juce::jmin<juce::int64> (4096, outSamples - done);
        juce::AudioSourceChannelInfo info (&block, 0, n);

        if (resample)
            resampler.getNextAudioBlock (info);
        else
            source.getNextAudioBlock (info);

        for (int i = 0; i < n; ++i)
            for (int c = 0; c < channels; ++c)
                pcm[(size_t) (i * channels + c)] = (juce::int16) juce::jlimit (-32768, 32767,
                    juce::roundToInt (juce::jlimit (-1.0f, 1.0f, block.getSample (c, i)) * 32767.0f));

        IMFMediaBuffer* buffer = nullptr;
        IMFSample* sample = nullptr;
        const DWORD bytes = (DWORD) (n * channels * (int) sizeof (juce::int16));

        if (FAILED (MFCreateMemoryBuffer (bytes, &buffer)) || FAILED (MFCreateSample (&sample)))
        {
            if (buffer != nullptr) buffer->Release();
            if (sample != nullptr) sample->Release();
            return "Couldn't write the MP3.";
        }

        BYTE* data = nullptr;
        buffer->Lock (&data, nullptr, nullptr);
        std::memcpy (data, pcm.data(), bytes);
        buffer->Unlock();
        buffer->SetCurrentLength (bytes);
        sample->AddBuffer (buffer);
        sample->SetSampleTime ((LONGLONG) done * 10000000LL / dstRate);
        sample->SetSampleDuration ((LONGLONG) n * 10000000LL / dstRate);
        const auto wrote = writer->WriteSample (stream, sample);
        buffer->Release();
        sample->Release();

        if (FAILED (wrote))
            return "Couldn't write the MP3.";

        done += n;
    }

    if (FAILED (writer->Finalize()) || ! mp3.existsAsFile() || mp3.getSize() < 128)
        return "Couldn't finish the MP3.";

    return {};
   #endif
}

namespace
{
    using K = Rpc::Kind;

    struct RenderStep
    {
        te::Renderer::Parameters params;
        String label;
        juce::File mp3;
        bool dropWav = false;
    };

    struct RenderJob
    {
        int id = 0;
        std::vector<RenderStep> queue;
        size_t index = 0;
        std::shared_ptr<te::EditRenderer::Handle> handle;
        juce::Array<var> files;
        juce::StringArray errors;
    };

    struct RenderJobs : private juce::Timer
    {
        explicit RenderJobs (AppEngine& a) : app (a) {}

        int start (std::vector<RenderStep> queue)
        {
            auto job = std::make_shared<RenderJob>();
            job->id = ++lastId;
            job->queue = std::move (queue);
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

            const auto& step = job->queue[job->index];
            step.params.destFile.getParentDirectory().createDirectory();

            app.emit ("render", Obj().set ("job", job->id).set ("state", "rendering")
                                     .set ("label", step.label)
                                     .set ("step", (int) job->index + 1).set ("steps", (int) job->queue.size()).set ("progress", 0.0));

            job->handle = te::EditRenderer::render (step.params, [this, job] (tl::expected<juce::File, std::string> result)
            {
                juce::MessageManager::callAsync ([this, job, result]
                {
                    if (! result.has_value())
                    {
                        job->errors.add (job->queue[job->index].label + ": " + String (result.error()));
                        ++job->index;
                        job->handle.reset();
                        next (job);
                        return;
                    }

                    const auto wav = *result;
                    const auto stepNow = job->queue[job->index];
                    job->handle.reset();

                    if (stepNow.mp3 == juce::File())
                    {
                        job->files.add (wav.getFullPathName());
                        ++job->index;
                        next (job);
                        return;
                    }

                    app.emit ("render", Obj().set ("job", job->id).set ("state", "rendering")
                                             .set ("label", stepNow.label + " MP3")
                                             .set ("step", (int) job->index + 1).set ("steps", (int) job->queue.size()).set ("progress", 1.0));

                    juce::Thread::launch ([this, job, wav, stepNow]
                    {
                        const auto err = transcodeWavToMp3 (app.getEngine(), wav, stepNow.mp3);

                        juce::MessageManager::callAsync ([this, job, wav, stepNow, err]
                        {
                            if (err.isEmpty())
                            {
                                if (stepNow.dropWav)
                                    wav.deleteFile();
                                else
                                    job->files.add (wav.getFullPathName());

                                job->files.add (stepNow.mp3.getFullPathName());
                            }
                            else
                            {
                                job->files.add (wav.getFullPathName());
                                job->errors.add (stepNow.label + ": " + err);
                            }

                            ++job->index;
                            next (job);
                        });
                    });
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
                                             .set ("label", job->queue[juce::jmin (job->index, job->queue.size() - 1)].label)
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
        if (format == "flac") return ".flac";
        if (format == "ogg")  return ".ogg";
        if (format == "mp3")  return ".mp3";
        return ".wav";
    }

    RenderStep makeStep (AppEngine& app, const var& p, const juce::File& dest, const String& label)
    {
        const auto format = str (p, "format", "wav");
        const bool mp3 = format == "mp3" || format == "mp3wav";
        juce::File wav = dest;
        juce::File mp3File;

        if (format == "mp3")
        {
            mp3File = dest.withFileExtension ("mp3");
            wav = juce::File::createTempFile (".wav");
        }
        else if (format == "mp3wav")
        {
            wav = dest.withFileExtension ("wav");
            mp3File = dest.withFileExtension ("mp3");
        }
        else
            wav = dest.withFileExtension (extensionFor (format).fromFirstOccurrenceOf (".", true, false));

        auto params = baseParams (app, p, wav);

        if (mp3)
            params.audioFormat = app.getEngine().getAudioFileFormatManager().getWavFormat();

        return { std::move (params), label, mp3File, format == "mp3" };
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
             "{what?: mix|stems, format?: wav|mp3|mp3wav|flac|ogg, file?, dir?, bitDepth?, sampleRate?, normalizeLufs?, truePeakDb?, start?, end?, tail?, name?, trackIds?}",
             [&app, jobs] (const var& p)
    {
        auto& edit = app.edit();
        app.save();

        const auto what = str (p, "what", "mix");
        const auto format = str (p, "format", "wav");
        const auto stamp = juce::Time::getCurrentTime().formatted ("%Y%m%d-%H%M");
        const auto name = juce::File::createLegalFileName (str (p, "name", app.getEditFile().getFileNameWithoutExtension()));
        auto dir = app.getBouncesDir();

        std::vector<RenderStep> queue;

        if (what == "stems")
        {
            const bool chosen = has (p, "dir");
            auto stemDir = chosen ? juce::File (str (p, "dir")) : dir.getChildFile (name + " stems " + stamp);
            juce::Array<te::Track*> tracks;

            if (auto* ids = p["trackIds"].getArray())
                for (auto& id : *ids)
                    tracks.add (&app.track (id.toString()));
            else
                for (auto* t : te::getAudioTracks (edit))
                    tracks.add (t);

            for (auto* t : tracks)
            {
                auto fileName = juce::File::createLegalFileName (chosen && name.isNotEmpty() ? name + " - " + t->getName() : t->getName());
                auto step = makeStep (app, p, stemDir.getChildFile (fileName + extensionFor (format == "mp3wav" ? "wav" : format)), t->getName());
                step.params.tracksToDo = bitsWithParents (edit, *t);
                step.params.useMasterPlugins = false;
                queue.push_back (std::move (step));
            }
        }
        else
        {
            auto dest = has (p, "file") ? juce::File (str (p, "file"))
                                        : dir.getNonexistentChildFile (name + " " + stamp, extensionFor (format == "mp3wav" ? "wav" : format), false);
            auto step = makeStep (app, p, dest, "Mixdown");
            step.params.tracksToDo = te::toBitSet (te::getAllTracks (edit));
            step.params.useMasterPlugins = true;
            queue.push_back (std::move (step));
        }

        if (queue.empty())
            throw RpcError ("There are no tracks to export");

        return var (jobs->start (std::move (queue)));
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
