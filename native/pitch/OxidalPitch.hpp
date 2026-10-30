// Copyright (c) 2026 PiPedal contributors (adapter, ported to Oxidal)
// SPDX-License-Identifier: MIT
#pragma once
#include <lv2/core/lv2.h>
#include <cstdint>

/** Independent, ordinary-port pitch effect; no T3K full-state/import identity.
 * @see docs/native-pitch.md
 */
namespace oxidal_pitch {
inline constexpr const char* MonoUri = "urn:oxidal:plugin:pitch#mono";
inline constexpr const char* StereoUri = "urn:oxidal:plugin:pitch#stereo";
enum Port : uint32_t { Enabled, Semitones, Step, Tonality, Window, Latency, InputMode, InputL, OutputL, InputR, OutputR, PortCount };
inline constexpr uint32_t FallbackBlock = 4096, MaximumBlock = 65536;
}
LV2_SYMBOL_EXPORT const LV2_Descriptor* lv2_descriptor(uint32_t index);
