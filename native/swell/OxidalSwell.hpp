// Copyright (c) 2026 Oxidal contributors
// SPDX-License-Identifier: MIT
#pragma once
#include <lv2/core/lv2.h>
#include <cstdint>

/** Attack-triggered volume swell: each new note fades in instead of starting on its pick.
 * @see docs/native-swell.md
 */
namespace oxidal_swell {
inline constexpr const char* MonoUri = "urn:oxidal:plugin:swell#mono";
inline constexpr const char* StereoUri = "urn:oxidal:plugin:swell#stereo";
/** Both plugins share one layout; the mono plugin has no right-hand audio ports.
 * There is no latency port: no lookahead, so the LV2 default of zero latency holds. */
enum Port : uint32_t { Threshold, Sensitivity, Time, Release, Curve, Mix, InputL, OutputL, InputR, OutputR, PortCount };
/** Level, below the threshold, at which a note counts as finished (hysteresis). */
inline constexpr float HysteresisDb = 6.0f;
/** A retrigger first fades the previous swell out over this long, never in one step. */
inline constexpr float DuckSeconds = 0.004f;
/** Shortest gap between two detected attacks. */
inline constexpr float HoldoffSeconds = 0.05f;
/** Time, curve and mix glide to a new value over about this long. */
inline constexpr float SmoothingSeconds = 0.02f;
}
LV2_SYMBOL_EXPORT const LV2_Descriptor* lv2_descriptor(uint32_t index);
