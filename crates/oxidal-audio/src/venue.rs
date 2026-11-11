//! Venue EQ output stage: high-pass, low shelf, three bells, high shelf,
//! low-pass and output trim on the main outputs, applied once after the
//! session mix and before mono fold, so it corrects the room without touching
//! the rig, its taps or recordings.
//!
//! RBJ Audio EQ Cookbook biquads in transposed direct form II, per channel.
//! Small edits glide (parameters move every 32 frames, coefficients follow);
//! profile switches, bypass and any change in which bands exist crossfade over
//! 30 ms between two preallocated filter sets, so high-Q or low-frequency
//! sections never click. Processing never allocates.
//! @see docs/media.md
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// Bands in fixed order: high-pass, low shelf, low mid, mid, high mid, high
/// shelf, low-pass.
pub const BANDS: usize = 7;
/// Seven bands, two of which may be 24 dB/oct pass filters (two sections).
pub const MAX_SECTIONS: usize = 9;
const CROSSFADE_SECONDS: f32 = 0.030;
/// Parameters move toward their targets every this many frames.
const GLIDE_BLOCK: usize = 32;
/// Time constant of the parameter glide (about 20 ms to settle).
const GLIDE_SECONDS: f32 = 0.005;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VenueKind {
    HighPass,
    LowShelf,
    Bell,
    HighShelf,
    LowPass,
}
impl VenueKind {
    pub fn of(band: usize) -> Self {
        match band {
            0 => Self::HighPass,
            1 => Self::LowShelf,
            5 => Self::HighShelf,
            6 => Self::LowPass,
            _ => Self::Bell,
        }
    }
}

/// One band's settings. Which kind it is follows from its position.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VenueBandSettings {
    pub enabled: bool,
    pub freq_hz: f32,
    /// Shelves and bells only.
    #[serde(default)]
    pub gain_db: f32,
    /// Bells only (0.3–8); shelves use 0.707 and pass filters Butterworth.
    #[serde(default = "unit_q")]
    pub q: f32,
    /// Pass filters only: 24 dB/oct instead of 12.
    #[serde(default)]
    pub steep: bool,
}
fn unit_q() -> f32 {
    1.0
}

/// A whole venue EQ: seven bands and output trim.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VenueSettings {
    pub bands: [VenueBandSettings; BANDS],
    pub trim_db: f32,
}
impl Default for VenueSettings {
    /// Flat: pass filters off, every other band at 0 dB, trim 0 dB.
    fn default() -> Self {
        let band = |enabled, freq_hz, q| VenueBandSettings {
            enabled,
            freq_hz,
            gain_db: 0.0,
            q,
            steep: false,
        };
        Self {
            bands: [
                band(false, 80.0, 0.707),
                band(true, 120.0, 0.707),
                band(true, 250.0, 1.0),
                band(true, 1000.0, 1.0),
                band(true, 3500.0, 1.0),
                band(true, 8000.0, 0.707),
                band(false, 12_000.0, 0.707),
            ],
            trim_db: 0.0,
        }
    }
}
impl VenueSettings {
    /// Ranges from the venue band table.
    pub fn validate(&self) -> Result<(), String> {
        let within = |v: f32, lo: f32, hi: f32| v.is_finite() && (lo..=hi).contains(&v);
        for (i, band) in self.bands.iter().enumerate() {
            let (lo, hi) = match VenueKind::of(i) {
                VenueKind::HighPass => (20.0, 400.0),
                VenueKind::LowShelf => (40.0, 500.0),
                VenueKind::Bell => (40.0, 16_000.0),
                VenueKind::HighShelf => (1500.0, 16_000.0),
                VenueKind::LowPass => (2000.0, 20_000.0),
            };
            if !within(band.freq_hz, lo, hi)
                || !within(band.gain_db, -12.0, 12.0)
                || !within(band.q, 0.3, 8.0)
            {
                return Err(format!(
                    "Venue band {} must be {lo}–{hi} Hz, −12 to +12 dB, Q 0.3–8",
                    i + 1
                ));
            }
        }
        if within(self.trim_db, -24.0, 6.0) {
            Ok(())
        } else {
            Err("Venue output trim must be −24 to +6 dB".into())
        }
    }
    /// Which sections exist: a band that is off, or a shelf or bell at 0 dB,
    /// adds none, so a flat profile passes samples through untouched.
    fn layout(&self) -> [u8; BANDS] {
        let mut layout = [0; BANDS];
        for (i, band) in self.bands.iter().enumerate() {
            layout[i] = match VenueKind::of(i) {
                _ if !band.enabled => 0,
                VenueKind::HighPass | VenueKind::LowPass => 1 + u8::from(band.steep),
                _ if band.gain_db == 0.0 => 0,
                _ => 1,
            };
        }
        layout
    }
}

/// What the outputs should use now: settings, or bypassed (flat, no trim).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VenueApplied {
    pub settings: VenueSettings,
    pub bypass: bool,
}

#[derive(Debug, Clone, Copy, Default)]
struct Section {
    b0: f32,
    b1: f32,
    b2: f32,
    a1: f32,
    a2: f32,
    /// Transposed direct form II state, left then right.
    s: [[f32; 2]; 2],
}
impl Section {
    /// New coefficients; the filter state is kept so a glide stays continuous.
    fn tune(&mut self, kind: VenueKind, rate: f32, freq: f32, gain_db: f32, q: f32) {
        let w0 = std::f32::consts::TAU * (freq / rate).clamp(1e-5, 0.49);
        let (sin, cos) = w0.sin_cos();
        let alpha = sin / (2.0 * q.max(0.05));
        let a = 10f32.powf(gain_db / 40.0);
        let (b0, b1, b2, a0, a1, a2) = match kind {
            VenueKind::Bell => (
                1.0 + alpha * a,
                -2.0 * cos,
                1.0 - alpha * a,
                1.0 + alpha / a,
                -2.0 * cos,
                1.0 - alpha / a,
            ),
            VenueKind::LowShelf | VenueKind::HighShelf => {
                let k = 2.0 * a.sqrt() * alpha;
                let sign = if kind == VenueKind::LowShelf {
                    1.0
                } else {
                    -1.0
                };
                let (ap, am) = (a + 1.0, a - 1.0);
                (
                    a * (ap - sign * am * cos + k),
                    sign * 2.0 * a * (am - sign * ap * cos),
                    a * (ap - sign * am * cos - k),
                    ap + sign * am * cos + k,
                    -sign * 2.0 * (am + sign * ap * cos),
                    ap + sign * am * cos - k,
                )
            }
            VenueKind::HighPass => (
                (1.0 + cos) / 2.0,
                -(1.0 + cos),
                (1.0 + cos) / 2.0,
                1.0 + alpha,
                -2.0 * cos,
                1.0 - alpha,
            ),
            VenueKind::LowPass => (
                (1.0 - cos) / 2.0,
                1.0 - cos,
                (1.0 - cos) / 2.0,
                1.0 + alpha,
                -2.0 * cos,
                1.0 - alpha,
            ),
        };
        self.b0 = b0 / a0;
        self.b1 = b1 / a0;
        self.b2 = b2 / a0;
        self.a1 = a1 / a0;
        self.a2 = a2 / a0;
    }
    #[inline]
    fn run(&mut self, channel: usize, x: f32) -> f32 {
        let s = &mut self.s[channel];
        let y = self.b0 * x + s[0];
        s[0] = self.b1 * x - self.a1 * y + s[1];
        s[1] = self.b2 * x - self.a2 * y;
        // Flush denormals so a decaying tail never costs extra CPU.
        if s[0].abs() < 1e-20 {
            s[0] = 0.0;
        }
        if s[1].abs() < 1e-20 {
            s[1] = 0.0;
        }
        y
    }
}

/// One complete filter chain plus its trim.
#[derive(Debug, Clone, Copy)]
struct Chain {
    sections: [Section; MAX_SECTIONS],
    active: usize,
    layout: [u8; BANDS],
    trim: f32,
}
impl Chain {
    const FLAT: Self = Self {
        sections: [Section {
            b0: 1.0,
            b1: 0.0,
            b2: 0.0,
            a1: 0.0,
            a2: 0.0,
            s: [[0.0; 2]; 2],
        }; MAX_SECTIONS],
        active: 0,
        layout: [0; BANDS],
        trim: 1.0,
    };
    /// Retunes in place when `layout` matches; `reset` clears state for a new set.
    fn tune(&mut self, rate: f32, settings: &VenueSettings, reset: bool) {
        let layout = settings.layout();
        let mut n = 0;
        for (i, band) in settings.bands.iter().enumerate() {
            let kind = VenueKind::of(i);
            let qs: &[f32] = match (layout[i], kind) {
                (0, _) => &[],
                (2, _) => &[0.541_196_1, 1.306_563],
                (_, VenueKind::HighPass | VenueKind::LowPass) => &[std::f32::consts::FRAC_1_SQRT_2],
                (_, VenueKind::LowShelf | VenueKind::HighShelf) => {
                    &[std::f32::consts::FRAC_1_SQRT_2]
                }
                (_, VenueKind::Bell) => std::slice::from_ref(&band.q),
            };
            for q in qs {
                if reset {
                    self.sections[n].s = [[0.0; 2]; 2];
                }
                self.sections[n].tune(kind, rate, band.freq_hz, band.gain_db, *q);
                n += 1;
            }
        }
        self.active = n;
        self.layout = layout;
        self.trim = 10f32.powf(settings.trim_db / 20.0);
    }
    #[inline]
    fn run(&mut self, l: f32, r: f32) -> (f32, f32) {
        let (mut l, mut r) = (l, r);
        for section in &mut self.sections[..self.active] {
            l = section.run(0, l);
            r = section.run(1, r);
        }
        (l * self.trim, r * self.trim)
    }
}

#[derive(Debug)]
pub struct VenueEq {
    rate: f32,
    live: Chain,
    next: Chain,
    /// Crossfade progress 0–1 toward `next`, while one is running.
    fading: Option<f32>,
    fade_step: f32,
    /// What the live chain is tuned to, and where it glides.
    current: Option<VenueSettings>,
    target: Option<VenueSettings>,
    glide: f32,
    countdown: usize,
}
impl VenueEq {
    pub fn new(rate: u32) -> Self {
        let rate = rate.max(1) as f32;
        Self {
            rate,
            live: Chain::FLAT,
            next: Chain::FLAT,
            fading: None,
            fade_step: 1.0 / (CROSSFADE_SECONDS * rate),
            current: None,
            target: None,
            glide: 1.0 - (-(GLIDE_BLOCK as f32) / (GLIDE_SECONDS * rate)).exp(),
            countdown: 0,
        }
    }
    /// Applies at once, with no transition: a stream starting with its EQ.
    pub fn start(&mut self, applied: Option<VenueApplied>) {
        let effective = applied.filter(|a| !a.bypass).map(|a| a.settings);
        self.fading = None;
        self.live = Chain::FLAT;
        if let Some(settings) = effective {
            self.live.tune(self.rate, &settings, true);
        }
        self.current = effective;
        self.target = effective;
    }
    /// Moves to new settings: glides when the same bands exist before and
    /// after and `crossfade` is false; otherwise crossfades over 30 ms.
    /// Invalid settings are ignored; the caller validates first.
    pub fn apply(&mut self, applied: Option<VenueApplied>, crossfade: bool) {
        if applied.is_some_and(|a| a.settings.validate().is_err()) {
            return;
        }
        let effective = applied.filter(|a| !a.bypass).map(|a| a.settings);
        let same_layout = match (self.current, effective) {
            (Some(a), Some(b)) => a.layout() == b.layout(),
            (None, None) => true,
            _ => false,
        };
        if !crossfade && same_layout && self.fading.is_none() {
            self.target = effective;
            return;
        }
        if self.fading.is_some() {
            // A new switch during a crossfade: land the current one first.
            self.live = self.next;
        }
        self.next = Chain::FLAT;
        if let Some(settings) = effective {
            self.next.tune(self.rate, &settings, true);
        }
        self.fading = Some(0.0);
        self.current = effective;
        self.target = effective;
    }

    fn step_glide(&mut self) {
        let (Some(current), Some(target)) = (&mut self.current, self.target) else {
            return;
        };
        if *current == target {
            return;
        }
        let k = self.glide;
        let mut done = true;
        let mut mv = |value: &mut f32, goal: f32, log: bool| {
            if log {
                let (a, b) = (value.ln(), goal.ln());
                *value = (a + (b - a) * k).exp();
            } else {
                *value += (goal - *value) * k;
            }
            if (*value - goal).abs() <= goal.abs().max(1.0) * 1e-4 {
                *value = goal;
            } else {
                done = false;
            }
        };
        for (band, goal) in current.bands.iter_mut().zip(target.bands.iter()) {
            mv(&mut band.freq_hz, goal.freq_hz, true);
            mv(&mut band.gain_db, goal.gain_db, false);
            mv(&mut band.q, goal.q, true);
        }
        mv(&mut current.trim_db, target.trim_db, false);
        if done {
            *current = target;
        }
        let settings = *current;
        self.live.tune(self.rate, &settings, false);
    }

    pub fn process(&mut self, left: &mut [f32], right: &mut [f32]) {
        if self.fading.is_none() && self.current.is_none() {
            return;
        }
        for (left, right) in left
            .chunks_mut(GLIDE_BLOCK)
            .zip(right.chunks_mut(GLIDE_BLOCK))
        {
            if self.fading.is_none() {
                if self.countdown == 0 {
                    self.step_glide();
                    self.countdown = 1;
                }
                self.countdown -= 1;
            }
            for (l, r) in left.iter_mut().zip(right.iter_mut()) {
                let (a, b) = self.live.run(*l, *r);
                if let Some(progress) = &mut self.fading {
                    let (c, d) = self.next.run(*l, *r);
                    // Equal-gain crossfade: both chains see the same input.
                    let p = *progress;
                    *l = a + (c - a) * p;
                    *r = b + (d - b) * p;
                    *progress += self.fade_step;
                    if *progress >= 1.0 {
                        self.fading = None;
                        self.live = self.next;
                    }
                } else {
                    *l = a;
                    *r = b;
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const RATE: u32 = 48_000;

    fn sine(freq: f32, frames: usize, offset: usize) -> Vec<f32> {
        (0..frames)
            .map(|i| (std::f32::consts::TAU * freq * (i + offset) as f32 / RATE as f32).sin())
            .collect()
    }

    fn steady_gain(eq: &mut VenueEq, freq: f32) -> f32 {
        let mut l = sine(freq, RATE as usize, 0);
        let mut r = l.clone();
        eq.process(&mut l, &mut r);
        assert_eq!(l, r, "both channels see the same correction");
        let peak = l[RATE as usize / 2..]
            .iter()
            .fold(0.0f32, |m, v| m.max(v.abs()));
        20.0 * peak.log10()
    }

    fn applied(settings: VenueSettings) -> Option<VenueApplied> {
        Some(VenueApplied {
            settings,
            bypass: false,
        })
    }

    #[test]
    fn nothing_flat_or_bypassed_is_sample_identical() {
        let source = sine(997.0, 4096, 0);
        for venue in [
            None,
            applied(VenueSettings::default()),
            Some(VenueApplied {
                settings: VenueSettings {
                    trim_db: -6.0,
                    ..VenueSettings::default()
                },
                bypass: true,
            }),
        ] {
            let mut eq = VenueEq::new(RATE);
            eq.start(venue);
            let (mut l, mut r) = (source.clone(), source.clone());
            eq.process(&mut l, &mut r);
            assert_eq!(l, source, "{venue:?}");
        }
        assert!(VenueSettings::default().validate().is_ok());
    }

    #[test]
    fn every_band_and_the_trim_match_the_cookbook() {
        let mut settings = VenueSettings::default();
        settings.bands[3].gain_db = -6.0;
        let mut eq = VenueEq::new(RATE);
        eq.start(applied(settings));
        assert!((steady_gain(&mut eq, 1000.0) + 6.0).abs() < 0.1);

        let mut settings = VenueSettings::default();
        settings.bands[1].gain_db = 6.0;
        settings.trim_db = -3.0;
        let mut eq = VenueEq::new(RATE);
        eq.start(applied(settings));
        assert!(
            (steady_gain(&mut eq, 30.0) - 3.0).abs() < 0.4,
            "shelf +6, trim −3"
        );
        assert!((steady_gain(&mut eq, 4000.0) + 3.0).abs() < 0.1);

        for (steep, per_octave) in [(false, 12.0), (true, 24.0)] {
            let mut settings = VenueSettings::default();
            settings.bands[0] = VenueBandSettings {
                enabled: true,
                freq_hz: 200.0,
                gain_db: 0.0,
                q: 0.707,
                steep,
            };
            let mut eq = VenueEq::new(RATE);
            eq.start(applied(settings));
            assert!(
                (steady_gain(&mut eq, 200.0) + 3.0).abs() < 0.3,
                "−3 dB at the corner"
            );
            let two_octaves = steady_gain(&mut eq, 50.0);
            assert!(
                (two_octaves + 2.0 * per_octave).abs() < 1.5,
                "{two_octaves}"
            );
        }
        let mut settings = VenueSettings::default();
        settings.bands[6].enabled = true;
        settings.bands[6].steep = true;
        let mut eq = VenueEq::new(RATE);
        eq.start(applied(settings));
        assert!(steady_gain(&mut eq, 1000.0).abs() < 0.1);
        assert!(steady_gain(&mut eq, 20_000.0) < -20.0);
    }

    #[test]
    fn ranges_from_the_band_table_are_enforced() {
        let mut settings = VenueSettings::default();
        settings.bands[0].freq_hz = 500.0;
        assert!(settings.validate().is_err(), "high-pass stops at 400 Hz");
        let mut settings = VenueSettings::default();
        settings.bands[3].gain_db = 13.0;
        assert!(settings.validate().is_err());
        let settings = VenueSettings {
            trim_db: 7.0,
            ..VenueSettings::default()
        };
        assert!(settings.validate().is_err());
        // Invalid settings never reach the filters.
        let mut eq = VenueEq::new(RATE);
        eq.apply(applied(settings), true);
        assert!(eq.fading.is_none() && eq.current.is_none());
    }

    /// Runs a 200 Hz tone through a change and returns the largest
    /// sample-to-sample step and the largest sample.
    fn transition(
        from: Option<VenueApplied>,
        to: Option<VenueApplied>,
        crossfade: bool,
    ) -> (f32, f32) {
        let mut eq = VenueEq::new(RATE);
        eq.start(from);
        let mut offset = 0;
        let mut run = |eq: &mut VenueEq, blocks: usize| {
            let mut out = Vec::new();
            for _ in 0..blocks {
                let mut l = sine(200.0, 128, offset)
                    .iter()
                    .map(|v| v * 0.5)
                    .collect::<Vec<_>>();
                let mut r = l.clone();
                eq.process(&mut l, &mut r);
                offset += 128;
                out.extend(l);
            }
            out
        };
        let before = run(&mut eq, 200);
        eq.apply(to, crossfade);
        let after = run(&mut eq, 100);
        let joined: Vec<f32> = before[before.len() - 256..]
            .iter()
            .chain(&after)
            .copied()
            .collect();
        let step = joined
            .windows(2)
            .fold(0.0f32, |m, w| m.max((w[1] - w[0]).abs()));
        let peak = joined.iter().fold(0.0f32, |m, v| m.max(v.abs()));
        (step, peak)
    }

    #[test]
    fn switches_bypass_and_edits_change_without_clicks() {
        // A 200 Hz tone at 0.5 moves at most 0.5 · 2π · 200 / 48 000 ≈ 0.013
        // per sample; a click would jump far beyond that.
        let smooth = 0.5 * std::f32::consts::TAU * 200.0 / RATE as f32 * 2.0;
        let mut boomy = VenueSettings::default();
        boomy.bands[0] = VenueBandSettings {
            enabled: true,
            freq_hz: 100.0,
            gain_db: 0.0,
            q: 0.707,
            steep: true,
        };
        boomy.bands[2].gain_db = -9.0;
        boomy.bands[2].freq_hz = 200.0;
        boomy.bands[2].q = 6.0;
        let flat = applied(VenueSettings::default());
        for (from, to, crossfade) in [
            (flat, applied(boomy), true),
            (applied(boomy), flat, true),
            (
                applied(boomy),
                Some(VenueApplied {
                    settings: boomy,
                    bypass: true,
                }),
                false,
            ),
            (None, applied(boomy), false),
        ] {
            let (step, peak) = transition(from, to, crossfade);
            assert!(step < smooth, "step {step} ≥ {smooth}");
            assert!(peak <= 0.51, "no overshoot: {peak}");
        }
        // A knob drag: the bell moves from −9 dB to +3 dB by gliding.
        let mut louder = boomy;
        louder.bands[2].gain_db = 3.0;
        let (step, _) = transition(applied(boomy), applied(louder), false);
        assert!(step < smooth, "glide step {step}");
    }

    #[test]
    fn a_glide_settles_on_the_exact_target() {
        let mut from = VenueSettings::default();
        from.bands[3].gain_db = -6.0;
        let mut to = from;
        to.bands[3].gain_db = 4.0;
        to.bands[3].freq_hz = 2000.0;
        to.trim_db = -2.0;
        let mut eq = VenueEq::new(RATE);
        eq.start(applied(from));
        eq.apply(applied(to), false);
        assert!(eq.fading.is_none(), "same bands: glide, not crossfade");
        let (mut l, mut r) = (vec![0.0; 4800], vec![0.0; 4800]);
        eq.process(&mut l, &mut r);
        assert_eq!(eq.current, Some(to), "within 100 ms");
        let mut reference = VenueEq::new(RATE);
        reference.start(applied(to));
        assert!((steady_gain(&mut eq, 2000.0) - steady_gain(&mut reference, 2000.0)).abs() < 0.01);
    }
}
