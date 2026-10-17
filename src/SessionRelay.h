#pragma once

#include "RpcRegistry.h"

namespace s3
{

/** In-app session relay. Hosting a room does not need a separate server process. */
class SessionRelay : private juce::Thread
{
public:
    explicit SessionRelay (Rpc&);
    ~SessionRelay() override;

    bool start();
    void stop();

private:
    void run() override;
    void registerMethods();
    void publish();
    void unmap();

    struct Impl;
    std::unique_ptr<Impl> impl;
    Rpc& rpc;
    juce::StreamingSocket listener;
    int port = 0;
    juce::String lan { "127.0.0.1" };
    juce::String advertise;
    juce::String mapControl, mapService;
    int mapExternal = 0;
    juce::CriticalSection shareLock;
    juce::WaitableEvent reachEvent { true };
    std::atomic<bool> reachReady { false };
    std::atomic<int> publishing { 0 };
    std::atomic<int> clients { 0 };

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (SessionRelay)
};

}
