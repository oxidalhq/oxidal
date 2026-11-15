//! Chord hold: a compact spectral hold for sounds with no single pitch.
//!
//! The analysis follows Oxidal Hold: two overlapping Hann-windowed frames,
//! the peaks of the newest one, and for each peak the frequency its phase
//! turned at between the frames. Where Hold rebuilds the sound with an
//! inverse transform every hop, this keeps only the peaks and plays each as
//! one steady sinusoid, which costs a few multiplications per partial and
//! never a whole transform in one audio block. The frame is twice as long as
//! Hold's (about 170 ms), so notes a tone apart low on the neck come out as
//! separate peaks; the two forward transforms of a capture are spread over
//! about 35 ms, one pass at a time.
//!
//! # References
//!
//! - Cooley and Tukey, "An algorithm for the machine calculation of complex Fourier series" (1965). <https://doi.org/10.1090/S0025-5718-1965-0178586-1>
//! - Flanagan and Golden, "Phase Vocoder" (1966). <https://doi.org/10.1002/j.1538-7305.1966.tb01706.x>
//! - Dolson, "The Phase Vocoder: A Tutorial" (1986). <https://doi.org/10.2307/3680093>
//! - McAulay and Quatieri, "Speech analysis/synthesis based on a sinusoidal representation" (1986). <https://doi.org/10.1109/TASSP.1986.1164910>
//!
//! @see docs/native-sustain.md

use core::f32::consts::{PI, TAU};

/// Sinusoids kept: three notes with about ten audible harmonics each.
pub const PARTIALS: usize = 32;
/// Lowest and highest partial kept, in hertz.
const LOWEST: f32 = 70.0;
const HIGHEST: f32 = 5000.0;
/// A peak is the largest bin within the half-width of the Hann window's
/// main lobe (two bins)...
const SIDE: usize = 2;
/// ...falls by 6 dB at that distance on at least one side, as the lobe of a
/// steady sinusoid does (by 14 dB or more) and a flat stretch of noise does
/// not...
const LOBE_FALL: f32 = 4.0;
/// ...and is within 30 dB of the strongest peak.
const BELOW_TOP: f32 = 1.0e-3;
/// Samples between two corrections of the oscillators' rounding drift.
const TRIM_EVERY: u32 = 1024;

/// Radix-2 fast Fourier transform, forward only, one pass at a time.
#[derive(Clone)]
pub struct Fft {
    size: usize,
    passes: u32,
    cos: Vec<f32>,
    sin: Vec<f32>,
    reversed: Vec<usize>,
}

impl core::fmt::Debug for Fft {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.debug_struct("Fft").field("size", &self.size).finish()
    }
}

impl Fft {
    /// Tables for a transform of `size` points, rounded up to a power of two.
    pub fn new(size: usize) -> Self {
        let size = size.next_power_of_two().max(4);
        let passes = size.trailing_zeros();
        let turn = |k: usize| TAU * k as f32 / size as f32;
        Self {
            size,
            passes,
            cos: (0..size / 2).map(|k| turn(k).cos()).collect(),
            sin: (0..size / 2).map(|k| turn(k).sin()).collect(),
            reversed: (0..size)
                .map(|i| i.reverse_bits() >> (usize::BITS - passes))
                .collect(),
        }
    }

    pub fn size(&self) -> usize {
        self.size
    }

    /// Butterfly passes in one transform.
    pub fn passes(&self) -> u32 {
        self.passes
    }

    /// Where input sample `index` goes before the first pass.
    pub fn place(&self, index: usize) -> usize {
        self.reversed.get(index).copied().unwrap_or(0)
    }

    /// One butterfly pass (0 is the first) over data in bit-reversed order.
    pub fn pass(&self, real: &mut [f32], imaginary: &mut [f32], pass: u32) {
        if pass >= self.passes {
            return;
        }
        let half = 1_usize << pass;
        let stride = self.size / (2 * half);
        let blocks = real
            .chunks_exact_mut(2 * half)
            .zip(imaginary.chunks_exact_mut(2 * half));
        for (real_block, imaginary_block) in blocks {
            let (real_low, real_high) = real_block.split_at_mut(half);
            let (imaginary_low, imaginary_high) = imaginary_block.split_at_mut(half);
            let twiddles = self.cos.iter().zip(&self.sin).step_by(stride);
            let low = real_low.iter_mut().zip(imaginary_low.iter_mut());
            let high = real_high.iter_mut().zip(imaginary_high.iter_mut());
            for (((a_re, a_im), (b_re, b_im)), (cos, sin)) in low.zip(high).zip(twiddles) {
                // b times e^(-j·angle)
                let t_re = *b_re * cos + *b_im * sin;
                let t_im = *b_im * cos - *b_re * sin;
                *b_re = *a_re - t_re;
                *b_im = *a_im - t_im;
                *a_re += t_re;
                *a_im += t_im;
            }
        }
    }
}

/// One analysed frame.
#[derive(Clone)]
struct Spectrum {
    real: Vec<f32>,
    imaginary: Vec<f32>,
}

impl Spectrum {
    fn new(size: usize) -> Self {
        Self {
            real: vec![0.0; size],
            imaginary: vec![0.0; size],
        }
    }
    fn phase(&self, bin: usize) -> f32 {
        let re = self.real.get(bin).copied().unwrap_or(0.0);
        let im = self.imaginary.get(bin).copied().unwrap_or(0.0);
        im.atan2(re)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Job {
    Idle,
    /// Passes done so far over the two frames (older first).
    Transform(u32),
    Pick,
}

/// Captures the spectrum of the newest input and keeps it sounding.
#[derive(Clone)]
pub struct ChordHold {
    fft: Fft,
    rate: f32,
    hop: usize,
    history: Vec<f32>,
    mask: usize,
    write: usize,
    window: Vec<f32>,
    older: Spectrum,
    newest: Spectrum,
    power: Vec<f32>,
    job: Job,
    /// Samples taken since the capture began.
    elapsed: u32,
    /// The held partials: a rotating unit vector, its turn per sample and
    /// its amplitude.
    cos: [f32; PARTIALS],
    sin: [f32; PARTIALS],
    turn_cos: [f32; PARTIALS],
    turn_sin: [f32; PARTIALS],
    amplitude: [f32; PARTIALS],
    held: usize,
    ready: bool,
    until_trim: u32,
}

impl core::fmt::Debug for ChordHold {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.debug_struct("ChordHold")
            .field("frame", &self.fft.size())
            .field("job", &self.job)
            .field("held", &self.held)
            .finish()
    }
}

impl ChordHold {
    /// Frame length for a rate: about 170 ms, a power of two. Its bins are
    /// under 6 Hz apart, and two notes need four bins between them to show
    /// as two peaks: 23 Hz, the gap between G and B on the low strings.
    pub fn new(sample_rate: f32) -> Self {
        let frame = if sample_rate <= 50_000.0 {
            8192
        } else {
            16_384
        };
        let fft = Fft::new(frame);
        let size = fft.size();
        let hop = size / 4;
        let history = (size + hop).next_power_of_two();
        Self {
            rate: sample_rate,
            hop,
            history: vec![0.0; history],
            mask: history - 1,
            write: 0,
            window: (0..size)
                .map(|i| 0.5 - 0.5 * (TAU * i as f32 / size as f32).cos())
                .collect(),
            older: Spectrum::new(size),
            newest: Spectrum::new(size),
            power: vec![0.0; size / 2 + 1],
            job: Job::Idle,
            elapsed: 0,
            cos: [0.0; PARTIALS],
            sin: [0.0; PARTIALS],
            turn_cos: [1.0; PARTIALS],
            turn_sin: [0.0; PARTIALS],
            amplitude: [0.0; PARTIALS],
            held: 0,
            ready: false,
            until_trim: TRIM_EVERY,
            fft,
        }
    }

    pub fn reset(&mut self) {
        self.history.fill(0.0);
        self.write = 0;
        self.stop();
    }

    /// Seconds of input a capture looks at.
    pub fn frame_seconds(&self) -> f32 {
        self.fft.size() as f32 / self.rate
    }

    /// Slices of work in one capture; call [`Self::work`] this many times.
    pub fn slices(&self) -> u32 {
        2 * self.fft.passes() + 1
    }

    /// Remembers one input sample.
    pub fn push(&mut self, x: f32) {
        self.write = (self.write + 1) & self.mask;
        if let Some(slot) = self.history.get_mut(self.write) {
            *slot = x;
        }
        self.elapsed = self.elapsed.saturating_add(1);
    }

    /// Starts a capture of the newest frame. The frames are copied now; the
    /// transforms are done by later calls to [`Self::work`].
    pub fn begin(&mut self) {
        let size = self.fft.size();
        for (frame, back) in [(&mut self.older, self.hop), (&mut self.newest, 0)] {
            frame.imaginary.fill(0.0);
            for (i, w) in self.window.iter().enumerate() {
                // Sample i of a frame that ends `back` samples ago.
                let at = self.write.wrapping_sub(back + size - 1 - i) & self.mask;
                let x = self.history.get(at).copied().unwrap_or(0.0);
                if let Some(slot) = frame.real.get_mut(self.fft.place(i)) {
                    *slot = x * w;
                }
            }
        }
        self.held = 0;
        self.ready = false;
        self.elapsed = 0;
        self.job = Job::Transform(0);
    }

    /// True while a capture still has work to do.
    pub fn busy(&self) -> bool {
        self.job != Job::Idle
    }

    /// True once a capture has finished (it may have found nothing).
    pub fn ready(&self) -> bool {
        self.ready
    }

    /// Partials held.
    pub fn held(&self) -> usize {
        self.held
    }

    /// Abandons a capture that is still being worked out.
    pub fn cancel(&mut self) {
        self.job = Job::Idle;
    }

    /// Forgets the held sound.
    pub fn stop(&mut self) {
        self.job = Job::Idle;
        self.held = 0;
        self.ready = false;
    }

    /// One bounded slice of a capture: a single transform pass, or the peak
    /// picking at the end.
    pub fn work(&mut self) {
        match self.job {
            Job::Idle => {}
            Job::Transform(done) => {
                let passes = self.fft.passes();
                let frame = if done < passes {
                    &mut self.older
                } else {
                    &mut self.newest
                };
                self.fft
                    .pass(&mut frame.real, &mut frame.imaginary, done % passes.max(1));
                self.job = if done + 1 >= 2 * passes {
                    Job::Pick
                } else {
                    Job::Transform(done + 1)
                };
            }
            Job::Pick => {
                self.pick();
                self.job = Job::Idle;
                self.ready = true;
            }
        }
    }

    /// Chooses the strongest spectral peaks and starts one oscillator on each.
    fn pick(&mut self) {
        let size = self.fft.size();
        let bins = size / 2;
        for ((p, re), im) in self
            .power
            .iter_mut()
            .zip(&self.newest.real)
            .zip(&self.newest.imaginary)
        {
            *p = re * re + im * im;
        }
        let power = |bin: usize| self.power.get(bin).copied().unwrap_or(0.0);
        let lowest = ((LOWEST * size as f32 / self.rate).ceil() as usize).max(SIDE + 1);
        let highest =
            ((HIGHEST * size as f32 / self.rate) as usize).min(bins.saturating_sub(SIDE + 1));
        let top = (lowest..=highest).map(power).fold(0.0_f32, f32::max);
        // The strongest peaks, strongest first.
        let mut chosen = [(0.0_f32, 0_usize); PARTIALS];
        let mut count = 0;
        if top > 0.0 {
            for bin in lowest..=highest {
                let here = power(bin);
                let peak = here > BELOW_TOP * top
                    && (1..=SIDE).all(|d| here > power(bin - d) && here >= power(bin + d))
                    && here > LOBE_FALL * power(bin - SIDE).min(power(bin + SIDE));
                if !peak {
                    continue;
                }
                // Insert in order of strength; the weakest falls off the end.
                let mut entry = (here, bin);
                for slot in chosen.iter_mut().take((count + 1).min(PARTIALS)) {
                    if entry.0 > slot.0 {
                        core::mem::swap(slot, &mut entry);
                    }
                }
                count = (count + 1).min(PARTIALS);
            }
        }
        let mut total = 0.0;
        for (index, (strength, bin)) in chosen.iter().take(count).enumerate() {
            // The phase each bin should turn through in one hop, and how far
            // it really turned: together, the partial's true frequency.
            let expected = TAU * *bin as f32 * self.hop as f32 / size as f32;
            let mut extra = self.newest.phase(*bin) - self.older.phase(*bin) - expected;
            extra -= TAU * (extra / TAU).round();
            // Distance from the bin centre in bins; beyond one the estimate
            // is not to be trusted.
            let offset = (extra * size as f32 / (TAU * self.hop as f32)).clamp(-1.0, 1.0);
            let turn = TAU * (*bin as f32 + offset) / size as f32;
            // A Hann window's response `offset` bins from a sinusoid is
            // sinc(offset) / (1 - offset²) of its peak value amplitude·N/4.
            let response = if offset.abs() < 1.0e-3 {
                1.0
            } else if (1.0 - offset.abs()) < 1.0e-3 {
                0.5
            } else {
                (PI * offset).sin() / (PI * offset * (1.0 - offset * offset))
            };
            let amplitude = 4.0 * strength.sqrt() / (size as f32 * response.max(0.5));
            // The window is centred on the frame, where the bin's phase is
            // its angle plus pi for odd bins; run it on to this sample.
            let centre = self.newest.phase(*bin) + PI * (*bin % 2) as f32;
            let since = (size / 2) as f32 + self.elapsed.saturating_sub(1) as f32;
            let mut phase = centre + turn * since;
            phase -= TAU * (phase / TAU).round();
            let slots = (
                self.cos.get_mut(index),
                self.sin.get_mut(index),
                self.turn_cos.get_mut(index),
                self.turn_sin.get_mut(index),
                self.amplitude.get_mut(index),
            );
            if let (Some(cos), Some(sin), Some(turn_cos), Some(turn_sin), Some(slot)) = slots {
                (*sin, *cos) = phase.sin_cos();
                (*turn_sin, *turn_cos) = turn.sin_cos();
                *slot = amplitude;
                total += 0.5 * amplitude * amplitude;
            }
        }
        // Scale to unit power, so the caller sets the level.
        self.held = if total > 0.0 { count } else { 0 };
        if total > 0.0 {
            let scale = 1.0 / total.sqrt();
            for amplitude in self.amplitude.iter_mut().take(count) {
                *amplitude *= scale;
            }
        }
        self.until_trim = TRIM_EVERY;
    }

    /// One sample of the held sound, at unit power.
    #[allow(clippy::should_implement_trait)]
    pub fn next(&mut self) -> f32 {
        let held = self.held.min(PARTIALS);
        let mut sums = [0.0_f32; 4];
        let state = self.cos[..held].iter_mut().zip(self.sin[..held].iter_mut());
        let turns = self.turn_cos[..held].iter().zip(&self.turn_sin[..held]);
        for (i, (((cos, sin), (turn_cos, turn_sin)), amplitude)) in
            state.zip(turns).zip(&self.amplitude[..held]).enumerate()
        {
            sums[i & 3] += *cos * amplitude;
            (*cos, *sin) = (
                *cos * turn_cos - *sin * turn_sin,
                *sin * turn_cos + *cos * turn_sin,
            );
        }
        self.until_trim = self.until_trim.saturating_sub(1);
        if self.until_trim == 0 {
            self.until_trim = TRIM_EVERY;
            // One Newton step back to unit length undoes rounding drift.
            for (cos, sin) in self.cos[..held].iter_mut().zip(self.sin[..held].iter_mut()) {
                let trim = 1.5 - 0.5 * (*cos * *cos + *sin * *sin);
                *cos *= trim;
                *sin *= trim;
            }
        }
        (sums[0] + sums[1]) + (sums[2] + sums[3])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_transform_matches_its_definition() {
        let fft = Fft::new(64);
        let signal: Vec<f32> = (0..64)
            .map(|i| (0.37 * i as f32).sin() + 0.5 * (1.3 * i as f32 + 0.2).cos() - 0.1)
            .collect();
        let (mut real, mut imaginary) = (vec![0.0; 64], vec![0.0; 64]);
        for (i, x) in signal.iter().enumerate() {
            real[fft.place(i)] = *x;
        }
        for pass in 0..fft.passes() {
            fft.pass(&mut real, &mut imaginary, pass);
        }
        for k in 0..64 {
            let (mut re, mut im) = (0.0_f64, 0.0_f64);
            for (i, x) in signal.iter().enumerate() {
                let angle = core::f64::consts::TAU * (k * i) as f64 / 64.0;
                re += f64::from(*x) * angle.cos();
                im -= f64::from(*x) * angle.sin();
            }
            assert!((f64::from(real[k]) - re).abs() < 1.0e-3, "bin {k} real");
            assert!(
                (f64::from(imaginary[k]) - im).abs() < 1.0e-3,
                "bin {k} imaginary"
            );
        }
    }

    fn chord(rate: f32, notes: &[f32], i: usize) -> f32 {
        notes
            .iter()
            .map(|f| {
                let w = TAU * f * i as f32 / rate;
                0.1 * w.sin() + 0.05 * (2.0 * w).sin() + 0.03 * (3.0 * w).sin()
            })
            .sum()
    }

    fn strength(signal: &[f32], rate: f32, hertz: f32) -> f32 {
        let (mut re, mut im) = (0.0_f32, 0.0_f32);
        for (i, x) in signal.iter().enumerate() {
            let angle = TAU * hertz * i as f32 / rate;
            re += x * angle.cos();
            im += x * angle.sin();
        }
        2.0 * (re * re + im * im).sqrt() / signal.len() as f32
    }

    #[test]
    fn a_captured_chord_keeps_its_notes_and_its_phase() {
        for rate in [44_100.0, 48_000.0, 96_000.0] {
            let notes = [164.81, 207.65, 233.08];
            let mut hold = ChordHold::new(rate);
            let warm = (0.4 * rate) as usize;
            for i in 0..warm {
                hold.push(chord(rate, &notes, i));
            }
            hold.begin();
            // The input carries on while the capture is worked out.
            let mut at = warm;
            while hold.busy() {
                for _ in 0..64 {
                    hold.push(chord(rate, &notes, at));
                    at += 1;
                }
                hold.work();
            }
            assert!(hold.ready() && hold.held() >= 9, "held {}", hold.held());
            // The last push was sample at - 1, and the first held sample
            // stands for that same instant.
            let held: Vec<f32> = (0..rate as usize).map(|_| hold.next()).collect();
            let power = held.iter().map(|x| x * x).sum::<f32>() / held.len() as f32;
            assert!((power - 1.0).abs() < 0.05, "power {power} at {rate}");
            // Every note and harmonic is there in the proportions played.
            let unit = strength(&held, rate, notes[0]);
            for note in notes {
                for (harmonic, share) in [(1.0, 1.0), (2.0, 0.5), (3.0, 0.3)] {
                    let found = strength(&held, rate, note * harmonic) / unit;
                    assert!(
                        (found / share - 1.0).abs() < 0.1,
                        "{note} x{harmonic}: {found}"
                    );
                }
            }
            // It continues the input: scaled back, the first samples match.
            let scale = 0.1 / unit;
            for (i, sample) in held.iter().take(200).enumerate() {
                let played = chord(rate, &notes, at - 1 + i);
                assert!(
                    (sample * scale - played).abs() < 0.04,
                    "sample {i} at {rate}"
                );
            }
        }
    }

    #[test]
    fn silence_and_noise_floor_capture_nothing_and_stop_is_silent() {
        let mut hold = ChordHold::new(48_000.0);
        for _ in 0..10_000 {
            hold.push(0.0);
        }
        hold.begin();
        for _ in 0..hold.slices() {
            hold.work();
        }
        assert!(hold.ready() && !hold.busy() && hold.held() == 0);
        assert_eq!(hold.next(), 0.0);
        hold.begin();
        hold.cancel();
        assert!(!hold.busy() && !hold.ready());
        hold.stop();
        assert_eq!(hold.next(), 0.0);
    }

    #[test]
    fn the_held_sound_does_not_drift_in_level() {
        let rate = 48_000.0;
        let mut hold = ChordHold::new(rate);
        for i in 0..20_000 {
            hold.push(chord(rate, &[110.0, 138.59], i));
        }
        hold.begin();
        for _ in 0..hold.slices() {
            hold.work();
        }
        let mut first = 0.0;
        let mut last = 0.0;
        for second in 0..60 {
            let power = (0..48_000).map(|_| hold.next().powi(2)).sum::<f32>() / 48_000.0;
            if second == 0 {
                first = power;
            }
            last = power;
        }
        assert!((last / first - 1.0).abs() < 1.5e-2, "{first} became {last}");
    }
}
