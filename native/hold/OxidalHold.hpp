// Copyright (c) 2026 Oxidal contributors
// SPDX-License-Identifier: MIT
#pragma once
#include <lv2/core/lv2.h>
#include <cstdint>

/** Spectral sustain: Hold captures the sound and keeps it ringing.
 * @see docs/native-hold.md
 */
namespace oxidal_hold {
inline constexpr const char* MonoUri = "urn:oxidal:plugin:hold#mono";
inline constexpr const char* StereoUri = "urn:oxidal:plugin:hold#stereo";
/** The mono plugin has no Width: its audio ports are one lower (see connect). */
enum Port : uint32_t { Hold, Attack, Release, Level, Dry, Focus, Width, InputL, OutputL, InputR, OutputR, PortCount };
/** Analysis/synthesis frame: about 85 ms at 48 kHz, long enough to separate
 * the harmonics of a low guitar string, short enough to be the last note. */
inline constexpr uint32_t FrameSize = 4096;
inline constexpr uint32_t Hop = FrameSize / 4;
}
LV2_SYMBOL_EXPORT const LV2_Descriptor* lv2_descriptor(uint32_t index);
