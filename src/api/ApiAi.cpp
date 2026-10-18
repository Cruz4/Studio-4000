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
        "clip.set", "clip.move", "clip.split", "clip.delete", "clip.addMidi", "clip.toMidi", "clip.bounce", "clip.importAudio",
        "midi.setNotes", "midi.quantize", "midi.transpose", "midi.capture",
        "automation.setPoints", "automation.clear", "marker.add", "project.setTempo",
        "track.setMonitor", "track.setCue", "transport.record",
        "transport.play", "transport.stop", "transport.setPosition", "transport.setLoop", "transport.setClick",
        "export.render", "batch.run", "edit.undo"
    };

    String describeForModel (AppEngine& app)
    {
        auto& edit = app.edit();
        auto snap = buildProjectSnapshot (app);
        String s;

        auto& transport = edit.getTransport();
        s << "Project \"" << snap["name"].toString() << "\", " << String ((double) snap["bpm"], 1) << " BPM, "
          << snap["timeSig"][0].toString() << "/" << snap["timeSig"][1].toString() << ", length "
          << String ((double) snap["length"], 1) << " s.\n"
          << "Playhead " << String (transport.getPosition().inSeconds(), 2) << " s"
          << (transport.isPlaying() ? ", playing" : ", stopped")
          << (transport.isRecording() ? ", RECORDING" : "")
          << ((bool) snap["looping"] ? ", loop " + snap["loop"][0].toString() + "-" + snap["loop"][1].toString() + " s" : "")
          << ((bool) snap["punch"] ? ", punch in" : "")
          << ((bool) snap["click"] ? ", click on" : ", click off")
          << ".\n";

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
                if ((bool) t["live"]) s << ", live input";
                if ((bool) t["cue"]) s << ", in guest cue";
                if (t["monitor"].toString().isNotEmpty() && t["monitor"].toString() != "auto")
                    s << ", monitor " << t["monitor"].toString();

                if (auto* clips = t["clips"].getArray())
                {
                    s << ", " << clips->size() << " clip(s)";

                    for (int i = 0; i < juce::jmin (6, clips->size()); ++i)
                    {
                        auto c = (*clips)[i];
                        s << " [" << c["id"].toString() << " " << c["name"].toString() << " " << c["kind"].toString()
                          << " " << String ((double) c["start"], 2) << "-" << String ((double) c["end"], 2) << "s";

                        if (c["kind"].toString() == "midi" && c["notes"].getArray() != nullptr)
                            s << " " << c["notes"].getArray()->size() << " notes";

                        if (c["takes"].isObject() && (int) c["takes"]["count"] > 1)
                            s << " take " << c["takes"]["current"].toString() << "/" << c["takes"]["count"].toString();

                        s << "]";
                    }
                }

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
