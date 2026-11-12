#pragma once
#include "StudioFx.h"
namespace s3
{
void registerVocalEffects (te::PluginManager&);
std::vector<std::array<const char*, 3>> vocalEffectCatalogue();
}
