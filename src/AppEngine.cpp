#include "AppEngine.h"
#include "LoudnessMeterPlugin.h"
#include "ChainMix.h"
#include "LimiterPlugin.h"
#include "LiveMidi.h"
#include "StudioFx.h"
#include "ProjectState.h"
#include "api/Api.h"

namespace s3
{
namespace
{
    // Loads plug-ins saved under a type name from before the rename; the state is retyped so it saves under the new one.
    template <typename Type>
    struct LegacyPluginType : public te::PluginManager::BuiltInType
    {
        explicit LegacyPluginType (const String& legacyType) : BuiltInType (legacyType) {}

        te::Plugin::Ptr create (te::PluginCreationInfo info) override
        {
            info.state.setProperty (te::IDs::type, Type::xmlTypeName, nullptr);
            return new Type (info);
        }
    };

    String undoActionName (const String& method, const var& params)
    {
        if (method == "track.set")
        {
            if (params.hasProperty ("volumeDb")) return "Volume";
            if (params.hasProperty ("pan"))      return "Pan";
            if (params.hasProperty ("name"))     return "Rename track";
            if (params.hasProperty ("colour"))   return "Track colour";
            if (params.hasProperty ("mute"))     return params["mute"] ? "Mute" : "Unmute";
            if (params.hasProperty ("solo"))     return params["solo"] ? "Solo" : "Unsolo";
            if (params.hasProperty ("output"))   return "Track output";
            if (params.hasProperty ("channels")) return "Track format";
            return "Track change";
        }

        if (method == "chain.setMix")
            return "Wet/dry";

        if (method == "clip.set")
        {
            if (params.hasProperty ("muted"))  return params["muted"] ? "Mute clips" : "Unmute clips";
            if (params.hasProperty ("gainDb")) return "Clip gain";
            if (params.hasProperty ("colour")) return "Clip colour";
            if (params.hasProperty ("name"))   return "Rename clip";
            return "Clip change";
        }

        const std::pair<const char*, const char*> names[] = {
            { "track.add", "New track" }, { "track.remove", "Delete track" }, { "track.move", "Reorder tracks" },
            { "track.duplicate", "Duplicate track" }, { "track.arm", "Arm track" }, { "track.setInput", "Track input" },
            { "track.setMonitor", "Input monitoring" }, { "bus.create", "New FX return" },
            { "plugin.add", "Add effect" }, { "plugin.remove", "Remove effect" }, { "plugin.move", "Reorder effect" },
            { "plugin.duplicate", "Duplicate effect" }, { "chain.load", "Load effect chain" },
            { "plugin.set", "Effect bypass" }, { "plugin.setParams", "Effect change" }, { "plugin.setParam", "Effect change" },
            { "plugin.setSidechain", "Sidechain" }, { "clip.move", "Move clip" }, { "clip.delete", "Delete clip" },
            { "clip.split", "Split" }, { "clip.duplicate", "Duplicate" }, { "clip.trim", "Trim" }, { "clip.slip", "Slip" },
            { "clip.importAudio", "Import audio" }, { "clip.addMidi", "New MIDI clip" }, { "clip.normalize", "Normalize" },
            { "clip.setGainPoints", "Clip gain" },
            { "master.set", "Master volume" }, { "send.add", "Add send" }, { "send.set", "Send level" }, { "send.remove", "Remove send" },
            { "marker.add", "Add marker" }, { "marker.set", "Edit marker" }, { "project.setTempo", "Tempo" },
            { "automation.addPoint", "Automation" }, { "automation.movePoint", "Automation" }, { "automation.deletePoint", "Automation" },
            { "midi.setNotes", "Edit notes" }, { "midi.quantize", "Quantize" },
        };

        for (auto& n : names)
            if (method == n.first)
                return n.second;

        return method;
    }

    //==============================================================================
    struct PluginWindow : public juce::DocumentWindow
    {
        explicit PluginWindow (te::Plugin& p)
            : DocumentWindow (p.getName(), juce::Colour (0xff0b0d12), DocumentWindow::closeButton, true),
              plugin (p)
        {
            setUsingNativeTitleBar (true);
            getConstrainer()->setMinimumOnscreenAmounts (0x10000, 50, 30, 50);
            setResizeLimits (100, 50, 4000, 4000);
            recreateEditor();
            setBoundsConstrained (getLocalBounds() + plugin.windowState->choosePositionForPluginWindow());
            setAlwaysOnTop (true);
            trackStoredBounds = true;
        }

        ~PluginWindow() override
        {
            trackStoredBounds = false;
            plugin.edit.flushPluginStateIfNeeded (plugin);
            setEditor (nullptr);
        }

        void setEditor (std::unique_ptr<te::Plugin::EditorComponent> newEditor)
        {
            setConstrainer (nullptr);
            editor.reset();

            if (newEditor != nullptr)
            {
                editor = std::move (newEditor);
                setContentNonOwned (editor.get(), true);
            }

            setResizable (editor == nullptr || editor->allowWindowResizing(), false);

            if (editor != nullptr && editor->allowWindowResizing())
                setConstrainer (editor->getBoundsConstrainer());
        }

        void recreateEditor()
        {
            setEditor (nullptr);
            setEditor (plugin.createEditor());
        }

        void recreateEditorAsync()
        {
            setEditor (nullptr);

            juce::Timer::callAfterDelay (50, [sp = juce::Component::SafePointer<PluginWindow> (this)]
            {
                if (sp != nullptr)
                    sp->recreateEditor();
            });
        }

        void moved() override
        {
            if (trackStoredBounds)
            {
                plugin.windowState->lastWindowBounds = getBounds();
                plugin.edit.pluginChanged (plugin);
            }
        }

        void closeButtonPressed() override              { plugin.windowState->closeWindowExplicitly(); }
        float getDesktopScaleFactor() const override    { return 1.0f; }

        te::Plugin& plugin;
        std::unique_ptr<te::Plugin::EditorComponent> editor;
        bool trackStoredBounds = false;
    };

    struct StudioUIBehaviour : public te::UIBehaviour
    {
        std::unique_ptr<juce::Component> createPluginWindow (te::PluginWindowState& pws) override
        {
            auto* ws = dynamic_cast<te::Plugin::WindowState*> (&pws);

            if (ws == nullptr)
                return {};

            if (auto* ext = dynamic_cast<te::ExternalPlugin*> (&ws->plugin))
                if (ext->getAudioPluginInstance() == nullptr)
                    return {};

            auto w = std::make_unique<PluginWindow> (ws->plugin);

            if (w->editor == nullptr)
                return {};

            w->setVisible (true);
            w->toFront (true);
            return w;
        }

        void recreatePluginWindowContentAsync (te::Plugin& p) override
        {
            if (auto* w = dynamic_cast<PluginWindow*> (p.windowState->pluginWindow.get()))
                return w->recreateEditorAsync();

            UIBehaviour::recreatePluginWindowContentAsync (p);
        }

        void showWarningAlert (const juce::String& title, const juce::String& message) override
        {
            if (onMessage)
                onMessage (title, message);
        }

        void showWarningMessage (const juce::String& message) override
        {
            if (onMessage)
                onMessage ("Studio 4000", message);
        }

        void runTaskWithProgressBar (te::ThreadPoolJobWithProgress& task) override
        {
            while (task.runJob() == juce::ThreadPoolJob::jobNeedsRunningAgain)
            {}
        }

        std::function<void (const String&, const String&)> onMessage;
    };

    struct StudioEngineBehaviour : public te::EngineBehaviour
    {
        explicit StudioEngineBehaviour (AppEngine& a) : app (a) {}

        bool canScanPluginsOutOfProcess() override                  { return true; }
        bool autoAddClipEdgeFades() override                        { return false; }
        bool muteTrackContentsWhilstRecording() override            { return true; }

        te::EditLimits getEditLimits() override
        {
            te::EditLimits limits;
            limits.maxPluginsOnTrack = 24;
            limits.maxNumMasterPlugins = 12;
            return limits;
        }

        juce::File getDefaultFolderForAudioRecordings (te::Edit&) override
        {
            return app.getAudioDir();
        }

        juce::File getFileForNewAudioRecording (te::Track& track, const juce::String& ext) override
        {
            auto dir = app.getAudioDir();
            dir.createDirectory();

            auto base = juce::File::createLegalFileName (track.getName()).replaceCharacter (' ', '_')
                          + "_" + juce::Time::getCurrentTime().formatted ("%Y%m%d-%H%M%S");

            return dir.getNonexistentChildFile (base, ext, false);
        }

        AppEngine& app;
    };
}

//==============================================================================
AppEngine::AppEngine (bool isolated)
{
    migrateLegacyAppData();

    juce::PropertiesFile::Options opts;
    opts.applicationName = isolated ? "Studio4000 selftest" : "Studio4000";
    opts.filenameSuffix = ".settings";
    opts.folderName = "Studio4000";
    opts.osxLibrarySubFolder = "Application Support";
    props = std::make_unique<juce::PropertiesFile> (opts);

    auto ui = std::make_unique<StudioUIBehaviour>();
    ui->onMessage = [this] (const String& title, const String& message)
    {
        emit ("toast", Obj().set ("level", "warning").set ("title", title).set ("message", message));
    };

    engine = std::make_unique<te::Engine> (opts.applicationName, std::move (ui), std::make_unique<StudioEngineBehaviour> (*this));
    auto& pm = engine->getPluginManager();
    pm.createBuiltInType<LoudnessMeterPlugin>();
    pm.createBuiltInType<ChainDryPlugin>();
    pm.createBuiltInType<ChainWetPlugin>();
    pm.createBuiltInType<LimiterPlugin>();
    pm.registerBuiltInType (std::make_unique<LegacyPluginType<LoudnessMeterPlugin>> ("s3030loudness"));
    pm.registerBuiltInType (std::make_unique<LegacyPluginType<LimiterPlugin>> ("s3030limiter"));
    registerStudioEffects (pm);
   #if TRACKTION_AIR_WINDOWS
    pm.initialiseAirWindows();
   #endif

    auto& dm = engine->getDeviceManager().deviceManager;
    dm.setCurrentAudioDeviceType (props->getValue ("audioDeviceType", dm.getCurrentAudioDeviceType()), true);
    liveMidi = std::make_unique<LiveMidi> (*this);

    // Continuous gestures (fader, knob, slider drags) arrive as many identical calls; they share one undo step.
    rpc.beforeWrite = [this, last = std::make_shared<std::pair<String, juce::uint32>>()] (const String& method, const var& params, const String&)
    {
        if (editPtr == nullptr || batchDepth != 0)
            return;

        String key = method + "|" + params["id"].toString() + "|" + params["paramId"].toString();

        if (auto* o = params.getDynamicObject())
            for (auto& prop : o->getProperties())
                key << "|" << prop.name.toString();

        if (auto* values = params["values"].getDynamicObject())
            for (auto& prop : values->getProperties())
                key << "|" << prop.name.toString();

        const auto now = juce::Time::getMillisecondCounter();

        if (key != last->first || now - last->second > 1000)
            editPtr->getUndoManager().beginNewTransaction (undoActionName (method, params));

        *last = { key, now };
    };

    rpc.afterWrite = [this] (const String& method, const var& params, const String& origin)
    {
        markProjectChanged();
        emit ("op", Obj().set ("method", method).set ("params", params).set ("origin", origin));
    };

    registerAllApis (*this);

    startTimerHz (30);
}

AppEngine::~AppEngine()
{
    stopTimer();

    if (editPtr != nullptr)
    {
        save();
        detachEdit();
    }

    liveMidi.reset();
    props->saveIfNeeded();
    engine.reset();
}

te::Edit& AppEngine::edit() const
{
    if (editPtr == nullptr)
        throw RpcError ("No project is open");

    return *editPtr;
}

juce::File AppEngine::getAudioDir() const       { return getProjectDir().getChildFile ("Audio"); }
juce::File AppEngine::getBouncesDir() const     { return getProjectDir().getChildFile ("Bounces"); }

juce::File AppEngine::getAutosaveFile() const
{
    return getProjectDir().getChildFile ("autosave").getChildFile (editFile.getFileNameWithoutExtension() + ".autosave" + projectFileExtension);
}

void AppEngine::emit (const String& type, const var& payload)
{
    if (sendEvent)
        sendEvent (type, payload);
}

//==============================================================================
void AppEngine::ensureProjectStructure()
{
    for (auto* sub : { "Audio", "Bounces", "autosave", "Imported" })
        getProjectDir().getChildFile (sub).createDirectory();
}

void AppEngine::createProject (const juce::File& projectDir, const String& name)
{
    auto safeName = juce::File::createLegalFileName (name.isNotEmpty() ? name : "Untitled Session");
    auto dir = projectDir.getChildFile (safeName);

    if (dir.getChildFile (safeName + projectFileExtension).existsAsFile())
        dir = projectDir.getNonexistentChildFile (safeName, {}, false);

    dir.createDirectory();
    auto file = dir.getChildFile (safeName + projectFileExtension);

    auto newEdit = te::createEmptyEdit (*engine, file);

    if (newEdit == nullptr)
        throw RpcError ("Could not create the project");

    attachEdit (std::move (newEdit), file);
    save();
}

void AppEngine::openProject (const juce::File& file)
{
    if (! file.existsAsFile())
        throw RpcError ("Project not found: " + file.getFullPathName());

    auto loaded = te::loadEditFromFile (*engine, file);

    if (loaded == nullptr)
        throw RpcError ("Could not open " + file.getFileName());

    attachEdit (std::move (loaded), file);
}

void AppEngine::save()
{
    if (editPtr == nullptr)
        return;

    te::EditFileOperations (*editPtr).save (false, true, false);
    lastAutosave = juce::Time::getCurrentTime();
    emit ("saved", Obj().set ("file", editFile.getFullPathName()));
}

void AppEngine::saveAs (const juce::File& requested)
{
    if (editPtr == nullptr)
        throw RpcError ("No project is open");

    auto file = requested.getFileExtension().isEmpty() ? requested.withFileExtension (projectFileExtension)
                                                       : requested;

    if (! file.hasFileExtension (projectFileExtension))
        file = file.withFileExtension (projectFileExtension);

    auto parent = file.getParentDirectory();

    if (! parent.createDirectory())
        throw RpcError ("Could not create " + parent.getFullPathName());

    auto from = getProjectDir();

    if (from != parent)
    {
        for (auto* sub : { "Audio", "Imported", "Bounces" })
        {
            auto src = from.getChildFile (sub);
            auto dst = parent.getChildFile (sub);

            if (! src.isDirectory() || src == dst || dst.isAChildOf (src))
                continue;

            if (! dst.exists() && ! src.copyDirectoryTo (dst))
                throw RpcError ("Could not copy " + String (sub) + " into the new folder");
        }
    }

    editFile = file;
    editPtr->editFileRetriever = [file] { return file; };
    ensureProjectStructure();
    save();

    props->setValue ("lastProject", file.getFullPathName());

    auto recents = juce::StringArray::fromLines (props->getValue ("recentProjects"));
    recents.removeString (file.getFullPathName());
    recents.insert (0, file.getFullPathName());
    recents.removeEmptyStrings();

    while (recents.size() > 12)
        recents.remove (recents.size() - 1);

    props->setValue ("recentProjects", recents.joinIntoString ("\n"));
    props->saveIfNeeded();
    pushSnapshotNow();
}

juce::File AppEngine::findRecoveryFile() const
{
    if (editPtr == nullptr)
        return {};

    auto autosave = getAutosaveFile();

    if (autosave.existsAsFile() && autosave.getLastModificationTime() > editFile.getLastModificationTime() + juce::RelativeTime::seconds (2))
        return autosave;

    return {};
}

void AppEngine::recoverFromAutosave()
{
    auto recovery = findRecoveryFile();

    if (! recovery.existsAsFile())
        throw RpcError ("There is no newer autosave for this project");

    auto target = editFile;
    auto loaded = te::loadEditFromFile (*engine, recovery);

    if (loaded == nullptr)
        throw RpcError ("The autosave could not be read");

    loaded->editFileRetriever = [target] { return target; };
    attachEdit (std::move (loaded), target);
    save();
}

void AppEngine::attachEdit (std::unique_ptr<te::Edit> newEdit, const juce::File& file)
{
    detachEdit();

    editPtr = std::move (newEdit);
    editFile = file;
    selection = std::make_unique<te::SelectionManager> (*engine);
    selection->edit = editPtr.get();
    ensureProjectStructure();

    auto& e = *editPtr;
    e.playInStopEnabled = true;

    // Monitoring is set per track ("s4monitor"). A device-wide "on" saved by older versions would send the input
    // through the effects of every track that uses that input, even with the transport stopped.
    auto& tdm = engine->getDeviceManager();

    for (int i = 0; i < tdm.getNumWaveInDevices(); ++i)
        if (auto* w = tdm.getWaveInDevice (i); w != nullptr && w->getMonitorMode() != te::InputDevice::MonitorMode::automatic)
            w->setMonitorMode (te::InputDevice::MonitorMode::automatic);

    e.visitAllTracksRecursive ([] (te::Track& t)
    {
        if (auto* at = dynamic_cast<te::AudioTrack*> (&t))
        {
            if (! at->state.hasProperty ("s4monitor"))
                at->state.setProperty ("s4monitor", "auto", nullptr);

            // Older sessions stored the automatic 5 ms edge fade on every clip.
            const auto automatic = te::TimeDuration::fromSeconds (0.006);
            for (auto* clip : at->getClips())
                if (auto* audio = dynamic_cast<te::AudioClipBase*> (clip))
                {
                    if (audio->getFadeIn() > te::TimeDuration() && audio->getFadeIn() <= automatic)
                        audio->setFadeIn ({});
                    if (audio->getFadeOut() > te::TimeDuration() && audio->getFadeOut() <= automatic)
                        audio->setFadeOut ({});
                }
        }

        return true;
    });

    e.getTransport().ensureContextAllocated();

    bool hasLoudness = false;

    for (auto* p : e.getMasterPluginList())
        if (dynamic_cast<LoudnessMeterPlugin*> (p) != nullptr)
            hasLoudness = true;

    if (! hasLoudness)
        e.getMasterPluginList().insertPlugin (LoudnessMeterPlugin::create(), -1);

    e.getUndoManager().clearUndoHistory();
    e.state.addListener (this);
    e.getTransport().addChangeListener (this);

    props->setValue ("lastProject", file.getFullPathName());

    auto recents = juce::StringArray::fromLines (props->getValue ("recentProjects"));
    recents.removeString (file.getFullPathName());
    recents.insert (0, file.getFullPathName());
    recents.removeEmptyStrings();

    while (recents.size() > 12)
        recents.remove (recents.size() - 1);

    props->setValue ("recentProjects", recents.joinIntoString ("\n"));
    props->saveIfNeeded();

    meterTapsDirty = true;
    lastAutosave = juce::Time::getCurrentTime();
    pushSnapshotNow();

    if (findRecoveryFile().existsAsFile())
        emit ("recovery", Obj().set ("file", findRecoveryFile().getFullPathName()));
}

void AppEngine::detachEdit()
{
    if (editPtr == nullptr)
        return;

    clearMeterTaps();
    editPtr->getTransport().stop (false, true);
    if (liveMidi != nullptr)
        liveMidi->editChanged();

    editPtr->getTransport().removeChangeListener (this);
    editPtr->state.removeListener (this);
    selection.reset();
    editPtr.reset();
}

void AppEngine::beginBatch (const String& name)
{
    if (batchDepth++ == 0 && editPtr != nullptr)
        editPtr->getUndoManager().beginNewTransaction (name);
}

void AppEngine::endBatch()
{
    batchDepth = juce::jmax (0, batchDepth - 1);
}

//==============================================================================
te::Track* AppEngine::findTrack (const String& id) const
{
    if (editPtr == nullptr || id.isEmpty())
        return nullptr;

    te::Track* found = nullptr;
    const auto itemID = te::EditItemID::fromVar (id);

    editPtr->visitAllTracksRecursive ([&] (te::Track& t)
    {
        if (t.itemID == itemID)
        {
            found = &t;
            return false;
        }

        return true;
    });

    return found;
}

te::Track& AppEngine::track (const String& id) const
{
    if (auto* t = findTrack (id))
        return *t;

    throw RpcError ("Track not found: " + id);
}

te::AudioTrack& AppEngine::audioTrack (const String& id) const
{
    if (auto* t = dynamic_cast<te::AudioTrack*> (findTrack (id)))
        return *t;

    throw RpcError ("Audio track not found: " + id);
}

te::Clip& AppEngine::clip (const String& id) const
{
    const auto itemID = te::EditItemID::fromVar (id);

    if (auto* c = te::findClipForID (edit(), itemID))
        return *c;

    throw RpcError ("Clip not found: " + id);
}

te::Plugin& AppEngine::plugin (const String& id) const
{
    const auto itemID = te::EditItemID::fromVar (id);

    if (auto p = edit().getPluginCache().getPluginFor (itemID))
        return *p;

    throw RpcError ("Plug-in not found: " + id);
}

te::AutomatableParameter& AppEngine::parameter (te::Plugin& p, const String& paramId) const
{
    for (auto* param : p.getAutomatableParameters())
        if (param->paramID == paramId)
            return *param;

    throw RpcError ("Parameter not found: " + paramId);
}

LoudnessMeterPlugin* AppEngine::getMasterLoudnessMeter() const
{
    if (editPtr == nullptr)
        return nullptr;

    for (auto* p : editPtr->getMasterPluginList())
        if (auto* l = dynamic_cast<LoudnessMeterPlugin*> (p))
            return l;

    return nullptr;
}

//==============================================================================
juce::Array<juce::File> AppEngine::studioPluginFolders()
{
    juce::Array<juce::File> dirs;
    dirs.add (juce::File::getSpecialLocation (juce::File::currentExecutableFile).getSiblingFile ("vsts"));
   #ifdef STUDIO4000_PLUGIN_DIR
    dirs.addIfNotAlreadyThere (juce::File (STUDIO4000_PLUGIN_DIR));
   #endif
    return dirs;
}

void AppEngine::scanPlugins()
{
    if (scanning.exchange (true))
        return;

    emit ("pluginScan", Obj().set ("state", "started"));

    juce::Thread::launch ([this]
    {
        auto& pm = engine->getPluginManager();
        auto deadMansPedal = appDataDir().getChildFile ("scan-in-progress.txt");
        juce::StringArray failed;
        int found = 0;

        for (auto* format : pm.pluginFormatManager.getFormats())
        {
            if (format->getName() != "VST3" && format->getName() != "VST")
                continue;

            auto paths = format->getDefaultLocationsToSearch();

            for (auto& dir : studioPluginFolders())
                if (dir.isDirectory())
                    paths.addIfNotAlreadyThere (dir);

            for (auto& extra : juce::StringArray::fromTokens (props->getValue ("vst3Paths"), ";", {}))
                if (juce::File::isAbsolutePath (extra))
                    paths.addIfNotAlreadyThere (juce::File (extra));

            juce::PluginDirectoryScanner scanner (pm.knownPluginList, *format, paths, true, deadMansPedal, true);

            for (;;)
            {
                juce::String name;
                const auto progress = scanner.getProgress();
                const bool more = scanner.scanNextFile (true, name);

                juce::MessageManager::callAsync ([this, name, progress]
                {
                    emit ("pluginScan", Obj().set ("state", "scanning").set ("current", name).set ("progress", progress));
                });

                if (! more)
                    break;
            }

            failed.addArray (scanner.getFailedFiles());
        }

        found = pm.knownPluginList.getNumTypes();

        juce::MessageManager::callAsync ([this, failed, found]
        {
            juce::Array<var> failedList;

            for (auto& f : failed)
                failedList.add (f);

            scanning = false;
            emit ("pluginScan", Obj().set ("state", "done").set ("found", found).set ("failed", failedList));
        });
    });
}

//==============================================================================
void AppEngine::clearMeterTaps()
{
    for (auto& tap : meterTaps)
        if (auto* meter = tap->track->getLevelMeterPlugin())
            meter->measurer.removeClient (tap->client);

    meterTaps.clear();
}

void AppEngine::rebuildMeterTaps()
{
    clearMeterTaps();

    if (editPtr == nullptr)
        return;

    for (auto* t : te::getAudioTracks (*editPtr))
    {
        if (auto* meter = t->getLevelMeterPlugin())
        {
            auto tap = std::make_unique<MeterTap>();
            tap->track = t;
            meter->measurer.addClient (tap->client);
            meterTaps.push_back (std::move (tap));
        }
    }

    meterTapsDirty = false;
}

void AppEngine::sendTick()
{
    auto& e = *editPtr;
    auto& transport = e.getTransport();
    auto loop = transport.getLoopRange();

    juce::DynamicObject::Ptr meters = new juce::DynamicObject();

    for (auto& tap : meterTaps)
    {
        auto l = tap->client.getAndClearAudioLevel (0).dB;
        auto r = tap->client.getAndClearAudioLevel (1).dB;
        meters->setProperty (tap->track->itemID.toString(), var (juce::Array<var> { l, r }));
    }

    Obj tick;
    tick.set ("t", transport.getPosition().inSeconds())
        .set ("playing", transport.isPlaying())
        .set ("recording", transport.isRecording())
        .set ("looping", transport.looping.get())
        .set ("loop", var (juce::Array<var> { loop.getStart().inSeconds(), loop.getEnd().inSeconds() }))
        .set ("meters", var (meters.get()))
        .set ("cpu", engine->getDeviceManager().getCpuUsage());

    if (auto* lm = getMasterLoudnessMeter())
    {
        auto& a = lm->analyzer;
        tick.set ("master", var (juce::Array<var> { a.getAndResetBlockPeakDb (0), a.getAndResetBlockPeakDb (1) }))
            .set ("lufs", Obj().set ("m", a.getMomentaryLufs())
                               .set ("s", a.getShortTermLufs())
                               .set ("i", a.getIntegratedLufs())
                               .set ("peak", a.getPeakDb()));
    }

    emit ("tick", tick);
}

void AppEngine::autosaveIfNeeded()
{
    if (editPtr == nullptr || editPtr->getTransport().isRecording())
        return;

    const auto interval = juce::jlimit (10, 3600, settings().getIntValue ("autosaveSeconds", 60) > 0 ? settings().getIntValue ("autosaveSeconds", 60) : 60);

    if (juce::Time::getCurrentTime() - lastAutosave < juce::RelativeTime::seconds (interval))
        return;

    lastAutosave = juce::Time::getCurrentTime();

    if (editPtr->hasChangedSinceSaved())
    {
        auto f = getAutosaveFile();
        f.getParentDirectory().createDirectory();
        te::EditFileOperations (*editPtr).writeToFile (f, false);
        emit ("autosaved", Obj().set ("file", f.getFullPathName()));
    }
}

void AppEngine::pushSnapshotNow()
{
    snapshotPending = false;

    if (editPtr == nullptr)
    {
        emit ("project", var());
        return;
    }

    emit ("project", buildProjectSnapshot (*this));
}

void AppEngine::timerCallback()
{
    if (editPtr == nullptr)
        return;

    if (meterTapsDirty)
        rebuildMeterTaps();

    sendTick();

    ++tickCount;

    if (snapshotPending && tickCount % 3 == 0)
        pushSnapshotNow();

    if (tickCount % 30 == 0)
        autosaveIfNeeded();
}

void AppEngine::changeListenerCallback (juce::ChangeBroadcaster*)
{
    if (editPtr == nullptr)
        return;

    const bool recording = editPtr->getTransport().isRecording();

    if (wasRecording && ! recording)
    {
        // Takes land in the project as soon as recording stops.
        juce::Timer::callAfterDelay (300, [this]
        {
            if (editPtr != nullptr)
            {
                save();
                markProjectChanged();
            }
        });
    }

    wasRecording = recording;
    markProjectChanged();
}

void AppEngine::noteTreeChange (const juce::ValueTree& tree)
{
    for (auto t = tree; t.isValid(); t = t.getParent())
        if (t.hasType (te::IDs::TRANSPORT))
            return;

    snapshotPending = true;
}

static bool affectsMeters (const juce::ValueTree& child)
{
    return child.hasType (te::IDs::TRACK) || child.hasType (te::IDs::FOLDERTRACK) || child.hasType (te::IDs::PLUGIN);
}

void AppEngine::valueTreePropertyChanged (juce::ValueTree& t, const juce::Identifier&)    { noteTreeChange (t); }

void AppEngine::valueTreeChildAdded (juce::ValueTree& p, juce::ValueTree& c)
{
    noteTreeChange (p);

    if (affectsMeters (c))
        meterTapsDirty = true;
}

void AppEngine::valueTreeChildRemoved (juce::ValueTree& p, juce::ValueTree& c, int)
{
    noteTreeChange (p);

    if (affectsMeters (c))
        meterTapsDirty = true;
}
void AppEngine::valueTreeChildOrderChanged (juce::ValueTree& p, int, int)                   { noteTreeChange (p); }
}
