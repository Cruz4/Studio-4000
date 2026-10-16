#pragma once

#include "AppEngine.h"

namespace s3
{
/** Lets a user's own AI agent drive the studio.

    Listens on 127.0.0.1 only and requires a bearer token, both written to
    %APPDATA%/Studio4000/agent.json for the bundled MCP server to pick up.
    Edits can require approval in the app before they run.
*/
class AgentServer : private juce::Thread
{
public:
    explicit AgentServer (AppEngine&);
    ~AgentServer() override;

    bool start();
    void stop();

    int getPort() const noexcept            { return port; }
    String getToken() const                 { return token; }

private:
    struct PendingApproval
    {
        juce::WaitableEvent done;
        std::atomic<bool> approved { false };
    };

    AppEngine& app;
    juce::StreamingSocket listener;
    String token;
    int port = 0;
    bool enabled = true;
    bool askBeforeEdits = true;
    std::atomic<int> activeClients { 0 };
    std::atomic<int> nextRequestId { 0 };
    juce::Time lastActivity;

    juce::CriticalSection approvalLock;
    std::map<int, std::shared_ptr<PendingApproval>> approvals;

    void run() override;
    var dispatch (const String& method, const var& params, const String& client);
    bool needsApproval (const String& method, const var& params) const;
    void writeConnectionFile();
    void registerMethods();

    JUCE_DECLARE_NON_COPYABLE (AgentServer)
};
}
