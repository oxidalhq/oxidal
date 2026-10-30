// Copyright (c) 2026 PiPedal contributors (adapter, ported to Oxidal)
// SPDX-License-Identifier: MIT
#include "../OxidalPitch.hpp"
#define PitchShift ReferencePitchShift
#include PITCH_REFERENCE_HEADER
#undef PitchShift
#include <lv2/atom/atom.h>
#include <lv2/buf-size/buf-size.h>
#include <lv2/options/options.h>
#include <lv2/urid/urid.h>
#include <atomic>
#include <array>
#include <cmath>
#include <cstdlib>
#include <cstring>
#include <iostream>
#include <limits>
#include <new>
#include <stdexcept>
#include <vector>

namespace {
thread_local bool auditAllocations = false;
std::atomic<size_t> allocations{0};
size_t checks = 0;
void check(bool condition, const char* message) {
    ++checks; if (!condition) throw std::runtime_error(message);
}
}
// Count C++ heap allocations only during the production C ABI run callback.
void* operator new(size_t size) {
    if (auditAllocations) ++allocations;
    if (auto* pointer = std::malloc(size ? size : 1)) return pointer;
    throw std::bad_alloc();
}
void* operator new[](size_t size) { return ::operator new(size); }
void operator delete(void* pointer) noexcept { std::free(pointer); }
void operator delete[](void* pointer) noexcept { std::free(pointer); }
void operator delete(void* pointer, size_t) noexcept { std::free(pointer); }
void operator delete[](void* pointer, size_t) noexcept { std::free(pointer); }
void* operator new(size_t size, std::align_val_t alignment) {
    if (auditAllocations) ++allocations;
    void* pointer = nullptr;
    if (posix_memalign(&pointer, size_t(alignment), size ? size : 1) != 0) throw std::bad_alloc();
    return pointer;
}
void* operator new[](size_t size, std::align_val_t alignment) { return ::operator new(size, alignment); }
void operator delete(void* pointer, std::align_val_t) noexcept { std::free(pointer); }
void operator delete[](void* pointer, std::align_val_t) noexcept { std::free(pointer); }
void operator delete(void* pointer, size_t, std::align_val_t) noexcept { std::free(pointer); }
void operator delete[](void* pointer, size_t, std::align_val_t) noexcept { std::free(pointer); }

namespace {
using namespace oxidal_pitch;
LV2_URID mapUri(LV2_URID_Map_Handle, const char* uri) {
    return !std::strcmp(uri, LV2_BUF_SIZE__maxBlockLength) ? 1 : !std::strcmp(uri, LV2_ATOM__Int) ? 2 : 3;
}

/** Production descriptor fixture, actual upstream reference; no DSP substitutes.
 * @see docs/native-pitch.md
 */
struct Fixture {
    const LV2_Descriptor* descriptor;
    LV2_Handle instance = nullptr;
    double rate;
    int channels;
    std::array<float, InputL> controls{0, 0, 1, 20000, 1};
    float latency = -1;
    std::array<std::vector<float>, 2> input, output;
    explicit Fixture(double rate = 48000, int channels = 1, int32_t block = 0) : descriptor(lv2_descriptor(channels == 2)), rate(rate), channels(channels) {
        LV2_URID_Map map{nullptr, mapUri};
        LV2_Options_Option options[] = {{LV2_OPTIONS_INSTANCE, 0, 1, sizeof(block), 2, &block}, {}};
        LV2_Feature mapping{LV2_URID__map, &map}, option{LV2_OPTIONS__options, options};
        const LV2_Feature* features[] = {&mapping, &option, nullptr};
        instance = descriptor->instantiate(descriptor, rate, nullptr, block ? features : nullptr);
        check(instance != nullptr, "Instantiation failed");
        for (uint32_t port = 0; port < 5; ++port) descriptor->connect_port(instance, port, &controls[port]);
        descriptor->connect_port(instance, Latency, &latency);
        descriptor->connect_port(instance, InputMode, &controls[InputMode]);
        descriptor->activate(instance);
    }
    ~Fixture() { if (instance) { descriptor->deactivate(instance); descriptor->cleanup(instance); } }
    Fixture(const Fixture&) = delete;
    void audio(uint32_t count, uint64_t start = 0) {
        for (int ch = 0; ch < channels; ++ch) {
            input[ch].resize(count); output[ch].assign(count, -777);
            for (uint32_t i = 0; i < count; ++i) {
                const double t = double(start + i) / rate;
                const double envelope = ((start + i) / uint64_t(rate / 10)) % 2 ? .9 : .3;
                input[ch][i] = float(envelope * (.25 * std::sin(2 * 3.141592653589793 * (82.41 + ch * 23) * t)
                    + .13 * std::sin(2 * 3.141592653589793 * (164.82 + ch * 31) * t)
                    + .05 * std::sin(2 * 3.141592653589793 * 987 * t)));
            }
            descriptor->connect_port(instance, ch ? InputR : InputL, input[ch].data());
            descriptor->connect_port(instance, ch ? OutputR : OutputL, output[ch].data());
        }
    }
    void run(uint32_t count) {
        const auto before = allocations.load(); auditAllocations = true;
        descriptor->run(instance, count); auditAllocations = false;
        check(allocations == before, "Production run allocated C++ heap storage");
    }
};

ReferencePitchShift::Params nativeParams(const std::array<float, InputL>& controls) {
    ReferencePitchShift::Params params;
    params.semitones = controls[Step] >= .5f ? std::round(controls[Semitones]) : controls[Semitones];
    params.tonalityHz = controls[Tonality] >= 20000 ? 0 : controls[Tonality];
    params.window = ReferencePitchShift::windowFromIndex(int(std::lround(controls[Window])));
    return params;
}

void sameSamples(const Fixture& actual, const std::array<std::vector<float>, 2>& expected, uint32_t count) {
    for (int ch = 0; ch < actual.channels; ++ch) for (uint32_t i = 0; i < count; ++i) {
        check(std::isfinite(actual.output[ch][i]), "Nonfinite output");
        check(actual.output[ch][i] == expected[ch][i], "Wrapper differs from independently compiled upstream engine");
    }
}

/** All controls/window transitions, 16/variable/excess blocks and host rates.
 * @see docs/native-pitch.md
 */
void upstreamSequence(double rate, int channels, int32_t capacity) {
    Fixture actual(rate, channels, capacity);
    ReferencePitchShift reference; reference.prepare(rate, capacity > 0 ? capacity : int(FallbackBlock));
    std::array<std::vector<float>, 2> expected;
    uint64_t position = 0;
    for (int stage = 0; stage < 12; ++stage) {
        actual.controls = {stage == 0 || stage >= 10 ? 0.f : 1.f,
            std::array<float, 12>{0,-24,-12.4f,-3.25f,0,4.4f,12,24,7.3f,-5.2f,0,0}[stage],
            stage % 2 ? 1.f : 0.f, stage % 3 == 0 ? 20000.f : stage % 3 == 1 ? 1000.f : 7300.f, float(stage % 4)};
        reference.setEnabled(actual.controls[Enabled] >= .5f);
        if (reference.isRunning()) reference.setParams(nativeParams(actual.controls));
        for (int block = 0; block < 35; ++block) {
            const uint32_t count = block % 4 == 0 ? 16 : block % 4 == 1 ? 64 : block % 4 == 2 ? 257 : 1031;
            actual.audio(count, position);
            std::array<float*, 2> pointers{};
            for (int ch = 0; ch < channels; ++ch) { expected[ch] = actual.input[ch]; pointers[ch] = expected[ch].data(); }
            juce::AudioBuffer<float> buffer(pointers.data(), channels, int(count));
            if (reference.isRunning()) reference.process(buffer);
            actual.run(count); sameSamples(actual, expected, count);
            const float expectedLatency = actual.controls[Enabled] ? float(ReferencePitchShift::latencySamples(nativeParams(actual.controls).window, rate)) : 0;
            check(actual.latency == expectedLatency, "Reported latency violates native requested-power convention");
            position += count;
        }
    }
    actual.audio(257, position); actual.run(257);
    for (int ch = 0; ch < channels; ++ch)
        check(std::memcmp(actual.input[ch].data(), actual.output[ch].data(), 257 * sizeof(float)) == 0, "Settled bypass is not bit-exact dry");
}

/** C ABI invalid controls/rate/options, disconnected ports and lifecycle guards.
 * @see docs/native-pitch.md
 */
void safety() {
    check(lv2_descriptor(2) == nullptr, "Unexpected descriptor");
    const auto* descriptor = lv2_descriptor(0);
    for (double rate : {0., -1., 32000., 192001., std::numeric_limits<double>::infinity(), std::numeric_limits<double>::quiet_NaN()})
        check(descriptor->instantiate(descriptor, rate, nullptr, nullptr) == nullptr, "Invalid rate accepted");
    // Wrong-sized/context/type options are ignored, without relying on alignment.
    int32_t cap = 16;
    LV2_URID_Map mapping{nullptr, mapUri};
    for (auto invalid : {LV2_Options_Option{LV2_OPTIONS_PORT, 0, 1, 4, 2, &cap},
        LV2_Options_Option{LV2_OPTIONS_INSTANCE, 0, 1, 8, 2, &cap},
        LV2_Options_Option{LV2_OPTIONS_INSTANCE, 0, 1, 4, 3, &cap},
        LV2_Options_Option{LV2_OPTIONS_INSTANCE, 0, 1, 4, 2, nullptr}}) {
        LV2_Options_Option options[] = {invalid, {}};
        LV2_Feature mapFeature{LV2_URID__map, &mapping}, optionFeature{LV2_OPTIONS__options, options};
        const LV2_Feature* features[] = {&mapFeature, &optionFeature, nullptr};
        auto instance = descriptor->instantiate(descriptor, 48000, nullptr, features);
        check(instance != nullptr, "Invalid optional feature prevented safe fallback");
        descriptor->activate(instance); descriptor->run(instance, 19); descriptor->cleanup(instance);
    }
    for (int32_t maxBlock : {-1, 1, 17, 65536, std::numeric_limits<int32_t>::max()}) {
        Fixture instance(48000, 2, maxBlock); instance.audio(70001); instance.run(70001);
        for (int ch = 0; ch < 2; ++ch) check(instance.output[ch] == instance.input[ch], "Oversized bypass changed audio");
    }
    Fixture actual, expected;
    actual.controls = expected.controls = {1, -6.25f, 0, 1000, 3};
    actual.audio(3000); expected.audio(3000); actual.run(3000); expected.run(3000);
    actual.controls.fill(std::numeric_limits<float>::quiet_NaN());
    actual.audio(1501, 3000); expected.audio(1501, 3000); actual.run(1501); expected.run(1501);
    check(actual.output[0] == expected.output[0], "Nonfinite controls did not retain last valid controls");
    actual.controls = {2, 100, -1, -400, 9}; expected.controls = {1, 24, 0, 1000, 3};
    actual.audio(257, 4501); expected.audio(257, 4501); actual.run(257); expected.run(257);
    check(actual.output[0] == expected.output[0], "Out-of-range controls not clamped");
    actual.descriptor->deactivate(actual.instance); actual.audio(19); actual.run(19);
    check(actual.latency == 0 && actual.output[0] == std::vector<float>(19, 0), "Inactive run is not silent");
    actual.descriptor->activate(actual.instance); expected.descriptor->activate(expected.instance);
    actual.audio(1001); expected.audio(1001); actual.run(1001); expected.run(1001);
    check(actual.output[0] == expected.output[0], "Reactivation did not reset upstream lifecycle");
    Fixture disconnected;
    disconnected.descriptor->connect_port(disconnected.instance, 400, nullptr);
    disconnected.audio(31); disconnected.input[0][0] = std::numeric_limits<float>::quiet_NaN();
    disconnected.input[0][1] = std::numeric_limits<float>::infinity(); disconnected.run(31);
    check(disconnected.output[0][0] == 0 && disconnected.output[0][1] == 0, "Invalid audio not sanitized");
    disconnected.descriptor->connect_port(disconnected.instance, InputL, nullptr);
    disconnected.run(31); check(disconnected.output[0] == std::vector<float>(31, 0), "Disconnected input is not silence");
    disconnected.descriptor->connect_port(disconnected.instance, OutputL, nullptr);
    disconnected.descriptor->connect_port(disconnected.instance, Latency, nullptr);
    for (uint32_t port = 0; port < 5; ++port) disconnected.descriptor->connect_port(disconnected.instance, port, nullptr);
    disconnected.descriptor->connect_port(disconnected.instance, InputMode, nullptr);
    disconnected.run(0); disconnected.run(31);
}

/** Two serial processors remain independent, with actual reference sequencing.
 * @see docs/native-pitch.md
 */
void serialAndStereo() {
    Fixture first(48000, 2, 16), second(48000, 2, 257);
    first.controls = {1, -3.2f, 0, 20000, 0}; second.controls = {1, 7, 1, 9000, 3};
    ReferencePitchShift a, b; a.prepare(48000, 16); b.prepare(48000, 257);
    a.setEnabled(true); b.setEnabled(true); a.setParams(nativeParams(first.controls)); b.setParams(nativeParams(second.controls));
    for (uint64_t position = 0; position < 48000; position += 257) {
        first.audio(257, position); second.audio(257, position);
        auto expected = first.input; std::array<float*, 2> pointers{expected[0].data(), expected[1].data()};
        juce::AudioBuffer<float> buffer(pointers.data(), 2, 257); a.process(buffer); b.process(buffer);
        first.run(257);
        second.input = first.output;
        second.descriptor->connect_port(second.instance, InputL, second.input[0].data());
        second.descriptor->connect_port(second.instance, InputR, second.input[1].data());
        second.run(257); sameSamples(second, expected, 257);
        check(first.latency + second.latency == 2016, "Configured serial latency sum differs");
    }
    // Stereo anti-phase survives the shared mean-control/tap path exactly.
    Fixture stereo(48000, 2, 64); stereo.controls = {1, -12, 1, 20000, 1};
    for (uint64_t position = 0; position < 12000; position += 257) {
        stereo.audio(257, position);
        for (size_t i = 0; i < 257; ++i) stereo.input[1][i] = -stereo.input[0][i];
        stereo.run(257);
        for (size_t i = 0; i < 257; ++i) check(stereo.output[1][i] == -stereo.output[0][i], "Stereo taps became independent");
    }
    Fixture inPlace(48000, 2, 17), separate(48000, 2, 17); inPlace.controls = separate.controls = {1, -7, 1, 20000, 1};
    for (uint64_t position = 0; position < 10000; position += 257) {
        inPlace.audio(257, position); separate.audio(257, position);
        inPlace.descriptor->connect_port(inPlace.instance, OutputL, inPlace.input[0].data());
        inPlace.descriptor->connect_port(inPlace.instance, OutputR, inPlace.input[1].data());
        inPlace.run(257); separate.run(257);
        check(inPlace.input == separate.output, "In-place audio aliases changed stereo output");
    }
}

/** Match native T3K's pre-pitch source selection, including cancelling stereo.
 * @see docs/native-pitch.md
 */
void inputRouting() {
    static_assert(InputMode == 6 && InputL == 7 && OutputL == 8 && InputR == 9 && OutputR == 10);
    for (double rate : {44100., 48000., 192000.}) for (int mode : {0, 1, 2}) for (bool antiPhase : {false, true}) {
        Fixture actual(rate, 2, 17);
        actual.controls = {1, -7.25f, 0, 7300, 1, 0, float(mode)};
        ReferencePitchShift reference; reference.prepare(rate, 17);
        reference.setEnabled(true); reference.setParams(nativeParams(actual.controls));
        double energy = 0;
        for (uint64_t position = 0; position < 12000; position += 257) {
            actual.audio(257, position);
            if (antiPhase) for (size_t i = 0; i < 257; ++i) actual.input[1][i] = -actual.input[0][i];
            auto expected = actual.input;
            // These are the exact native Processor.cpp Left/Right operations,
            // performed independently of the wrapper before original DSP.
            if (mode == 1) expected[1] = expected[0];
            if (mode == 2) expected[0] = expected[1];
            std::array<float*, 2> pointers{expected[0].data(), expected[1].data()};
            juce::AudioBuffer<float> buffer(pointers.data(), 2, 257);
            reference.process(buffer); actual.run(257); sameSamples(actual, expected, 257);
            for (float sample : actual.output[0]) energy += double(sample) * sample;
            if (mode) check(actual.output[0] == actual.output[1], "Selected pitch source was not duplicated");
        }
        check(energy > .001, "Selected channel unexpectedly cancelled or remained silent");
    }
    // Requested source selection also applies while pitch is powered off.
    for (int channels : {1, 2}) for (float mode : {1.f, 2.f, 1.6f, 9.f, -2.f}) {
        Fixture actual(48000, channels, 17); actual.controls[InputMode] = mode;
        actual.audio(257); auto expected = actual.input;
        const auto selected = int(std::lround(std::clamp(mode, 0.f, 2.f)));
        if (channels == 2 && selected == 1) expected[1] = expected[0];
        if (channels == 2 && selected == 2) expected[0] = expected[1];
        actual.run(257); sameSamples(actual, expected, 257);
        actual.controls[InputMode] = std::numeric_limits<float>::quiet_NaN();
        actual.run(257); sameSamples(actual, expected, 257);
        actual.descriptor->connect_port(actual.instance, InputMode, nullptr);
        actual.run(257); sameSamples(actual, expected, 257);
    }
    // Folding must be safe when output aliases a different input channel.
    for (float mode : {1.f, 2.f}) {
        Fixture actual(48000, 2, 17); actual.controls[InputMode] = mode; actual.audio(257);
        const auto selected = actual.input[mode == 1 ? 0 : 1];
        actual.descriptor->connect_port(actual.instance, OutputL, actual.input[1].data());
        actual.descriptor->connect_port(actual.instance, OutputR, actual.input[0].data());
        actual.run(257);
        check(actual.input[0] == selected && actual.input[1] == selected, "Fold cross-channel aliases changed the selected source");
    }
}
}

int main() {
    try {
        for (double rate : {44100., 48000., 96000., 192000.})
            for (int channels : {1, 2}) upstreamSequence(rate, channels, channels == 1 ? 16 : 0);
        safety(); serialAndStereo(); inputRouting();
        std::cout << checks << " checks passed; independent upstream sequences, lifecycle, controls, aliasing, stereo and serial instances.\n";
        return 0;
    } catch (const std::exception& error) { auditAllocations = false; std::cerr << error.what() << '\n'; return 1; }
}
