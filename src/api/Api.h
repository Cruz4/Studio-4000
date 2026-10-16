#pragma once

#include "../AppEngine.h"
#include "../ProjectState.h"

namespace s3
{
void registerAllApis (AppEngine&);

void registerProjectApi (AppEngine&);
void registerTransportApi (AppEngine&);
void registerTrackApi (AppEngine&);
void registerClipApi (AppEngine&);
void registerPluginApi (AppEngine&);
void registerAutomationApi (AppEngine&);
void registerExportApi (AppEngine&);
void registerSmartApi (AppEngine&);
void registerAiApi (AppEngine&);
void registerDeviceApi (AppEngine&);

//==============================================================================
/** Shared helpers used across API groups and templates. */
te::Track::Ptr createTrack (AppEngine&, const String& kind, const String& name,
                            te::Track* insertAfter = nullptr, te::FolderTrack* parent = nullptr, te::Track* insertBefore = nullptr);

/** Inserts a built-in plug-in by type name, or an external plug-in by identifier string or name. */
te::Plugin::Ptr insertPlugin (AppEngine&, te::PluginList&, const String& typeOrId, int index = -1);

/** Assigns the first free physical input of the right kind to a track. */
void assignDefaultInput (AppEngine&, te::AudioTrack&, bool midi);

te::PluginList& pluginListFor (AppEngine&, const String& trackIdOrMaster);

/** Creates an FX return track listening on a new aux bus and returns the bus number. */
int createReturnBus (AppEngine&, const String& name, const String& effectType,
                     te::Track* insertAfter = nullptr, te::Track* insertBefore = nullptr);

juce::Colour nextTrackColour (te::Edit&);

/** Built-in effects offered in the browser, with friendly names. */
var builtInPluginCatalogue();
}
