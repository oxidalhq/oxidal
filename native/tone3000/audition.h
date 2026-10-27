// Oxidal-owned prepare/commit boundary. No target mutation during model parsing/prewarm.
// This currently uses the native wet-mute splice, not a gapless crossfade.
#pragma once
#include <atomic>
#include <thread>
#include <limits>

class OxidalModelPreparation {
public:
  enum Phase { preparing, ready, applying, applied, failed, cancelled };
  explicit OxidalModelPreparation(TONE3000Processor& owner, const std::string& target,
                                  const juce::File& source, const juce::var& tone)
      : p(owner), targetId(target) {
    const auto format = tone["format"].toString();
    const auto* models = tone["models"].getArray();
    const auto toneId = static_cast<juce::int64>(tone["id"]);
    if (target.empty() || target.size() > 128 || !source.existsAsFile() ||
        source.getSize() <= 0 || source.getSize() > 32 * 1024 * 1024 ||
        (format != "nam" && format != "ir") || !models || models->size() != 1 ||
        toneId < 1 || toneId > std::numeric_limits<int>::max())
      throw std::runtime_error("invalid model preparation request");
    const auto modelId = static_cast<juce::int64>((*models)[0]["id"]);
    if (modelId < 1 || modelId > std::numeric_limits<int>::max())
      throw std::runtime_error("invalid model identity");
    type = format == "nam" ? ChainBlockType::NAM : ChainBlockType::IR;
    {
      juce::ScopedLock lock(p.chainMutex);
      auto* current = p.findBlockById(target);
      if (!current || current->modelLoading || current->loadFailed)
        throw std::runtime_error("target missing or not ready");
      inserting = current->type == ChainBlockType::INSERT;
      candidate = std::make_unique<ChainBlock>(inserting ? juce::Uuid().toString().toStdString() : target, type);
      candidate->namSlimSize = inserting ? p.namSlimSizeDefault.load() : current->namSlimSize;
      p.setToneOnBlock(*candidate, static_cast<int>(toneId), juce::JSON::toString(tone), tone.clone());
      candidate->activeModelId = static_cast<int>(modelId);
      candidate->applyDefaultMixOnLoad = inserting;
      if (inserting) p.prepareBlockForChainRate(*candidate);
      baseline = p.serializeBlockSettings(*current);
      revision = p.chainRevision.load();
      factor = p.chainOversampleFactor.load(); voices = p.wantedNamVoices();
    }
    task = std::thread([this, source] {
      try {
        juce::MemoryBlock data;
        if (!source.loadFileAsData(data) || data.getSize() == 0 || data.getSize() > 32 * 1024 * 1024)
          throw std::runtime_error("model read failed");
        const auto* first = static_cast<const uint8_t*>(data.getData());
        std::vector<uint8_t> bytes(first, first + data.getSize());
        prepared = p.prepareBlockModelOffThread(type, bytes, source.getFileName(), candidate->namSlimSize);
        if (!prepared.success || (type == ChainBlockType::NAM ? !prepared.namEngine : !prepared.convolverMono))
          throw std::runtime_error("model preparation failed; previous sound retained");
        candidate->modelCache.emplace(candidate->activeModelId, std::move(bytes));
      } catch (...) { preparationFailed = true; }
      done.store(true, std::memory_order_release);
    });
  }
  ~OxidalModelPreparation() { cancel(); if (task.joinable()) task.join(); }
  bool finishedPreparing() const { return done.load(std::memory_order_acquire); }
  void cancel() {
    if (phase == applied || phase == failed || phase == cancelled) return;
    resetFade(); phase = cancelled;
  }
  void commit() {
    poll();
    if (phase != ready) throw std::runtime_error("model is not ready to audition");
    juce::ScopedLock lock(p.chainMutex);
    if (!current()) { reject("target or processing settings changed; select again"); return; }
    auto* block = p.findBlockById(targetId);
    if (!inserting) {
      block->swapFadeDone.store(false);
      block->swapMuteWet.store(true);
      block->swapFadePending.store(true);
    }
    phase = applying;
    started = juce::Time::getMillisecondCounterHiRes();
  }
  void poll() {
    if (phase == preparing && finishedPreparing()) {
      if (task.joinable()) task.join();
      if (preparationFailed) { reject("model preparation failed; previous sound retained"); return; }
      phase = ready;
    }
    if (phase != ready && phase != applying) return;
    juce::ScopedLock lock(p.chainMutex);
    if (!current()) { reject("target or processing settings changed; select again"); return; }
    if (phase != applying) return;
    auto* block = p.findBlockById(targetId);
    if (!inserting && !block->swapFadeDone.load()) {
      if (juce::Time::getMillisecondCounterHiRes() - started > 1000)
        reject("audio did not finish the model transition; previous sound retained");
      return;
    }
    // All fallible parsing/prewarm is complete. Settings, metadata and engine
    // become visible together. The old engines stay in `prepared` until disposal
    // outside this lock; the existing block identity and user controls survive.
    p.pushChainHistory();
    if (inserting) {
      for (auto& lane : p.lanes) for (auto& slot : lane) if (slot.get() == block) {
        p.applyPreparedModelToChainBlock(*candidate, type, prepared);
        resultingId = candidate->id;
        slot.swap(candidate);
        p.alignBranchLaneLengths();
        p.refreshIrTailLength();
        phase = applied; return;
      }
    } else {
      std::swap(block->toneId, candidate->toneId);
      std::swap(block->toneJson, candidate->toneJson);
      std::swap(block->toneVar, candidate->toneVar);
      std::swap(block->toneSummary, candidate->toneSummary);
      std::swap(block->activeModelId, candidate->activeModelId);
      block->modelCache.swap(candidate->modelCache);
      p.applyPreparedModelToChainBlock(*block, type, prepared);
      resultingId = targetId;
      phase = applied;
    }
  }
  juce::var status() {
    poll();
    const char* names[] = {"preparing","ready","applying","applied","failed","cancelled"};
    juce::DynamicObject::Ptr result = new juce::DynamicObject();
    result->setProperty("phase", names[phase]);
    result->setProperty("block_id", juce::String(resultingId.empty() ? targetId : resultingId));
    result->setProperty("error", message);
    return result.get();
  }
private:
  bool current() const {
    auto* block = p.findBlockById(targetId);
    return block && p.serializeBlockSettings(*block).isEquivalentTo(baseline) && p.chainRevision.load() == revision && p.chainOversampleFactor.load() == factor
      && p.wantedNamVoices() == voices && !block->modelLoading && !block->loadFailed
      && (block->type == ChainBlockType::INSERT) == inserting
      && (type != ChainBlockType::NAM || (prepared.namEngine && prepared.namEngine->getOversampleFactor() == factor
        && prepared.namEngine->getVoiceCount() == voices && prepared.preparedBlockSize >= p.chainDomainBlockSize()))
      && (type != ChainBlockType::IR || prepared.preparedIrBlockSize == p.irConvolverBlockSize());
  }
  void resetFade() {
    if (phase != applying || inserting) return;
    juce::ScopedLock lock(p.chainMutex);
    if (auto* block = p.findBlockById(targetId)) {
      block->swapFadePending.store(false); block->swapFadeDone.store(false);
      // Preserve swapMuteWet while its gain returns to unity in processBlock.
    }
  }
  void reject(const char* error) { resetFade(); message = error; phase = failed; }
  TONE3000Processor& p;
  std::string targetId, resultingId;
  std::unique_ptr<ChainBlock> candidate;
  TONE3000Processor::PreparedBlockModel prepared;
  ChainBlockType type = ChainBlockType::NAM;
  juce::ValueTree baseline;
  juce::uint32 revision = 0;
  int factor = 1, voices = 1;
  bool inserting = false, preparationFailed = false;
  std::atomic<bool> done{false};
  std::thread task;
  Phase phase = preparing;
  juce::String message;
  double started = 0;
};
