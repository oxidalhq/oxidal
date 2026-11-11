//! Venue EQ output stage: RBJ Audio EQ Cookbook biquads in transposed direct
//! form II, per channel, applied once after the session mix and before mono
//! fold, so it corrects the room without touching the rig, its taps or
//! recordings. Sections are preallocated; processing never allocates. An
//! empty or bypassed stage passes samples unchanged.
//! @see docs/audio.md
use crate::eq::EqType;

/// The most sections one stage holds: seven bands, two of which may be
/// 24 dB/oct pass filters made of two sections each.
pub const MAX_SECTIONS: usize = 9;

/// One venue band as the audio thread receives it, already validated.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct VenueBand {
    pub kind: VenueKind,
    pub freq_hz: f32,
    pub gain_db: f32,
    pub q: f32,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VenueKind {
    Bell,
    LowShelf,
    HighShelf,
    /// High-pass; `steep` is 24 dB/oct (two sections), otherwise 12 dB/oct.
    HighPass {
        steep: bool,
    },
    /// Low-pass; `steep` is 24 dB/oct (two sections), otherwise 12 dB/oct.
    LowPass {
        steep: bool,
    },
}
impl VenueKind {
    /// The stored band type this kind corresponds to.
    pub fn eq_type(self) -> EqType {
        match self {
            Self::Bell => EqType::Bell,
            Self::LowShelf => EqType::Lowshelf,
            Self::HighShelf => EqType::Highshelf,
            Self::HighPass { .. } => EqType::Lowcut,
            Self::LowPass { .. } => EqType::Highcut,
        }
    }
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
    fn coefficients(kind: VenueKind, rate: f32, freq: f32, gain_db: f32, q: f32) -> Self {
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
                let b0 = a * (ap - sign * am * cos + k);
                let b1 = sign * 2.0 * a * (am - sign * ap * cos);
                let b2 = a * (ap - sign * am * cos - k);
                let a0 = ap + sign * am * cos + k;
                let a1 = -sign * 2.0 * (am + sign * ap * cos);
                let a2 = ap + sign * am * cos - k;
                (b0, b1, b2, a0, a1, a2)
            }
            VenueKind::HighPass { .. } => (
                (1.0 + cos) / 2.0,
                -(1.0 + cos),
                (1.0 + cos) / 2.0,
                1.0 + alpha,
                -2.0 * cos,
                1.0 - alpha,
            ),
            VenueKind::LowPass { .. } => (
                (1.0 - cos) / 2.0,
                1.0 - cos,
                (1.0 - cos) / 2.0,
                1.0 + alpha,
                -2.0 * cos,
                1.0 - alpha,
            ),
        };
        Self {
            b0: b0 / a0,
            b1: b1 / a0,
            b2: b2 / a0,
            a1: a1 / a0,
            a2: a2 / a0,
            s: [[0.0; 2]; 2],
        }
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

#[derive(Debug)]
pub struct VenueEq {
    rate: f32,
    sections: [Section; MAX_SECTIONS],
    active: usize,
    bypass: bool,
}
impl VenueEq {
    pub fn new(rate: u32) -> Self {
        Self {
            rate: rate.max(1) as f32,
            sections: [Section::default(); MAX_SECTIONS],
            active: 0,
            bypass: false,
        }
    }
    /// Replaces the bands. Bands that do not fit are ignored; the caller
    /// validates first. Coefficients change at once: the 20 ms glides and
    /// 30 ms set crossfade of the full design arrive with the venue EQ phase.
    pub fn set(&mut self, bands: &[VenueBand]) {
        let mut active = 0;
        for band in bands {
            let qs: &[f32] = match band.kind {
                VenueKind::HighPass { steep: true } | VenueKind::LowPass { steep: true } => {
                    &[0.541_196_1, 1.306_563]
                }
                VenueKind::HighPass { .. } | VenueKind::LowPass { .. } => {
                    &[std::f32::consts::FRAC_1_SQRT_2]
                }
                VenueKind::LowShelf | VenueKind::HighShelf => &[std::f32::consts::FRAC_1_SQRT_2],
                VenueKind::Bell => &[band.q],
            };
            if active + qs.len() > MAX_SECTIONS {
                break;
            }
            for q in qs {
                self.sections[active] =
                    Section::coefficients(band.kind, self.rate, band.freq_hz, band.gain_db, *q);
                active += 1;
            }
        }
        self.active = active;
    }
    pub fn set_bypass(&mut self, bypass: bool) {
        self.bypass = bypass;
    }
    pub fn apply(&mut self, left: &mut [f32], right: &mut [f32]) {
        if self.bypass || self.active == 0 {
            return;
        }
        let sections = &mut self.sections[..self.active];
        for (l, r) in left.iter_mut().zip(right.iter_mut()) {
            for section in sections.iter_mut() {
                *l = section.run(0, *l);
                *r = section.run(1, *r);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn steady_gain(eq: &mut VenueEq, rate: u32, freq: f32) -> f32 {
        let frames = rate as usize;
        let mut l: Vec<f32> = (0..frames)
            .map(|i| (std::f32::consts::TAU * freq * i as f32 / rate as f32).sin())
            .collect();
        let mut r = l.clone();
        eq.apply(&mut l, &mut r);
        let tail = &l[frames / 2..];
        let peak = tail.iter().fold(0.0f32, |m, v| m.max(v.abs()));
        assert_eq!(l, r, "both channels see the same correction");
        20.0 * peak.log10()
    }

    #[test]
    fn an_empty_or_bypassed_stage_is_sample_identical() {
        let mut eq = VenueEq::new(48000);
        let source: Vec<f32> = (0..256).map(|i| (i as f32 * 0.37).sin() * 0.8).collect();
        let (mut l, mut r) = (source.clone(), source.clone());
        eq.apply(&mut l, &mut r);
        assert_eq!(l, source);
        eq.set(&[VenueBand {
            kind: VenueKind::Bell,
            freq_hz: 1000.0,
            gain_db: 6.0,
            q: 1.0,
        }]);
        eq.set_bypass(true);
        eq.apply(&mut l, &mut r);
        assert_eq!(r, source);
    }

    #[test]
    fn bands_match_the_cookbook_response() {
        let rate = 48000;
        let mut eq = VenueEq::new(rate);
        eq.set(&[VenueBand {
            kind: VenueKind::Bell,
            freq_hz: 1000.0,
            gain_db: -6.0,
            q: 1.0,
        }]);
        assert!((steady_gain(&mut eq, rate, 1000.0) + 6.0).abs() < 0.1);
        let mut eq = VenueEq::new(rate);
        eq.set(&[VenueBand {
            kind: VenueKind::LowShelf,
            freq_hz: 120.0,
            gain_db: 6.0,
            q: 0.707,
        }]);
        assert!((steady_gain(&mut eq, rate, 30.0) - 6.0).abs() < 0.3);
        assert!(steady_gain(&mut eq, rate, 4000.0).abs() < 0.1);
        for (steep, expected) in [(false, -12.0), (true, -24.0)] {
            let mut eq = VenueEq::new(rate);
            eq.set(&[VenueBand {
                kind: VenueKind::HighPass { steep },
                freq_hz: 200.0,
                gain_db: 0.0,
                q: 0.707,
            }]);
            // One octave below the corner is about 12 or 24 dB down (−3 at the corner).
            let at_corner = steady_gain(&mut eq, rate, 200.0);
            assert!((at_corner + 3.0).abs() < 0.3, "{at_corner}");
            let below = steady_gain(&mut eq, rate, 50.0);
            assert!((below - 2.0 * expected).abs() < 1.5, "{below}");
        }
        assert_eq!(
            VenueKind::LowPass { steep: true }.eq_type(),
            EqType::Highcut
        );
    }

    #[test]
    fn more_bands_than_sections_are_ignored_not_overflowed() {
        let mut eq = VenueEq::new(48000);
        let steep = VenueBand {
            kind: VenueKind::LowPass { steep: true },
            freq_hz: 8000.0,
            gain_db: 0.0,
            q: 0.707,
        };
        eq.set(&[steep; 6]);
        assert_eq!(eq.active, 8);
    }
}
