#pragma once

#include "AppEngine.h"

namespace s3
{
/** Headless end-to-end check run with --selftest [--report=path].
    Drives the engine through the same RPC methods the UI and agents use.
*/
class SelfTest : private juce::Timer
{
public:
    SelfTest (AppEngine&, const String& commandLine, std::function<void (int)> onFinished);
    ~SelfTest() override;

private:
    AppEngine& app;
    std::function<void (int)> finished;
    juce::File reportFile, workDir;
    juce::Array<var> results;
    int failures = 0;
    int step = 0;
    int waitingForJob = -1;
    juce::Array<var> renderedFiles;
    juce::uint32 waitStarted = 0;
    std::map<String, String> ids;

    void timerCallback() override;
    bool runStep();
    var call (const String& method, const var& params = {});
    void check (const String& name, bool ok, const String& detail = {});
    void finish();
};
}
