// Modified for the recording and device fixes: audio round-trip tests without physical hardware.
#include "RecordingSelfTest.h"
#include "ProjectState.h"
#include "LoopTakeRecorder.h"
#include <atomic>
#include <iterator>
#include <set>

namespace s3
{
namespace
{
    constexpr const char* deviceName = "Studio loopback test";
    struct Scenario { double rate; int block; double extraMs; double correctionMs; bool immediateChange = false; };
    constexpr Scenario scenarios[] {
        { 48000.0, 128, 0.0, 0.0 },
        { 44100.0, 512, 0.0, 0.0 },
        { 48000.0, 256, 20.0, 20.0 },
        { 48000.0, 512, 0.0, 0.0, true }
    };

    // A real callback stream with a known output-to-input delay. Never opens a physical device.
    class LoopbackDevice : public juce::AudioIODevice, private juce::Thread
    {
    public:
        LoopbackDevice() : AudioIODevice (deviceName, deviceName), Thread ("Recording loopback") {}
        ~LoopbackDevice() override { close(); }

        juce::StringArray getOutputChannelNames() override { return { "Output L", "Output R" }; }
        juce::StringArray getInputChannelNames() override { return { "Input L", "Input R" }; }
        juce::Array<double> getAvailableSampleRates() override { return { 44100.0, 48000.0 }; }
        juce::Array<int> getAvailableBufferSizes() override { return { 128, 256, 512 }; }
        int getDefaultBufferSize() override { return 128; }

        String open (const juce::BigInteger& in, const juce::BigInteger& out, double sr, int size) override
        {
            close();
            inputs = in;
            outputs = out;
            rate = sr > 0 ? sr : 48000.0;
            block = size > 0 ? size : 128;
            opened = true;
            return {};
        }
        void close() override { stop(); opened = false; }
        bool isOpen() override { return opened; }
        void start (juce::AudioIODeviceCallback* cb) override
        {
            stop();
            if (cb == nullptr) return;
            callback = cb;
            callback->audioDeviceAboutToStart (this);
            startThread();
        }
        void stop() override
        {
            signalThreadShouldExit();
            stopThread (5000);
            if (callback != nullptr) callback->audioDeviceStopped();
            callback = nullptr;
        }
        bool isPlaying() override { return isThreadRunning(); }
        String getLastError() override { return {}; }
        int getCurrentBufferSizeSamples() override { return block; }
        double getCurrentSampleRate() override { return rate; }
        int getCurrentBitDepth() override { return 32; }
        juce::BigInteger getActiveOutputChannels() const override { return outputs; }
        juce::BigInteger getActiveInputChannels() const override { return inputs; }
        int getOutputLatencyInSamples() override { return block * 3; }
        int getInputLatencyInSamples() override { return block * 2; }

        static inline std::atomic<double> extraMs { 0.0 };
        static inline std::atomic<int> probeSerial { 0 };
        static inline std::atomic<double> firstOutputMs { -1.0 };

    private:
        bool opened = false;
        int block = 128;
        double rate = 48000.0;
        juce::BigInteger inputs, outputs;
        juce::AudioIODeviceCallback* callback = nullptr;

        void run() override
        {
            const int delay = block * 5 + (int) std::llround (extraMs.load() * rate / 1000.0);
            juce::AudioBuffer<float> ring (2, delay), input (2, block), output (2, block);
            ring.clear();
            int cursor = 0, serial = -1;
            juce::int64 probeSamples = 0;
            auto next = juce::Time::getMillisecondCounterHiRes();
            while (! threadShouldExit())
            {
                const int currentSerial = probeSerial.load();
                if (currentSerial != serial)
                {
                    serial = currentSerial;
                    probeSamples = 0;
                    firstOutputMs = -1.0;
                }
                for (int ch = 0; ch < 2; ++ch)
                    for (int i = 0; i < block; ++i)
                        input.setSample (ch, i, ch == 0 ? ring.getSample (ch, (cursor + i) % delay) : 0.25f);
                output.clear();
                callback->audioDeviceIOCallbackWithContext (input.getArrayOfReadPointers(), 2,
                                                           output.getArrayOfWritePointers(), 2, block, {});
                if (firstOutputMs.load() < 0)
                    for (int i = 0; i < block; ++i)
                        if (std::abs (output.getSample (0, i)) > 0.1f)
                        {
                            firstOutputMs = (probeSamples + i) * 1000.0 / rate;
                            break;
                        }
                probeSamples += block;
                for (int ch = 0; ch < 2; ++ch)
                    for (int i = 0; i < block; ++i)
                        ring.setSample (ch, (cursor + i) % delay, output.getSample (ch, i));
                cursor = (cursor + block) % delay;
                next += 1000.0 * block / rate;
                const auto waitMs = next - juce::Time::getMillisecondCounterHiRes();
                if (waitMs >= 1.0) wait ((int) waitMs);
            }
        }
    };

    class LoopbackType : public juce::AudioIODeviceType
    {
    public:
        LoopbackType() : AudioIODeviceType (deviceName) {}
        void scanForDevices() override {}
        juce::StringArray getDeviceNames (bool) const override { return { deviceName }; }
        int getDefaultDeviceIndex (bool) const override { return 0; }
        int getIndexOfDevice (juce::AudioIODevice*, bool) const override { return 0; }
        bool hasSeparateInputsAndOutputs() const override { return false; }
        juce::AudioIODevice* createDevice (const String&, const String&) override { return new LoopbackDevice(); }
    };

    std::vector<float> writePulses (const juce::File& file, double sr)
    {
        juce::AudioBuffer<float> buffer (2, (int) (4 * sr));
        buffer.clear();
        for (double t : { 1.25, 1.5, 2.0, 2.5 })
            for (int ch = 0; ch < 2; ++ch)
                for (int i = 0; i < (t == 1.25 ? 128 : 16); ++i)
                    buffer.setSample (ch, (int) std::llround (t * sr) + i, 0.5f);
        juce::WavAudioFormat format;
        auto stream = file.createOutputStream();
        auto writer = std::unique_ptr<juce::AudioFormatWriter> (format.createWriterFor (stream.get(), sr, 2, 24, {}, 0));
        if (writer == nullptr) throw RpcError ("Could not write loopback fixture");
        stream.release();
        if (! writer->writeFromAudioSampleBuffer (buffer, 0, buffer.getNumSamples()))
            throw RpcError ("Could not finish loopback fixture");
        std::vector<float> interleaved ((size_t) buffer.getNumSamples() * 2);
        for (int i = 0; i < buffer.getNumSamples(); ++i)
            for (int ch = 0; ch < 2; ++ch)
                interleaved[(size_t) i * 2 + ch] = buffer.getSample (ch, i);
        return interleaved;
    }
}

RecordingSelfTest::RecordingSelfTest (AppEngine& a, std::function<void (int)> done)
    : app (a), finished (std::move (done))
{
    workDir = juce::File::getSpecialLocation (juce::File::tempDirectory)
                  .getNonexistentChildFile ("Studio4000 recording test", "", false);
    workDir.createDirectory();
    auto& dm = app.getEngine().getDeviceManager().deviceManager;
    dm.closeAudioDevice();
    dm.addAudioDeviceType (std::make_unique<LoopbackType>());
    dm.setCurrentAudioDeviceType (deviceName, false);
    started = juce::Time::getMillisecondCounter();
    startTimer (50);
}

RecordingSelfTest::~RecordingSelfTest()
{
    stopTimer();
    app.sendEvent = nullptr;
    if (auto* e = app.currentEdit()) e->getTransport().stop (false, true);
    app.getEngine().getDeviceManager().deviceManager.closeAudioDevice();
    for (const auto& source : sourceBuffers)
        app.getEngine().getAudioFileManager().unregisterMemoryBuffer (source.first);
}

var RecordingSelfTest::call (const String& method, const var& params)
{
    return app.rpc.invoke (method, params, "selftest");
}

void RecordingSelfTest::check (const String& name, bool ok, const String& detail)
{
    if (! ok) ++failures;
    std::cout << (ok ? "[ ok ] " : "[FAIL] ") << name << " " << detail << std::endl;
}

void RecordingSelfTest::beginScenario()
{
    call ("recording.loopTakes.configure", Obj().set ("enabled", false));
    const auto s = scenarios[scenario];
    auto& tdm = app.getEngine().getDeviceManager();
    auto& dm = tdm.deviceManager;
    LoopbackDevice::extraMs = s.extraMs;
    auto setup = dm.getAudioDeviceSetup();
    dm.closeAudioDevice();
    setup.inputDeviceName = setup.outputDeviceName = deviceName;
    setup.sampleRate = s.rate;
    setup.bufferSize = s.immediateChange ? 128 : s.block;
    setup.useDefaultInputChannels = setup.useDefaultOutputChannels = false;
    setup.inputChannels.setRange (0, 2, true);
    setup.outputChannels.setRange (0, 2, true);
    const auto error = dm.setAudioDeviceSetup (setup, true);
    if (error.isNotEmpty()) throw RpcError (error);
    if (dynamic_cast<LoopbackDevice*> (dm.getCurrentAudioDevice()) == nullptr)
        throw RpcError ("Loopback device was not selected");

    auto dir = workDir.getChildFile (String (scenario));
    dir.createDirectory();
    call ("project.new", Obj().set ("dir", dir.getFullPathName()).set ("name", "Loopback").set ("template", "empty"));
    const auto file = app.getAudioDir().getChildFile ("pulses.wav");
    sourceBuffers.emplace_back (file.getFullPathName().toStdString(), writePulses (file, s.rate));
    const auto& source = sourceBuffers.back();
    // Use the engine's memory-reader fixture path, so capture timing is independent of disk read-ahead.
    app.getEngine().getAudioFileManager().registerMemoryBuffer (
        source.first, choc::buffer::createInterleavedView (static_cast<const float*> (source.second.data()),
                                                        2, source.second.size() / 2), s.rate);
    auto playback = call ("track.add", Obj().set ("kind", "audio").set ("name", "Pulse source"))[0].toString();
    auto sourceClip = call ("clip.importAudio", Obj().set ("trackId", playback).set ("file", file.getFullPathName()).set ("start", 0.0)).toString();
    if (auto* wave = dynamic_cast<te::WaveAudioClip*> (&app.clip (sourceClip)))
        wave->setUsesProxy (false);
    recordTrack = call ("track.add", Obj().set ("kind", "audio").set ("name", "Recorded pulses"))[0].toString();
    // Prime the disk-backed source before the clock test; missing disk-cache data is not an input offset.
    call ("transport.setPosition", Obj().set ("time", 1.25));
    started = juce::Time::getMillisecondCounter();
}

void RecordingSelfTest::enableInput()
{
    auto& tdm = app.getEngine().getDeviceManager();
    // The fixture uses independent left pulses and right microphone data.
    // Do not inherit persisted mono grouping, gain or trigger thresholds.
    tdm.setAllWaveInputsToNumChannels (2);
    tdm.dispatchPendingUpdates();
    te::WaveInputDevice* input = nullptr;
    for (int i = 0; i < tdm.getNumWaveInDevices(); ++i)
        if (auto* w = tdm.getWaveInDevice (i); w != nullptr && ! w->isTrackDevice() && w->getChannels().getNumChannels() == 2)
        {
            input = w;
            break;
        }
    if (input == nullptr) throw RpcError ("No loopback input");
    inputName = input->getName();
    input->setRecordTriggerDb (-50);
    input->setInputGainDb (0);
    input->setEnabled (true);
    started = juce::Time::getMillisecondCounter();
}

void RecordingSelfTest::beginRecording()
{
    if (scenarios[scenario].immediateChange)
        call ("devices.set", Obj().set ("bufferSize", scenarios[scenario].block));
    call ("devices.setInput", Obj().set ("name", inputName)
                                  .set ("recordAdjustmentMs", scenarios[scenario].correctionMs));
    call ("track.setInput", Obj().set ("id", recordTrack).set ("input", inputName));
    call ("track.setMonitor", Obj().set ("id", recordTrack).set ("mode", "off"));
    call ("track.arm", Obj().set ("id", recordTrack).set ("armed", true));
    call ("transport.setLoop", Obj().set ("start", 0.0).set ("end", 0.0));
    call ("transport.setCountIn", Obj().set ("mode", "none"));
    call ("transport.setClick", Obj().set ("enabled", false));
    call ("transport.setPosition", Obj().set ("time", 1.25));
    sawPreview = false; stablePreview = true; previewRate = 0; previousPeaks.clear();
    app.sendEvent = [this] (const String& type, const var& payload)
    {
        if (type == "toast")
            std::cout << "Engine message: " << juce::JSON::toString (payload, true) << std::endl;
        if (type != "recordings") return;
        if (auto* previews = payload.getArray())
            for (auto& preview : *previews)
                if (preview["trackId"].toString() == recordTrack && (double) preview["length"] > 1.0)
                    if (auto* peaks = preview["data"].getArray())
                    {
                        const int strideNow = juce::jmax (1, (int) preview["channels"]) * 2;
                        const double rateNow = (double) preview["binsPerSecond"];
                        if (previewRate != 0) stablePreview = stablePreview && previewRate == rateNow;
                        previewRate = rateNow;
                        const int completed = juce::jmax (0, (int) previousPeaks.size() - strideNow);
                        for (int i = 0; i < juce::jmin (completed, peaks->size()); ++i)
                            stablePreview = stablePreview && previousPeaks[(size_t) i] == (int) (*peaks)[i];
                        previousPeaks.clear();
                        for (auto& value : *peaks) previousPeaks.push_back ((int) value);
                        // Check an old LEFT-channel transient, after later buffers have arrived.
                        // The independent right-channel mic signal must not satisfy this check.
                        const int stride = juce::jmax (1, (int) preview["channels"]) * 2;
                        const double binsPerSecond = (double) preview["binsPerSecond"];
                        const int begin = juce::jmax (0, (int) std::floor (0.23 * binsPerSecond));
                        const int end = juce::jmin (peaks->size() / stride, (int) std::ceil (0.29 * binsPerSecond));
                        for (int bin = begin; bin < end; ++bin)
                            sawPreview = sawPreview || std::abs ((int) (*peaks)[bin * stride]) > 5
                                                    || std::abs ((int) (*peaks)[bin * stride + 1]) > 5;
                    }
    };
    ++LoopbackDevice::probeSerial;
    call ("transport.record");
    check ("transport enters recording", app.edit().getTransport().isRecording());
    recordingFile = {};
    for (auto* input : app.edit().getAllInputDevices())
        for (auto target : input->getTargets())
            if (target.toString() == recordTrack)
            {
                const auto file = input->getRecordingFile (target);
                if (file != juce::File()) recordingFile = file.getFullPathName();
                std::cout << "Input " << input->getInputDevice().getName()
                          << " armed=" << input->isRecordingEnabled (target)
                          << " recording=" << input->isRecording (target)
                          << " file=" << file.getFullPathName() << std::endl;
            }
    auto attempt = app.rpc.call ("devices.set", Obj().set ("bufferSize", 512), "selftest");
    check ("device settings stay fixed during recording", ! (bool) attempt["ok"]);
    started = juce::Time::getMillisecondCounter();
}

void RecordingSelfTest::inspectRecording()
{
    std::cout << "First rendered source pulse after test arm: " << LoopbackDevice::firstOutputMs.load() << " ms" << std::endl;
    auto& at = app.audioTrack (recordTrack);
    check ("recording creates a clip", at.getClips().size() == 1,
           "clips=" + String (at.getClips().size()) + " file=" + recordingFile);
    if (recordingFile.isNotEmpty())
        std::cout << "Recorded file size: " << juce::File (recordingFile).getSize() << std::endl;
    if (at.getClips().size() != 1) return;
    auto* clip = dynamic_cast<te::WaveAudioClip*> (at.getClips()[0]);
    if (clip == nullptr) throw RpcError ("Recording is not an audio clip");
    const auto pos = clip->getPosition();
    std::cout << "Captured timeline " << pos.getStart().inSeconds() << " to " << pos.getEnd().inSeconds() << std::endl;
    auto reader = app.getEngine().getAudioFileFormatManager().readFormatManager
                      .createReaderFor (clip->getCurrentSourceFile());
    std::unique_ptr<juce::AudioFormatReader> owned (reader);
    if (reader == nullptr) throw RpcError ("Cannot read the recorded file");
    juce::AudioBuffer<float> buffer (2, (int) reader->lengthInSamples);
    reader->read (&buffer, 0, buffer.getNumSamples(), 0, true, true);
    // Check the first captured samples using an independent continuous microphone signal.
    // A backing clip's seek/start-up transient is a separate playback behavior.
    bool firstSamples = reader->numChannels >= 2 && buffer.getNumSamples() >= 128;
    for (int i = 0; i < juce::jmin (128, buffer.getNumSamples()); ++i)
        firstSamples = firstSamples && std::abs (buffer.getSample (1, i) - 0.25f) < 0.001f;
    check ("first microphone samples are preserved", firstSamples);
    for (double expected : { 1.5, 2.0, 2.5 })
    {
        const double sourceTime = expected - pos.getStart().inSeconds() + pos.getOffset().inSeconds();
        const int centre = (int) std::llround (sourceTime * reader->sampleRate);
        int first = -1;
        const int radius = (int) (0.1 * reader->sampleRate);
        for (int i = juce::jmax (0, centre - radius); i < juce::jmin (buffer.getNumSamples(), centre + radius); ++i)
            if (std::abs (buffer.getSample (0, i)) > 0.1f) { first = i; break; }
        const double errorMs = first < 0 ? 9999.0 : (first - centre) * 1000.0 / reader->sampleRate;
        check ("pulse at " + String (expected) + "s is aligned", std::abs (errorMs) < 2.0, String (errorMs, 3) + " ms");
    }
    check ("earlier waveform peaks remain visible before stopping", sawPreview);
    check ("completed recording waveform bins never pulse or shift", stablePreview && previousPeaks.size() > 10);
    std::cout << "Scenario " << scenario << ": " << reader->sampleRate << " Hz, "
              << scenarios[scenario].block << " samples" << std::endl;
}

void RecordingSelfTest::beginLoopScenario()
{
    std::cout << "Begin loop scenario " << loopScenario << std::endl;
    auto dir = workDir.getChildFile ("loop-" + String (loopScenario));
    dir.createDirectory();
    call ("project.new", Obj().set ("dir", dir.getFullPathName()).set ("name", "Loop takes").set ("template", "empty"));
    std::cout << "Loop project created" << std::endl;
    const auto file = app.getAudioDir().getChildFile ("loop-pulses.wav");
    sourceBuffers.emplace_back (file.getFullPathName().toStdString(), writePulses (file, 48000.0));
    const auto& source = sourceBuffers.back();
    app.getEngine().getAudioFileManager().registerMemoryBuffer (source.first,
        choc::buffer::createInterleavedView (static_cast<const float*> (source.second.data()), 2, source.second.size() / 2), 48000.0);
    auto backing = call ("track.add", Obj().set ("kind", "audio").set ("name", "Backing"))[0].toString();
    auto id = call ("clip.importAudio", Obj().set ("trackId", backing).set ("file", file.getFullPathName()).set ("start", 0.0)).toString();
    dynamic_cast<te::WaveAudioClip&> (app.clip (id)).setUsesProxy (false);
    recordTrack = call ("track.add", Obj().set ("kind", "audio").set ("name", "Loop Vocal").set ("channels", loopScenario == 1 ? 1 : 2))[0].toString();
    call ("track.setInput", Obj().set ("id", recordTrack).set ("input", inputName));
    call ("track.setMonitor", Obj().set ("id", recordTrack).set ("mode", "off"));
    call ("track.set", Obj().set ("id", recordTrack).set ("volumeDb", -3.0).set ("pan", -.2));
    auto effect = call ("plugin.add", Obj().set ("trackId", recordTrack).set ("plugin", "s4000comp"))["id"].toString();
    call ("plugin.setParam", Obj().set ("id", effect).set ("paramId", "ratio").set ("value", 2.5));
    call ("track.arm", Obj().set ("id", recordTrack).set ("armed", true));
    call ("transport.setCountIn", Obj().set ("mode", "none"));
    call ("transport.setClick", Obj().set ("enabled", false));
    call ("transport.setLoop", Obj().set ("start", .5).set ("end", 3.5).set ("enabled", true));
    call ("recording.loopTakes.configure", Obj().set ("enabled", true).set ("takeCount", loopScenario == 0 ? 3 : loopScenario == 1 ? 0 : 1).set ("mutePrevious", loopScenario != 1));
    std::cout << "Loop inputs and range configured" << std::endl;
    sawPreview = false;
    app.sendEvent = [this] (const String& type, const var& payload)
    {
        if (type == "recordings") if (auto* list = payload.getArray())
            for (auto& p : *list) if (p["trackId"].toString() != recordTrack && (double) p["length"] > .2) sawPreview = true;
        if (type == "toast") std::cout << "Loop message: " << juce::JSON::toString (payload, true) << std::endl;
    };
    call ("transport.record");
    check ("loop takes enter recording", app.edit().getTransport().isRecording());
    started = juce::Time::getMillisecondCounter();
}

void RecordingSelfTest::inspectLoopScenario()
{
    const int expected = loopScenario == 0 ? 3 : loopScenario == 1 ? 2 : 1;
    auto snapshot = call ("project.get");
    auto* tracks = snapshot["tracks"].getArray();
    int takes = 0;
    std::set<String> files, pluginIDs;
    if (tracks) for (auto& track : *tracks)
    {
        if (! track["name"].toString().startsWith ("Loop Vocal")) continue;
        ++takes;
        check ("loop track retains channel format", (int) track["channels"] == (loopScenario == 1 ? 1 : 2));
        check ("loop track retains mixer and input setup", std::abs ((double) track["volumeDb"] + 3) < .01 && std::abs ((double) track["pan"] + .2) < .01 && track["input"].toString() == inputName && track["monitor"].toString() == "off");
        auto* plugins = track["plugins"].getArray();
        check ("loop track retains its compressor", plugins && plugins->size() == 1 && (*plugins)[0]["type"].toString() == "s4000comp");
        if (plugins && ! plugins->isEmpty()) pluginIDs.insert ((*plugins)[0]["id"].toString());
        auto* clips = track["clips"].getArray();
        check ("one separate clip per take track", clips && clips->size() == 1);
        if (! clips || clips->size() != 1) continue;
        const auto clip = (*clips)[0];
        check ("loop take begins at the selected range", std::abs ((double) clip["start"] - .5) < 1.0 / 48000);
        const double duration = (double) clip["end"] - (double) clip["start"];
        check ("loop take stays within the selected range", duration > .1 && duration <= 3.0001, String (duration, 6));
        if (loopScenario != 1 || takes == 1) check ("completed loop take has the exact range length", std::abs (duration - 3.0) < .002, String (duration, 6));
        check ("previous take mute policy is respected", (bool) clip["muted"] == (loopScenario != 1 && takes < expected));
        files.insert (clip["file"].toString());
        auto reader = std::unique_ptr<juce::AudioFormatReader> (app.getEngine().getAudioFileFormatManager().readFormatManager.createReaderFor (juce::File (clip["file"].toString())));
        bool captured = reader && reader->lengthInSamples > 1000;
        if (captured && reader->numChannels >= 2)
        {
            juce::AudioBuffer<float> samples (2, 128);
            reader->read (&samples, 0, 128, 0, true, true);
            for (int i = 0; i < 128; ++i) captured = captured && std::abs (samples.getSample (1, i) - .25f) < .001;
        }
        check ("each scheduled pass preserves its first microphone samples", captured);
    }
    check ("loop take count and empty-track cleanup", takes == expected, String (takes));
    check ("loop takes have independent files and effects", (int) files.size() == expected && (int) pluginIDs.size() == expected);
    check ("live preview follows the new take track", expected == 1 || sawPreview);
    check ("loop take recording stops cleanly", ! app.edit().getTransport().isRecording() && ! app.loopTakes().isActive());
    call ("recording.loopTakes.configure", Obj().set ("enabled", false));
}

void RecordingSelfTest::beginBusScenario()
{
    auto dir = workDir.getChildFile ("bus-meters"); dir.createDirectory();
    call ("project.new", Obj().set ("dir", dir.getFullPathName()).set ("name", "Bus meters").set ("template", "empty"));
    auto file = app.getAudioDir().getChildFile ("meter-tone.wav");
    juce::AudioBuffer<float> tone (2, 96000);
    std::vector<float> interleaved (192000);
    for (int i = 0; i < 96000; ++i)
        for (int ch = 0; ch < 2; ++ch)
        {
            const float value = .1f * std::sin ((float) (juce::MathConstants<double>::twoPi * 220 * i / 48000.0));
            tone.setSample (ch, i, value); interleaved[(size_t) i * 2 + ch] = value;
        }
    {
        juce::WavAudioFormat format;
        std::unique_ptr<juce::OutputStream> stream (file.createOutputStream().release());
        auto writer = format.createWriterFor (stream, juce::AudioFormatWriterOptions{}.withSampleRate (48000).withNumChannels (2).withBitsPerSample (24));
        if (writer == nullptr || ! writer->writeFromAudioSampleBuffer (tone, 0, 96000)) throw RpcError ("Could not write bus-meter fixture");
    }
    sourceBuffers.emplace_back (file.getFullPathName().toStdString(), std::move (interleaved));
    auto& memory = sourceBuffers.back();
    app.getEngine().getAudioFileManager().registerMemoryBuffer (memory.first,
        choc::buffer::createInterleavedView (static_cast<const float*> (memory.second.data()), 2, 96000), 48000.0);
    outerBus = call ("track.add", Obj().set ("kind", "group").set ("name", "Outer bus"))[0].toString();
    innerBus = call ("track.add", Obj().set ("kind", "group").set ("name", "Inner bus").set ("parentId", outerBus))[0].toString();
    for (int i = 0; i < 2; ++i)
    {
        auto track = call ("track.add", Obj().set ("kind", "audio").set ("name", "Tone " + String (i + 1)).set ("parentId", innerBus))[0].toString();
        auto clip = call ("clip.importAudio", Obj().set ("trackId", track).set ("file", file.getFullPathName()).set ("start", 0)).toString();
        dynamic_cast<te::WaveAudioClip&> (app.clip (clip)).setUsesProxy (false);
    }
    call ("track.set", Obj().set ("id", innerBus).set ("volumeDb", -6));
    call ("track.set", Obj().set ("id", outerBus).set ("volumeDb", -6));
    call ("transport.setLooping", Obj().set ("enabled", false));
    call ("transport.setClick", Obj().set ("enabled", false));
    app.sendEvent = [this] (const String& type, const var& payload)
    {
        if (type != "tick") return;
        for (int ch = 0; ch < 2; ++ch)
        {
            if (auto* levels = payload["meters"][juce::Identifier (innerBus)].getArray(); levels && levels->size() > ch)
                innerBusPeak[ch] = std::max (innerBusPeak[ch], (float) (double) (*levels)[ch]);
            if (auto* levels = payload["meters"][juce::Identifier (outerBus)].getArray(); levels && levels->size() > ch)
                outerBusPeak[ch] = std::max (outerBusPeak[ch], (float) (double) (*levels)[ch]);
        }
    };
    call ("transport.play", Obj().set ("from", 0));
    started = juce::Time::getMillisecondCounter();
}

void RecordingSelfTest::timerCallback()
{
    try
    {
        if (juce::Time::getMillisecondCounter() - started > 30000)
            throw RpcError ("Loopback scenario timed out");
        if (stage == 0)
        {
            beginScenario();
            stage = 1;
        }
        else if (stage == 1 && juce::Time::getMillisecondCounter() - started > 500)
        {
            // DeviceManager rebuilds its inputs asynchronously after opening an interface.
            enableInput();
            stage = 2;
        }
        else if (stage == 2 && juce::Time::getMillisecondCounter() - started > 300)
        {
            beginRecording();
            stage = 3;
        }
        // The synthetic callback can be scheduled slower than the UI clock under
        // a debugger or a loaded CI machine. Finish by actual captured samples,
        // so an extrapolated transport position cannot truncate the fixture.
        else if (stage == 3 && app.getEngine().getRecordingThumbnailManager().getThumbnailFor (juce::File (recordingFile))->getRecordedSampleCount()
                                   >= (juce::int64) (1.75 * scenarios[scenario].rate))
        {
            app.edit().getTransport().stop (false, true);
            stage = 4;
            started = juce::Time::getMillisecondCounter();
        }
        else if (stage == 4 && juce::Time::getMillisecondCounter() - started > 300)
        {
            inspectRecording();
            app.sendEvent = nullptr;
            if (++scenario < (int) std::size (scenarios))
            {
                stage = 0;
                started = juce::Time::getMillisecondCounter();
            }
            else
            {
                stage = 10;
                started = juce::Time::getMillisecondCounter();
            }
        }
        else if (stage == 10) { beginLoopScenario(); stage = 11; }
        else if (stage == 11)
        {
            if (loopScenario == 1 && app.loopTakes().isActive())
                if (auto* c = app.edit().getTransport().getCurrentPlaybackContext())
                    if (c->getUnloopedPosition().inSeconds() > 5.0) app.edit().getTransport().stop (false, true);
            app.loopTakes().poll();
            if (! app.loopTakes().isActive() && ! app.edit().getTransport().isRecording())
            { stage = 12; started = juce::Time::getMillisecondCounter(); }
        }
        else if (stage == 12 && juce::Time::getMillisecondCounter() - started > 300)
        {
            inspectLoopScenario(); app.sendEvent = nullptr;
            if (++loopScenario < 3) { stage = 10; started = juce::Time::getMillisecondCounter(); }
            else { stage = 13; started = juce::Time::getMillisecondCounter(); }
        }
        else if (stage == 13) { beginBusScenario(); stage = 14; }
        else if (stage == 14 && juce::Time::getMillisecondCounter() - started > 1600)
        {
            call ("transport.stop"); app.sendEvent = nullptr;
            for (int ch = 0; ch < 2; ++ch)
            {
                check ("bus meter receives the summed post-fader signal, channel " + String (ch + 1), std::abs (innerBusPeak[ch] + 20) < 1, String (innerBusPeak[ch], 2) + " dBFS");
                check ("nested bus meter follows its output gain, channel " + String (ch + 1), std::abs (outerBusPeak[ch] + 26) < 1, String (outerBusPeak[ch], 2) + " dBFS");
            }
            stopTimer(); std::cout << (failures ? "RECORDING SELFTEST FAILED" : "RECORDING SELFTEST PASSED") << std::endl; finished (failures ? 1 : 0);
        }
    }
    catch (const std::exception& e)
    {
        stopTimer();
        check ("recording regression test completes", false, e.what());
        finished (1);
    }
}
}
