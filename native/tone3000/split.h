// Oxidal port of PiPedal Tone3000Preset::PartitionAmpCab / Tone3000MixMatch.
// Source: PiPedal d7d627f, MIT; see NOTICE-split.md. Control-thread work only.
#pragma once
#include <juce_audio_formats/juce_audio_formats.h>
#include <stdexcept>
#include <span>
#include <bit>
#include <limits>

namespace oxidal {
struct SplitState {
  juce::MemoryBlock amp, cab;
  juce::var pitch;
};
inline void require(bool condition, const char* message) {
  if (!condition) throw std::runtime_error(message);
}
inline juce::MemoryBlock encodeState(const juce::ValueTree& tree) {
  juce::MemoryBlock result;
  juce::MemoryOutputStream out(result, false);
  out.write("T3KB", 4);
  tree.writeToStream(out);
  require(result.getSize() <= 32 * 1024 * 1024, "derived state exceeds limit");
  return result;
}
inline void checkMonoCab(std::span<const uint8_t> bytes)
    {
        auto u16 = [&](size_t at) -> uint16_t {
            if (at > bytes.size() || bytes.size() - at < 2) throw std::runtime_error("Truncated cab WAV field");
            return uint16_t(bytes[at]) | (uint16_t(bytes[at + 1]) << 8);
        };
        auto u32 = [&](size_t at) -> uint32_t {
            if (at > bytes.size() || bytes.size() - at < 4) throw std::runtime_error("Truncated cab WAV field");
            return uint32_t(bytes[at]) | (uint32_t(bytes[at + 1]) << 8)
                | (uint32_t(bytes[at + 2]) << 16) | (uint32_t(bytes[at + 3]) << 24);
        };
        if (bytes.size() < 12 || std::memcmp(bytes.data(), "RIFF", 4)
            || std::memcmp(bytes.data() + 8, "WAVE", 4) || uint64_t(u32(4)) + 8 != bytes.size())
            throw std::runtime_error("Cab requires a complete RIFF/WAVE asset (RF64 is unsupported)");
        size_t fmt = 0, data = 0, dataSize = 0;
        for (size_t at = 12; at < bytes.size();)
        {
            if (bytes.size() - at < 8) throw std::runtime_error("Truncated cab WAV chunk");
            const size_t size = u32(at + 4), begin = at + 8;
            if (size > bytes.size() - begin || (size & 1) > bytes.size() - begin - size)
                throw std::runtime_error("Cab WAV chunk exceeds asset");
            if (!std::memcmp(bytes.data() + at, "fmt ", 4)) {
                if (fmt || (size != 16 && size != 18)) throw std::runtime_error("Duplicate or unsupported cab WAV format");
                fmt = begin;
                if (size == 18 && u16(begin + 16) != 0) throw std::runtime_error("Unsupported cab WAV format extension");
            }
            if (!std::memcmp(bytes.data() + at, "data", 4)) {
                if (data) throw std::runtime_error("Duplicate cab WAV data");
                data = begin; dataSize = size;
            }
            at = begin + size + (size & 1);
        }
        if (!fmt || !data || !dataSize) throw std::runtime_error("Cab WAV needs nonempty format and audio data");
        const auto format = u16(fmt), channels = u16(fmt + 2), bits = u16(fmt + 14);
        const uint32_t rate = u32(fmt + 4), byteRate = u32(fmt + 8), align = u16(fmt + 12);
        const bool pcm = format == 1 && (bits == 16 || bits == 24 || bits == 32);
        const bool floating = format == 3 && (bits == 32 || bits == 64);
        if ((!pcm && !floating) || channels != 1 || rate < 8000 || rate > 192000
            || align != bits / 8 || uint64_t(rate) * align != byteRate || dataSize % align
            || dataSize / align > rate)
            throw std::runtime_error("Cab requires a short (at most one second) mono PCM/float WAV");
        bool nonzero = false;
        for (size_t at = data; at < data + dataSize; at += align)
        {
            if (floating) {
                double sample;
                if (bits == 32) sample = std::bit_cast<float>(u32(at));
                else {
                    const uint64_t value = uint64_t(u32(at)) | (uint64_t(u32(at + 4)) << 32);
                    sample = std::bit_cast<double>(value);
                }
                if (!std::isfinite(sample) || std::abs(sample) > std::numeric_limits<float>::max())
                    throw std::runtime_error("Cab WAV contains nonfinite or unrepresentable samples");
                nonzero = nonzero || static_cast<float>(sample) != 0;
            } else for (size_t byte = 0; byte < align; ++byte) nonzero = nonzero || bytes[at + byte] != 0;
        }
        if (!nonzero) throw std::runtime_error("Cab WAV is silent");
    }

inline SplitState partition(TONE3000Processor& processor, const juce::String& ampId,
                            const juce::String& cabId, bool confirmAmp, bool externalPitch) {
  require(confirmAmp, "Confirm an amp-head capture before splitting");
  require(ampId.isNotEmpty() && cabId.isNotEmpty() && ampId != cabId && ampId.length() <= 128 && cabId.length() <= 128,
          "Choose distinct amp and cab block IDs");
  juce::MemoryBlock bytes;
  processor.getStateInformation(bytes);
  require(bytes.getSize() > 4 && bytes.getSize() <= 32 * 1024 * 1024 && std::memcmp(bytes.getData(), "T3KB", 4) == 0,
          "Unsupported source state");
  auto source = juce::ValueTree::readFromData(static_cast<const char*>(bytes.getData()) + 4, bytes.getSize() - 4);
  require(source.hasType("TONE3000State") && static_cast<int>(source.getProperty("schemaVersion")) == 1,
          "Unsupported source state schema");
  auto snapshot = source.getChildWithName("ChainSnapshot");
  auto input = source.getProperty("inputMode").toString();
  require((input == "left" || input == "right") && !static_cast<bool>(snapshot.getProperty("stereoEnabled", false)) &&
              snapshot.getProperty("branchAfterBlockId").toString().isEmpty(),
          "Split requires explicit mono input and unbranched routing");
  auto values = source.getChildWithName("PARAMETERS");
  auto parameter = [&](const char* id) -> double {
    auto row = values.getChildWithProperty("id", id);
    require(row.isValid(), "Missing native parameter");
    double value = static_cast<double>(row.getProperty("value"));
    require(std::isfinite(value), "Non-finite native parameter");
    return value;
  };
  for (auto id : {"osEnabled", "spreadEnabled", "alignEnabled", "chainSoloLeft", "chainSoloRight", "chainInvertLeft", "chainInvertRight"})
    require(parameter(id) == 0, "Disable oversampling and spatial/image processing before splitting");
  require(parameter("outputBalance") == .5 && parameter("chainPanLeft") == 0 && parameter("chainPanRight") == 1,
          "Reset output balance and chain pans before splitting");
  juce::ValueTree amp, cab;
  for (auto laneName : {"ChainBlocks", "RightChainBlocks"}) {
    auto lane = snapshot.getChildWithName(laneName);
    for (auto block : lane) {
      auto type = block.getProperty("type").toString();
      if (type == "insert") continue;
      require(lane.hasType("ChainBlocks") && static_cast<bool>(block.getProperty("enabled", true)),
              "Split requires enabled blocks on the left serial lane");
      auto id = block.getProperty("id").toString();
      if (type == "nam" && !amp.isValid() && !cab.isValid() && id == ampId) amp = block;
      else if (type == "ir" && amp.isValid() && !cab.isValid() && id == cabId) cab = block;
      else throw std::runtime_error("Choose exactly one NAM amp followed by one cab IR");
    }
  }
  require(amp.isValid() && cab.isValid(), "Selected stages are missing");
  auto metadata = [](const juce::ValueTree& block) { return juce::JSON::parse(block.getProperty("toneJson").toString()); };
  require(metadata(amp).getProperty("gear", {}).toString() == "amp" && metadata(cab).getProperty("gear", {}).toString() == "cab",
          "Only classified amp-head and cab blocks can be split");
  auto asset = [](const juce::ValueTree& block) -> juce::MemoryBlock {
    auto cache = block.getChildWithName("ModelCache");
    auto modelId = block.getProperty("activeModelId");
    auto row = cache.getChildWithProperty("modelId", modelId);
    const auto data = row.getProperty("data");
    auto* binary = data.getBinaryData();
    require(binary != nullptr && binary->getSize() > 0, "Selected model must be embedded before splitting");
    return *binary;
  };
  auto ampData = asset(amp);
  auto model = juce::JSON::parse(juce::String::fromUTF8(static_cast<const char*>(ampData.getData()), static_cast<int>(ampData.getSize())));
  require(model.isObject() && model.getProperty("version", {}).isString() && model.getProperty("version", {}).toString().isNotEmpty() &&
          model.getProperty("architecture", {}).isString() && model.getProperty("architecture", {}).toString().isNotEmpty() &&
          model.getProperty("config", {}).isObject() && model.getProperty("weights", {}).isArray(), "Invalid amp NAM structure");
  for (const auto& weight : *model.getProperty("weights", {}).getArray())
    require((weight.isInt() || weight.isDouble() || weight.isInt64()) && std::isfinite(static_cast<double>(weight)) &&
            std::abs(static_cast<double>(weight)) <= std::numeric_limits<float>::max(), "Invalid amp NAM weights");
  auto gear = model.getProperty("metadata", {}).getProperty("gear_type", {}).toString().trim().toLowerCase();
  require(gear.isEmpty() || gear == "amp" || gear == "preamp" || gear == "pedal_amp", "Embedded NAM metadata conflicts with amp-head classification");
  auto cabData = asset(cab);
  checkMonoCab({static_cast<const uint8_t*>(cabData.getData()), cabData.getSize()});
  auto* pitch = new juce::DynamicObject();
  juce::var pitchValues(pitch);
  if (externalPitch) {
    require(parameter("pitchEnabled") == 0 || (parameter("inputLevel") == .5 && parameter("gateEnabled") == 0),
            "Moving active pitch requires unity input gain and gate off");
    for (auto id : {"pitchEnabled", "pitchSemitones", "pitchStep", "pitchTonality", "pitchWindow"}) pitch->setProperty(id, parameter(id));
    pitch->setProperty("inputMode", input);
  }
  require(source.getProperty("activePresetId").toString().length() <= 480 &&
          source.getProperty("activePresetName").toString().length() <= 480,
          "Source identity or name is too long for derived stages");
  auto stage = [&](const juce::ValueTree& block, bool isAmp) {
    auto tree = source.createCopy();
    auto suffix = isAmp ? ":oxidal-amp" : ":oxidal-cab";
    tree.setProperty("activePresetId", source.getProperty("activePresetId").toString() + suffix, nullptr);
    tree.setProperty("activePresetName", source.getProperty("activePresetName").toString() + (isAmp ? " (Amp)" : " (Cab IR)"), nullptr);
    tree.setProperty("inputMode", isAmp ? input : "left", nullptr);
    auto chain = tree.getChildWithName("ChainSnapshot");
    chain.setProperty("stereoEnabled", false, nullptr);
    chain.setProperty("branchSide", "left", nullptr);
    chain.setProperty("branchAfterBlockId", "", nullptr);
    chain.removeAllChildren(nullptr);
    juce::ValueTree left("ChainBlocks"), right("RightChainBlocks");
    left.appendChild(block.createCopy(), nullptr);
    chain.appendChild(left, nullptr); chain.appendChild(right, nullptr);
    tree.removeChild(tree.getChildWithName("MidiMappings"), nullptr);
    tree.appendChild(juce::ValueTree("MidiMappings"), nullptr);
    auto params = tree.getChildWithName("PARAMETERS");
    for (auto* base : processor.juce::AudioProcessor::getParameters()) {
      auto* p = dynamic_cast<juce::RangedAudioParameter*>(base);
      require(p != nullptr, "Unsupported parameter descriptor");
      auto name = p->paramID;
      const bool keepInput = name == "inputLevel" || name.startsWith("gate") || name.startsWith("pitch") ||
          name == "calibrateInput" || name == "inputCalibrationLevel" || name == "targetLoudness";
      const bool keepOutput = name.startsWith("tone") || name == "outputLevel";
      auto value = (isAmp ? keepInput : keepOutput) ? parameter(name.toRawUTF8()) : p->convertFrom0to1(p->getDefaultValue());
      if (name == "osEnabled" || name == "osFactor" || name == "spreadEnabled" || name == "alignEnabled" ||
          (!isAmp && (name == "gateEnabled" || name == "pitchEnabled" || name == "calibrateInput")) ||
          (isAmp && (name == "toneEqEnabled" || (externalPitch && name == "pitchEnabled")))) value = 0;
      auto row = params.getChildWithProperty("id", name);
      require(row.isValid(), "Missing derived parameter"); row.setProperty("value", value, nullptr);
    }
    return encodeState(tree);
  };
  return {stage(amp, true), stage(cab, false), pitchValues};
}
} // namespace oxidal
