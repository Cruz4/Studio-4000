// Modified for the recording and device fixes: audio round-trip tests without physical hardware.
#include "RecordingSelfTest.h"
#include "ProjectState.h"
#include <atomic>
#include <iterator>

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
    const auto s = scenarios[scenario];
    auto& tdm = app.getEngine().getDeviceManager();
    auto& dm = tdm.deviceManager;
    LoopbackDevice::extraMs = s.extraMs;
    auto setup = dm.getAudioDeviceSetup();
    dm.closeAudioDevice();
    setup.inputDeviceName = setup.outputDeviceName = deviceName;
    setup.sampleRate = s.rate;
    setup.bufferSize = s.immediateChange ? 128 : s.block;
    setup.useDefaultInputChannels = setup.useDefaultOutputChannels = true;
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
    te::WaveInputDevice* input = nullptr;
    for (int i = 0; i < tdm.getNumWaveInDevices(); ++i)
        if (auto* w = tdm.getWaveInDevice (i); w != nullptr && ! w->isTrackDevice())
        {
            input = w;
            break;
        }
    if (input == nullptr) throw RpcError ("No loopback input");
    inputName = input->getName();
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
    sawPreview = false;
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
    std::cout << "Scenario " << scenario << ": " << reader->sampleRate << " Hz, "
              << scenarios[scenario].block << " samples" << std::endl;
}

void RecordingSelfTest::timerCallback()
{
    try
    {
        if (juce::Time::getMillisecondCounter() - started > 20000)
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
        else if (stage == 3 && app.edit().getTransport().getPosition().inSeconds() >= 3.0)
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
                stopTimer();
                std::cout << (failures ? "RECORDING SELFTEST FAILED" : "RECORDING SELFTEST PASSED") << std::endl;
                finished (failures ? 1 : 0);
            }
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
