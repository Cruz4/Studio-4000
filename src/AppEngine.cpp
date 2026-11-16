#include "AppEngine.h"
#include "RecordingPreview.h"
#include "LoopTakeRecorder.h"
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
            { "track.duplicate", "Duplicate track" }, { "track.bounce", "Print effects" }, { "track.arm", "Arm track" }, { "track.setInput", "Track input" },
            { "track.setMonitor", "Input monitoring" }, { "bus.create", "New FX return" },
            { "plugin.add", "Add effect" }, { "plugin.remove", "Remove effect" }, { "plugin.move", "Reorder effect" },
            { "plugin.duplicate", "Duplicate effect" }, { "chain.load", "Load effect chain" },
            { "plugin.set", "Effect bypass" }, { "plugin.setParams", "Effect change" }, { "plugin.setParam", "Effect change" },
            { "noise.capture", "Capture noise print" },
            { "plugin.setSidechain", "Sidechain" }, { "clip.move", "Move clip" }, { "clip.delete", "Delete clip" },
            { "clip.split", "Split" }, { "clip.duplicate", "Duplicate" }, { "clip.trim", "Trim" }, { "clip.slip", "Slip" },
            { "clip.importAudio", "Import audio" }, { "clip.addMidi", "New MIDI clip" }, { "clip.normalize", "Normalize" },
            { "clip.toMidi", "Audio to MIDI" }, { "clip.bounce", "Print to audio" }, { "midi.capture", "Capture MIDI" },
            { "track.setCue", "Cue mix" },
            { "clip.setGainPoints", "Clip gain" }, { "clip.setPanPoints", "Clip pan" },
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
    struct GenericParameterEditor : public te::Plugin::EditorComponent, private juce::Timer
    {
        explicit GenericParameterEditor (te::Plugin& p) : plugin (p)
        {
            addAndMakeVisible (viewport);
            viewport.setViewedComponent (&content, false);
            viewport.setScrollBarsShown (true, false);
            for (auto* parameter : plugin.getAutomatableParameters())
            {
                auto row = std::make_unique<Row>();
                row->parameter = parameter;
                row->name.setText (parameter->getParameterName(), juce::dontSendNotification);
                row->name.setColour (juce::Label::textColourId, juce::Colour (0xffdfe4f2));
                row->name.setJustificationType (juce::Justification::centredLeft);
                row->slider.setRange (parameter->valueRange.start, parameter->valueRange.end, 0.0);
                row->slider.setValue (parameter->getCurrentValue(), juce::dontSendNotification);
                row->slider.setTextBoxStyle (juce::Slider::TextBoxRight, false, 92, 24);
                row->slider.onValueChange = [parameter, slider = &row->slider]
                {
                    parameter->setParameter ((float) slider->getValue(), juce::sendNotificationSync);
                };
                content.addAndMakeVisible (row->name);
                content.addAndMakeVisible (row->slider);
                rows.push_back (std::move (row));
            }
            setSize (640, juce::jlimit (180, 620, 24 + (int) rows.size() * 34));
            startTimerHz (15);
        }

        bool allowWindowResizing() override { return true; }
        bool isEditorResizable() override { return true; }
        juce::ComponentBoundsConstrainer* getBoundsConstrainer() override { return nullptr; }
        void resized() override
        {
            viewport.setBounds (getLocalBounds());
            const int width = juce::jmax (420, viewport.getWidth() - viewport.getScrollBarThickness());
            content.setSize (width, juce::jmax (getHeight(), 10 + (int) rows.size() * 34));
            int y = 7;
            for (auto& row : rows)
            {
                row->name.setBounds (10, y, 205, 27);
                row->slider.setBounds (218, y, width - 228, 27);
                y += 34;
            }
        }

    private:
        void timerCallback() override
        {
            for (auto& row : rows)
                if (! row->slider.isMouseButtonDown())
                    row->slider.setValue (row->parameter->getCurrentValue(), juce::dontSendNotification);
        }
        struct Row { te::AutomatableParameter* parameter = nullptr; juce::Label name; juce::Slider slider; };
        te::Plugin& plugin;
        juce::Viewport viewport;
        juce::Component content;
        std::vector<std::unique_ptr<Row>> rows;
    };

    struct PluginWindow : public juce::DocumentWindow
    {
        explicit PluginWindow (te::Plugin& p)
            : DocumentWindow (p.getName(), juce::Colour (0xff0b0d12), DocumentWindow::closeButton, false),
              plugin (p)
        {
            // Create a fully independent desktop peer. An embedded/owned peer is
            // clipped by the WebView host and cannot cross onto another monitor.
            setUsingNativeTitleBar (true);
            addToDesktop();
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
            auto next = plugin.createEditor();
            if (next == nullptr)
                next = std::make_unique<GenericParameterEditor> (plugin);
            setEditor (std::move (next));
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
    pm.createBuiltInType<te::ImpulseResponsePlugin>();
    pm.registerBuiltInType (std::make_unique<LegacyPluginType<LoudnessMeterPlugin>> ("s3030loudness"));
    pm.registerBuiltInType (std::make_unique<LegacyPluginType<LimiterPlugin>> ("s3030limiter"));
    registerStudioEffects (pm);
   #if TRACKTION_AIR_WINDOWS
    pm.initialiseAirWindows();
   #endif

    auto& dm = engine->getDeviceManager().deviceManager;
    dm.setCurrentAudioDeviceType (props->getValue ("audioDeviceType", dm.getCurrentAudioDeviceType()), true);
    liveMidi = std::make_unique<LiveMidi> (*this);
    loopTakeRecorder = std::make_unique<LoopTakeRecorder> (*this);

    // Continuous gestures (fader, knob, slider drags) arrive as many identical calls; they share one undo step.
    rpc.beforeWrite = [this, last = std::make_shared<std::pair<String, juce::uint32>>()] (const String& method, const var& params, const String&)
    {
        if (loopTakeRecorder->isActive() && loopTakeRecorder->hasTrack (params["id"].toString())
            && (method == "track.remove" || method == "track.arm" || method == "track.setInput"))
            throw RpcError ("Stop loop-take recording before changing its recording tracks");
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
        if (editPtr != nullptr) editPtr->markAsChanged();
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
        // The exit prompt has already resolved Save / Discard / Cancel.
        try
        {
            if (editPtr->getTransport().isRecording())
                editPtr->getTransport().stop (false, true);

            // Normal exit has already resolved Save / Discard / Cancel.
        }
        catch (...) {}

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
    return getProjectDir().getChildFile ("Autosaves").getChildFile (editFile.getFileNameWithoutExtension() + " (Autosave)" + projectFileExtension);
}

void AppEngine::emit (const String& type, const var& payload)
{
    if (sendEvent)
        sendEvent (type, payload);
}

//==============================================================================
void AppEngine::ensureProjectStructure()
{
    for (auto* sub : { "Audio", "Bounces", "Imported" })
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

    auto target = file;
    const auto base = file.getFileNameWithoutExtension();
    const bool autosave = base.endsWithIgnoreCase (" (Autosave)") || base.endsWithIgnoreCase (".autosave");
    if (autosave)
    {
        auto parent = file.getParentDirectory();
        if (parent.getFileName().equalsIgnoreCase ("Autosaves") || parent.getFileName().equalsIgnoreCase ("autosave"))
            parent = parent.getParentDirectory();
        target = parent.getChildFile (base.dropLastCharacters (base.endsWithIgnoreCase (" (Autosave)") ? 11 : 9) + projectFileExtension);
    }
    // Resolve media paths against the manual project's directory, including while loading backups.
    auto state = te::loadEditFromFile (*engine, file, te::ProjectItemID{});
    if (! state.isValid()) throw RpcError ("Could not read " + file.getFileName());
    auto projectID = te::ProjectItemID::fromProperty (state, te::IDs::projectID);
    if (! projectID.isValid()) projectID = te::ProjectItemID::createNewID (te::ProjectID{});
    auto loaded = te::Edit::createEdit (te::Edit::Options { *engine, state, projectID,
        te::Edit::forEditing, nullptr, te::Edit::getDefaultNumUndoLevels(), [target] { return target; }, {} });

    if (loaded == nullptr)
        throw RpcError ("Could not open " + file.getFileName());

    attachEdit (std::move (loaded), target);
    if (autosave) { editPtr->markAsChanged(); pushSnapshotNow(); }
}

void AppEngine::save()
{
    if (editPtr == nullptr)
        return;

    bool saved = false;
    te::EditFileOperations (*editPtr).save (false, true, false, [&saved] (bool ok) { saved = ok; });
    if (! saved) throw RpcError ("Could not save the project. Your changes are still open.");
    lastAutosave = juce::Time::getCurrentTime();
    emit ("saved", Obj().set ("file", editFile.getFullPathName()));
    pushSnapshotNow();
}

bool AppEngine::writeAutosave()
{
    if (editPtr == nullptr || closing)
        return false;

    // A just-finished edit can still be queued in Tracktion's undo manager.
    // Flush it before deciding there is nothing to recover (especially on shutdown).
    editPtr->getUndoManager().dispatchPendingMessages();

    if (! editPtr->hasChangedSinceSaved())
        return false;

    auto file = getAutosaveFile();

    if (file == editFile)
        throw RpcError ("Autosave path must be different from the project file");

    if (! file.getParentDirectory().createDirectory()
        || ! te::EditFileOperations (*editPtr).writeToFile (file, false))
        throw RpcError ("Could not write the separate autosave: " + file.getFullPathName());

    emit ("autosaved", Obj().set ("file", file.getFullPathName()));
    return true;
}

bool AppEngine::hasUnsavedChanges()
{
    if (editPtr == nullptr || closing) return false;
    editPtr->getUndoManager().dispatchPendingMessages();
    return editPtr->hasChangedSinceSaved();
}

void AppEngine::finishClosing (bool saveChanges)
{
    if (saveChanges) save();
    else
    {
        // Discard explicitly abandons recovery for this project as well.
        for (auto file : { getAutosaveFile(), editFile.getSiblingFile (editFile.getFileNameWithoutExtension() + " (Autosave)" + projectFileExtension),
                           getProjectDir().getChildFile ("autosave").getChildFile (editFile.getFileNameWithoutExtension() + ".autosave" + projectFileExtension) })
            if (file.existsAsFile() && ! file.deleteFile())
                throw RpcError ("Could not discard autosave: " + file.getFullPathName());
    }
    closing = true;
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

    const auto legacy = getProjectDir().getChildFile ("autosave")
                                       .getChildFile (editFile.getFileNameWithoutExtension() + ".autosave" + projectFileExtension);
    juce::File newest;

    for (auto candidate : { getAutosaveFile(), legacy, editFile.getSiblingFile (editFile.getFileNameWithoutExtension() + " (Autosave)" + projectFileExtension) })
        if (candidate.existsAsFile() && (! newest.existsAsFile() || candidate.getLastModificationTime() > newest.getLastModificationTime()))
            newest = candidate;

    if (newest.existsAsFile() && newest.getLastModificationTime() > editFile.getLastModificationTime())
        return newest;

    return {};
}

void AppEngine::recoverFromAutosave()
{
    auto recovery = findRecoveryFile();

    if (! recovery.existsAsFile())
        throw RpcError ("There is no newer autosave for this project");

    openProject (recovery);
    // Loading recovery changes the in-memory session only. The original project
    // remains untouched until the user explicitly presses Save.
    editPtr->markAsChanged();
    pushSnapshotNow();
}

void AppEngine::attachEdit (std::unique_ptr<te::Edit> newEdit, const juce::File& file)
{
    detachEdit();

    editPtr = std::move (newEdit);
    closing = false;
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

    // The startup version tabs let the user choose the manual save or autosave explicitly.
}

void AppEngine::detachEdit()
{
    if (editPtr == nullptr)
        return;

    loopTakeRecorder->reset();

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
        if (auto* meter = dynamic_cast<te::LevelMeterPlugin*> (tap->plugin.get()))
            meter->measurer.removeClient (tap->client);

    meterTaps.clear();
}

void AppEngine::rebuildMeterTaps()
{
    clearMeterTaps();

    if (editPtr == nullptr)
        return;

    editPtr->visitAllTracksRecursive ([&] (te::Track& track)
    {
        auto* meter = track.pluginList.findFirstPluginOfType<te::LevelMeterPlugin>();
        if (meter == nullptr)
            if (auto* folder = dynamic_cast<te::FolderTrack*> (&track); folder != nullptr && folder->isSubmixFolder())
            {
                auto plugin = editPtr->getPluginCache().createNewPlugin (te::LevelMeterPlugin::xmlTypeName, {});
                track.pluginList.insertPlugin (plugin, -1, nullptr);
                meter = dynamic_cast<te::LevelMeterPlugin*> (plugin.get());
            }
        if (meter != nullptr)
        {
            auto tap = std::make_unique<MeterTap>();
            tap->track = &track;
            tap->plugin = meter;
            meter->measurer.addClient (tap->client);
            meterTaps.push_back (std::move (tap));
        }
        return true;
    });

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
    // Ten waveform updates per second, with bounded data per input, keeps the UI responsive on long takes.
    if (transport.isRecording() && tickCount % 3 == 0)
        emit ("recordings", recordingSnapshot());
}

var AppEngine::recordingSnapshot (const var& request)
{
    return recordingPreviews (edit(), request, loopTakeRecorder->targets());
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
        try
        {
            writeAutosave();
        }
        catch (const std::exception& e)
        {
            emit ("toast", Obj().set ("level", "error")
                                .set ("title", "Autosave failed")
                                .set ("message", String (e.what())));
        }
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

    loopTakeRecorder->poll();

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
                // A finished take is protected immediately, but only in the
                // separate recovery file. Manual Save owns the project file.
                try
                {
                    writeAutosave();
                }
                catch (const std::exception& e)
                {
                    emit ("toast", Obj().set ("level", "error")
                                        .set ("title", "Autosave failed")
                                        .set ("message", String (e.what())));
                }
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
