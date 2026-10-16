#include "Api.h"

namespace s3
{
namespace
{
    using K = Rpc::Kind;

    /** Methods offered to language models as tools. Everything else stays reachable through batch.run. */
    const char* assistantTools[] = {
        "project.get", "plugins.list", "plugin.params", "smart.analyze", "smart.mix", "smart.gainStage", "smart.duck", "smart.master",
        "smart.vocalChain", "track.add", "track.set", "track.remove", "track.arm", "bus.create", "send.add", "send.set", "group.create",
        "plugin.add", "plugin.remove", "plugin.set", "plugin.setParam", "plugin.setSidechain",
        "clip.set", "clip.move", "clip.split", "clip.delete", "clip.addMidi", "midi.setNotes", "midi.quantize",
        "automation.setPoints", "automation.clear", "marker.add", "project.setTempo",
        "transport.play", "transport.stop", "transport.setPosition", "transport.setLoop", "transport.setClick",
        "export.render", "batch.run", "edit.undo"
    };

    String describeForModel (AppEngine& app)
    {
        auto& edit = app.edit();
        auto snap = buildProjectSnapshot (app);
        String s;

        s << "Project \"" << snap["name"].toString() << "\", " << String ((double) snap["bpm"], 1) << " BPM, "
          << snap["timeSig"][0].toString() << "/" << snap["timeSig"][1].toString() << ", length "
          << String ((double) snap["length"], 1) << " s.\n";

        if (auto* tracks = snap["tracks"].getArray())
        {
            s << "Tracks:\n";

            for (auto& t : *tracks)
            {
                s << "- [" << t["id"].toString() << "] " << t["name"].toString() << " (" << t["kind"].toString() << ")"
                  << " vol " << String ((double) t["volumeDb"], 1) << " dB, pan " << String ((double) t["pan"], 2);

                if ((bool) t["mute"]) s << ", muted";
                if ((bool) t["solo"]) s << ", solo";
                if ((bool) t["armed"]) s << ", armed";

                if (auto* clips = t["clips"].getArray())
                    s << ", " << clips->size() << " clip(s)";

                if (auto* plugins = t["plugins"].getArray(); plugins != nullptr && ! plugins->isEmpty())
                {
                    s << ", inserts:";

                    for (auto& p : *plugins)
                        s << " " << p["name"].toString() << " [" << p["id"].toString() << "]" << ((bool) p["enabled"] ? "" : " (bypassed)");
                }

                if (auto* sends = t["sends"].getArray(); sends != nullptr && ! sends->isEmpty())
                    for (auto& sd : *sends)
                        s << ", send to " << sd["busName"].toString() << " " << String ((double) sd["gainDb"], 1) << " dB";

                s << "\n";
            }
        }

        if (auto* master = snap["master"]["plugins"].getArray())
        {
            s << "Master " << String ((double) snap["master"]["volumeDb"], 1) << " dB, chain:";

            for (auto& p : *master)
                s << " " << p["name"].toString() << " [" << p["id"].toString() << "]";

            s << "\n";
        }

        (void) edit;
        return s;
    }
}

void registerAiApi (AppEngine& app)
{
    auto& rpc = app.rpc;

    rpc.add ("ai.context", K::read, "A compact text description of the project for language models", "{}", [&app] (const var&)
    {
        return var (describeForModel (app));
    });

    rpc.add ("ai.tools", K::read, "Tool definitions for the assistant", "{}", [&app] (const var&)
    {
        juce::Array<var> tools;
        auto all = app.rpc.describe();

        for (auto& m : *all.getArray())
            for (auto* name : assistantTools)
                if (m["name"].toString() == name)
                    tools.add (m);

        return var (tools);
    });
}
}
