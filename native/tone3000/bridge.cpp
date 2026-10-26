// Offline qualification bridge. See docs/native-tone3000.md.
#include "Processor.h"
#include <atomic>
#include <cmath>
#include <cstring>
#include <memory>
#include <thread>

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
  std::thread::id owner = std::this_thread::get_id();
  explicit Engine(int frames) : audio(2, frames) {}
  ~Engine() { processor.releaseResources(); }
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
