// Oxidal-owned prepare/commit boundary. No target mutation during model parsing/prewarm.
// This currently uses the native wet-mute splice, not a gapless crossfade.
#pragma once
#include <atomic>
#include <thread>
#include <limits>
#include <map>
#include <set>
#include <functional>

class OxidalModelPreparation {
public:
  enum Phase { preparing, ready, applying, applied, failed, cancelled };
  // Only used while rebuilding an isolated working session, before PCM opens.
  // New trailing insert slots receive fresh native UUIDs; replay binds the exact
  // recorded identity back to its empty coordinate before filling it.
  static void restoreSlot(TONE3000Processor& p, const std::string& target, int lane, int index) {
    if (target.empty() || target.size() > 128 || lane < 0 || lane > 1 || index < 0)
      throw std::runtime_error("invalid replay slot");
    juce::ScopedLock lock(p.chainMutex);
    if (static_cast<size_t>(index) >= p.lanes[lane].size()) throw std::runtime_error("replay slot missing");
    auto* block = p.lanes[lane][static_cast<size_t>(index)].get();
    if (auto* existing = p.findBlockById(target)) {
      if (existing != block) throw std::runtime_error("replay identity moved");
      return;
    }
    if (block->type != ChainBlockType::INSERT) throw std::runtime_error("replay slot occupied");
    block->id = target;
  }
  using Payloads = std::map<int, std::vector<uint8_t>>;
  using Reader = std::function<Payloads()>;
  static juce::var chain(TONE3000Processor& p) {
    auto state = p.getChainState(-1);
    for (const auto* lane : {"chain", "chainRight"}) {
      if (auto* blocks = state[lane].getArray()) for (auto& row : *blocks) {
        auto* block = p.findBlockById(row["blockId"].toString().toStdString());
        if (!block || !static_cast<bool>(block->toneVar["local"])) continue;
        juce::Array<juce::var> choices;
        if (const auto* models = block->toneVar["models"].getArray()) for (const auto& model : *models) {
          const int id=static_cast<int>(model["id"]);
          if (!block->modelCache.count(id)) continue;
          juce::DynamicObject::Ptr choice = new juce::DynamicObject();
          choice->setProperty("id", id);choice->setProperty("name",model["name"].toString().substring(0,200));
          choices.add(choice.get());
        }
        if (choices.size()>1) {
          row.getDynamicObject()->setProperty("variants",choices);
          row.getDynamicObject()->setProperty("active_model",block->activeModelId);
        }
      }
    }
    return state;
  }
  static std::unique_ptr<OxidalModelPreparation> selected(TONE3000Processor& p, const std::string& target, int selectedId) {
    juce::ScopedLock lock(p.chainMutex);
    auto* block=p.findBlockById(target);
    if (!block || !static_cast<bool>(block->toneVar["local"]) || !block->modelCache.count(selectedId))
      throw std::runtime_error("Local variant is not embedded in this block");
    bool found=false;
    if (const auto* models=block->toneVar["models"].getArray()) for(const auto& model:*models)
      if(static_cast<int>(model["id"])==selectedId)found=true;
    if(!found)throw std::runtime_error("Local variant identity missing");
    // Restoring owned history may retain cache entries from earlier tones.
    // Only current collection members belong to this replacement candidate.
    Payloads bytes;
    for(const auto& model:*block->toneVar["models"].getArray()) {
      const int id=static_cast<int>(model["id"]);
      const auto cached=block->modelCache.find(id);
      if(cached==block->modelCache.end())throw std::runtime_error("Local variant is not embedded in this block");
      bytes.emplace(id,cached->second);
    }
    return std::make_unique<OxidalModelPreparation>(p,target,block->toneVar.clone(),selectedId,
      [bytes=std::move(bytes)]() mutable { return std::move(bytes); });
  }
  explicit OxidalModelPreparation(TONE3000Processor& owner, const std::string& target,
                                  const juce::File& source, const juce::var& tone, const juce::var& files={})
      : OxidalModelPreparation(owner,target,tone,static_cast<int>(tone["models"][0]["id"]),
        [source,files,tone] {
          Payloads payloads;size_t total=0;
          auto load=[&](int id,const juce::File& path) {
            juce::MemoryBlock data;
            if(id<1 || payloads.count(id) || !path.existsAsFile() || path.getSize()<=0 || path.getSize()>32*1024*1024 ||
              !path.loadFileAsData(data) || data.getSize()==0 || data.getSize()>32*1024*1024-total)
              throw std::runtime_error("Invalid collection payload");
            total+=data.getSize();const auto* first=static_cast<const uint8_t*>(data.getData());
            payloads.emplace(id,std::vector<uint8_t>(first,first+data.getSize()));
          };
          if(const auto* paths=files.getArray()) {
            for(const auto& entry:*paths)load(static_cast<int>(entry["id"]),juce::File(entry["path"].toString()));
          } else load(static_cast<int>(tone["models"][0]["id"]),source);
          return payloads;
        }) {}
  OxidalModelPreparation(TONE3000Processor& owner, const std::string& target,
                        const juce::var& tone,int selectedId,Reader reader)
      : p(owner), targetId(target) {
    const auto format = tone["format"].toString();
    const auto* models = tone["models"].getArray();
    const auto toneId = static_cast<juce::int64>(tone["id"]);
    const bool local=static_cast<bool>(tone["local"]);
    if (target.empty() || target.size() > 128 || (format != "nam" && format != "ir") ||
        !models || models->isEmpty() || (!local && models->size()!=1) ||
        (local ? toneId != 0 : toneId < 1) || toneId > std::numeric_limits<int>::max())
      throw std::runtime_error("invalid model preparation request");
    std::set<int> identities;
    for(const auto& model:*models) {
      const auto id=static_cast<juce::int64>(model["id"]);
      if(id<1 || id>std::numeric_limits<int>::max() || !identities.insert(static_cast<int>(id)).second)
        throw std::runtime_error("invalid collection model identity");
    }
    if(!identities.count(selectedId))throw std::runtime_error("selected model identity missing");
    const auto role = p.oxidalProcessingRole;
    if ((role == TONE3000Processor::OxidalProcessingRole::Amp && format != "nam") ||
        (role == TONE3000Processor::OxidalProcessingRole::Cab && format != "ir"))
      throw std::runtime_error("model format differs from extracted processing role");
    type = format == "nam" ? ChainBlockType::NAM : ChainBlockType::IR;
    {
      juce::ScopedLock lock(p.chainMutex);
      auto* current = p.findBlockById(target);
      if (!current || current->modelLoading || current->loadFailed)
        throw std::runtime_error("target missing or not ready");
      inserting = current->type == ChainBlockType::INSERT;
      if (role != TONE3000Processor::OxidalProcessingRole::WholePreset && (inserting || current->type != type))
        throw std::runtime_error("extracted stages support only same-format replacement");
      candidate = std::make_unique<ChainBlock>(target, type);
      candidate->namSlimSize = inserting ? p.namSlimSizeDefault.load() : current->namSlimSize;
      p.setToneOnBlock(*candidate, static_cast<int>(toneId), juce::JSON::toString(tone), tone.clone());
      candidate->activeModelId = selectedId;
      candidate->applyDefaultMixOnLoad = inserting;
      if (inserting) p.prepareBlockForChainRate(*candidate);
      if (p.pendingParamBumpAt.exchange(0) != 0) p.bumpChainRevision();
      baseline = p.serializeBlockSettings(*current);
      revision = p.chainRevision.load();
      factor = p.chainOversampleFactor.load(); voices = p.wantedNamVoices();
    }
    task = std::thread([this, reader=std::move(reader),role,identities=std::move(identities)] {
      try {
        auto payloads=reader();
        if(payloads.size()!=identities.size())throw std::runtime_error("Collection payloads missing");
        size_t total=0;
        for(const auto& [id,bytes]:payloads) {
          if(!identities.count(id) || bytes.empty() || bytes.size()>32*1024*1024-total)
            throw std::runtime_error("Invalid collection payload");
          total+=bytes.size();
          if(role==TONE3000Processor::OxidalProcessingRole::Cab)oxidal::checkMonoCab(bytes);
        }
        const auto& bytes=payloads.at(candidate->activeModelId);
        prepared = p.prepareBlockModelOffThread(type, bytes, type==ChainBlockType::NAM ? "model.nam" : "model.wav", candidate->namSlimSize);
        if (!prepared.success || (type == ChainBlockType::NAM ? !prepared.namEngine : !prepared.convolverMono))
          throw std::runtime_error("model preparation failed; previous sound retained");
        candidate->modelCache=std::move(payloads);
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
