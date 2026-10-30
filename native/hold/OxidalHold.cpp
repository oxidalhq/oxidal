// Copyright (c) 2026 Oxidal contributors
// SPDX-License-Identifier: MIT
#include "OxidalHold.hpp"
#include <algorithm>
#include <array>
#include <cmath>
#include <complex>
#include <cstring>
#include <new>
#include <vector>

namespace {
using namespace oxidal_hold;
using Complex = std::complex<float>;
constexpr float Pi = 3.14159265358979f;

/** Frame length for a rate: about 43 ms, a power of two. */
uint32_t frameFor(double rate) {
    return rate <= 50000 ? FrameSize : rate <= 100000 ? FrameSize * 2 : FrameSize * 4;
}

/** In-place iterative radix-2 FFT with tables built at instantiate. */
class Fft {
public:
    explicit Fft(uint32_t n) : n(n), twiddle(n / 2), reversed(n) {
        uint32_t bits = 0;
        while ((1u << bits) < n) ++bits;
        for (uint32_t k = 0; k < n / 2; ++k) twiddle[k] = std::polar(1.0f, -2 * Pi * float(k) / float(n));
        for (uint32_t i = 0; i < n; ++i) {
            uint32_t r = 0;
            for (uint32_t b = 0; b < bits; ++b) r |= ((i >> b) & 1u) << (bits - 1 - b);
            reversed[i] = r;
        }
    }
    void run(Complex* data, bool inverse) const noexcept {
        for (uint32_t i = 0; i < n; ++i)
            if (i < reversed[i]) std::swap(data[i], data[reversed[i]]);
        for (uint32_t size = 2; size <= n; size *= 2) {
            const uint32_t half = size / 2, step = n / size;
            for (uint32_t start = 0; start < n; start += size)
                for (uint32_t k = 0; k < half; ++k) {
                    const Complex w = inverse ? std::conj(twiddle[k * step]) : twiddle[k * step];
                    const Complex t = w * data[start + k + half];
                    data[start + k + half] = data[start + k] - t;
                    data[start + k] += t;
                }
        }
    }
private:
    uint32_t n;
    std::vector<Complex> twiddle;
    std::vector<uint32_t> reversed;
};

/** One channel: recent input, the held spectrum and the running resynthesis. */
struct Channel {
    explicit Channel(uint32_t n)
        : history(n + n / 4), magnitude(n / 2 + 1), phase(n / 2 + 1), advance(n / 2 + 1), overlap(n), ready(n / 4) {}
    std::vector<float> history;  // ring of the latest input
    uint32_t write = 0;
    std::vector<float> magnitude;
    std::vector<float> phase;    // phase of each bin in the held frame
    std::vector<float> advance;  // phase each bin turns through per hop
    std::vector<float> overlap;  // overlap-add of synthesised frames
    std::vector<float> ready;    // the next hop of held sound
};

/** Hold: on the rising edge, read the spectrum of the newest frame and how fast
 * each bin's phase was turning; while held, keep turning every bin at that rate
 * and resynthesise each hop, so a held note stays the same note, in the same
 * place in the stereo image. Fades in and out; everything is allocated here.
 * @see docs/native-hold.md
 */
class Instance {
public:
    Instance(double rate, uint32_t channels)
        : rate(rate), channels(channels), n(frameFor(rate)), hop(n / 4), fft(n), window(n), scratch(n),
          frames{{{std::vector<Complex>(n), std::vector<Complex>(n)}, {std::vector<Complex>(n), std::vector<Complex>(n)}}},
          loudest(n / 2 + 1), keep(n / 2 + 1), lanes{Channel(n), Channel(n)} {
        for (uint32_t i = 0; i < n; ++i) window[i] = 0.5f - 0.5f * std::cos(2 * Pi * float(i) / float(n));
    }
    std::array<float*, PortCount> ports{};
    bool stereo() const noexcept { return channels == 2; }

    void activate() noexcept {
        for (auto& lane : lanes) {
            std::fill(lane.history.begin(), lane.history.end(), 0.0f);
            std::fill(lane.overlap.begin(), lane.overlap.end(), 0.0f);
            std::fill(lane.ready.begin(), lane.ready.end(), 0.0f);
            std::fill(lane.magnitude.begin(), lane.magnitude.end(), 0.0f);
            lane.write = 0;
        }
        gain = 0;
        held = false;
        position = hop;
    }
    void run(uint32_t count) noexcept {
        const bool hold = control(Hold, 0, 1, 0) >= .5f;
        const float attack = control(Attack, 10, 5000, 300) / 1000;
        const float release = control(Release, 10, 10000, 1500) / 1000;
        const float level = std::pow(10.0f, control(Level, -40, 6, 0) / 20);
        const bool dry = control(Dry, 0, 1, 1) >= .5f;
        if (hold && !held) capture();
        held = hold;
        const float up = 1.0f / std::max(1.0f, attack * float(rate));
        const float down = 1.0f / std::max(1.0f, release * float(rate));
        for (uint32_t i = 0; i < count; ++i) {
            float input[2] = {sample(InputL, i), channels == 2 ? sample(InputR, i) : 0.0f};
            for (uint32_t ch = 0; ch < channels; ++ch) {
                auto& lane = lanes[ch];
                lane.history[lane.write] = input[ch];
                lane.write = (lane.write + 1) % uint32_t(lane.history.size());
            }
            gain = held ? std::min(1.0f, gain + up) : std::max(0.0f, gain - down);
            if (gain > 0 && position >= hop) synthesise();
            for (uint32_t ch = 0; ch < channels; ++ch) {
                const float frozen = gain > 0 ? lanes[ch].ready[position] * gain * level : 0.0f;
                if (auto* out = ports[ch ? OutputR : OutputL]) out[i] = (dry ? input[ch] : 0.0f) + frozen;
            }
            if (gain > 0) ++position;
        }
    }

private:
    float control(uint32_t port, float lo, float hi, float fallback) noexcept {
        const float* value = ports[port];
        return value && std::isfinite(*value) ? std::clamp(*value, lo, hi) : fallback;
    }
    float sample(uint32_t port, uint32_t i) const noexcept {
        const float* in = ports[port];
        const float value = in ? in[i] : 0.0f;
        return std::isfinite(value) ? value : 0.0f;
    }
    /** Reads the newest frame and the one a hop before it: the magnitudes are
     * held, and the phase each bin turned through between them is how far it
     * keeps turning, so a held note stays one steady note. Width pulls the two
     * sides toward their mid; Focus lets only the spectral peaks (the note's
     * partials) through, so noise, room and amp hiss are not frozen into a wash. */
    void capture() noexcept {
        const float focus = control(Focus, 0, 100, 80) / 100;
        const float width = control(Width, 0, 100, 50) / 100;
        for (uint32_t ch = 0; ch < channels; ++ch) {
            auto& lane = lanes[ch];
            // A new hold starts clean: nothing of the previous one overlaps it.
            std::fill(lane.overlap.begin(), lane.overlap.end(), 0.0f);
            const auto size = uint32_t(lane.history.size());
            for (uint32_t frame = 0; frame < 2; ++frame) {
                const uint32_t start = (lane.write + size - n - frame * hop) % size;
                auto& target = frames[ch][frame];
                for (uint32_t i = 0; i < n; ++i) target[i] = Complex(lane.history[(start + i) % size] * window[i], 0);
                fft.run(target.data(), false);
            }
        }
        if (channels == 2 && width < 1)
            for (uint32_t frame = 0; frame < 2; ++frame)
                for (uint32_t k = 0; k <= n / 2; ++k) {
                    const Complex mid = (frames[0][frame][k] + frames[1][frame][k]) * 0.5f;
                    frames[0][frame][k] = mid + width * (frames[0][frame][k] - mid);
                    frames[1][frame][k] = mid + width * (frames[1][frame][k] - mid);
                }
        pickPeaks(focus);
        for (uint32_t ch = 0; ch < channels; ++ch) {
            auto& lane = lanes[ch];
            const auto& newest = frames[ch][0];
            const auto& older = frames[ch][1];
            double before = 0, after = 0;
            for (uint32_t k = 0; k <= n / 2; ++k) {
                const float magnitude = std::abs(newest[k]);
                const float kept = magnitude * keep[k];
                before += double(magnitude) * magnitude;
                after += double(kept) * kept;
                lane.magnitude[k] = kept;
                lane.phase[k] = std::arg(newest[k]);
                const float expected = 2 * Pi * float(k) * float(hop) / float(n);
                float turned = std::arg(newest[k]) - std::arg(older[k]) - expected;
                turned -= 2 * Pi * std::round(turned / (2 * Pi));
                lane.advance[k] = expected + turned;
            }
            // What is left of the sound keeps the loudness the whole had.
            const float restore = after > 0 ? std::min(4.0f, float(std::sqrt(before / after))) : 1.0f;
            for (auto& m : lane.magnitude) m *= restore;
        }
        position = hop;
    }
    /** Per-bin gain: 1 within two bins of a spectral peak, 1 - focus elsewhere.
     * A peak is a local maximum of the sides' summed magnitude that stands well
     * above both its neighbourhood and the loudest partial. */
    void pickPeaks(float focus) noexcept {
        const uint32_t bins = n / 2 + 1;
        for (uint32_t k = 0; k < bins; ++k) {
            float sum = 0;
            for (uint32_t ch = 0; ch < channels; ++ch) sum += std::abs(frames[ch][0][k]);
            loudest[k] = sum;
        }
        const float top = *std::max_element(loudest.begin(), loudest.end());
        std::fill(keep.begin(), keep.end(), 1.0f - focus);
        if (focus <= 0 || top <= 0) return;
        constexpr uint32_t Reach = 24, Side = 3, Spread = 2;
        // Running sum over +-Reach bins gives each bin's neighbourhood level.
        double running = 0;
        for (uint32_t k = 0; k <= std::min(Reach, bins - 1); ++k) running += loudest[k];
        for (uint32_t k = 0; k < bins; ++k) {
            if (k > 0) {
                if (k + Reach < bins) running += loudest[k + Reach];
                if (k > Reach) running -= loudest[k - Reach - 1];
            }
            const uint32_t lo = k > Reach ? k - Reach : 0, hi = std::min(bins - 1, k + Reach);
            const float around = float(running / double(hi - lo + 1));
            bool peak = loudest[k] > 2.0f * around && loudest[k] > 0.03f * top;
            for (uint32_t j = k > Side ? k - Side : 0; peak && j <= std::min(bins - 1, k + Side); ++j)
                if (loudest[j] > loudest[k]) peak = false;
            if (!peak) continue;
            for (uint32_t j = k > Spread ? k - Spread : 0; j <= std::min(bins - 1, k + Spread); ++j) keep[j] = 1.0f;
        }
    }
    /** One hop of held sound: the held magnitudes, each bin's phase turned on by its own rate. */
    void synthesise() noexcept {
        // A steady sinusoid of amplitude A has bin magnitude A·N/4 under a Hann
        // window; the inverse turns it into A/2, the synthesis window and the
        // quarter-frame overlap-add (sum of w² = 1.5) make that 0.75·A, and
        // 2/3 brings it back to A.
        const float scale = 2.0f / 3.0f / float(n);
        for (uint32_t ch = 0; ch < channels; ++ch) {
            auto& lane = lanes[ch];
            scratch[0] = Complex(lane.magnitude[0], 0);
            scratch[n / 2] = Complex(lane.magnitude[n / 2], 0);
            for (uint32_t k = 1; k < n / 2; ++k) {
                lane.phase[k] += lane.advance[k];
                lane.phase[k] -= 2 * Pi * std::round(lane.phase[k] / (2 * Pi));
                scratch[k] = std::polar(lane.magnitude[k], lane.phase[k]);
                scratch[n - k] = std::conj(scratch[k]);
            }
            fft.run(scratch.data(), true);
            std::copy(lane.overlap.begin() + hop, lane.overlap.end(), lane.overlap.begin());
            std::fill(lane.overlap.end() - hop, lane.overlap.end(), 0.0f);
            for (uint32_t i = 0; i < n; ++i) lane.overlap[i] += scratch[i].real() * window[i] * scale;
            std::copy_n(lane.overlap.begin(), hop, lane.ready.begin());
        }
        position = 0;
    }

    double rate;
    uint32_t channels, n, hop;
    Fft fft;
    std::vector<float> window;
    std::vector<Complex> scratch;
    std::array<std::array<std::vector<Complex>, 2>, 2> frames;  // [side][newest, a hop earlier]
    std::vector<float> loudest;                                  // summed magnitude across sides
    std::vector<float> keep;                                     // per-bin gain from the peak picker
    std::array<Channel, 2> lanes;
    float gain = 0;
    bool held = false;
    uint32_t position = 0;
};

LV2_Handle instantiate(const LV2_Descriptor* descriptor, double rate, const char*, const LV2_Feature* const*) noexcept {
    if (!std::isfinite(rate) || rate < 22050 || rate > 192000) return nullptr;
    try {
        auto* instance = new Instance(rate, std::strcmp(descriptor->URI, StereoUri) == 0 ? 2 : 1);
        instance->activate();
        return instance;
    } catch (...) {
        return nullptr;
    }
}
void connect(LV2_Handle handle, uint32_t port, void* data) noexcept {
    if (!handle) return;
    auto* instance = static_cast<Instance*>(handle);
    // Mono has no Width control, so its audio ports start one place earlier.
    if (!instance->stereo() && port >= Width) ++port;
    if (port < PortCount) instance->ports[port] = static_cast<float*>(data);
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
 * @see docs/native-hold.md
 */
LV2_SYMBOL_EXPORT const LV2_Descriptor* lv2_descriptor(uint32_t index) {
    return index < 2 ? &descriptors[index] : nullptr;
}
