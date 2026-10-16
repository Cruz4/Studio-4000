#include "RpcRegistry.h"

namespace s3
{
void Rpc::add (const String& name, Kind kind, const String& description, const String& paramsHint, Handler handler)
{
    methods[name] = { std::move (handler), kind, description, paramsHint };
}

bool Rpc::isWrite (const String& name) const
{
    auto it = methods.find (name);
    return it != methods.end() && it->second.kind == Kind::write;
}

var Rpc::invoke (const String& name, const var& params, const String& origin)
{
    JUCE_ASSERT_MESSAGE_THREAD

    auto it = methods.find (name);

    if (it == methods.end())
        throw RpcError ("Unknown method: " + name);

    const bool write = it->second.kind == Kind::write;

    if (write && beforeWrite)
        beforeWrite (name, params, origin);

    auto result = it->second.handler (params);

    if (write && afterWrite)
        afterWrite (name, params, origin);

    return result;
}

var Rpc::call (const String& name, const var& params, const String& origin)
{
    try
    {
        auto result = invoke (name, params, origin);
        return Obj().set ("ok", true).set ("result", result);
    }
    catch (const std::exception& e)
    {
        return Obj().set ("ok", false).set ("error", String (e.what()));
    }
}

var Rpc::describe() const
{
    juce::Array<var> list;

    for (const auto& [name, m] : methods)
        list.add (Obj().set ("name", name)
                       .set ("write", m.kind == Kind::write)
                       .set ("description", m.description)
                       .set ("params", m.paramsHint));

    return list;
}
}
