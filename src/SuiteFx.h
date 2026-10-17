#pragma once

#include "StudioFx.h"

namespace s3
{
/** Original Studio 4000 effects. Registered with the other built-in effects. */
void registerSuite (te::PluginManager&);

/** {type, display name, category} for the effects added here. */
std::vector<std::array<const char*, 3>> suiteEffectCatalogue();

/** {type, display name, category} for the playable instruments added here. */
std::vector<std::array<const char*, 3>> suiteSynthCatalogue();
}
