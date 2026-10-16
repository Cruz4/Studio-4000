#include "AgentServer.h"

extern "C" __declspec (dllimport) unsigned long __stdcall GetCurrentProcessId();

namespace s3
{
namespace
{
    String randomToken()
    {
        juce::Random r (juce::Time::getHighResolutionTicks() ^ (juce::int64) juce::Time::currentTimeMillis());
        juce::MemoryBlock bytes (32);

        for (size_t i = 0; i < bytes.getSize(); ++i)
            bytes[i] = (char) r.nextInt (256);

        return juce::String::toHexString (bytes.getData(), (int) bytes.getSize(), 0);
    }

    struct Request
    {
        String method, path;
        std::map<String, String> headers;
        String body;
    };

    bool readRequest (juce::StreamingSocket& s, Request& req)
    {
        juce::MemoryOutputStream data;
        char buffer[8192];
        int headerEnd = -1;
        const auto deadline = juce::Time::getMillisecondCounter() + 10000;

        while (headerEnd < 0)
        {
            if (juce::Time::getMillisecondCounter() > deadline || s.waitUntilReady (true, 2000) != 1)
                return false;

            const int n = s.read (buffer, sizeof (buffer), false);

            if (n <= 0)
                return false;

            data.write (buffer, (size_t) n);

            if (data.getDataSize() > 1024 * 1024)
                return false;

            auto text = String::fromUTF8 (static_cast<const char*> (data.getData()), (int) data.getDataSize());
            headerEnd = text.indexOf ("\r\n\r\n");
        }

        auto all = String::fromUTF8 (static_cast<const char*> (data.getData()), (int) data.getDataSize());
        auto head = all.substring (0, headerEnd);
        auto lines = juce::StringArray::fromLines (head);

        if (lines.isEmpty())
            return false;

        auto requestLine = juce::StringArray::fromTokens (lines[0], " ", {});
        req.method = requestLine[0];
        req.path = requestLine[1];

        for (int i = 1; i < lines.size(); ++i)
            req.headers[lines[i].upToFirstOccurrenceOf (":", false, false).trim().toLowerCase()] = lines[i].fromFirstOccurrenceOf (":", false, false).trim();

        const int contentLength = req.headers.count ("content-length") ? req.headers["content-length"].getIntValue() : 0;

        if (contentLength < 0 || contentLength > 16 * 1024 * 1024)
            return false;

        // Count bytes, not characters, so multi-byte UTF-8 bodies are read completely.
        const auto headerBytes = (size_t) head.getNumBytesAsUTF8() + 4;
        juce::MemoryOutputStream body;
        body.write (static_cast<const char*> (data.getData()) + headerBytes, data.getDataSize() - headerBytes);

        while ((int) body.getDataSize() < contentLength)
        {
            if (juce::Time::getMillisecondCounter() > deadline + 20000 || s.waitUntilReady (true, 2000) != 1)
                return false;

            const int n = s.read (buffer, juce::jmin ((int) sizeof (buffer), contentLength - (int) body.getDataSize()), false);

            if (n <= 0)
                return false;

            body.write (buffer, (size_t) n);
        }

        req.body = body.toUTF8();
        return true;
    }

    void respond (juce::StreamingSocket& s, int status, const var& json)
    {
        const auto body = juce::JSON::toString (json, true);
        const auto statusText = status == 200 ? "OK" : status == 401 ? "Unauthorized" : status == 403 ? "Forbidden" : status == 404 ? "Not Found" : "Bad Request";

        String header;
        header << "HTTP/1.1 " << status << " " << statusText << "\r\n"
               << "Content-Type: application/json; charset=utf-8\r\n"
               << "Content-Length: " << (int) body.getNumBytesAsUTF8() << "\r\n"
               << "Connection: close\r\n\r\n";

        auto out = header + body;
        s.write (out.toRawUTF8(), (int) out.getNumBytesAsUTF8());
    }

    const juce::StringArray editingReads { "batch.run", "project.new", "project.open", "project.recover", "export.render",
                                           "project.archive", "plugins.block", "media.writeFile", "settings.set",
                                           "edit.undo", "edit.redo", "transport.record", "track.arm", "plugins.setPaths" };
}

AgentServer::AgentServer (AppEngine& a) : juce::Thread ("Studio 4000 agent link"), app (a)
{
    auto& s = app.settings();
    token = s.getValue ("secretAgentToken");

    if (token.length() < 32)
    {
        token = randomToken();
        s.setValue ("secretAgentToken", token);
        s.saveIfNeeded();
    }

    enabled = s.getBoolValue ("agentEnabled", true);
    askBeforeEdits = s.getBoolValue ("agentAskBeforeEdits", true);
    registerMethods();
}

AgentServer::~AgentServer()
{
    stop();
}

bool AgentServer::start()
{
    if (! enabled || isThreadRunning())
        return isThreadRunning();

    for (int p = 30303; p < 30323; ++p)
    {
        if (listener.createListener (p, "127.0.0.1"))
        {
            port = p;
            writeConnectionFile();
            startThread();
            return true;
        }
    }

    return false;
}

void AgentServer::stop()
{
    signalThreadShouldExit();
    listener.close();

    {
        const juce::ScopedLock sl (approvalLock);

        for (auto& [id, pending] : approvals)
            pending->done.signal();
    }

    stopThread (3000);
    appDataDir().getChildFile ("agent.json").deleteFile();
}

void AgentServer::writeConnectionFile()
{
    auto info = Obj().set ("url", "http://127.0.0.1:" + String (port))
                     .set ("port", port)
                     .set ("token", token)
                     .set ("pid", (int) GetCurrentProcessId());

    appDataDir().getChildFile ("agent.json").replaceWithText (juce::JSON::toString (info, false));
}

void AgentServer::run()
{
    while (! threadShouldExit())
    {
        std::shared_ptr<juce::StreamingSocket> client (listener.waitForNextConnection());

        if (client == nullptr)
        {
            if (threadShouldExit())
                break;

            wait (50);
            continue;
        }

        juce::Thread::launch ([this, client]
        {
            ++activeClients;
            Request req;

            if (readRequest (*client, req))
            {
                if (req.headers.count ("origin") && req.headers["origin"] != "null")
                {
                    respond (*client, 403, Obj().set ("ok", false).set ("error", "Browser origins are not allowed"));
                }
                else if (req.headers["authorization"] != "Bearer " + token)
                {
                    respond (*client, 401, Obj().set ("ok", false).set ("error", "Missing or wrong token. Read it from %APPDATA%/Studio4000/agent.json"));
                }
                else if (req.method == "GET" && req.path == "/health")
                {
                    respond (*client, 200, Obj().set ("ok", true).set ("app", "Studio 4000").set ("version", JUCE_APPLICATION_VERSION_STRING));
                }
                else if (req.method == "GET" && req.path == "/methods")
                {
                    auto result = dispatch ("app.describe", {}, "agent");
                    respond (*client, 200, result);
                }
                else if (req.method == "POST" && req.path == "/rpc")
                {
                    auto body = juce::JSON::parse (req.body);
                    auto clientName = req.headers.count ("x-agent-name") ? req.headers["x-agent-name"] : String ("agent");
                    auto result = dispatch (body["method"].toString(), body["params"], clientName);

                    if (body.hasProperty ("jsonrpc"))
                    {
                        auto rpcResult = Obj().set ("jsonrpc", "2.0").set ("id", body["id"]);

                        if ((bool) result["ok"])
                            rpcResult.set ("result", result["result"]);
                        else
                            rpcResult.set ("error", Obj().set ("code", -32000).set ("message", result["error"]));

                        respond (*client, 200, rpcResult);
                    }
                    else
                    {
                        respond (*client, 200, result);
                    }
                }
                else
                {
                    respond (*client, 404, Obj().set ("ok", false).set ("error", "Use POST /rpc"));
                }
            }

            client->close();
            --activeClients;
        });
    }
}

bool AgentServer::needsApproval (const String& method, const var& params) const
{
    if (! askBeforeEdits)
        return false;

    if (method.startsWith ("smart."))
        return flag (params, "apply");

    return app.rpc.isWrite (method) || editingReads.contains (method);
}

var AgentServer::dispatch (const String& method, const var& params, const String& client)
{
    if (method.isEmpty())
        return Obj().set ("ok", false).set ("error", "Missing method");

    if (method.startsWith ("agent."))
        return Obj().set ("ok", false).set ("error", "Agent settings can only be changed in the app");

    struct Shared
    {
        juce::WaitableEvent done;
        var result;
        bool exists = false, write = false;
    };

    auto shared = std::make_shared<Shared>();

    juce::MessageManager::callAsync ([this, shared, method, params]
    {
        shared->exists = app.rpc.exists (method);
        shared->write = needsApproval (method, params);
        shared->done.signal();
    });

    if (! shared->done.wait (5000))
        return Obj().set ("ok", false).set ("error", "The app is busy");

    if (! shared->exists)
        return Obj().set ("ok", false).set ("error", "Unknown method: " + method + ". GET /methods lists them.");

    if (shared->write)
    {
        const int requestId = ++nextRequestId;
        auto pending = std::make_shared<PendingApproval>();

        {
            const juce::ScopedLock sl (approvalLock);
            approvals[requestId] = pending;
        }

        juce::MessageManager::callAsync ([this, requestId, method, params, client]
        {
            juce::Array<var> calls;

            if (method == "batch.run" && params["calls"].isArray())
                calls = *params["calls"].getArray();
            else
                calls.add (Obj().set ("method", method).set ("params", params));

            app.emit ("agent.approval", Obj().set ("requestId", requestId).set ("client", client)
                                             .set ("label", method == "batch.run" ? str (params, "label", "Agent plan") : method)
                                             .set ("calls", calls));
        });

        const bool decided = pending->done.wait (180000);

        {
            const juce::ScopedLock sl (approvalLock);
            approvals.erase (requestId);
        }

        if (! decided || ! pending->approved || threadShouldExit())
        {
            juce::MessageManager::callAsync ([this, requestId] { app.emit ("agent.approvalClosed", Obj().set ("requestId", requestId)); });
            return Obj().set ("ok", false).set ("error", decided ? "The user declined this change" : "Timed out waiting for the user to approve");
        }
    }

    auto call = std::make_shared<Shared>();

    juce::MessageManager::callAsync ([this, call, method, params, client]
    {
        call->result = app.rpc.call (method, params, "agent");
        app.emit ("agent.activity", Obj().set ("client", client).set ("method", method).set ("ok", call->result["ok"])
                                         .set ("error", call->result["error"]));
        call->done.signal();
    });

    if (! call->done.wait (600000))
        return Obj().set ("ok", false).set ("error", "Timed out");

    return call->result;
}

void AgentServer::registerMethods()
{
    using K = Rpc::Kind;
    auto& rpc = app.rpc;

    rpc.add ("agent.status", K::read, "Agent link status", "{}", [this] (const var&)
    {
        return var (Obj().set ("enabled", enabled).set ("running", isThreadRunning()).set ("port", port)
                         .set ("askBeforeEdits", askBeforeEdits).set ("clients", activeClients.load())
                         .set ("configFile", appDataDir().getChildFile ("agent.json").getFullPathName()));
    });

    rpc.add ("agent.setEnabled", K::read, "Turns the agent link on or off", "{enabled}", [this] (const var& p)
    {
        enabled = flag (p, "enabled", true);
        app.settings().setValue ("agentEnabled", enabled);
        app.settings().saveIfNeeded();

        if (enabled)
            start();
        else
            stop();

        return var (isThreadRunning());
    });

    rpc.add ("agent.setAskBeforeEdits", K::read, "Whether agent edits need approval", "{ask}", [this] (const var& p)
    {
        askBeforeEdits = flag (p, "ask", true);
        app.settings().setValue ("agentAskBeforeEdits", askBeforeEdits);
        app.settings().saveIfNeeded();
        return var (askBeforeEdits);
    });

    rpc.add ("agent.decide", K::read, "Approves or declines a pending agent change", "{requestId, approve}", [this] (const var& p)
    {
        const juce::ScopedLock sl (approvalLock);

        if (auto it = approvals.find (integer (p, "requestId")); it != approvals.end())
        {
            it->second->approved = flag (p, "approve");
            it->second->done.signal();
            return var (true);
        }

        return var (false);
    });

    rpc.add ("agent.newToken", K::read, "Replaces the agent token (disconnects agents until they re-read agent.json)", "{}", [this] (const var&)
    {
        token = randomToken();
        app.settings().setValue ("secretAgentToken", token);
        app.settings().saveIfNeeded();

        if (isThreadRunning())
            writeConnectionFile();

        return var (true);
    });
}
}
