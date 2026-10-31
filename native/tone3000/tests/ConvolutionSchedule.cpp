// Compare the actual pinned engine and reviewed overlay, including irregular
// callback boundaries and reset. @see docs/mixed-engine.md
#include "convolution-engines.h"
#include <algorithm>
#include <chrono>
#include <cmath>
#include <iostream>
#include <stdexcept>
#include <vector>

void compareHeadSizes() {
  juce::dsp::Convolution a(juce::dsp::Convolution::NonUniform{8192});
  juce::dsp::Convolution b(juce::dsp::Convolution::NonUniform{2048});
  juce::AudioBuffer<float> ir(2, 240001);
  for (int side = 0; side < 2; ++side)
    for (int i = 0; i < ir.getNumSamples(); ++i)
      ir.setSample(side, i, static_cast<float>(0.003 * std::sin(i * (0.31 + side * 0.1)) * std::exp(-5.0 * i / ir.getNumSamples())));
  ir.setSample(0, 0, 0.5f); ir.setSample(1, 0, 0.3f);
  auto copy = ir;
  a.loadImpulseResponse(std::move(ir), 48000, juce::dsp::Convolution::Stereo::yes, juce::dsp::Convolution::Trim::no, juce::dsp::Convolution::Normalise::no);
  b.loadImpulseResponse(std::move(copy), 48000, juce::dsp::Convolution::Stereo::yes, juce::dsp::Convolution::Trim::no, juce::dsp::Convolution::Normalise::no);
  a.prepare({48000, 384, 2}); b.prepare({48000, 384, 2});
  juce::AudioBuffer<float> left(2, 384), right(2, 384);
  size_t cursor = 0;
  float worst = 0;
  double energy = 0;
  for (size_t block = 0; block < 2200; ++block) {
    const auto frames = std::array<size_t, 4>{192, 256, 384, 127}[block % 4];
    for (int side = 0; side < 2; ++side)
      for (size_t i = 0; i < frames; ++i) {
        const float value = block >= 100 && block < 1100 ? static_cast<float>(0.15 * std::sin((cursor + i) * (0.073 + side * 0.019))) : 0;
        left.setSample(side, static_cast<int>(i), value);
        right.setSample(side, static_cast<int>(i), value);
      }
    if (block == 837) { a.reset(); b.reset(); }
    auto x = juce::dsp::AudioBlock<float>(left).getSubBlock(0, frames);
    auto y = juce::dsp::AudioBlock<float>(right).getSubBlock(0, frames);
    a.process(juce::dsp::ProcessContextReplacing<float>(x));
    b.process(juce::dsp::ProcessContextReplacing<float>(y));
    for (int side = 0; side < 2; ++side)
      for (size_t i = 0; i < frames; ++i) {
        const auto value = right.getSample(side, static_cast<int>(i));
        if (!std::isfinite(value)) throw std::runtime_error("Nonfinite stereo convolution");
        worst = std::max(worst, std::abs(left.getSample(side, static_cast<int>(i)) - value));
        energy += value * value;
      }
    cursor += frames;
  }
  if (worst > 1e-5f || energy < 1 || a.getLatency() != 0 || b.getLatency() != 0 || a.getCurrentIRSize() != 240001 || b.getCurrentIRSize() != 240001)
    throw std::runtime_error("IR head-size equivalence failed: " + std::to_string(worst));
  std::cout << "stereo_head_sizes=8192/2048 full_ir=240001 latency=0 max_error=" << worst << '\n';
}

int main() {
  compareHeadSizes();
  using Clock = std::chrono::steady_clock;
  for (const auto partition : {64u, 256u, 2048u, 8192u}) {
    for (const auto length : {1u, 97u, 48000u, 240001u}) {
      std::vector<float> ir(length);
      for (size_t i = 0; i < ir.size(); ++i)
        ir[i] = static_cast<float>(std::sin(i * 0.73) * std::exp(-6.0 * i / length) * 0.01);
      ir[0] = 0.5f;
      juce::dsp::ReferenceConvolutionEngine reference(ir.data(), ir.size(), partition);
      juce::dsp::ScheduledConvolutionEngine scheduled(ir.data(), ir.size(), partition);
      std::vector<float> input(513), a(513), b(513);
      double originalMax = 0, changedMax = 0;
      double originalTotal = 0, changedTotal = 0;
      size_t cursor = 0;
      for (size_t block = 0; block < 1600; ++block) {
        const size_t frames = std::array<size_t, 7>{192, 1, 256, 384, 127, 513, 64}[block % 7];
        for (size_t i = 0; i < frames; ++i)
          input[i] = block < 900 ? static_cast<float>(0.2 * std::sin((cursor + i) * 0.073) + 0.1 * std::cos((cursor + i) * 0.411)) : 0.0f;
        if (block == 437) { reference.reset(); scheduled.reset(); }
        auto start = Clock::now();
        reference.processSamplesWithAddedLatency(input.data(), a.data(), frames);
        const auto originalUs = std::chrono::duration<double, std::micro>(Clock::now() - start).count();
        start = Clock::now();
        scheduled.processSamplesWithAddedLatency(input.data(), b.data(), frames);
        const auto changedUs = std::chrono::duration<double, std::micro>(Clock::now() - start).count();
        originalMax = std::max(originalMax, originalUs);
        changedMax = std::max(changedMax, changedUs);
        originalTotal += originalUs; changedTotal += changedUs;
        for (size_t i = 0; i < frames; ++i) {
          if (!std::isfinite(b[i]) || a[i] != b[i])
            throw std::runtime_error("Convolution PCM differs: partition=" + std::to_string(partition) + " length=" + std::to_string(length) + " block=" + std::to_string(block));
        }
        cursor += frames;
      }
      std::cout << "partition=" << partition << " samples=" << length
                << " bit_exact=true reference_mean_us=" << originalTotal / 1600
                << " scheduled_mean_us=" << changedTotal / 1600
                << " reference_peak_us=" << originalMax << " scheduled_peak_us=" << changedMax << '\n';
    }
  }
}
