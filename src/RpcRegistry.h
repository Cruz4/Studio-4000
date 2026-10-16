#pragma once

#include "Common.h"

namespace s3
{
/** A named-method registry shared by the UI, the agent port and collaboration.

    Every user-visible operation is a method here, so anything a person can do an
    agent can do too, with the same validation and undo behaviour.
*/
class Rpc
{
public:
    using Handler = std::function<var (const var& params)>;

    enum class Kind { read, write };

    struct Method
    {
        Handler handler;
        Kind kind = Kind::read;
        String description;
        String paramsHint;
    };

    void add (const String& name, Kind kind, const String& description, const String& paramsHint, Handler handler);

    bool exists (const String& name) const              { return methods.find (name) != methods.end(); }
    bool isWrite (const String& name) const;

    /** Calls a method and returns { ok, result } or { ok: false, error }. Must be called on the message thread. */
    var call (const String& name, const var& params, const String& origin);

    /** Calls a method and throws RpcError on failure. */
    var invoke (const String& name, const var& params, const String& origin);

    /** Returns a description of every method, for agents and the command palette. */
    var describe() const;

    /** Called before a write method runs. Used to open an undo transaction. */
    std::function<void (const String& method, const var& params, const String& origin)> beforeWrite;

    /** Called after a write method succeeds. */
    std::function<void (const String& method, const var& params, const String& origin)> afterWrite;

private:
    std::map<String, Method> methods;
};
}
