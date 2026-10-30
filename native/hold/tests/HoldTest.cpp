// Copyright (c) 2026 Oxidal contributors
// SPDX-License-Identifier: MIT
#include "../OxidalHold.hpp"
#include <cmath>
#include <cstdlib>
#include <cstring>
#include <iostream>
#include <limits>
#include <stdexcept>
#include <vector>

namespace {
using namespace oxidal_hold;
void check(bool ok, const char* what) {
    if (!ok) throw std::runtime_error(what);
}
struct Fixture {
    const LV2_Descriptor* descriptor;
    LV2_Handle instance;
    double rate;
    float controls[5] = {0, 50, 200, 0, 1};
    std::vector<float> in[2], out[2];
    Fixture(bool stereo, double rate = 48000) : rate(rate) {
        descriptor = lv2_descriptor(stereo ? 1 : 0);
        check(descriptor && !std::strcmp(descriptor->URI, stereo ? StereoUri : MonoUri), "Descriptor");
        instance = descriptor->instantiate(descriptor, rate, "", nullptr);
        check(instance, "Instantiate");
        for (uint32_t p = 0; p < 5; ++p) descriptor->connect_port(instance, p, &controls[p]);
        descriptor->activate(instance);
    }
    ~Fixture() { descriptor->cleanup(instance); }
    bool stereo() const { return !std::strcmp(descriptor->URI, StereoUri); }
    /** Runs `count` frames of `source(frame)` in blocks of 64 and keeps the output. */
    template <typename F> std::vector<float> render(uint32_t count, F source, uint32_t channel = 0) {
        std::vector<float> kept;
        for (uint32_t done = 0; done < count;) {
            const uint32_t n = std::min(64u, count - done);
            for (int ch = 0; ch < 2; ++ch) {
                in[ch].assign(n, 0);
                out[ch].assign(n, 0);
                for (uint32_t i = 0; i < n; ++i) in[ch][i] = source(done + i);
            }
            descriptor->connect_port(instance, InputL, in[0].data());
            descriptor->connect_port(instance, OutputL, out[0].data());
            if (stereo()) {
                descriptor->connect_port(instance, InputR, in[1].data());
                descriptor->connect_port(instance, OutputR, out[1].data());
            }
            descriptor->run(instance, n);
            kept.insert(kept.end(), out[channel].begin(), out[channel].end());
            done += n;
        }
        return kept;
    }
};
double rms(const std::vector<float>& v, size_t from = 0) {
    double sum = 0;
    for (size_t i = from; i < v.size(); ++i) sum += double(v[i]) * v[i];
    return std::sqrt(sum / double(v.size() - from));
}
/** Goertzel power of one frequency, normalised by length. */
double tone(const std::vector<float>& v, double frequency, double rate, size_t from) {
    const double w = 2 * M_PI * frequency / rate, c = 2 * std::cos(w);
    double s1 = 0, s2 = 0;
    for (size_t i = from; i < v.size(); ++i) {
        const double s = v[i] + c * s1 - s2;
        s2 = s1;
        s1 = s;
    }
    return (s1 * s1 + s2 * s2 - c * s1 * s2) / double(v.size() - from);
}

void dryPassesUntouchedWhileNotHeld() {
    Fixture f(false);
    auto out = f.render(4800, [](uint32_t i) { return float(std::sin(i * 0.05)) * 0.4f; });
    for (uint32_t i = 0; i < out.size(); ++i)
        check(out[i] == float(std::sin(i * 0.05)) * 0.4f, "Dry is not bit-exact while not held");
    f.controls[Dry] = 0;
    out = f.render(480, [](uint32_t) { return 0.5f; });
    check(rms(out) == 0, "Dry off and not held must be silent");
}

void holdSustainsTheCapturedToneAfterTheInputStops(double rate) {
    Fixture f(false, rate);
    const double frequency = 220, amplitude = 0.3;
    auto sine = [&](uint32_t i) { return float(amplitude * std::sin(2 * M_PI * frequency * i / rate)); };
    f.render(uint32_t(rate / 2), sine);
    f.controls[Hold] = 1;
    // Three seconds of silence in; the held tone keeps sounding.
    auto held = f.render(uint32_t(rate * 3), [](uint32_t) { return 0.0f; });
    const size_t settled = size_t(rate * 0.5);
    const double inputRms = amplitude / std::sqrt(2.0);
    const double heldDb = 20 * std::log10(rms(held, settled) / inputRms);
    check(std::abs(heldDb) < 3.0, "Held level is not within 3 dB of the captured tone");
    check(tone(held, frequency, rate, settled) > 50 * tone(held, frequency * 1.5, rate, settled),
          "Held sound is not the captured pitch");
    // Release: fades to silence within the release time and a frame.
    f.controls[Hold] = 0;
    auto released = f.render(uint32_t(rate * 0.5), [](uint32_t) { return 0.0f; });
    const size_t gone = size_t(rate * 0.2) + 64;
    check(rms(released, gone) < 1e-6, "Release does not reach silence");
    for (float v : held) check(std::isfinite(v), "Non-finite output");
}

void stereoSidesHoldOnTheirOwn() {
    Fixture f(true);
    f.render(24000, [](uint32_t i) { return float(0.3 * std::sin(2 * M_PI * 330 * i / 48000.0)); });
    f.controls[Hold] = 1;
    auto left = f.render(48000, [](uint32_t) { return 0.0f; }, 0);
    const auto right = f.out[1];
    check(rms(left, 24000) > 0.05, "Stereo left is not held");
    // Independent phases: the sides differ, a wider drone than mono.
    double difference = 0;
    for (size_t i = 0; i < right.size(); ++i) difference += std::abs(left[left.size() - right.size() + i] - right[i]);
    check(difference > 0, "Stereo sides are identical");
}

void invalidInputAndControlsAreSafe() {
    Fixture f(false);
    f.controls[Attack] = std::numeric_limits<float>::quiet_NaN();
    f.controls[Level] = 1000;
    f.controls[Hold] = 1;
    auto out = f.render(4800, [](uint32_t i) {
        return i % 7 ? std::numeric_limits<float>::infinity() : 0.2f;
    });
    for (float v : out) check(std::isfinite(v), "Invalid input leaked");
    check(!lv2_descriptor(2), "Only two descriptors");
    const auto* d = lv2_descriptor(0);
    check(!d->instantiate(d, 8000, "", nullptr), "Unsupported rate accepted");
}
}  // namespace

int main() {
    try {
        dryPassesUntouchedWhileNotHeld();
        holdSustainsTheCapturedToneAfterTheInputStops(48000);
        holdSustainsTheCapturedToneAfterTheInputStops(96000);
        stereoSidesHoldOnTheirOwn();
        invalidInputAndControlsAreSafe();
    } catch (const std::exception& e) {
        std::cerr << "FAIL: " << e.what() << "\n";
        return EXIT_FAILURE;
    }
    std::cout << "hold tests passed\n";
    return EXIT_SUCCESS;
}
