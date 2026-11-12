#pragma once
#include "Common.h"
namespace s3
{
class AppEngine;
bool sumsToMono (const te::PluginList&);
void setSumToMono (AppEngine&, te::PluginList&, bool);
}
