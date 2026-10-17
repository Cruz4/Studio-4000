#pragma once

#include "RpcRegistry.h"

namespace s3
{
class LoudnessMeterPlugin;
class LiveMidi;

class AppEngine : private juce::Timer,
                  private juce::ValueTree::Listener,
                  private juce::ChangeListener
{
public:
    /** An isolated engine keeps its settings apart from the user's, so test runs never touch them. */
    explicit AppEngine (bool isolated = false);
    ~AppEngine() override;

    te::Engine& getEngine()                                 { return *engine; }
    te::Edit* currentEdit() const                           { return editPtr.get(); }
    te::Edit& edit() const;
    te::SelectionManager& getSelection()                    { return *selection; }
    LiveMidi& midi()                                        { return *liveMidi; }

    Rpc rpc;

    //==============================================================================
    juce::File getEditFile() const                          { return editFile; }
    juce::File getProjectDir() const                        { return editFile.getParentDirectory(); }
    juce::File getAudioDir() const;
    juce::File getBouncesDir() const;
    juce::File getAutosaveFile() const;

    void createProject (const juce::File& projectDir, const String& name);
    void openProject (const juce::File& file);
    void save();
    /** Writes the session to a new file, copies its audio beside that file, and keeps working there. */
    void saveAs (const juce::File& file);

    /** Returns an autosave file that is newer than the saved project, if any. */
    juce::File findRecoveryFile() const;
    void recoverFromAutosave();

    //==============================================================================
    std::function<void (const String& type, const var& payload)> sendEvent;
    void emit (const String& type, const var& payload);
    void markProjectChanged()                               { snapshotPending = true; }
    void pushSnapshotNow();

    /** Groups every write call until endBatch into one undo step. */
    void beginBatch (const String& name);
    void endBatch();
    bool isInBatch() const noexcept                         { return batchDepth > 0; }

    juce::PropertiesFile& settings()                        { return *props; }

    //==============================================================================
    void scanPlugins();
    bool isScanningPlugins() const noexcept                 { return scanning.load(); }

    /** The studio's own "vsts" folders, always scanned along with the system folders and the user's extra ones. */
    static juce::Array<juce::File> studioPluginFolders();
    static constexpr bool canHostVst2 = JUCE_PLUGINHOST_VST != 0;

    //==============================================================================
    te::Track* findTrack (const String& id) const;
    te::Track& track (const String& id) const;
    te::AudioTrack& audioTrack (const String& id) const;
    te::Clip& clip (const String& id) const;
    te::Plugin& plugin (const String& id) const;
    te::AutomatableParameter& parameter (te::Plugin&, const String& paramId) const;
    LoudnessMeterPlugin* getMasterLoudnessMeter() const;

    /** The UI implements this to ask the user whether an agent may run a list of write calls. */
    std::function<void (const String& summary, const var& calls, std::function<void (bool)> decide)> requestApproval;

private:
    std::unique_ptr<te::Engine> engine;
    std::unique_ptr<te::Edit> editPtr;
    std::unique_ptr<te::SelectionManager> selection;
    std::unique_ptr<juce::PropertiesFile> props;
    std::unique_ptr<LiveMidi> liveMidi;
    juce::File editFile;

    bool snapshotPending = false;
    int batchDepth = 0;
    int tickCount = 0;
    bool wasRecording = false;
    std::atomic<bool> scanning { false };
    juce::Time lastAutosave;

    struct MeterTap
    {
        te::AudioTrack::Ptr track;
        te::LevelMeasurer::Client client;
    };
    std::vector<std::unique_ptr<MeterTap>> meterTaps;
    bool meterTapsDirty = true;

    void attachEdit (std::unique_ptr<te::Edit>, const juce::File&);
    void detachEdit();
    void ensureProjectStructure();
    void rebuildMeterTaps();
    void clearMeterTaps();
    void sendTick();
    void autosaveIfNeeded();

    void timerCallback() override;
    void changeListenerCallback (juce::ChangeBroadcaster*) override;
    void valueTreePropertyChanged (juce::ValueTree&, const juce::Identifier&) override;
    void valueTreeChildAdded (juce::ValueTree&, juce::ValueTree&) override;
    void valueTreeChildRemoved (juce::ValueTree&, juce::ValueTree&, int) override;
    void valueTreeChildOrderChanged (juce::ValueTree&, int, int) override;
    void noteTreeChange (const juce::ValueTree&);

    JUCE_DECLARE_NON_COPYABLE (AppEngine)
};
}
