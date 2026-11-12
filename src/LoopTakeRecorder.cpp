#include "LoopTakeRecorder.h"
#include "AppEngine.h"

namespace s3
{
LoopTakeRecorder::LoopTakeRecorder (AppEngine& a) : app (a)
{
    enabled = app.settings().getBoolValue ("loopTakesEnabled", false);
    mutePrevious = app.settings().getBoolValue ("loopTakesMutePrevious", true);
    limit = juce::jlimit (0, 99, app.settings().getIntValue ("loopTakesLimit", 4));
}

LoopTakeRecorder::~LoopTakeRecorder() { lifetime.reset(); }

var LoopTakeRecorder::state() const
{
    return Obj().set ("enabled", enabled).set ("takeCount", limit).set ("mutePrevious", mutePrevious)
                .set ("active", active).set ("take", active ? current + 1 : 0)
                .set ("trackId", currentTrack());
}

var LoopTakeRecorder::configure (const var& p)
{
    if (active || (app.currentEdit() && app.edit().getTransport().isRecording()))
        throw RpcError ("Stop recording before changing loop-take settings");
    const int count = integer (p, "takeCount", limit);
    if (count < 0 || count > 99) throw RpcError ("Choose 1 to 99 takes, or 0 for Until I stop");
    enabled = flag (p, "enabled", enabled);
    mutePrevious = flag (p, "mutePrevious", mutePrevious);
    limit = count;
    app.settings().setValue ("loopTakesEnabled", enabled);
    app.settings().setValue ("loopTakesLimit", limit);
    app.settings().setValue ("loopTakesMutePrevious", mutePrevious);
    app.markProjectChanged();
    return state();
}

bool LoopTakeRecorder::hasTrack (const String& id) const
{
    return std::any_of (passes.begin(), passes.end(), [&] (const auto& p) { return p.track == id; });
}

String LoopTakeRecorder::currentTrack() const
{
    return active && current >= 0 && current < (int) passes.size() ? passes[(size_t) current].track : String();
}

juce::Array<te::EditItemID> LoopTakeRecorder::targets() const
{
    juce::Array<te::EditItemID> ids;
    if (active) for (auto& p : passes) ids.add (te::EditItemID::fromVar (p.track));
    return ids;
}

void LoopTakeRecorder::start()
{
    auto& edit = app.edit();
    auto& transport = edit.getTransport();
    auto range = transport.getLoopRange();
    if (range.getStart().inSeconds() < 0 || range.getLength().inSeconds() <= 2.0)
        throw RpcError ("Highlight a loop range longer than 2 seconds before recording loop takes");
    input = nullptr;
    int armed = 0;
    for (auto* in : edit.getAllInputDevices())
        for (auto target : in->getTargets())
            if (in->isRecordingEnabled (target))
            {
                ++armed; input = in; source = target.toString();
            }
    if (armed != 1 || input == nullptr || input->getInputDevice().isMidi()
        || dynamic_cast<te::AudioTrack*> (app.findTrack (source)) == nullptr)
        throw RpcError ("Arm one audio track with an audio input for loop-take recording");

    sourceName = app.track (source).getName();
    inputName = input->getInputDevice().getName();
    startTime = range.getStart().inSeconds(); length = range.getLength().inSeconds();
    savedPunch = edit.recordingPunchInOut.get();
    edit.recordingPunchInOut = false;
    transport.setPosition (range.getStart()); transport.looping = true;
    edit.getUndoManager().beginNewTransaction ("Record loop takes");
    passes.clear(); passes.push_back ({ source });
    current = 0; finishing = false; autoStop = false; ++generation;
    transport.record (false);
    if (! transport.isRecording())
    {
        edit.recordingPunchInOut = savedPunch;
        passes.clear(); input = nullptr;
        throw RpcError ("Could not start loop-take recording. Check the audio input.");
    }
    // Starting the transport can recreate its input instances. Resolve the live one again.
    input = nullptr;
    for (auto* candidate : edit.getAllInputDevices())
        if (candidate->getTargets().contains (te::EditItemID::fromVar (source)) && candidate->getInputDevice().getName() == inputName)
        { input = candidate; break; }
    if (input == nullptr) { transport.stop (false, true); edit.recordingPunchInOut = savedPunch; throw RpcError ("The recording input was disconnected"); }
    active = true;
    input->setRecordingTimelineStart (te::EditItemID::fromVar (source), range.getStart());
    scheduleEnd (0);
    try { if (limit != 1) prepareNext(); }
    catch (...) { transport.stop (false, true); finish(); throw; }
    app.markProjectChanged();
}

void LoopTakeRecorder::prepareNext()
{
    auto& edit = app.edit();
    auto& model = app.audioTrack (source);
    auto* previous = app.findTrack (passes.back().track);
    auto copy = edit.copyTrack (&model, te::TrackInsertPoint (*previous, false));
    auto* track = dynamic_cast<te::AudioTrack*> (copy.get());
    if (track == nullptr) throw RpcError ("Could not create the next take track");
    for (auto* c : track->getClips()) c->removeFromParent();
    track->setName (sourceName + " - Take " + String ((int) passes.size() + 1));
    const int index = (int) passes.size();
    passes.push_back ({ track->itemID.toString() });
    te::InputDeviceInstance::RecordingParameters params;
    params.targets = { track->itemID };
    params.punchRange = { seconds (startTime + index * length), te::TimeDuration::fromSeconds (length) };
    auto prepared = input->prepareToRecord (params);
    std::vector<std::unique_ptr<te::InputDeviceInstance::RecordingContext>> contexts;
    for (auto& result : prepared)
    {
        if (! result) throw RpcError (result.error());
        contexts.push_back (std::move (result.value()));
    }
    if (contexts.empty()) throw RpcError ("Could not prepare the next recording pass");
    input->startRecording (std::move (contexts));
    input->setRecordingTimelineStart (track->itemID, seconds (startTime));
    scheduleEnd (index);
    app.markProjectChanged();
}

void LoopTakeRecorder::scheduleEnd (int index)
{
    te::InputDeviceInstance::StopRecordingParameters params;
    params.targetsToStop = { te::EditItemID::fromVar (passes[(size_t) index].track) };
    params.unloopedTimeToEndRecording = seconds (startTime + (index + 1) * length);
    params.isLooping = false;
    params.markedRange = { seconds (startTime), te::TimeDuration::fromSeconds (length) };
    const int run = generation;
    std::weak_ptr<int> weak = lifetime;
    input->stopRecording (params, [this, weak, run, index] (auto result)
    {
        if (weak.expired() || run != generation || ! active || index >= (int) passes.size()) return;
        auto& pass = passes[(size_t) index];
        pass.completed = true;
        if (result)
            for (auto* clip : result.value())
            {
                clip->setName (sourceName + " - Take " + String (index + 1));
                clip->setMuted (mutePrevious && !(limit > 0 && index + 1 == limit));
                pass.clips.add (clip->itemID);
            }
        else
        {
            app.emit ("toast", Obj().set ("level", "error").set ("message", result.error()));
            autoStop = true;
        }
        if (limit > 0 && index + 1 >= limit) autoStop = true;
        app.markProjectChanged();
    });
}

void LoopTakeRecorder::poll()
{
    if (! active || finishing) return;
    auto& transport = app.edit().getTransport();
    if (! transport.isRecording()) { finish(); return; }
    if (autoStop) { transport.stop (false, true); finish(); return; }
    if (auto* context = transport.getCurrentPlaybackContext())
    {
        const int now = juce::jlimit (0, (int) passes.size() - 1,
            (int) std::floor ((context->getUnloopedPosition().inSeconds() - startTime) / length));
        if (now != current) { current = now; app.markProjectChanged(); }
        if ((int) passes.size() < current + 2 && (limit == 0 || (int) passes.size() < limit))
            try { prepareNext(); }
            catch (const std::exception& e)
            {
                app.emit ("toast", Obj().set ("level", "error").set ("message", String (e.what())));
                transport.stop (false, true); finish();
            }
    }
}

void LoopTakeRecorder::finish()
{
    if (! active || finishing || ! app.currentEdit()) return;
    finishing = true;
    auto& edit = app.edit();
    if (edit.getTransport().isRecording()) edit.getTransport().stop (false, true);
    // Stopping with clearDevices may release the old input instances.
    edit.getTransport().ensureContextAllocated();
    input = nullptr;
    for (auto* candidate : edit.getAllInputDevices())
        if (candidate->getInputDevice().getName() == inputName) { input = candidate; break; }
    int last = -1;
    for (int i = 0; i < (int) passes.size(); ++i)
        if (! passes[(size_t) i].clips.isEmpty()) last = i;
    for (int i = 0; i < (int) passes.size(); ++i)
    {
        auto& pass = passes[(size_t) i];
        for (auto id : pass.clips)
            if (auto* clip = te::findClipForID (edit, id)) clip->setMuted (mutePrevious && i != last);
        if (auto* track = app.findTrack (pass.track))
        {
            if (i > 0 && pass.clips.isEmpty()) { edit.deleteTrack (track); continue; }
            if (i > 0 && input != nullptr)
            {
                [[maybe_unused]] auto result = input->setTarget (track->itemID, false, nullptr);
                input->setRecordingEnabled (track->itemID, false);
            }
        }
    }
    edit.recordingPunchInOut = savedPunch;
    active = false; input = nullptr; finishing = false; ++generation;
    edit.getUndoManager().beginNewTransaction();
    app.markProjectChanged();
}

void LoopTakeRecorder::reset()
{
    finish();
    ++generation; active = false; input = nullptr; passes.clear();
}
}
