#pragma once
// Modified for the recording and device fixes: deterministic loopback regression checks.
#include "AppEngine.h"

namespace s3
{
class RecordingSelfTest : private juce::Timer
{
public:
    RecordingSelfTest (AppEngine&, std::function<void (int)>);
    ~RecordingSelfTest() override;

private:
    AppEngine& app;
    std::function<void (int)> finished;
    juce::File workDir;
    int scenario = 0, stage = 0, failures = 0;
    int loopScenario = 0;
    String innerBus, outerBus;
    float innerBusPeak[2] { -100, -100 }, outerBusPeak[2] { -100, -100 };
    juce::uint32 started = 0;
    String recordTrack, inputName, recordingFile;
    bool sawPreview = false, stablePreview = true;
    double previewRate = 0;
    std::vector<int> previousPeaks;
    std::vector<std::pair<std::string, std::vector<float>>> sourceBuffers;

    void timerCallback() override;
    void check (const String&, bool, const String& = {});
    var call (const String&, const var& = {});
    void beginScenario();
    void enableInput();
    void beginRecording();
    void inspectRecording();
    void beginLoopScenario();
    void inspectLoopScenario();
    void beginBusScenario();
};
}
