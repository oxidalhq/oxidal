// Copyright (c) 2026 Oxidal contributors
// SPDX-License-Identifier: MIT
#include "OxidalSwell.hpp"
#include <algorithm>
#include <array>
#include <cmath>
#include <cstring>
#include <new>

namespace {
using namespace oxidal_swell;

/** One-pole coefficient for a time constant in seconds. */
float pole(float seconds, double rate) noexcept {
    return 1.0f - std::exp(-1.0f / std::max(1.0f, seconds * float(rate)));
}

/** Swell: a stereo-linked envelope follower detects each attack; the gain then
 * rises from silence to unity along the curve over the swell time and falls back
 * over the release time when the note dies away. The gain is a function of one
 * continuous progress value, so changing the time only changes how fast that
 * value moves: no control change ever steps the output. No lookahead, so no
 * latency; nothing is allocated, locked or called outside this object in run().
 * @see docs/native-swell.md
 */
class Instance {
public:
    Instance(double rate, uint32_t channels)
        : rate(rate), channels(channels), fastUp(pole(0.001f, rate)), fastDown(pole(0.05f, rate)),
          slowUp(pole(0.08f, rate)), slowDown(pole(0.4f, rate)), glide(pole(SmoothingSeconds, rate)),
          duckStep(1.0f / std::max(1.0f, DuckSeconds * float(rate))),
          holdoffFrames(uint32_t(HoldoffSeconds * rate)) {}
    std::array<float*, PortCount> ports{};
    bool stereo() const noexcept { return channels == 2; }

    void activate() noexcept {
        fast = slow = progress = 0;
        sounding = ducking = false;
        armed = true;
        holdoff = 0;
        settled = false;
    }
    void run(uint32_t count) noexcept {
        const float threshold = std::pow(10.0f, control(Threshold, -70, -10, -45) / 20);
        const float finished = threshold * std::pow(10.0f, -HysteresisDb / 20);
        // Sensitivity 0 never retriggers a ringing note; 100 retriggers on a 2 dB jump.
        const float sensitivity = control(Sensitivity, 0, 100, 50) / 100;
        const bool retrigger = sensitivity > 0;
        const float jump = std::pow(10.0f, (20.0f - 18.0f * sensitivity) / 20);
        const float rearm = std::sqrt(jump);
        const double targetTime = std::log(double(control(Time, 20, 4000, 600)) / 1000);
        const double releaseStep = 1.0 / std::max(1.0, double(control(Release, 10, 5000, 300)) / 1000 * rate);
        const float targetCurve = 1.0f + 3.0f * control(Curve, 0, 100, 50) / 100;
        const float targetMix = control(Mix, 0, 100, 100) / 100;
        if (!settled) {
            logTime = targetTime;
            riseStep = 1.0 / (std::exp(logTime) * rate);
            curve = targetCurve;
            mix = targetMix;
            settled = true;
        }
        for (uint32_t i = 0; i < count; ++i) {
            const float left = sample(InputL, i), right = channels == 2 ? sample(InputR, i) : 0.0f;
            const float level = std::max(std::abs(left), std::abs(right));
            fast += (level - fast) * (level > fast ? fastUp : fastDown);
            slow += (level - slow) * (level > slow ? slowUp : slowDown);
            if (fast < 1e-12f) fast = 0;  // no denormals in silence
            if (slow < 1e-12f) slow = 0;
            if (holdoff) --holdoff;
            if (!sounding) {
                if (fast > threshold) {
                    // A new note: the swell continues upward from wherever a release left it.
                    sounding = true;
                    armed = false;
                    holdoff = holdoffFrames;
                }
            } else if (fast < finished) {
                sounding = false;
                ducking = false;
            } else if (retrigger) {
                if (armed && !holdoff && fast > slow * jump) {
                    ducking = true;
                    armed = false;
                    holdoff = holdoffFrames;
                } else if (!armed && fast < slow * rearm) {
                    armed = true;
                }
            }
            if (logTime != targetTime) {
                approach(logTime, targetTime);
                riseStep = 1.0 / (std::exp(logTime) * rate);
            }
            approach(curve, targetCurve);
            approach(mix, targetMix);
            if (ducking) {
                progress -= duckStep;
                if (progress <= 0) progress = 0, ducking = false;
            } else if (sounding) {
                progress = std::min(1.0, progress + riseStep);
            } else {
                progress = std::max(0.0, progress - releaseStep);
            }
            const float gain = progress > 0 ? float(std::pow(progress, double(curve))) : 0.0f;
            const float through = 1.0f - mix + mix * gain;
            if (auto* out = ports[OutputL]) out[i] = left * through;
            if (channels == 2)
                if (auto* out = ports[OutputR]) out[i] = right * through;
        }
    }

private:
    /** One step of a one-pole glide; it lands exactly on the target (no denormal tail). */
    template <typename T> void approach(T& value, T target) const noexcept {
        value += (target - value) * T(glide);
        if (std::abs(target - value) < T(1e-6)) value = target;
    }
    float control(uint32_t port, float lo, float hi, float fallback) const noexcept {
        const float* value = ports[port];
        return value && std::isfinite(*value) ? std::clamp(*value, lo, hi) : fallback;
    }
    float sample(uint32_t port, uint32_t i) const noexcept {
        const float* in = ports[port];
        const float value = in ? in[i] : 0.0f;
        return std::isfinite(value) ? value : 0.0f;
    }

    double rate;
    uint32_t channels;
    float fastUp, fastDown, slowUp, slowDown, glide, duckStep;
    uint32_t holdoffFrames;
    float fast = 0, slow = 0;  // envelope followers: attack detector and running level
    // Double precision: a 4 s swell is 192000 small steps that must sum to exactly 1.
    double progress = 0;  // 0 silent .. 1 fully swelled; the gain is progress^curve
    double logTime = 0, riseStep = 0;   // smoothed log swell time and its per-frame step
    float curve = 1, mix = 1;           // smoothed controls
    bool sounding = false, ducking = false, armed = true, settled = false;
    uint32_t holdoff = 0;
};

LV2_Handle instantiate(const LV2_Descriptor* descriptor, double rate, const char*, const LV2_Feature* const*) noexcept {
    if (!std::isfinite(rate) || rate < 22050 || rate > 192000) return nullptr;
    auto* instance = new (std::nothrow) Instance(rate, std::strcmp(descriptor->URI, StereoUri) == 0 ? 2 : 1);
    if (instance) instance->activate();
    return instance;
}
void connect(LV2_Handle handle, uint32_t port, void* data) noexcept {
    if (!handle) return;
    auto* instance = static_cast<Instance*>(handle);
    if (port < (instance->stereo() ? PortCount : InputR)) instance->ports[port] = static_cast<float*>(data);
}
void activate(LV2_Handle handle) noexcept {
    if (handle) static_cast<Instance*>(handle)->activate();
}
void run(LV2_Handle handle, uint32_t count) noexcept {
    if (handle) static_cast<Instance*>(handle)->run(count);
}
void deactivate(LV2_Handle) noexcept {}
void cleanup(LV2_Handle handle) noexcept { delete static_cast<Instance*>(handle); }
const void* extension(const char*) noexcept { return nullptr; }
const LV2_Descriptor descriptors[] = {
    {MonoUri, instantiate, connect, activate, run, deactivate, cleanup, extension},
    {StereoUri, instantiate, connect, activate, run, deactivate, cleanup, extension},
};
}  // namespace

/** Two standard LV2 descriptors: mono and stereo.
 * @see docs/native-swell.md
 */
LV2_SYMBOL_EXPORT const LV2_Descriptor* lv2_descriptor(uint32_t index) {
    return index < 2 ? &descriptors[index] : nullptr;
}
