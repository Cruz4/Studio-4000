#include "MonoSum.h"
#include "AppEngine.h"
#include "LoudnessMeterPlugin.h"

namespace s3
{
bool sumsToMono (const te::PluginList& list)
{
    for (auto* effect : list) if ((bool) effect->state["s4sumToMono"]) return effect->isEnabled();
    return false;
}

void setSumToMono (AppEngine& app, te::PluginList& list, bool enabled)
{
    te::Plugin::Ptr mono;
    for (auto* effect : list) if ((bool) effect->state["s4sumToMono"]) { mono = effect; break; }
    if (mono == nullptr)
    {
        if (! enabled) return;
        mono = app.edit().getPluginCache().createNewPlugin ("s4000utility", {});
        if (mono == nullptr) throw RpcError ("Could not create the mono check");
        mono->state.setProperty ("s4sumToMono", true, nullptr);
        if (auto param = mono->getAutomatableParameterByID ("mono")) param->setParameter (1, juce::sendNotification);
        // Sum after inserts and the fader/pan, ahead of the output meters.
        int index = 0;
        for (auto* effect : list)
        {
            if (dynamic_cast<te::LevelMeterPlugin*> (effect) != nullptr || dynamic_cast<LoudnessMeterPlugin*> (effect) != nullptr) break;
            ++index;
        }
        list.insertPlugin (mono, index, nullptr);
    }
    mono->setEnabled (enabled);
    app.markProjectChanged();
}
}
