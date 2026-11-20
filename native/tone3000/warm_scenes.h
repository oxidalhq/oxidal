#pragma once

#include <algorithm>
#include <array>
#include <functional>
#include <string_view>

// Private Rust/native wire layout. No borrowed data survive the owner call.
struct OxidalSceneRow {
  void* handle;
  const char* block;
  uint32_t control;
  float value;
};

class OxidalWarmScenes {
public:
  enum Control : uint32_t { Enabled, InputGain, OutputGain, Mix };
  static constexpr size_t MaxBypass = 128;
  static constexpr size_t MaxControls = 32;

  static juce::var candidates(TONE3000Processor& processor) {
    juce::ScopedLock lock(processor.chainMutex);
    juce::Array<juce::var> result;
    for (const auto& lane : processor.lanes) {
      if (&lane == &processor.lanes[1] && !processor.isStereoMode())
        continue;
      for (const auto& block : lane) {
        if (!ready(processor, *block))
          continue;
        if (block->id.empty() || block->id.size() > 128 || result.size() >= 512)
          throw std::runtime_error("Native bypass catalog exceeds its bounds");
        auto* row = new juce::DynamicObject();
        row->setProperty("block", juce::String(block->id));
        row->setProperty("value", !block->enabled);
        result.add(juce::var(row));
      }
    }
    return juce::var(result);
  }

  static bool transitioning(TONE3000Processor& processor) {
    juce::ScopedLock lock(processor.chainMutex);
    if (failed(processor))
      throw std::runtime_error("An armed native scene block failed while rendering");
    bool active = false;
    size_t armed = 0;
    for (size_t side = 0; side < processor.lanes.size(); ++side) {
      const auto& lane = processor.lanes[side];
      const int fixedLastNam = processor.oxidalSceneLastNam[side];
      if (fixedLastNam != -2 && fixedLastNam != lastLoadedNam(processor, lane))
        throw std::runtime_error("An armed native scene lane lost its prepared layout");
      for (const auto& block : lane) {
        if (block->oxidalWarmSceneFrames != 0) {
          ++armed;
          if (!ready(processor, *block) || !preparedRate(processor, *block)
              || (side == 1 && !processor.isStereoMode()))
            throw std::runtime_error("An armed native scene block lost prepared DSP");
          active |= block->wetFadeGain.isSmoothing();
        }
        const auto controls = block->oxidalSceneScalarMask;
        active |= (controls & ChainBlock::SceneInputGain) && block->inputGainSmoother.isSmoothing();
        active |= (controls & ChainBlock::SceneOutputGain) && block->outputGainSmoother.isSmoothing();
        active |= (controls & ChainBlock::SceneMix) && block->mixSmoother.isSmoothing();
      }
    }
    if (armed != processor.oxidalSceneArmedCount)
      throw std::runtime_error("An armed native scene block is missing");
    return active;
  }

  static bool failed(const TONE3000Processor& processor) noexcept {
    return processor.oxidalSceneRenderFailed.load(std::memory_order_relaxed);
  }

  static size_t batch(const OxidalSceneRow* rows, size_t count, uint32_t fade, bool prepare,
                      size_t byteBudget) {
    constexpr auto capacity = MaxBypass + MaxControls;
    if (count == 0)
      return 0;
    if (!rows || count > (prepare ? MaxBypass : capacity) || (prepare && (fade == 0 || fade > 48000)))
      throw std::runtime_error("Native scene batch exceeds its bounds");
    struct Staged {
      TONE3000Processor* processor{};
      ChainBlock* block{};
      bool inactiveLane{};
      int factor{1};
      int baseFrames{};
      std::unique_ptr<ChainBlock::SceneIrDry> dry;
    };
    std::array<Staged, capacity> staged{};
    std::array<TONE3000Processor*, capacity> processors{};
    size_t engineCount = 0;
    for (size_t i = 0; i < count; ++i) {
      auto& e = engine(rows[i].handle);
      if (e.preparation && !e.preparation->sceneChangeReady())
        throw std::runtime_error("Finish native model preparation before applying a scene");
      auto* processor = &e.processor;
      staged[i].processor = processor;
      if (std::find(processors.begin(), processors.begin() + engineCount, processor)
          == processors.begin() + engineCount)
        processors[engineCount++] = processor;
    }
    std::sort(processors.begin(), processors.begin() + engineCount,
              std::less<TONE3000Processor*>{});
    struct Locks {
      std::array<juce::CriticalSection*, capacity> mutexes{};
      size_t count{0};
      ~Locks() { while (count > 0) mutexes[--count]->exit(); }
    } locks;
    for (size_t i = 0; i < engineCount; ++i) {
      auto& processor = *processors[i];
      processor.chainMutex.enter();
      locks.mutexes[locks.count++] = &processor.chainMutex;
      if (failed(processor))
        throw std::runtime_error("An armed native scene block failed while rendering");
      if (processor.isChainEditFadeHeld())
        throw std::runtime_error("Finish the current native edit before applying a scene");
    }
    size_t bypassCount = 0;
    size_t controlCount = 0;
    for (size_t i = 0; i < count; ++i) {
      const auto& row = rows[i];
      auto& target = staged[i];
      if (!row.block || std::strlen(row.block) == 0 || std::strlen(row.block) > 128
          || row.control > Mix || !std::isfinite(row.value)
          || row.value < 0.0f || row.value > 1.0f
          || (row.control == Enabled && row.value != 0.0f && row.value != 1.0f)
          || (prepare && row.control != Enabled))
        throw std::runtime_error("Invalid native scene control");
      if (row.control == Enabled)
        ++bypassCount;
      else
        ++controlCount;
      for (const auto& lane : target.processor->lanes) {
        for (const auto& block : lane) {
          if (block->id != row.block)
            continue;
          if (target.block)
            throw std::runtime_error("Ambiguous native scene block");
          target.block = block.get();
          target.inactiveLane = &lane == &target.processor->lanes[1]
              && !target.processor->isStereoMode();
        }
      }
      if (!target.block || !ready(*target.processor, *target.block)
          || (row.control == Enabled && target.inactiveLane)
          || (row.control == Enabled && !prepare
              && (target.block->oxidalWarmSceneFrames == 0 || !preparedRate(*target.processor, *target.block)))
          || (prepare && target.block->oxidalWarmSceneFrames != 0))
        throw std::runtime_error("Native scene block is not prepared");
      for (size_t j = 0; j < i; ++j)
        if (staged[j].processor == target.processor && staged[j].block == target.block
            && rows[j].control == row.control)
          throw std::runtime_error("Duplicate native scene control");
    }
    if (bypassCount > MaxBypass || controlCount > MaxControls)
      throw std::runtime_error("Native scene batch exceeds its target limits");

    std::array<std::array<int, 2>, capacity> layouts{};
    size_t bytes = 0;
    if (prepare) {
      for (size_t i = 0; i < engineCount; ++i) {
        auto& processor = *processors[i];
        if (processor.oxidalSceneArmedCount != 0)
          throw std::runtime_error("Warm native layout is already prepared");
        auto& layout = layouts[i];
        layout = {-2, -2};
        for (size_t side = 0; side < processor.lanes.size(); ++side) {
          const auto& lane = processor.lanes[side];
          const bool hasArmed = std::any_of(lane.begin(), lane.end(), [&](const auto& block) {
            return std::any_of(staged.begin(), staged.begin() + count,
                [&](const auto& row) { return row.block == block.get(); });
          });
          if (hasArmed)
            layout[side] = lastLoadedNam(processor, lane);
        }
      }
      const auto admit = [&](size_t additional) {
        if (additional > byteBudget - bytes)
          throw std::runtime_error("Warm native scenes exceed the owner buffer budget");
        bytes += additional;
      };
      const auto bookkeeping = bypassCount * (sizeof(int) + sizeof(uint8_t))
          + engineCount * (sizeof(layouts[0]) + sizeof(size_t) + sizeof(std::atomic<bool>));
      admit(bookkeeping);
      // Admit the total before allocating any extra dry island. The largest
      // allowed host period/rate pair needs 12288 base frames.
      for (size_t i = 0; i < count; ++i) {
        auto& target = staged[i];
        target.factor = target.processor->chainOversampleFactor.load();
        target.baseFrames = target.processor->chainBaseBlockSize();
        if ((target.factor != 1 && target.factor != 2 && target.factor != 4 && target.factor != 8)
            || target.baseFrames < 1 || target.baseFrames > 16384
            || (target.block->type == ChainBlockType::NAM
                && target.block->namEngine->getOversampleFactor() != target.factor))
          throw std::runtime_error("Native scene block has an unsupported prepared rate");
        if (target.block->type == ChainBlockType::IR && target.factor > 1)
          admit(ChainBlock::SceneIrDry::requiredBytes(target.factor, target.baseFrames));
      }
      bytes = bookkeeping;
      for (size_t i = 0; i < count; ++i) {
        auto& target = staged[i];
        if (target.block->type == ChainBlockType::IR && target.factor > 1) {
          target.dry = std::make_unique<ChainBlock::SceneIrDry>(target.factor, target.baseFrames);
          admit(target.dry->allocatedBytes());
        }
      }
      // All state has been prepared and its measured capacity fits the owner.
      for (size_t i = 0; i < engineCount; ++i)
        processors[i]->oxidalSceneLastNam = layouts[i];
    }

    // Every target and lane has been validated. Only this loop changes endpoints.
    for (size_t i = 0; i < count; ++i) {
      auto& block = *staged[i].block;
      const auto& row = rows[i];
      switch (row.control) {
        case Enabled:
          if (prepare) {
            if (block.oxidalWarmSceneFrames == 0)
              ++staged[i].processor->oxidalSceneArmedCount;
            block.oxidalWarmSceneFrames = static_cast<int>(fade) * staged[i].factor;
            block.sceneIrDry = std::move(staged[i].dry);
            block.wetFadeGain.reset(block.oxidalWarmSceneFrames);
            block.wetFadeGain.setCurrentAndTargetValue(block.enabled ? 1.0f : 0.0f);
          } else {
            block.enabled = row.value == 1.0f;
            block.wetFadeGain.setTargetValue(row.value);
          }
          break;
        case InputGain:
          block.inputGainNormalized = row.value;
          block.oxidalSceneScalarMask |= ChainBlock::SceneInputGain;
          aimScalar(block, block.inputGainSmoother, sceneGain(row.value), staged[i].inactiveLane);
          break;
        case OutputGain:
          block.outputGainNormalized = row.value;
          block.oxidalSceneScalarMask |= ChainBlock::SceneOutputGain;
          aimScalar(block, block.outputGainSmoother, sceneGain(row.value), staged[i].inactiveLane);
          break;
        case Mix:
          block.mixNormalized = row.value;
          block.oxidalSceneScalarMask |= ChainBlock::SceneMix;
          aimScalar(block, block.mixSmoother, row.value, staged[i].inactiveLane);
          break;
      }
    }
    for (size_t i = 0; i < engineCount; ++i)
      processors[i]->bumpChainRevision();
    return bytes;
  }

private:
  static float sceneGain(float value) noexcept {
    return juce::Decibels::decibelsToGain((value - 0.5f) * 48.0f);
  }

  static void aimScalar(const ChainBlock& block, juce::SmoothedValue<float>& smoother,
                        float value, bool inactiveLane) noexcept {
    const bool coldSilent = !block.enabled && block.oxidalWarmSceneFrames == 0
        && !block.wetFadeGain.isSmoothing() && block.wetFadeGain.getCurrentValue() <= 0.001f;
    if (coldSilent || inactiveLane)
      smoother.setCurrentAndTargetValue(value);
    else
      smoother.setTargetValue(value);
  }

  template<typename Lane>
  static int lastLoadedNam(const TONE3000Processor& processor, const Lane& lane) {
    int last = -1;
    for (size_t i = 0; i < lane.size(); ++i)
      if (lane[i]->type == ChainBlockType::NAM && ready(processor, *lane[i]))
        last = static_cast<int>(i);
    return last;
  }

  static bool preparedRate(const TONE3000Processor& processor, const ChainBlock& block) {
    const int factor = processor.chainOversampleFactor.load();
    if (block.type == ChainBlockType::NAM)
      return block.namEngine->getOversampleFactor() == factor;
    if (factor == 1)
      return !block.sceneIrDry;
    return block.sceneIrDry && block.sceneIrDry->island.getFactor() == factor
        && block.sceneIrDry->frames >= static_cast<size_t>(processor.chainBaseBlockSize()) * factor;
  }

  static bool ready(const TONE3000Processor& processor, const ChainBlock& block) {
    if (!block.loaded || block.modelLoading || block.loadFailed || block.rtProcessingFailed.load())
      return false;
    using Role = TONE3000Processor::OxidalProcessingRole;
    return (block.type == ChainBlockType::NAM && block.namEngine
            && processor.oxidalProcessingRole != Role::Cab)
        || (block.type == ChainBlockType::IR && block.convolverMono
            && (block.irNumChannels <= 1 || block.convolverStereo)
            && processor.oxidalProcessingRole != Role::Amp);
  }
};

EXPORT int oxidal_t3k_scene_candidates(void* ptr, char* out, size_t capacity, size_t* written) noexcept {
  return guard([&] { json(OxidalWarmScenes::candidates(engine(ptr).processor), out, capacity, written); });
}

EXPORT int oxidal_t3k_scene_batch(const OxidalSceneRow* rows, size_t count, uint32_t fade,
                                  bool prepare, size_t* bytes) noexcept {
  return guard([&] {
    if (!bytes)
      throw std::runtime_error("Missing native scene budget readback");
    const auto budget = prepare ? *bytes : 0;
    *bytes = OxidalWarmScenes::batch(rows, count, fade, prepare, budget);
  });
}

EXPORT int oxidal_t3k_scene_transitioning(void* ptr, bool* result) noexcept {
  return guard([&] {
    if (!result)
      throw std::runtime_error("Missing native scene transition readback");
    *result = OxidalWarmScenes::transitioning(engine(ptr).processor);
  });
}
