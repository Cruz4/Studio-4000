#include "AppEngine.h"
#include "AgentServer.h"
#include "SessionRelay.h"
#include "MainWindow.h"
#include "SelfTest.h"
#include "Updater.h"

#include <atomic>

namespace s3
{
class Studio4000Application : public juce::JUCEApplication, private juce::Timer
{
public:
    const juce::String getApplicationName() override        { return JUCE_APPLICATION_NAME_STRING; }
    const juce::String getApplicationVersion() override     { return JUCE_APPLICATION_VERSION_STRING; }
    bool moreThanOneInstanceAllowed() override              { return isSelfTest (getCommandLineParameters()); }

    void initialise (const juce::String& commandLine) override
    {
        if (te::PluginManager::startChildProcessPluginScan (commandLine))
            return;

        engine = std::make_unique<AppEngine> (isSelfTest (commandLine));

        if (isSelfTest (commandLine))
        {
            selfTest = std::make_unique<SelfTest> (*engine, commandLine, [this] (int result)
            {
                setApplicationReturnValue (result);
                quit();
            });
            return;
        }

        agent = std::make_unique<AgentServer> (*engine);
        agent->start();
        relay = std::make_unique<SessionRelay> (engine->rpc);
        relay->start();
        window = std::make_unique<MainWindow> (*engine, *agent);

        openFromCommandLine (commandLine);
        startTimer (5 * 60 * 1000);
        lookForUpdate();
    }

    void shutdown() override
    {
        stopTimer();
        alive = false;
        window.reset();
        agent.reset();
        relay.reset();
        selfTest.reset();
        engine.reset();
    }

    void systemRequestedQuit() override
    {
        if (engine != nullptr && engine->currentEdit() != nullptr)
        {
            auto& transport = engine->edit().getTransport();

            if (transport.isRecording())
                transport.stop (false, true);

            engine->save();
        }

        quit();
    }

    void anotherInstanceStarted (const juce::String& commandLine) override
    {
        openFromCommandLine (commandLine);

        if (window != nullptr)
            window->toFront (true);
    }

private:
    static bool isSelfTest (const juce::String& commandLine)    { return commandLine.contains ("--selftest"); }

    void timerCallback() override
    {
        lookForUpdate();
    }

    // The window is already up. A published build downloads beside it, then this
    // process exits and the helper reopens the new copy.
    void lookForUpdate()
    {
        if (! alive || updateCheck.exchange (true))
            return;

        if (engine != nullptr && engine->currentEdit() != nullptr)
        {
            auto& transport = engine->edit().getTransport();

            if (transport.isPlaying() || transport.isRecording())
            {
                updateCheck = false;
                return;
            }
        }

        juce::Thread::launch ([this]
        {
            const bool restart = alive && stagePublishedUpdate() == UpdateState::staged;

            if (restart)
                juce::MessageManager::callAsync ([this] { if (alive) systemRequestedQuit(); });
            else
                updateCheck = false;
        });
    }

    void openFromCommandLine (const juce::String& commandLine)
    {
        for (auto& arg : juce::StringArray::fromTokens (commandLine, true))
        {
            juce::File f (arg.unquoted());

            if (juce::File::isAbsolutePath (arg.unquoted()) && (f.hasFileExtension (projectFileExtension) || f.hasFileExtension (legacyProjectFileExtension)) && f.existsAsFile())
            {
                try { engine->openProject (f); }
                catch (const std::exception& e) { engine->emit ("toast", Obj().set ("level", "error").set ("message", juce::String (e.what()))); }
            }
        }
    }

    std::atomic<bool> alive { true };
    std::atomic<bool> updateCheck { false };
    std::unique_ptr<AppEngine> engine;
    std::unique_ptr<AgentServer> agent;
    std::unique_ptr<SessionRelay> relay;
    std::unique_ptr<MainWindow> window;
    std::unique_ptr<SelfTest> selfTest;
};
}

START_JUCE_APPLICATION (s3::Studio4000Application)
