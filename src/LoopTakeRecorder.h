#pragma once
#include "Common.h"

namespace s3
{
class AppEngine;

/** Schedules adjacent capture windows on one input; the transport never restarts between passes. */
class LoopTakeRecorder
{
public:
    explicit LoopTakeRecorder (AppEngine&);
    ~LoopTakeRecorder();
    var state() const;
    var configure (const var&);
    bool isEnabled() const { return enabled; }
    bool isActive() const { return active; }
    void start();
    void poll();
    void finish();
    void reset();
    bool hasTrack (const String&) const;
    String currentTrack() const;
    String getInputName() const { return inputName; }
    juce::Array<te::EditItemID> targets() const;

private:
    struct Pass { String track; bool completed = false; juce::Array<te::EditItemID> clips; };
    AppEngine& app;
    bool enabled = false, mutePrevious = true, active = false, finishing = false, autoStop = false;
    bool savedPunch = false;
    int limit = 4, current = 0, generation = 0;
    double startTime = 0, length = 0;
    String source, sourceName, inputName;
    te::InputDeviceInstance* input = nullptr;
    std::vector<Pass> passes;
    std::shared_ptr<int> lifetime = std::make_shared<int> (0);

    void prepareNext();
    void scheduleEnd (int index);
};
}
