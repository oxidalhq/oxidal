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
    // Hold, Attack, Release, Level, Dry, Focus, Width
    float controls[7] = {0, 50, 200, 0, 1, 80, 100};
    std::vector<float> in[2], out[2];
    Fixture(bool stereo, double rate = 48000) : rate(rate) {
        descriptor = lv2_descriptor(stereo ? 1 : 0);
        check(descriptor && !std::strcmp(descriptor->URI, stereo ? StereoUri : MonoUri), "Descriptor");
        instance = descriptor->instantiate(descriptor, rate, "", nullptr);
        check(instance, "Instantiate");
        // The mono plugin has no Width, so its audio ports start one place earlier.
        for (uint32_t p = 0; p < (stereo ? 7u : 6u); ++p) descriptor->connect_port(instance, p, &controls[p]);
        descriptor->activate(instance);
    }
    ~Fixture() { descriptor->cleanup(instance); }
    bool stereo() const { return !std::strcmp(descriptor->URI, StereoUri); }
    uint32_t port(uint32_t p) const { return stereo() || p < Width ? p : p - 1; }
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
            descriptor->connect_port(instance, port(InputL), in[0].data());
            descriptor->connect_port(instance, port(OutputL), out[0].data());
            if (stereo()) {
                descriptor->connect_port(instance, port(InputR), in[1].data());
                descriptor->connect_port(instance, port(OutputR), out[1].data());
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
    check(std::abs(heldDb) < 1.0, "Held level is not within 1 dB of the captured tone");
    check(tone(held, frequency, rate, settled) > 50 * tone(held, frequency * 1.5, rate, settled),
          "Held sound is not the captured pitch");
    // Release: fades to silence within the release time and a frame.
    f.controls[Hold] = 0;
    auto released = f.render(uint32_t(rate * 0.5), [](uint32_t) { return 0.0f; });
    const size_t gone = size_t(rate * 0.2) + 64;
    check(rms(released, gone) < 1e-6, "Release does not reach silence");
    for (float v : held) check(std::isfinite(v), "Non-finite output");
}

/** Runs a stereo fixture for `count` frames; Hold goes on at `holdAt`. */
template <typename L, typename R>
void renderStereo(Fixture& f, uint32_t count, uint32_t holdAt, L left, R right, std::vector<float>& heldL,
                  std::vector<float>& heldR) {
    for (uint32_t done = 0; done < count; done += 64) {
        if (done >= holdAt) f.controls[Hold] = 1;
        for (uint32_t i = 0; i < 64; ++i) {
            f.in[0].resize(64);
            f.in[1].resize(64);
            f.in[0][i] = done < holdAt ? left(done + i) : 0.0f;
            f.in[1][i] = done < holdAt ? right(done + i) : 0.0f;
        }
        f.out[0].assign(64, 0);
        f.out[1].assign(64, 0);
        f.descriptor->connect_port(f.instance, f.port(InputL), f.in[0].data());
        f.descriptor->connect_port(f.instance, f.port(OutputL), f.out[0].data());
        f.descriptor->connect_port(f.instance, f.port(InputR), f.in[1].data());
        f.descriptor->connect_port(f.instance, f.port(OutputR), f.out[1].data());
        f.descriptor->run(f.instance, 64);
        heldL.insert(heldL.end(), f.out[0].begin(), f.out[0].end());
        heldR.insert(heldR.end(), f.out[1].begin(), f.out[1].end());
    }
}
double correlation(const std::vector<float>& a, const std::vector<float>& b, size_t from) {
    double ab = 0, aa = 0, bb = 0;
    for (size_t i = from; i < a.size(); ++i) ab += a[i] * b[i], aa += a[i] * a[i], bb += b[i] * b[i];
    return ab / std::sqrt(aa * bb);
}

void stereoSidesHoldOnTheirOwn() {
    Fixture f(true);  // Width 100: the original image
    auto left = [](uint32_t i) { return float(0.3 * std::sin(2 * M_PI * 330 * i / 48000.0)); };
    auto right = [](uint32_t i) { return float(0.3 * std::sin(2 * M_PI * 440 * i / 48000.0)); };
    std::vector<float> heldL, heldR;
    renderStereo(f, 24000 + 96000, 24000, left, right, heldL, heldR);
    const size_t settled = 24000 + 24000;
    check(rms(heldL, settled) > 0.1 && rms(heldR, settled) > 0.1, "Stereo sides are not both held");
    check(tone(heldL, 330, 48000, settled) > 50 * tone(heldL, 440, 48000, settled), "Left did not keep its own note");
    check(tone(heldR, 440, 48000, settled) > 50 * tone(heldR, 330, 48000, settled), "Right did not keep its own note");
}

/** Width 0 holds the centre: both sides carry the same drone. */
void widthPullsTheSidesTogether() {
    Fixture f(true);
    f.controls[Width] = 0;
    auto left = [](uint32_t i) { return float(0.3 * std::sin(2 * M_PI * 330 * i / 48000.0)); };
    auto right = [](uint32_t i) { return float(0.3 * std::sin(2 * M_PI * 440 * i / 48000.0 + 1)); };
    std::vector<float> heldL, heldR;
    renderStereo(f, 24000 + 96000, 24000, left, right, heldL, heldR);
    check(correlation(heldL, heldR, 24000 + 24000) > 0.99, "Width 0 did not centre the held sound");
    check(rms(heldL, 24000 + 24000) > 0.05, "Centred hold is silent");
}

/** What was playing, not a wash: a harmonic stack keeps its lines and valleys, and
 * identical sides stay identical, so a mono source does not turn into a wide pad. */
void holdKeepsHarmonicsAndTheStereoImage() {
    Fixture f(true);
    const double fundamental = 110;
    auto stack = [&](uint32_t i) {
        double x = 0;
        for (int h = 1; h <= 10; ++h) x += std::sin(2 * M_PI * fundamental * h * i / 48000.0 + h) / h;
        return float(0.15 * x);
    };
    std::vector<float> heldL, heldR;
    renderStereo(f, 24000 + 96000, 24000, stack, stack, heldL, heldR);
    const size_t settled = 24000 + 24000;
    double lines = 0, valleys = 0;
    for (int h = 1; h <= 8; ++h) {
        lines += tone(heldL, fundamental * h, 48000, settled);
        valleys += tone(heldL, fundamental * (h + 0.5), 48000, settled);
    }
    check(lines > 100 * valleys, "Held sound lost the harmonic structure of the note");
    check(correlation(heldL, heldR, settled) > 0.95, "Identical sides were decorrelated by the hold");
}

/** Focus keeps the note and drops the hiss and room around it. */
void focusKeepsTheNoteNotTheNoise() {
    auto held = [](float focus) {
        Fixture f(true);
        f.controls[Focus] = focus;
        uint32_t seed = 4321;
        auto hiss = [&seed] {
            seed = seed * 1664525u + 1013904223u;
            return float(seed >> 8) / float(1 << 24) - 0.5f;
        };
        auto source = [&](uint32_t i) { return float(0.2 * std::sin(2 * M_PI * 196 * i / 48000.0) + 0.08 * hiss()); };
        std::vector<float> left, right;
        renderStereo(f, 24000 + 96000, 24000, source, source, left, right);
        return left;
    };
    const auto wide = held(0), narrow = held(100);
    const size_t settled = 24000 + 24000;
    auto between = [&](const std::vector<float>& v) {
        double sum = 0;
        for (double frequency : {1000.0, 1700.0, 2600.0, 3900.0}) sum += tone(v, frequency, 48000, settled);
        return sum;
    };
    check(between(narrow) * 30 < between(wide), "Focus did not remove the noise around the note");
    check(tone(narrow, 196, 48000, settled) > 0.3 * tone(wide, 196, 48000, settled), "Focus dropped the note itself");
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
        widthPullsTheSidesTogether();
        holdKeepsHarmonicsAndTheStereoImage();
        focusKeepsTheNoteNotTheNoise();
        invalidInputAndControlsAreSafe();
    } catch (const std::exception& e) {
        std::cerr << "FAIL: " << e.what() << "\n";
        return EXIT_FAILURE;
    }
    std::cout << "hold tests passed\n";
    return EXIT_SUCCESS;
}
