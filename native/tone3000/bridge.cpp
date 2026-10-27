// Offline qualification bridge. See docs/native-tone3000.md.
#include "Processor.h"
#include "PresetFile.h"
#include <atomic>
#include <cmath>
#include <cstring>
#include <memory>
#include <thread>
#include "split.h"
#include "audition.h"

#define EXPORT extern "C" __attribute__((visibility("default")))
namespace {
thread_local std::string error;
std::atomic<bool> occupied{false};
struct Engine {
  juce::ScopedJuceInitialiser_GUI juce;
  TONE3000Processor processor;
  juce::AudioBuffer<float> audio;
  juce::MidiBuffer midi;
  juce::MemoryBlock captured;
  oxidal::SplitState split;
  std::unique_ptr<OxidalModelPreparation> preparation;
  std::thread::id owner = std::this_thread::get_id();
  explicit Engine(int frames) : audio(2, frames) {}
  ~Engine() { preparation.reset(); processor.releaseResources(); }
};
Engine& engine(void* ptr) {
  if (!ptr) throw std::runtime_error("null engine");
  auto& e = *static_cast<Engine*>(ptr);
  if (e.owner != std::this_thread::get_id()) throw std::runtime_error("wrong owner thread");
  return e;
}
template<class F> int guard(F&& fn) noexcept {
  try { error.clear(); fn(); return 0; }
  catch (const std::exception& e) { error = e.what(); return -1; }
  catch (...) { error = "native exception"; return -1; }
}
void json(const juce::var& value, char* out, size_t capacity, size_t* written) {
  const auto text = juce::JSON::toString(value, true).toStdString();
  if (!out || !written || text.size() > capacity) throw std::runtime_error("JSON capacity");
  std::memcpy(out, text.data(), text.size()); *written = text.size();
}
bool supportsSlim(const juce::var& runtime, const juce::String& id) {
  const auto blocks = runtime.getProperty("blocks", {});
  if (const auto* rows = blocks.getArray()) for (const auto& row : *rows)
    if (row.getProperty("blockId", {}).toString() == id)
      return static_cast<bool>(row.getProperty("loaded", false)) &&
        !static_cast<bool>(row.getProperty("modelLoading", false)) &&
        !static_cast<bool>(row.getProperty("loadFailed", false)) &&
        static_cast<bool>(row.getProperty("a2Known", false)) &&
        static_cast<bool>(row.getProperty("a2Supported", false));
  return false;
}
}
EXPORT const char* oxidal_t3k_error() noexcept { return error.c_str(); }
EXPORT int oxidal_t3k_create(double rate, int frames, void** result) noexcept {
  return guard([&] {
    if (!result || !std::isfinite(rate) || rate < 8000 || rate > 192000 || frames < 1 || frames > 2048)
      throw std::runtime_error("invalid audio configuration");
    *result = nullptr;
    const auto root = juce::SystemStats::getEnvironmentVariable("OXIDAL_QUALIFICATION_DATA", {});
    if (root.isEmpty() || !juce::File::isAbsolutePath(root) || !juce::File(root).isDirectory())
      throw std::runtime_error("explicit existing isolated data root required");
    if (occupied.exchange(true)) throw std::runtime_error("offline bridge permits one engine at a time");
    try {
      auto e = std::make_unique<Engine>(frames);
      e->processor.setMultiCoreEnabled(false, false);
      // JUCE host contract: publish rate/block metadata before preparation and callbacks.
      e->processor.setRateAndBufferSizeDetails(rate, frames);
      e->processor.prepareToPlay(rate, frames);
      *result = e.release();
    } catch (...) { occupied.store(false); throw; }
  });
}
EXPORT int oxidal_t3k_destroy(void* ptr) noexcept {
  return guard([&] { auto& e = engine(ptr); delete &e; occupied.store(false); });
}
EXPORT int oxidal_t3k_catalog(void* ptr, char* out, size_t capacity, size_t* written) noexcept {
  return guard([&] {
    auto& e = engine(ptr); juce::Array<juce::var> rows;
    // Source-pinned tone allowlist complement; checked against the inventory.
    const juce::StringArray nonTone{"targetLoudness", "chainSoloLeft", "chainSoloRight", "calibrateInput", "inputCalibrationLevel", "osEnabled", "osFactor"};
    for (auto* raw : e.processor.juce::AudioProcessor::getParameters()) {
      auto* p = dynamic_cast<juce::RangedAudioParameter*>(raw);
      if (!p) throw std::runtime_error("unexpected non-ranged parameter");
      auto* row = new juce::DynamicObject(); const auto range = p->getNormalisableRange();
      row->setProperty("id", p->paramID); row->setProperty("minimum", range.start);
      row->setProperty("maximum", range.end); row->setProperty("interval", range.interval);
      row->setProperty("default", p->convertFrom0to1(p->getDefaultValue()));
      row->setProperty("value", p->convertFrom0to1(p->getValue()));
      row->setProperty("normalized", p->getValue());
      row->setProperty("label", p->getName(64));
      row->setProperty("display", p->getText(p->getValue(), 64));
      row->setProperty("toggle", p->isBoolean());
      row->setProperty("automatable", p->isAutomatable());
      row->setProperty("tone", !nonTone.contains(p->paramID));
      row->setProperty("machine_default", TONE3000Processor::isMachineDefaultParameter(p->paramID));
      rows.add(juce::var(row));
    }
    json(rows, out, capacity, written);
  });
}
EXPORT int oxidal_t3k_set(void* ptr, const char* id, float normalized) noexcept {
  return guard([&] {
    auto& e = engine(ptr);
    if (!id || !std::isfinite(normalized) || normalized < 0 || normalized > 1)
      throw std::runtime_error("invalid normalized parameter");
    auto* p = e.processor.parameters.getParameter(id);
    if (!p) throw std::runtime_error("unknown parameter");
    p->setValueNotifyingHost(p->convertTo0to1(p->convertFrom0to1(normalized)));
  });
}
// Only qualified block controls cross this boundary. Never forward arbitrary
// browser method names or raw chain payloads into the native processor.
EXPORT int oxidal_t3k_block_controls(void* ptr, char* out, size_t capacity, size_t* written) noexcept {
  return guard([&] {
    auto& processor = engine(ptr).processor;
    const auto state = processor.getChainState(-1);
    const auto runtime = processor.getStageRuntime();
    juce::Array<juce::var> controls;
    int count = 0;
    for (const auto& lane : {"chain", "chainRight"}) {
      const auto rows = state.getProperty(lane, {});
      if (const auto* blocks = rows.getArray()) for (const auto& block : *blocks) {
        if (block.getProperty("kind", {}).toString() != "tone") continue;
        const auto id = block.getProperty("blockId", {}).toString();
        if (++count > 32 || id.isEmpty() || id.length() > 128)
          throw std::runtime_error("block catalog bounds");
        const auto params = block.getProperty("params", {});
        const auto title = block.getProperty("tone", {}).getProperty("title", "Tone").toString().substring(0, 128);
        for (const auto& name : {"enabled", "normalize", "inputGain", "outputGain", "mix", "slimSize"}) {
          const bool staged = std::strcmp(name, "slimSize") == 0;
          if (staged && !supportsSlim(runtime, id)) continue;
          const bool toggle = std::strcmp(name, "enabled") == 0 || std::strcmp(name, "normalize") == 0;
          const auto raw = params.getProperty(name, {});
          if (!(raw.isBool() || raw.isDouble() || raw.isInt())) throw std::runtime_error("invalid block readback");
          const double value = static_cast<double>(raw);
          if (!std::isfinite(value) || value < 0 || value > 1) throw std::runtime_error("invalid block readback");
          auto* row = new juce::DynamicObject();
          row->setProperty("id", "block:" + id + ":" + name);
          row->setProperty("block_id", id);
          row->setProperty("lane", std::strcmp(lane, "chain") == 0 ? "left" : "right");
          row->setProperty("name", title);
          row->setProperty("parameter", name);
          row->setProperty("value", value);
          row->setProperty("step", toggle ? 1.0 : 0.01);
          row->setProperty("staged", staged);
          controls.add(juce::var(row));
        }
      }
    }
    json(controls, out, capacity, written);
  });
}
EXPORT int oxidal_t3k_set_block(void* ptr, const char* id, const char* parameter, float value) noexcept {
  return guard([&] {
    auto& e = engine(ptr);
    if (!id || !parameter || std::strlen(id) == 0 || std::strlen(id) > 128 || !std::isfinite(value) || value < 0 || value > 1)
      throw std::runtime_error("invalid block control");
    const juce::String name(parameter);
    if (name == "slimSize") {
      if (!supportsSlim(e.processor.getStageRuntime(), juce::String(id)) || !e.processor.setBlockSlimSize(id, value))
        throw std::runtime_error("loaded block does not support model size");
      return;
    }
    const bool toggle = name == "enabled" || name == "normalize";
    if (!(toggle || name == "inputGain" || name == "outputGain" || name == "mix") || (toggle && value != 0 && value != 1))
      throw std::runtime_error("unsupported block control or value");
    if (!e.processor.setBlockParam(id, name, value)) throw std::runtime_error("block control rejected");
  });
}
EXPORT int oxidal_t3k_process(void* ptr, float* left, float* right, size_t frames) noexcept {
  return guard([&] {
    auto& e = engine(ptr);
    if (!left || !right || frames == 0 || frames > static_cast<size_t>(e.audio.getNumSamples()))
      throw std::runtime_error("invalid audio buffer");
    for (size_t i = 0; i < frames; ++i)
      if (!std::isfinite(left[i]) || !std::isfinite(right[i])) throw std::runtime_error("nonfinite input");
    e.audio.copyFrom(0, 0, left, static_cast<int>(frames));
    e.audio.copyFrom(1, 0, right, static_cast<int>(frames));
    juce::AudioBuffer<float> view(e.audio.getArrayOfWritePointers(), 2, static_cast<int>(frames));
    e.midi.clear(); e.processor.processBlock(view, e.midi);
    for (size_t i = 0; i < frames; ++i)
      if (!std::isfinite(view.getSample(0, static_cast<int>(i))) || !std::isfinite(view.getSample(1, static_cast<int>(i))))
        throw std::runtime_error("nonfinite native output");
    std::memcpy(left, view.getReadPointer(0), frames * sizeof(float));
    std::memcpy(right, view.getReadPointer(1), frames * sizeof(float));
  });
}
EXPORT int oxidal_t3k_capture(void* ptr, unsigned char* out, size_t capacity, size_t* written) noexcept {
  return guard([&] {
    auto& e = engine(ptr); if (!written) throw std::runtime_error("missing length");
    if (!out) { e.captured.reset(); e.processor.getStateInformation(e.captured); }
    if (e.captured.getSize() > 32 * 1024 * 1024) throw std::runtime_error("state limit");
    *written = e.captured.getSize();
    if (out) { if (capacity < *written) throw std::runtime_error("state capacity"); std::memcpy(out, e.captured.getData(), *written); }
  });
}
EXPORT int oxidal_t3k_restore(void* ptr, const unsigned char* bytes, size_t length) noexcept {
  return guard([&] {
    auto& e = engine(ptr);
    if (!bytes || length < 5 || length > 32 * 1024 * 1024) throw std::runtime_error("invalid state length");
    // Only opaque states captured by this adapter are accepted by the safe Rust API.
    e.processor.setStateInformation(bytes, static_cast<int>(length));
  });
}
EXPORT int oxidal_t3k_pump(void* ptr) noexcept {
  return guard([&] { engine(ptr); juce::MessageManager::getInstance()->runDispatchLoopUntil(1); });
}
EXPORT int oxidal_t3k_load_model(void* ptr, const char* path, char* out, size_t capacity, size_t* written) noexcept {
  return guard([&] { auto& e = engine(ptr); if (!path) throw std::runtime_error("missing model path"); json(e.processor.loadLocalTonePath(juce::File(path)), out, capacity, written); });
}
EXPORT int oxidal_t3k_runtime(void* ptr, char* out, size_t capacity, size_t* written) noexcept {
  return guard([&] { json(engine(ptr).processor.getStageRuntime(), out, capacity, written); });
}

// Offline/isolated preparation only: never invoke a whole-chain reset on PCM.
EXPORT int oxidal_t3k_reset_empty(void* ptr) noexcept {
  return guard([&] {
    auto& e = engine(ptr);
    if (e.preparation) throw std::runtime_error("create empty rig on a fresh preparation owner");
    e.processor.resetToDefault();
    const auto state = e.processor.getStageRuntime();
    const auto blocks = state.getProperty("blocks", {});
    if (!blocks.isArray() || blocks.size() != 0) throw std::runtime_error("native empty reset failed");
  });
}
// Input was structurally bounded by oxidal-presets before entering this ABI.
EXPORT int oxidal_t3k_load_preset(void* ptr, const unsigned char* bytes, size_t length) noexcept {
  return guard([&] {
    auto& e = engine(ptr);
    if (!bytes || length < 5 || length > 32 * 1024 * 1024) throw std::runtime_error("preset size");
    const auto root = juce::File(juce::SystemStats::getEnvironmentVariable("OXIDAL_QUALIFICATION_DATA", {})).getChildFile("adapter-presets");
    if (!root.createDirectory()) throw std::runtime_error("preset staging directory");
    const auto file = root.getChildFile("input.t3kpreset");
    if (!file.replaceWithData(bytes, length)) throw std::runtime_error("preset staging write");
    auto tree = t3k::presetfile::read(file);
    if (!tree.isValid()) throw std::runtime_error("native preset parse failed");
    // Staging identity is never the imported/provider identity, and never leaves this cache.
    tree.setProperty("id", "oxidal-input", nullptr);
    if (!t3k::presetfile::write(file, tree)) throw std::runtime_error("preset staging write");
    e.processor.setPresetStoreForTesting(root);
    if (!e.processor.loadPreset("user:oxidal-input")) throw std::runtime_error("native preset load failed");
  });
}
EXPORT int oxidal_t3k_save_preset(void* ptr, const char* name, unsigned char* out, size_t capacity, size_t* written) noexcept {
  return guard([&] {
    auto& e = engine(ptr);
    if (!written || !name || juce::String::fromUTF8(name).trim().isEmpty()) throw std::runtime_error("preset name required");
    if (!out) {
      // New empty scratch store prevents upstream's same-name overwrite rule from touching originals.
      const auto base = juce::File(juce::SystemStats::getEnvironmentVariable("OXIDAL_QUALIFICATION_DATA", {})).getChildFile("adapter-export");
      const auto root = base.getChildFile(juce::Uuid().toString());
      if (!root.createDirectory()) throw std::runtime_error("export staging directory");
      e.processor.setPresetStoreForTesting(root);
      const auto result = e.processor.savePreset(name);
      if (result.isVoid()) throw std::runtime_error("native preset save failed");
      const auto files = root.findChildFiles(juce::File::findFiles, false, "*.t3kpreset");
      if (files.size() != 1) throw std::runtime_error("native preset save ambiguous");
      auto tree = t3k::presetfile::read(files[0]);
      tree.setProperty("id", "oxidal-" + juce::Uuid().toString(), nullptr);
      e.captured.reset();
      if (!t3k::presetfile::write(files[0], tree) || !files[0].loadFileAsData(e.captured)) throw std::runtime_error("export read failed");
      if (!root.deleteRecursively()) throw std::runtime_error("export staging cleanup failed");
    }
    *written = e.captured.getSize();
    if (*written == 0 || *written > 32 * 1024 * 1024) throw std::runtime_error("preset size limit");
    if (out) {
      if (capacity < *written) throw std::runtime_error("preset capacity");
      std::memcpy(out, e.captured.getData(), *written);
    }
  });
}

EXPORT int oxidal_t3k_split(void* ptr, const char* amp, const char* cab, bool confirmAmp, bool externalPitch,
                           char* out, size_t capacity, size_t* written) noexcept {
  return guard([&] {
    auto& e = engine(ptr);
    if (!amp || !cab) throw std::runtime_error("Missing stage identity");
    // Prepare both states before publishing either; this never changes the playing/source processor.
    auto candidate = oxidal::partition(e.processor, amp, cab, confirmAmp, externalPitch);
    json(candidate.pitch, out, capacity, written);
    e.split = std::move(candidate);
  });
}
EXPORT int oxidal_t3k_split_state(void* ptr, int stage, unsigned char* out, size_t capacity, size_t* written) noexcept {
  return guard([&] {
    auto& e = engine(ptr);
    if (!written || (stage != 0 && stage != 1)) throw std::runtime_error("Invalid stage request");
    const auto& state = stage == 0 ? e.split.amp : e.split.cab;
    if (state.isEmpty()) throw std::runtime_error("No prepared split");
    *written = state.getSize();
    if (out) {
      if (capacity < *written) throw std::runtime_error("Stage capacity");
      std::memcpy(out, state.getData(), *written);
    }
  });
}

EXPORT int oxidal_t3k_input_mode(void* ptr, int mode) noexcept {
  return guard([&] {
    if (mode < 0 || mode > 3) throw std::runtime_error("Invalid input mode");
    engine(ptr).processor.setInputMode(static_cast<TONE3000Processor::InputMode>(mode));
  });
}
EXPORT int oxidal_t3k_chain(void* ptr, char* out, size_t capacity, size_t* written) noexcept {
  return guard([&] { json(engine(ptr).processor.getChainState(-1), out, capacity, written); });
}

EXPORT int oxidal_t3k_remove_block(void* ptr, const char* id) noexcept {
  return guard([&] {
    auto& p = engine(ptr).processor;
    if (!id || !*id || std::strlen(id) > 128 || !p.removeChainBlock(id))
      throw std::runtime_error("Missing, stale or non-removable block");
  });
}

EXPORT int oxidal_t3k_prepare_model(void* ptr, const char* target, const char* path, const char* metadata) noexcept {
  return guard([&] {
    auto& e = engine(ptr);
    if (!target || !path || !metadata || std::strlen(metadata) > 32768) throw std::runtime_error("invalid preparation input");
    if (e.preparation && !e.preparation->finishedPreparing()) throw std::runtime_error("previous model still preparing");
    e.preparation.reset();
    e.preparation = std::make_unique<OxidalModelPreparation>(e.processor, target, juce::File(path), juce::JSON::parse(metadata));
  });
}
EXPORT int oxidal_t3k_preparation(void* ptr, int action, char* out, size_t capacity, size_t* written) noexcept {
  return guard([&] {
    auto& e = engine(ptr);
    if (!e.preparation || action < 0 || action > 2) throw std::runtime_error("no model preparation");
    if (action == 1) e.preparation->commit();
    if (action == 2) e.preparation->cancel();
    json(e.preparation->status(), out, capacity, written);
  });
}

EXPORT int oxidal_t3k_restore_slot(void* ptr, const char* target, int lane, int index) noexcept {
  return guard([&] {
    auto& e = engine(ptr);
    if (!target || (e.preparation && !e.preparation->finishedPreparing())) throw std::runtime_error("replay preparation busy");
    OxidalModelPreparation::restoreSlot(e.processor, target, lane, index);
  });
}
