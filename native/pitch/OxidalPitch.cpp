// Copyright (c) 2026 PiPedal contributors (adapter, ported to Oxidal)
// SPDX-License-Identifier: MIT
#include "OxidalPitch.hpp"
#include "PitchShift.h"
#include <lv2/options/options.h>
#include <lv2/urid/urid.h>
#include <lv2/atom/atom.h>
#include <lv2/buf-size/buf-size.h>
#include <algorithm>
#include <array>
#include <cmath>
#include <cstring>
#include <vector>

namespace {
using namespace oxidal_pitch;
/** Instantiate-time bounded storage; oversized host blocks reuse it in slices.
 * @see docs/native-pitch.md
 */
uint32_t blockCapacity(const LV2_Feature* const* features) {
    const LV2_URID_Map* map = nullptr;
    const LV2_Options_Option* options = nullptr;
    if (features) for (size_t i = 0; i < 64 && features[i]; ++i) {
        const auto* feature = features[i];
        if (!feature->URI) continue;
        if (!std::strcmp(feature->URI, LV2_URID__map)) map = static_cast<const LV2_URID_Map*>(feature->data);
        if (!std::strcmp(feature->URI, LV2_OPTIONS__options)) options = static_cast<const LV2_Options_Option*>(feature->data);
    }
    if (!map || !map->map || !options) return FallbackBlock;
    const auto key = map->map(map->handle, LV2_BUF_SIZE__maxBlockLength);
    const auto type = map->map(map->handle, LV2_ATOM__Int);
    if (!key || !type) return FallbackBlock;
    for (size_t i = 0; i < 256 && options[i].key; ++i) {
        const auto& option = options[i];
        if (option.context != LV2_OPTIONS_INSTANCE || option.subject || option.key != key
            || option.type != type || option.size != sizeof(int32_t) || !option.value) continue;
        int32_t value; std::memcpy(&value, option.value, sizeof(value));
        if (value > 0) return std::min(uint32_t(value), MaximumBlock);
    }
    return FallbackBlock;
}

/** C ABI adapter only. DSP is the unmodified engine from the pinned TONE3000 checkout.
 * @see docs/native-pitch.md
 */
class Instance {
public:
    Instance(double rate, uint32_t channels, uint32_t capacity)
        : rate(rate), channels(channels), capacity(capacity), scratch(size_t(channels) * capacity) {
        for (uint32_t ch = 0; ch < channels; ++ch) pointers[ch] = scratch.data() + size_t(ch) * capacity;
        engine.prepare(rate, int(capacity));
    }
    double rate;
    uint32_t channels, capacity;
    PitchShift engine;
    std::vector<float> scratch;
    std::array<float*, 2> pointers{};
    std::array<float*, PortCount> ports{};
    std::array<float, InputL> controls{0, 0, 1, 20000, 1, 0, 0};
    bool active = false;

    void activate() noexcept {
        active = false;
        try { engine.setEnabled(false); engine.prepare(rate, int(capacity)); active = true; }
        catch (...) { /* Failed preparation has a silent, nonthrowing run path. */ }
    }
    float control(uint32_t port, float minimum, float maximum) noexcept {
        if (ports[port] && std::isfinite(*ports[port])) controls[port] = std::clamp(*ports[port], minimum, maximum);
        return controls[port]; // Disconnected/nonfinite values retain the last valid value (initially the default).
    }
    void silence(uint32_t count) noexcept {
        for (uint32_t ch = 0; ch < channels; ++ch)
            if (ports[ch ? OutputR : OutputL]) std::fill_n(ports[ch ? OutputR : OutputL], count, 0.0f);
        if (ports[Latency]) *ports[Latency] = 0;
    }
    void run(uint32_t count) noexcept {
        if (!active) { silence(count); return; }
        const bool enabled = control(Enabled, 0, 1) >= .5f;
        const float semitones = control(Semitones, -24, 24);
        const bool stepped = control(Step, 0, 1) >= .5f;
        const float tonality = control(Tonality, 1000, 20000);
        const auto window = PitchShift::windowFromIndex(int(std::lround(control(Window, 0, 3))));
        const auto inputMode = int(std::lround(control(InputMode, 0, 2)));
        PitchShift::Params params;
        params.semitones = stepped ? std::round(semitones) : semitones;
        params.tonalityHz = tonality >= PitchShift::kTonalityOffHz ? 0 : tonality;
        params.window = window;
        engine.setEnabled(enabled);
        if (engine.isRunning()) engine.setParams(params);
        if (ports[Latency]) *ports[Latency] = enabled ? float(PitchShift::latencySamples(window, rate)) : 0;
        // Copy every input before any output write, preserving stereo in-place aliases.
        for (uint32_t offset = 0; offset < count;) {
            const auto frames = std::min(capacity, count - offset);
            for (uint32_t ch = 0; ch < channels; ++ch) {
                const auto* input = ports[ch ? InputR : InputL];
                for (uint32_t i = 0; i < frames; ++i) {
                    const float value = input ? input[offset + i] : 0;
                    pointers[ch][i] = std::isfinite(value) ? value : 0;
                }
            }
            // T3K selects its source before the shared pitch detector/tap sees
            // the audio. Selecting a channel after pitch is not equivalent.
            // @see docs/native-pitch.md
            if (channels == 2 && inputMode != 0) {
                const auto source = inputMode == 1 ? 0u : 1u;
                std::copy_n(pointers[source], frames, pointers[1u - source]);
            }
            juce::AudioBuffer<float> buffer(pointers.data(), int(channels), int(frames));
            if (engine.isRunning()) engine.process(buffer);
            for (uint32_t ch = 0; ch < channels; ++ch)
                if (auto* output = ports[ch ? OutputR : OutputL]) std::copy_n(pointers[ch], frames, output + offset);
            offset += frames;
        }
    }
};

LV2_Handle instantiate(const LV2_Descriptor* descriptor, double rate, const char*, const LV2_Feature* const* features) noexcept {
    if (!std::isfinite(rate) || rate < 44100 || rate > 192000) return nullptr;
    try { return new Instance(rate, std::strcmp(descriptor->URI, StereoUri) == 0 ? 2 : 1, blockCapacity(features)); }
    catch (...) { return nullptr; }
}
void connect(LV2_Handle handle, uint32_t port, void* data) noexcept {
    if (handle && port < PortCount) static_cast<Instance*>(handle)->ports[port] = static_cast<float*>(data);
}
void activate(LV2_Handle handle) noexcept { if (handle) static_cast<Instance*>(handle)->activate(); }
void run(LV2_Handle handle, uint32_t count) noexcept { if (handle) static_cast<Instance*>(handle)->run(count); }
void deactivate(LV2_Handle handle) noexcept {
    if (handle) { auto& instance = *static_cast<Instance*>(handle); instance.active = false; if (instance.ports[Latency]) *instance.ports[Latency] = 0; }
}
void cleanup(LV2_Handle handle) noexcept { delete static_cast<Instance*>(handle); }
const void* extension(const char*) noexcept { return nullptr; }
const LV2_Descriptor descriptors[] = {
    {MonoUri, instantiate, connect, activate, run, deactivate, cleanup, extension},
    {StereoUri, instantiate, connect, activate, run, deactivate, cleanup, extension}
};
}

/** Export two independently instantiable standard LV2 descriptors.
 * @see docs/native-pitch.md
 */
LV2_SYMBOL_EXPORT const LV2_Descriptor* lv2_descriptor(uint32_t index) { return index < 2 ? &descriptors[index] : nullptr; }
