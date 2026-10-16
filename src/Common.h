#pragma once

#include <JuceHeader.h>

namespace te = tracktion;
using namespace std::literals;

namespace s3
{
using juce::var;
using juce::String;

struct RpcError : std::runtime_error
{
    explicit RpcError (const String& message) : std::runtime_error (message.toStdString()) {}
};

struct Obj
{
    Obj() = default;
    Obj& set (const juce::Identifier& key, const var& value)    { object->setProperty (key, value); return *this; }
    operator var() const                                        { return var (object.get()); }

    juce::DynamicObject::Ptr object { new juce::DynamicObject() };
};

inline var array()                                      { return var (juce::Array<var>()); }

inline bool has (const var& p, const char* key)         { return p.isObject() && p.hasProperty (key); }

inline String str (const var& p, const char* key, const String& fallback = {})
{
    return has (p, key) ? p[key].toString() : fallback;
}

inline double num (const var& p, const char* key, double fallback = 0.0)
{
    return has (p, key) ? static_cast<double> (p[key]) : fallback;
}

inline int integer (const var& p, const char* key, int fallback = 0)
{
    return has (p, key) ? static_cast<int> (p[key]) : fallback;
}

inline bool flag (const var& p, const char* key, bool fallback = false)
{
    return has (p, key) ? static_cast<bool> (p[key]) : fallback;
}

inline String reqStr (const var& p, const char* key)
{
    if (! has (p, key))
        throw RpcError ("Missing parameter: " + String (key));

    return p[key].toString();
}

inline double reqNum (const var& p, const char* key)
{
    if (! has (p, key))
        throw RpcError ("Missing parameter: " + String (key));

    return static_cast<double> (p[key]);
}

inline te::TimePosition seconds (double s)              { return te::TimePosition::fromSeconds (juce::jmax (0.0, s)); }
inline te::TimeDuration duration (double s)             { return te::TimeDuration::fromSeconds (juce::jmax (0.0, s)); }

inline String colourToString (juce::Colour c)           { return "#" + c.toDisplayString (false); }

inline juce::Colour colourFromString (const String& s, juce::Colour fallback)
{
    if (s.isEmpty())
        return fallback;

    return juce::Colour::fromString ("ff" + s.trimCharactersAtStart ("#"));
}

// The app used to be called Studio 3030; its settings, chains and agent token carry over once.
inline void migrateLegacyAppData()
{
    auto root = juce::File::getSpecialLocation (juce::File::userApplicationDataDirectory);
    auto oldDir = root.getChildFile ("Studio3030");
    auto newDir = root.getChildFile ("Studio4000");

    if (newDir.exists() || ! oldDir.isDirectory())
        return;

    newDir.createDirectory();
    oldDir.getChildFile ("Settings.xml").copyFileTo (newDir.getChildFile ("Settings.xml"));
    oldDir.getChildFile ("Studio3030.settings").copyFileTo (newDir.getChildFile ("Studio4000.settings"));
    oldDir.getChildFile ("agent.json").copyFileTo (newDir.getChildFile ("agent.json"));

    if (oldDir.getChildFile ("Chains").isDirectory())
        oldDir.getChildFile ("Chains").copyDirectoryTo (newDir.getChildFile ("Chains"));
}

inline juce::File appDataDir()
{
    auto d = juce::File::getSpecialLocation (juce::File::userApplicationDataDirectory).getChildFile ("Studio4000");
    d.createDirectory();
    return d;
}

inline juce::File defaultProjectsDir()
{
    auto d = juce::File::getSpecialLocation (juce::File::userMusicDirectory).getChildFile ("Studio 4000");
    d.createDirectory();
    return d;
}

inline const char* projectFileExtension = ".s4000";
inline const char* legacyProjectFileExtension = ".s3030";
}
