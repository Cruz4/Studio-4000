#include "Api.h"

namespace s3
{
namespace
{
    using K = Rpc::Kind;

    te::AutomatableParameter& paramFor (AppEngine& app, const var& p)
    {
        return app.parameter (app.plugin (reqStr (p, "pluginId")), reqStr (p, "paramId"));
    }

    float valueFromParams (te::AutomatableParameter& param, const var& p)
    {
        if (has (p, "norm"))
            return param.valueRange.convertFrom0to1 (juce::jlimit (0.0f, 1.0f, (float) num (p, "norm")));

        if (has (p, "db") && param.paramID == "volume")
            return te::decibelsToVolumeFaderPosition ((float) num (p, "db"));

        return param.valueRange.snapToLegalValue ((float) reqNum (p, "value"));
    }
}

void registerAutomationApi (AppEngine& app)
{
    auto& rpc = app.rpc;

    rpc.add ("automation.addPoint", K::write, "Adds an automation point. For track volume use db",
             "{pluginId, paramId, time, value | norm | db, curve?}", [&app] (const var& p)
    {
        auto& param = paramFor (app, p);
        param.getCurve().addPoint (seconds (reqNum (p, "time")), valueFromParams (param, p),
                                   (float) juce::jlimit (-1.0, 1.0, num (p, "curve", 0.0)), &app.edit().getUndoManager());
        return var (param.getCurve().getNumPoints());
    });

    rpc.add ("automation.setPoints", K::write, "Replaces a lane with points [[time, value, curve?]]", "{pluginId, paramId, points}",
             [&app] (const var& p)
    {
        auto& param = paramFor (app, p);
        auto& curve = param.getCurve();
        auto* um = &app.edit().getUndoManager();
        curve.clear (um);

        if (auto* points = p["points"].getArray())
            for (auto& pt : *points)
                curve.addPoint (seconds ((double) pt[0]), param.valueRange.snapToLegalValue ((float) pt[1]),
                                pt.size() > 2 ? (float) pt[2] : 0.0f, um);

        return var (curve.getNumPoints());
    });

    rpc.add ("automation.movePoint", K::write, "Moves a point", "{pluginId, paramId, index, time, value | norm}", [&app] (const var& p)
    {
        auto& param = paramFor (app, p);
        auto& curve = param.getCurve();
        const int index = integer (p, "index", -1);

        if (index < 0 || index >= curve.getNumPoints())
            throw RpcError ("Invalid point index");

        const auto curveShape = curve.getPointCurve (index);
        curve.removePoint (index, &app.edit().getUndoManager());
        curve.addPoint (seconds (reqNum (p, "time")), valueFromParams (param, p), curveShape, &app.edit().getUndoManager());
        return var (true);
    });

    rpc.add ("automation.removePoint", K::write, "Deletes a point", "{pluginId, paramId, index}", [&app] (const var& p)
    {
        auto& curve = paramFor (app, p).getCurve();
        const int index = integer (p, "index", -1);

        if (index < 0 || index >= curve.getNumPoints())
            throw RpcError ("Invalid point index");

        curve.removePoint (index, &app.edit().getUndoManager());
        return var (true);
    });

    rpc.add ("automation.clear", K::write, "Clears a lane, or a time range of it", "{pluginId, paramId, start?, end?}", [&app] (const var& p)
    {
        auto& curve = paramFor (app, p).getCurve();
        auto* um = &app.edit().getUndoManager();

        if (has (p, "start") && has (p, "end"))
            curve.removePoints (te::TimeRange (seconds (num (p, "start")), seconds (num (p, "end"))), um);
        else
            curve.clear (um);

        return var (true);
    });

    rpc.add ("automation.setGlobal", K::read, "Global automation read and write switches", "{read?, write?}", [&app] (const var& p)
    {
        auto& arm = app.edit().getAutomationRecordManager();

        if (has (p, "read"))   arm.setReadingAutomation (flag (p, "read"));
        if (has (p, "write"))  arm.setWritingAutomation (flag (p, "write"));

        return var (Obj().set ("read", arm.isReadingAutomation()).set ("write", arm.isWritingAutomation()));
    });

    rpc.add ("automation.gesture", K::read, "Begin or end a live control gesture so touch/latch modes record it",
             "{pluginId, paramId, phase: begin|end}", [&app] (const var& p)
    {
        auto& param = paramFor (app, p);

        if (str (p, "phase") == "begin")
            param.parameterChangeGestureBegin();
        else
            param.parameterChangeGestureEnd();

        return var (true);
    });
}
}
