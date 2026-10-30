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
enum Port : uint32_t { Hold, Attack, Release, Level, Dry, InputL, OutputL, InputR, OutputR, PortCount };
/** Analysis/synthesis frame: about 43 ms at 48 kHz, enough for a chord. */
inline constexpr uint32_t FrameSize = 2048;
inline constexpr uint32_t Hop = FrameSize / 4;
/** Frames averaged into the held spectrum, so one transient does not dominate. */
inline constexpr uint32_t CaptureFrames = 4;
}
LV2_SYMBOL_EXPORT const LV2_Descriptor* lv2_descriptor(uint32_t index);
