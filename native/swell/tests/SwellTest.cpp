// Copyright (c) 2026 Oxidal contributors
// SPDX-License-Identifier: MIT
// Attack detection, curve, swell time, glitch-free control changes and safety.
// @see docs/native-swell.md
#include "../OxidalSwell.hpp"
#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <cstring>
#include <functional>
#include <iostream>
#include <limits>
#include <new>
#include <stdexcept>
#include <vector>

namespace {
size_t allocations = 0;
}
void* operator new(size_t size) {
    ++allocations;
    if (void* p = std::malloc(size ? size : 1)) return p;
    throw std::bad_alloc();
}
void operator delete(void* p) noexcept { std::free(p); }
void operator delete(void* p, size_t) noexcept { std::free(p); }

namespace {
using namespace oxidal_swell;
void check(bool ok, const char* what) {
    if (!ok) throw std::runtime_error(what);
}
/** The steepest per-sample gain step a control change may cause: the slope of
 * the fastest legal swell (20 ms) with the steepest curve, at 48 kHz, is
 * 4 / 960 ≈ 0.0042 of full scale; anything above this is a step, not a swell. */
constexpr double MaxStep = 4.0 / (0.020 * 48000) * 1.02;

struct Fixture {
    const LV2_Descriptor* descriptor;
    LV2_Handle instance;
    double rate;
    // Threshold, Sensitivity, Time, Release, Curve, Mix
    float controls[6] = {-45, 50, 600, 300, 50, 100};
    std::vector<float> in[2], out[2];
    std::vector<float> keptRight;
    Fixture(bool stereo = false, double rate = 48000) : rate(rate) {
        descriptor = lv2_descriptor(stereo ? 1 : 0);
        check(descriptor && !std::strcmp(descriptor->URI, stereo ? StereoUri : MonoUri), "Descriptor");
        instance = descriptor->instantiate(descriptor, rate, "", nullptr);
        check(instance, "Instantiate");
        for (uint32_t p = 0; p < 6; ++p) descriptor->connect_port(instance, p, &controls[p]);
        descriptor->activate(instance);
    }
    ~Fixture() { descriptor->cleanup(instance); }
    bool stereo() const { return !std::strcmp(descriptor->URI, StereoUri); }
    /** Runs `count` frames of `source(frame)` in blocks of 64; `before(frame)` may
     * change controls at each block, as a scene change does. Returns the left output. */
    template <typename F>
    std::vector<float> render(uint32_t count, F source, std::function<void(uint32_t)> before = {},
                              std::function<float(uint32_t)> right = {}) {
        std::vector<float> kept;
        keptRight.clear();
        for (uint32_t done = 0; done < count;) {
            const uint32_t n = std::min(64u, count - done);
            if (before) before(done);
            for (int ch = 0; ch < 2; ++ch) {
                in[ch].assign(n, 0);
                out[ch].assign(n, 0);
            }
            for (uint32_t i = 0; i < n; ++i) {
                in[0][i] = source(done + i);
                in[1][i] = right ? right(done + i) : in[0][i];
            }
            descriptor->connect_port(instance, InputL, in[0].data());
            descriptor->connect_port(instance, OutputL, out[0].data());
            if (stereo()) {
                descriptor->connect_port(instance, InputR, in[1].data());
                descriptor->connect_port(instance, OutputR, out[1].data());
            }
            const size_t before_run = allocations;
            descriptor->run(instance, n);
            check(allocations == before_run, "run() allocated");
            kept.insert(kept.end(), out[0].begin(), out[0].end());
            keptRight.insert(keptRight.end(), out[1].begin(), out[1].end());
            done += n;
        }
        return kept;
    }
};
constexpr float Dc = 0.5f;
auto dc = [](uint32_t) { return Dc; };
/** Gain applied to a constant input: the output divided by the input. */
std::vector<double> gainOf(const std::vector<float>& out) {
    std::vector<double> g(out.size());
    for (size_t i = 0; i < out.size(); ++i) g[i] = out[i] / Dc;
    return g;
}
double maxStep(const std::vector<double>& g, size_t from = 1, size_t to = SIZE_MAX) {
    double step = 0;
    for (size_t i = std::max<size_t>(from, 1); i < std::min(to, g.size()); ++i) step = std::max(step, std::abs(g[i] - g[i - 1]));
    return step;
}
double peak(const std::vector<float>& v, size_t from, size_t to) {
    double p = 0;
    for (size_t i = from; i < std::min(to, v.size()); ++i) p = std::max(p, double(std::abs(v[i])));
    return p;
}
float sine(uint32_t i, double amplitude, double frequency = 220, double rate = 48000) {
    return float(amplitude * std::sin(2 * M_PI * frequency * i / rate));
}

/** Below the threshold nothing passes; a note above it starts silent (the pick is
 * hidden) and reaches the input level once the swell time is over. */
void attackIsDetectedAndHidden() {
    Fixture f;
    auto quiet = f.render(9600, [](uint32_t i) { return sine(i, 0.001); });  // -60 dBFS, threshold -45
    check(peak(quiet, 0, quiet.size()) == 0, "A note below the threshold passed");
    auto note = f.render(48000, [](uint32_t i) { return sine(i, 0.3); });
    check(peak(note, 0, 48) < 0.3 * 1e-3, "The pick attack was not hidden");
    check(peak(note, 4800, 9600) < 0.3 * 0.2, "The note did not start as a swell");
    check(std::abs(peak(note, 33600, 48000) - 0.3) < 0.003, "The swelled note did not reach full level");
}

/** Linear (0), default (50) and steepest (100) curves at half the swell time. */
void curveShapesTheFade() {
    auto halfway = [](float curve) {
        Fixture f;
        f.controls[Curve] = curve;
        f.controls[Time] = 1000;
        return gainOf(f.render(48000, dc))[24000];
    };
    check(std::abs(halfway(0) - 0.5) < 0.01, "Curve 0 is not linear");
    check(std::abs(halfway(50) - std::pow(0.5, 2.5)) < 0.01, "Curve 50 is not progress^2.5");
    check(std::abs(halfway(100) - std::pow(0.5, 4.0)) < 0.01, "Curve 100 is not progress^4");
    // Every curve is monotonic and ends at unity gain.
    for (float curve : {0.0f, 50.0f, 100.0f}) {
        Fixture f;
        f.controls[Curve] = curve;
        auto g = gainOf(f.render(48000, dc));
        for (size_t i = 1; i < g.size(); ++i) check(g[i] >= g[i - 1], "The swell is not monotonic");
        check(g.back() == 1.0, "The swell does not end at unity");
    }
}

/** Linear swell reaches unity at the swell time, within a block, at 48 and 96 kHz. */
void swellTimeIsHonoured(double rate) {
    for (float ms : {20.0f, 600.0f, 4000.0f}) {
        Fixture f(false, rate);
        f.controls[Curve] = 0;
        f.controls[Time] = ms;
        auto g = gainOf(f.render(uint32_t(rate * (ms / 1000 + 0.1)), dc));
        const size_t full = size_t(std::find(g.begin(), g.end(), 1.0) - g.begin());
        const double expected = ms / 1000 * rate;
        check(std::abs(double(full) - expected) <= 64 + rate * 0.002, "Swell time is not honoured");
    }
}

/** A scene changing Time (both ways), Curve or Mix mid-swell never steps the gain
 * by more than MaxStep in one sample: the output stays continuous. */
void changingControlsMidSwellIsSmooth() {
    {
        Fixture f;
        f.controls[Time] = 4000;
        f.controls[Curve] = 100;
        auto g = gainOf(f.render(96000, dc, [&](uint32_t at) {
            if (at >= 48000) f.controls[Time] = 20;  // 4 s → 20 ms after one second
        }));
        check(g[47999] < 0.01 && g.back() == 1.0, "Slow-to-fast change did not take effect");
        check(maxStep(g) <= MaxStep, "Changing swell time 4 s → 20 ms stepped the output");
    }
    {
        Fixture f;
        f.controls[Time] = 20;
        f.controls[Curve] = 100;
        auto g = gainOf(f.render(48000, dc, [&](uint32_t at) {
            if (at >= 512) f.controls[Time] = 4000;  // 20 ms → 4 s, halfway through
        }));
        // Uninterrupted, a 20 ms swell is at unity by frame 960; the slower time holds it back.
        check(g[960] < 0.5 && g[4800] < 0.5, "Fast-to-slow change did not take effect");
        check(maxStep(g) <= MaxStep, "Changing swell time 20 ms → 4 s stepped the output");
    }
    {
        Fixture f;
        f.controls[Time] = 2000;
        f.controls[Curve] = 0;
        auto g = gainOf(f.render(96000, dc, [&](uint32_t at) {
            if (at >= 48000) f.controls[Curve] = 100;
            if (at >= 72000) f.controls[Mix] = 0;
        }));
        check(maxStep(g) <= MaxStep, "Changing curve or mix mid-swell stepped the output");
        check(g.back() == 1.0, "Mix 0 is not fully dry");
    }
}

/** When the note dies away the gain fades over Release; the next note swells again.
 * The detector notices the end once its 50 ms follower falls 6 dB below the
 * threshold (about 230 ms from a -10 dBFS note), then Release runs. */
void releaseAndNextNote() {
    Fixture f;
    f.controls[Time] = 100;
    f.controls[Release] = 200;
    f.render(24000, [](uint32_t i) { return sine(i, 0.3); });
    auto gone = f.render(48000, [](uint32_t i) { return i < 4800 ? sine(i, 0.3) : sine(i, 0.0003); });
    check(peak(gone, 4800 + 4800, 4800 + 9600) > 0, "Release cut the note instead of fading it");
    check(peak(gone, 4800 + 11520 + 9600 + 480, 48000) == 0, "Release did not reach silence");
    auto again = f.render(24000, [](uint32_t i) { return sine(i, 0.3); });
    check(peak(again, 0, 480) < 0.3 * 0.05, "The next note did not swell from silence");
    check(peak(again, 12000, 24000) > 0.29, "The next note did not swell in");
}

/** A big jump in level retriggers a swell while a note rings; sensitivity 0 does
 * not. The retrigger fades the old swell out over DuckSeconds: its steepest
 * step is the 4 ms fade's (curve 2.5: 2.5 / 192 per sample), never a cut. */
void sensitivityRetriggers() {
    auto afterJump = [](float sensitivity) {
        Fixture f;
        f.controls[Sensitivity] = sensitivity;
        f.controls[Time] = 200;
        f.render(48000, [](uint32_t) { return 0.03f; });  // ringing at about -30 dBFS
        return gainOf(f.render(14400, [](uint32_t) { return Dc; }));  // +24 dB: a new pick
    };
    const auto g = afterJump(50);
    double dip = 1;
    for (size_t i = 0; i < 960; ++i) dip = std::min(dip, g[i]);
    check(dip == 0, "A new pick did not retrigger the swell");
    check(g.back() == 1.0, "The retriggered swell did not reach full level");
    check(maxStep(g) <= 2.5 / (DuckSeconds * 48000) * 1.02, "The retrigger cut the signal in one step");
    const auto held = afterJump(0);
    check(*std::min_element(held.begin(), held.end()) == 1.0, "Sensitivity 0 retriggered a ringing note");
}

/** Stereo shares one detector: both sides take the same gain, so the image is kept. */
void stereoIsLinked() {
    Fixture f(true);
    auto left = f.render(24000, [](uint32_t i) { return sine(i, 0.3); }, {}, [](uint32_t) { return 0.1f; });
    const auto& right = f.keptRight;
    for (size_t i = 0; i < left.size(); i += 97) {
        const double gl = left[i] / sine(uint32_t(i), 0.3), gr = right[i] / 0.1;
        if (std::abs(sine(uint32_t(i), 0.3)) > 0.05) check(std::abs(gl - gr) < 1e-4, "Sides took different gains");
    }
}

/** No added latency: at Mix 0 and after a complete swell, output equals input exactly. */
void noLatency() {
    Fixture f;
    f.controls[Mix] = 0;
    auto dry = f.render(4800, [](uint32_t i) { return sine(i, 0.001); });
    for (uint32_t i = 0; i < dry.size(); ++i) check(dry[i] == sine(i, 0.001), "Mix 0 is not bit-exact dry");
    Fixture g;
    g.controls[Time] = 20;
    g.render(4800, [](uint32_t i) { return sine(i, 0.3); });
    auto full = g.render(4800, [](uint32_t i) { return sine(i, 0.3, 997); });
    for (uint32_t i = 0; i < full.size(); ++i) check(full[i] == sine(i, 0.3, 997), "A swelled note is delayed or altered");
}

void invalidInputAndControlsAreSafe() {
    Fixture f(true);
    f.controls[Time] = std::numeric_limits<float>::quiet_NaN();
    f.controls[Curve] = 1e9f;
    f.controls[Threshold] = -std::numeric_limits<float>::infinity();
    auto out = f.render(4800, [](uint32_t i) { return i % 7 ? std::numeric_limits<float>::infinity() : 0.2f; });
    for (float v : out) check(std::isfinite(v), "Invalid input leaked");
    for (float v : f.keptRight) check(std::isfinite(v), "Invalid input leaked on the right");
    check(!lv2_descriptor(2), "Only two descriptors");
    const auto* d = lv2_descriptor(0);
    check(!d->instantiate(d, 8000, "", nullptr), "Unsupported rate accepted");
}
}  // namespace

int main() {
    try {
        attackIsDetectedAndHidden();
        curveShapesTheFade();
        swellTimeIsHonoured(48000);
        swellTimeIsHonoured(96000);
        changingControlsMidSwellIsSmooth();
        releaseAndNextNote();
        sensitivityRetriggers();
        stereoIsLinked();
        noLatency();
        invalidInputAndControlsAreSafe();
    } catch (const std::exception& e) {
        std::cerr << "FAIL: " << e.what() << "\n";
        return EXIT_FAILURE;
    }
    std::cout << "swell tests passed\n";
    return EXIT_SUCCESS;
}
