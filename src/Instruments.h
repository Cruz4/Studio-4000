#pragma once

#include "Common.h"

namespace s3
{
struct InstrumentEntry
{
    String id, name, category;
};

/** Ready-to-play instruments: 4OSC synth presets and sampled kits generated on first use. */
const std::vector<InstrumentEntry>& instrumentCatalogue();

/** Creates the instrument for a catalogue id ("4osc:…" or "kit:…"), or nullptr if the id isn't one of ours. */
te::Plugin::Ptr createInstrument (te::Edit&, const String& id);

/** Writes the sample sets for the kits if they're missing. Cheap when they already exist. */
void ensureInstrumentSamples();

/** The name a plug-in should be shown under (presets keep the instrument name, not "4OSC"). */
String displayNameFor (te::Plugin&);
}
