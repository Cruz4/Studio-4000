#include "Api.h"
#include "../LimiterPlugin.h"
#include "../LoudnessMeterPlugin.h"
#include "../StudioFx.h"
#include "../Instruments.h"

namespace s3
{
namespace
{
    using K = Rpc::Kind;

    struct BuiltIn
    {
        String type, name, category;
        bool synth = false;
    };

    const char* airWindowsCategory (te::AirWindowsPlugin::Type t)
    {
        switch (t)
        {
            case te::AirWindowsPlugin::delay:       return "Delay";
            case te::AirWindowsPlugin::dither:      return "Dither";
            case te::AirWindowsPlugin::distortion:  return "Saturation";
            case te::AirWindowsPlugin::dynamics:    return "Dynamics";
            case te::AirWindowsPlugin::emulation:   return "Console";
            case te::AirWindowsPlugin::eq:          return "EQ";
            case te::AirWindowsPlugin::filter:      return "Filter";
            case te::AirWindowsPlugin::imaging:     return "Stereo";
            case te::AirWindowsPlugin::modulation:  return "Modulation";
            case te::AirWindowsPlugin::reverb:      return "Reverb";
            case te::AirWindowsPlugin::utility:
            default:                                return "Utility";
        }
    }

    const std::vector<BuiltIn>& builtIns()
    {
        static const std::vector<BuiltIn> list = []
        {
            std::vector<BuiltIn> l {
                { te::EqualiserPlugin::xmlTypeName,          "Classic EQ",       "EQ" },
                { te::CompressorPlugin::xmlTypeName,         "Classic Compressor", "Dynamics" },
                { LimiterPlugin::xmlTypeName,                "Brickwall Limiter","Dynamics" },
                { te::ReverbPlugin::xmlTypeName,             "Reverb",           "Reverb" },
                { te::DelayPlugin::xmlTypeName,              "Delay",            "Delay" },
                { te::ChorusPlugin::xmlTypeName,             "Chorus",           "Modulation" },
                { te::PhaserPlugin::xmlTypeName,             "Phaser",           "Modulation" },
                { te::LowPassPlugin::xmlTypeName,            "Filter",           "Filter" },
                { te::PitchShiftPlugin::xmlTypeName,         "Pitch Shifter",    "Pitch" },
                { te::ImpulseResponsePlugin::xmlTypeName,    "Convolution",      "Reverb" },
                { LoudnessMeterPlugin::xmlTypeName,          "Loudness Meter",   "Utility" },
                { te::FourOscPlugin::xmlTypeName,            "4OSC Synth",       "Instrument", true },
                { te::SamplerPlugin::xmlTypeName,            "Sampler",          "Instrument", true },
            };

            for (auto& fx : studioEffectCatalogue())
                l.push_back ({ fx[0], fx[1], fx[2] });

           #if TRACKTION_AIR_WINDOWS
            #define S3_AIRWINDOWS(cls) l.push_back ({ te::cls::xmlTypeName, String ("AW ") + te::cls::getPluginName(), \
                                                      airWindowsCategory (te::cls::pluginType) });
            #include "../AirWindowsCatalogue.inc"
            #undef S3_AIRWINDOWS
           #endif

            return l;
        }();

        return list;
    }

    int anchorIndex (te::PluginList& list)
    {
        auto plugins = list.getPlugins();

        for (int i = 0; i < plugins.size(); ++i)
        {
            auto* p = plugins[i].get();

            if (dynamic_cast<te::VolumeAndPanPlugin*> (p) != nullptr
                 || dynamic_cast<te::LevelMeterPlugin*> (p) != nullptr
                 || dynamic_cast<LoudnessMeterPlugin*> (p) != nullptr)
                return i;
        }

        return plugins.size();
    }

    int absoluteIndexForInsert (te::PluginList& list, int index)
    {
        auto plugins = list.getPlugins();
        int seen = 0;

        if (index >= 0)
            for (int i = 0; i < plugins.size(); ++i)
                if (! isChannelStripPlugin (*plugins[i]))
                    if (seen++ == index)
                        return i;

        return anchorIndex (list);
    }

    std::optional<juce::PluginDescription> findExternal (te::Engine& engine, const String& id)
    {
        auto types = engine.getPluginManager().knownPluginList.getTypes();

        for (auto& d : types)
            if (d.createIdentifierString() == id || d.fileOrIdentifier == id)
                return d;

        for (auto& d : types)
            if (d.name.equalsIgnoreCase (id))
                return d;

        for (auto& d : types)
            if (d.name.containsIgnoreCase (id))
                return d;

        return std::nullopt;
    }

    te::PluginList* owningList (AppEngine& app, te::Plugin& p)
    {
        if (auto* t = p.getOwnerTrack())
            return &t->pluginList;

        if (app.edit().getMasterPluginList().indexOf (&p) >= 0)
            return &app.edit().getMasterPluginList();

        return nullptr;
    }

    juce::File chainsDir()
    {
        auto d = appDataDir().getChildFile ("Chains");
        d.createDirectory();
        return d;
    }
}

var builtInPluginCatalogue()
{
    juce::Array<var> list;

    for (auto& b : builtIns())
        list.add (Obj().set ("id", b.type).set ("name", b.name).set ("category", b.category)
                       .set ("vendor", b.type.startsWith ("airwindows") || b.name.startsWith ("AW ") ? "Airwindows" : "Studio 4000")
                       .set ("synth", b.synth).set ("format", "Built-in"));

    for (auto& i : instrumentCatalogue())
        list.add (Obj().set ("id", i.id).set ("name", i.name).set ("category", i.category)
                       .set ("vendor", "Studio 4000").set ("synth", true).set ("format", "Built-in"));

    return list;
}

te::Plugin::Ptr insertPlugin (AppEngine& app, te::PluginList& list, const String& typeOrId, int index)
{
    auto& edit = app.edit();
    te::Plugin::Ptr plugin = createInstrument (edit, typeOrId);

    for (auto& b : builtIns())
    {
        if (plugin == nullptr && b.type == typeOrId)
        {
            plugin = edit.getPluginCache().createNewPlugin (typeOrId, {});
            break;
        }
    }

    if (plugin == nullptr)
    {
        auto desc = findExternal (app.getEngine(), typeOrId);

        if (! desc)
            throw RpcError ("No plug-in called \"" + typeOrId + "\" is installed. Try plugins.list or plugins.scan.");

        plugin = edit.getPluginCache().createNewPlugin (te::ExternalPlugin::xmlTypeName, *desc);
    }

    if (plugin == nullptr)
        throw RpcError ("The plug-in could not be created");

    const bool synth = plugin->isSynth();
    list.insertPlugin (plugin, synth ? 0 : absoluteIndexForInsert (list, index), nullptr);

    if (list.indexOf (plugin.get()) < 0)
        throw RpcError ("This chain is full");

    return plugin;
}

void registerPluginApi (AppEngine& app)
{
    auto& rpc = app.rpc;

    rpc.add ("plugins.list", K::read, "Every available effect and instrument: built-ins and scanned VST plug-ins", "{query?}", [&app] (const var& p)
    {
        auto query = str (p, "query");
        juce::Array<var> list;
        const auto catalogue = builtInPluginCatalogue();

        for (auto& v : *catalogue.getArray())
            if (query.isEmpty() || v["name"].toString().containsIgnoreCase (query) || v["category"].toString().containsIgnoreCase (query))
                list.add (v);

        auto& kpl = app.getEngine().getPluginManager().knownPluginList;

        for (auto& d : kpl.getTypes())
            if (query.isEmpty() || d.name.containsIgnoreCase (query) || d.manufacturerName.containsIgnoreCase (query) || d.category.containsIgnoreCase (query))
                list.add (Obj().set ("id", d.createIdentifierString()).set ("name", d.name).set ("vendor", d.manufacturerName)
                               .set ("category", d.isInstrument ? String ("Instrument") : d.category.upToFirstOccurrenceOf ("|", false, false))
                               .set ("synth", d.isInstrument).set ("format", d.pluginFormatName).set ("version", d.version));

        juce::Array<var> blocked;

        for (auto& b : kpl.getBlacklistedFiles())
            blocked.add (b);

        juce::Array<var> studioFolders;
        int unhostableVst2 = 0;

        for (auto& dir : AppEngine::studioPluginFolders())
        {
            studioFolders.add (Obj().set ("path", dir.getFullPathName()).set ("exists", dir.isDirectory()));

            if (! AppEngine::canHostVst2 && dir.isDirectory())
                unhostableVst2 += dir.getNumberOfChildFiles (juce::File::findFiles, "*.dll");
        }

        return var (Obj().set ("plugins", list).set ("blocked", blocked).set ("scanning", app.isScanningPlugins())
                         .set ("vst3Paths", app.settings().getValue ("vst3Paths"))
                         .set ("studioFolders", studioFolders)
                         .set ("vst2", AppEngine::canHostVst2)
                         .set ("unhostableVst2", unhostableVst2));
    });

    rpc.add ("plugins.scan", K::read, "Scans the plug-in folders (VST3, and VST2 when available) in a separate process so crashing plug-ins can't take the app down", "{}",
             [&app] (const var&)
    {
        app.scanPlugins();
        return var (true);
    });

    rpc.add ("plugins.setPaths", K::read, "Extra plug-in folders, separated by semicolons", "{paths}", [&app] (const var& p)
    {
        app.settings().setValue ("vst3Paths", str (p, "paths"));
        app.settings().saveIfNeeded();
        return var (true);
    });

    rpc.add ("plugins.unblock", K::read, "Removes a plug-in file from the blocklist so it's scanned again", "{file}", [&app] (const var& p)
    {
        app.getEngine().getPluginManager().knownPluginList.removeFromBlacklist (reqStr (p, "file"));
        return var (true);
    });

    rpc.add ("plugins.block", K::read, "Blocks a plug-in so it is never loaded", "{id}", [&app] (const var& p)
    {
        auto& kpl = app.getEngine().getPluginManager().knownPluginList;

        if (auto d = findExternal (app.getEngine(), reqStr (p, "id")))
        {
            kpl.addToBlacklist (d->fileOrIdentifier);
            kpl.removeType (*d);
        }

        return var (true);
    });

    rpc.add ("plugin.add", K::write, "Inserts an effect or instrument on a track or the master, optionally setting parameters",
             "{trackId|'master', plugin, index?, params?: {paramId: value}}", [&app] (const var& p)
    {
        auto& list = pluginListFor (app, str (p, "trackId", "master"));
        auto plugin = insertPlugin (app, list, reqStr (p, "plugin"), integer (p, "index", -1));

        if (auto* values = p["params"].getDynamicObject())
            for (auto& v : values->getProperties())
                if (auto* param = plugin->getAutomatableParameterByID (v.name.toString()).get())
                    param->setParameter (param->valueRange.snapToLegalValue ((float) v.value), juce::sendNotification);

        return describePlugin (*plugin);
    });

    rpc.add ("plugin.remove", K::write, "Removes a plug-in", "{id}", [&app] (const var& p)
    {
        auto& plugin = app.plugin (reqStr (p, "id"));

        if (isChannelStripPlugin (plugin))
            throw RpcError ("That plug-in is part of the channel strip");

        plugin.deleteFromParent();
        return var (true);
    });

    rpc.add ("plugin.move", K::write, "Reorders a plug-in within its chain", "{id, index}", [&app] (const var& p)
    {
        te::Plugin::Ptr plugin = &app.plugin (reqStr (p, "id"));
        auto* list = owningList (app, *plugin);

        if (list == nullptr)
            throw RpcError ("Plug-in is not in a chain");

        // `index` is the plug-in's place among the non-strip plug-ins, counting itself.
        const int want = integer (p, "index", -1);
        const auto plugins = list->getPlugins();
        const int fromAbs = list->indexOf (plugin.get());

        if (fromAbs < 0)
            throw RpcError ("Plug-in is not in a chain");

        int visibleCount = 0;

        for (auto* item : plugins)
            if (! isChannelStripPlugin (*item))
                ++visibleCount;

        const int visibleTo = want < 0 ? visibleCount - 1 : juce::jlimit (0, juce::jmax (0, visibleCount - 1), want);
        int insertAbs = list->size();
        int seen = 0;

        for (int i = 0; i < plugins.size(); ++i)
        {
            if (plugins[i].get() == plugin.get())
                continue;

            if (isChannelStripPlugin (*plugins[i]))
            {
                if (seen >= visibleTo)
                {
                    insertAbs = i;
                    break;
                }
            }
            else if (seen++ == visibleTo)
            {
                insertAbs = i;
                break;
            }
        }

        if (insertAbs > fromAbs)
            --insertAbs;

        plugin->removeFromParent();
        list->insertPlugin (plugin, insertAbs, nullptr);
        return var (true);
    });

    rpc.add ("plugin.set", K::write, "Bypass a plug-in", "{id, enabled}", [&app] (const var& p)
    {
        app.plugin (reqStr (p, "id")).setEnabled (flag (p, "enabled", true));
        return var (true);
    });

    rpc.add ("plugin.setParam", K::write, "Sets a parameter by real value or normalised 0..1 value", "{id, paramId, value? | norm?}",
             [&app] (const var& p)
    {
        auto& plugin = app.plugin (reqStr (p, "id"));
        auto& param = app.parameter (plugin, reqStr (p, "paramId"));

        if (has (p, "norm"))
            param.setNormalisedParameter (juce::jlimit (0.0f, 1.0f, (float) num (p, "norm")), juce::sendNotification);
        else
            param.setParameter (param.valueRange.snapToLegalValue ((float) reqNum (p, "value")), juce::sendNotification);

        return describeParameter (param);
    });

    rpc.add ("plugin.setParams", K::write, "Sets several parameters at once by real value, as one undo step",
             "{id, values: {paramId: value}}", [&app] (const var& p)
    {
        auto& plugin = app.plugin (reqStr (p, "id"));
        juce::Array<var> changed;

        if (auto* o = p["values"].getDynamicObject())
            for (auto& prop : o->getProperties())
            {
                auto& param = app.parameter (plugin, prop.name.toString());
                param.setParameter (param.valueRange.snapToLegalValue ((float) static_cast<double> (prop.value)), juce::sendNotification);
                changed.add (describeParameter (param));
            }

        return var (changed);
    });

    rpc.add ("plugin.telemetry", K::read, "Live readings for a plug-in's editor: levels, optional spectra and stereo scope, "
             "plus effect-specific values such as gain reduction or detected pitch", "{id, spectrum?, scope?}", [&app] (const var& p)
    {
        auto& plugin = app.plugin (reqStr (p, "id"));

        if (auto* fx = dynamic_cast<StudioFxPlugin*> (&plugin))
            return fx->getTelemetry (flag (p, "spectrum", false), flag (p, "scope", false));

        if (auto* limiter = dynamic_cast<LimiterPlugin*> (&plugin))
            return var (Obj().set ("grDb", std::round (limiter->lastReductionDb.load() * 10.0f) / 10.0f));

        return var (Obj());
    });

    rpc.add ("plugin.params", K::read, "All parameters of a plug-in", "{id, query?}", [&app] (const var& p)
    {
        auto& plugin = app.plugin (reqStr (p, "id"));
        auto query = str (p, "query");
        juce::Array<var> list;

        for (auto* param : plugin.getAutomatableParameters())
            if (query.isEmpty() || param->getParameterName().containsIgnoreCase (query))
                list.add (describeParameter (*param));

        return var (list);
    });

    rpc.add ("plugin.get", K::read, "Describes one plug-in", "{id}", [&app] (const var& p)
    {
        return describePlugin (app.plugin (reqStr (p, "id")), 4096);
    });

    rpc.add ("plugin.openEditor", K::read, "Opens the plug-in's own window", "{id}", [&app] (const var& p)
    {
        auto& plugin = app.plugin (reqStr (p, "id"));

        if (dynamic_cast<te::ExternalPlugin*> (&plugin) == nullptr)
            return var (false);

        plugin.showWindowExplicitly();
        return var (true);
    });

    rpc.add ("plugin.closeEditor", K::read, "Closes the plug-in's window", "{id}", [&app] (const var& p)
    {
        app.plugin (reqStr (p, "id")).windowState->closeWindowExplicitly();
        return var (true);
    });

    rpc.add ("plugin.setSidechain", K::write, "Feeds another track into a plug-in's sidechain input (empty to clear)",
             "{id, sourceTrackId}", [&app] (const var& p)
    {
        auto& plugin = app.plugin (reqStr (p, "id"));

        if (! plugin.canSidechain())
            throw RpcError (plugin.getName() + " has no sidechain input");

        auto src = str (p, "sourceTrackId");
        plugin.setSidechainSourceID (src.isEmpty() ? te::EditItemID() : app.track (src).itemID);
        plugin.guessSidechainRouting();
        return var (true);
    });

    rpc.add ("chain.save", K::read, "Saves a track's insert chain as a reusable preset", "{trackId, name}", [&app] (const var& p)
    {
        auto& list = pluginListFor (app, str (p, "trackId", "master"));
        juce::ValueTree chain ("S3CHAIN");
        chain.setProperty ("name", reqStr (p, "name"), nullptr);

        for (auto* plugin : list)
        {
            if (isChannelStripPlugin (*plugin))
                continue;

            plugin->flushPluginStateToValueTree();
            chain.appendChild (plugin->state.createCopy(), nullptr);
        }

        auto f = chainsDir().getChildFile (juce::File::createLegalFileName (reqStr (p, "name")) + ".s3chain");

        if (auto xml = chain.createXml())
            xml->writeTo (f);

        return var (f.getFullPathName());
    });

    rpc.add ("chain.list", K::read, "Saved insert chain presets", "{}", [] (const var&)
    {
        juce::Array<var> list;

        for (auto& f : chainsDir().findChildFiles (juce::File::findFiles, false, "*.s3chain"))
            list.add (Obj().set ("name", f.getFileNameWithoutExtension()).set ("file", f.getFullPathName()));

        return var (list);
    });

    rpc.add ("chain.load", K::write, "Appends a saved chain to a track", "{trackId, name}", [&app] (const var& p)
    {
        auto& list = pluginListFor (app, str (p, "trackId", "master"));
        auto f = chainsDir().getChildFile (juce::File::createLegalFileName (reqStr (p, "name")) + ".s3chain");
        auto xml = juce::parseXML (f);

        if (xml == nullptr)
            throw RpcError ("Chain not found");

        auto chain = juce::ValueTree::fromXml (*xml);
        int added = 0;

        for (auto child : chain)
        {
            auto copy = child.createCopy();
            te::EditItemID::remapIDs (copy, nullptr, app.edit());

            if (auto plugin = app.edit().getPluginCache().createNewPlugin (copy))
            {
                list.insertPlugin (plugin, anchorIndex (list), nullptr);
                ++added;
            }
        }

        return var (added);
    });
}
}
