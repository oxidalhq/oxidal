//! The feedback delay network behind Room, Hall, Cloud, Bloom and Shimmer.
//!
//! Eight delay lines feed back through an energy-keeping mix. Each line loses
//! a little on every pass, by an amount set from its length and the decay
//! time, so every resonance of the network dies away at the same rate; a
//! one-pole shelf makes the top of the band die faster. The modes change the
//! line lengths, the diffusion, the modulation and what sits in the loop.
//!
//! # References
//!
//! - Jot and Chaigne, "Digital Delay Networks for Designing Artificial Reverberators" (1991). <https://aes2.org/publications/elibrary-page/?id=5663>
//! - Schlecht and Habets, "On Lossless Feedback Delay Networks" (2017). <https://doi.org/10.1109/TSP.2016.2637323>
//! - Allen and Berkley, "Image method for efficiently simulating small-room acoustics" (1979). <https://doi.org/10.1121/1.382599>
//!
//! @see docs/native-bloom.md

use crate::parts::{
    Allpass, Engine, FadingTap, Glide, LN_1000, Lin, RING_OUT_SECONDS, Settings, TICK, absorb,
    absorb_corner, absorb_cut, decay_trim, follow, guard, loop_gain, opaque_debug, passive_pair,
    tick_smoother,
};
use crate::shifter::Shifter;
use core::f32::consts::{FRAC_1_SQRT_2, TAU};
use oxidal_dsp::{DelayLine, OnePole, Smoothed, StateVariable, hadamard8, lerp, prime_at_or_above};

/// Where each line's length falls between the shortest and the longest of
/// the mode, as an exponent: sevenths, dealt so that both halves of the
/// network hold short and long lines.
const SPREAD: [f32; 8] = [
    0.0,
    4.0 / 7.0,
    2.0 / 7.0,
    6.0 / 7.0,
    1.0 / 7.0,
    5.0 / 7.0,
    3.0 / 7.0,
    1.0,
];
/// The same for the four all-passes inside the loop.
const LOOP_SPREAD: [f32; 4] = [0.0, 0.37, 0.71, 1.0];
/// Lines whose read position is slowly modulated, and each one's rate as a
/// multiple of the mode's rate (unrelated ratios, so they never line up).
const MOD_RATE: [f32; 8] = [0.0, 1.0, 0.0, 1.31, 0.77, 0.0, 0.0, 1.63];
/// Input diffuser lengths in seconds at scale one, left and right chains.
const INPUT_SECONDS: [[f32; 4]; 2] = [
    [0.0021, 0.0033, 0.0053, 0.0079],
    [0.00237, 0.00373, 0.00599, 0.00893],
];
/// The two lines that pass through the pitch shifters in Shimmer.
const SHIMMER_LINES: [usize; 2] = [2, 6];
/// Size scales every length by 2^(+-0.8).
const SIZE_OCTAVES: f32 = 1.6;
/// Longest line, in seconds, at the largest size; and the deepest modulation.
const LONGEST_SECONDS: f32 = 0.095 * 1.75;
const DEEPEST_SECONDS: f32 = 0.003;
const LONGEST_LOOP_PASS: f32 = 0.047 * 1.75;
const LONGEST_INPUT_PASS: f32 = 0.00893 * 3.0;
/// Six first reflections per ear.
const WALLS: usize = 6;
const SPEED_OF_SOUND: f32 = 343.0;
/// The sweep of the first shifter covers this long a grain; the second is a
/// little shorter so the two never crossfade together.
const GRAIN_SECONDS: [f32; 2] = [0.08, 0.066];
/// At full Shimmer, the share of the two lines' energy that is shifted on
/// each pass. Shifted energy keeps climbing until it leaves the band, so a
/// larger share makes a brighter but shorter tail.
const SHIMMER_SHARE: f32 = 0.7;
/// The shifters work below this frequency: no aliasing when an octave up
/// reads the signal at twice the speed, and no endless climb.
const SHIMMER_BAND_HERTZ: f32 = 6500.0;
const OUTPUT_SCALE: f32 = FRAC_1_SQRT_2 * 0.5;

/// What makes one mode of the network.
#[derive(Debug)]
struct Voicing {
    /// Shortest and longest line in seconds at Size 50%.
    lines: (f32, f32),
    /// Scale of the input diffuser lengths, and their gain.
    input: (f32, f32),
    /// Shortest and longest loop all-pass in seconds at Size 50%, and their gain.
    diffusion: (f32, f32, f32),
    /// Modulation depth in seconds at Mod 100%, and rate in hertz at Speed 50%.
    modulation: (f32, f32),
    /// Level of the early reflections.
    early: f32,
    /// Input enters one half of the network and the output listens to the other.
    bloom: bool,
    /// The pitch shifters sit in the loop.
    shimmer: bool,
    /// Input trim, measured so a sustained note comes out near its own level.
    level: f32,
}

const ROOM: Voicing = Voicing {
    lines: (0.011, 0.037),
    input: (0.6, 0.5),
    diffusion: (0.003, 0.0071, 0.3),
    modulation: (0.0005, 0.9),
    early: 0.5,
    bloom: false,
    shimmer: false,
    level: 0.57,
};
const HALL: Voicing = Voicing {
    lines: (0.031, 0.083),
    input: (1.0, 0.65),
    diffusion: (0.0067, 0.0157, 0.5),
    modulation: (0.001, 0.6),
    early: 0.15,
    bloom: false,
    shimmer: false,
    level: 0.9,
};
const CLOUD: Voicing = Voicing {
    lines: (0.043, 0.095),
    input: (3.0, 0.7),
    diffusion: (0.022, 0.047, 0.65),
    modulation: (0.003, 0.25),
    early: 0.0,
    bloom: false,
    shimmer: false,
    level: 1.03,
};
const BLOOM: Voicing = Voicing {
    lines: (0.037, 0.089),
    input: (2.2, 0.7),
    diffusion: (0.018, 0.041, 0.62),
    modulation: (0.0015, 0.4),
    early: 0.0,
    bloom: true,
    shimmer: false,
    level: 1.0,
};
const SHIMMER: Voicing = Voicing {
    lines: (0.031, 0.083),
    input: (1.2, 0.65),
    diffusion: (0.0083, 0.0173, 0.5),
    modulation: (0.001, 0.5),
    early: 0.08,
    bloom: false,
    shimmer: true,
    level: 0.95,
};

/// The voicing of a mode number, if the network plays that mode.
fn voicing(mode: usize) -> Option<&'static Voicing> {
    match mode {
        0 => Some(&ROOM),
        1 => Some(&HALL),
        4 => Some(&CLOUD),
        5 => Some(&BLOOM),
        6 => Some(&SHIMMER),
        _ => None,
    }
}

/// True if the network plays this mode.
pub fn plays(mode: usize) -> bool {
    voicing(mode).is_some()
}

/// The unscaled four-point Hadamard butterflies.
#[inline]
fn butterflies(x: [f32; 4]) -> [f32; 4] {
    let (p, q, r, t) = (x[0] + x[1], x[0] - x[1], x[2] + x[3], x[2] - x[3]);
    [p + r, q + t, p - r, q - t]
}

/// The feedback mix with a variable coupling between the two halves of the
/// network: each half is mixed by a four-point Hadamard matrix, then the
/// halves exchange `sin^2` of their energy. With `cos = sin` this is the
/// eight-point Hadamard mix; with a small `sin` energy seeps slowly from the
/// half that hears the input to the half that is heard.
#[inline]
fn coupled(v: &mut [f32; 8], cos: f32, sin: f32) {
    let a = butterflies([v[0], v[1], v[2], v[3]]);
    let b = butterflies([v[4], v[5], v[6], v[7]]);
    for j in 0..4 {
        v[j] = 0.5 * (cos * a[j] + sin * b[j]);
        v[j + 4] = 0.5 * (sin * a[j] - cos * b[j]);
    }
}

/// The feedback delay network engine.
pub struct Network {
    sample_rate: f32,
    stereo: bool,
    voice: &'static Voicing,
    mode: usize,
    /// Mode and size the lengths were last set for.
    applied: (usize, f32),
    retunes: u32,
    lines: [DelayLine; 8],
    taps: [FadingTap; 8],
    gain: [f32; 8],
    cut: [f32; 8],
    damp: [f32; 8],
    corner: f32,
    loop_pass: [Allpass; 4],
    loop_inner: [f32; 4],
    loop_amount: Glide,
    input_pass: [[Allpass; 4]; 2],
    input_amount: Glide,
    early_line: DelayLine,
    early_taps: [[FadingTap; WALLS]; 2],
    early_gains: [[f32; WALLS]; 2],
    early_level: Glide,
    phases: [f32; 8],
    offsets: [Lin; 8],
    depth: Smoothed,
    modulated: bool,
    bloom: Glide,
    share: Smoothed,
    mix_cos: Lin,
    mix_sin: Lin,
    plain: bool,
    shimmer: Smoothed,
    shimmer_cos: Lin,
    shimmer_sin: Lin,
    shimmer_inner: [f32; 2],
    shifters: [Shifter; 2],
    band: [StateVariable; 2],
    rumble: [OnePole; 2],
    ratio: Smoothed,
    sweep: [f32; 2],
    shifters_stale: bool,
    /// Fades the signal into the shifters when Shimmer starts, so their
    /// cleared memory never holds a sudden beginning.
    shimmer_feed: Glide,
    drive: Glide,
    hold: Smoothed,
    last: (f32, f32, f32, u32),
}
opaque_debug!(Network);

impl Network {
    /// Allocates everything for `sample_rate`. Not for the audio thread.
    pub fn new(sample_rate: f32, stereo: bool) -> Self {
        let samples = |seconds: f32| (seconds * sample_rate).ceil() as usize;
        let line = samples(LONGEST_SECONDS) + samples(DEEPEST_SECONDS) + 80;
        let mut band = [StateVariable::default(); 2];
        let mut rumble = [OnePole::default(); 2];
        for filter in &mut band {
            filter.set(sample_rate, SHIMMER_BAND_HERTZ, FRAC_1_SQRT_2);
        }
        for filter in &mut rumble {
            filter.set_cutoff(sample_rate, 70.0);
        }
        let mut network = Self {
            sample_rate,
            stereo,
            voice: &HALL,
            mode: 1,
            applied: (usize::MAX, 0.0),
            retunes: 0,
            lines: core::array::from_fn(|_| DelayLine::new(line)),
            taps: [FadingTap::new(sample_rate, 1); 8],
            gain: [0.0; 8],
            cut: [0.0; 8],
            damp: [0.0; 8],
            corner: 1.0,
            loop_pass: core::array::from_fn(|_| {
                Allpass::new(sample_rate, samples(LONGEST_LOOP_PASS) + 80)
            }),
            loop_inner: [0.0; 4],
            loop_amount: Glide::new(sample_rate, 15.0, 0.0),
            input_pass: core::array::from_fn(|_| {
                core::array::from_fn(|_| {
                    Allpass::new(sample_rate, samples(LONGEST_INPUT_PASS) + 80)
                })
            }),
            input_amount: Glide::new(sample_rate, 15.0, 0.0),
            early_line: DelayLine::new(samples(0.05)),
            early_taps: [[FadingTap::new(sample_rate, 1); WALLS]; 2],
            early_gains: [[0.0; WALLS]; 2],
            early_level: Glide::new(sample_rate, 15.0, 0.0),
            phases: [0.0, 0.0, 0.0, 0.25, 0.5, 0.0, 0.0, 0.75],
            offsets: [Lin::default(); 8],
            depth: tick_smoother(sample_rate, 30.0, 0.0),
            modulated: false,
            bloom: Glide::new(sample_rate, 30.0, 0.0),
            share: tick_smoother(sample_rate, 15.0, 0.5),
            mix_cos: Lin::default(),
            mix_sin: Lin::default(),
            plain: false,
            shimmer: tick_smoother(sample_rate, 15.0, 0.0),
            shimmer_cos: Lin::default(),
            shimmer_sin: Lin::default(),
            shimmer_inner: [1.0; 2],
            shifters: core::array::from_fn(|_| Shifter::new(samples(GRAIN_SECONDS[0]) + 8)),
            band,
            rumble,
            ratio: tick_smoother(sample_rate, 20.0, 2.0),
            sweep: [64.0; 2],
            shifters_stale: false,
            shimmer_feed: Glide::new(sample_rate, 8.0, 0.0),
            drive: Glide::new(sample_rate, 40.0, 0.0),
            hold: tick_smoother(sample_rate, 25.0, 0.0),
            last: (-1.0, -1.0, -1.0, 0),
        };
        Engine::reset(&mut network);
        network
    }

    fn clear_shifters(&mut self) {
        for shifter in &mut self.shifters {
            shifter.clear();
        }
        for filter in &mut self.band {
            filter.reset();
        }
        for filter in &mut self.rumble {
            filter.reset(0.0);
        }
    }

    fn idle(&self) -> bool {
        self.taps.iter().all(FadingTap::idle)
            && self.loop_pass.iter().all(Allpass::idle)
            && self.input_pass.iter().flatten().all(Allpass::idle)
            && self.early_taps.iter().flatten().all(FadingTap::idle)
    }

    /// Sets every length for the current mode and `size`.
    fn retune(&mut self, size: f32, snap: bool) {
        let voice = self.voice;
        let rate = self.sample_rate;
        let scale = 2.0_f32.powf((size - 0.5) * SIZE_OCTAVES);
        let prime = |seconds: f32, limit: usize| {
            let wanted = ((seconds * rate) as usize).clamp(8, limit.saturating_sub(80).max(8));
            prime_at_or_above(wanted).min(limit.max(8))
        };
        let margin = (DEEPEST_SECONDS * rate) as usize + 8;
        for ((tap, line), spread) in self.taps.iter_mut().zip(&self.lines).zip(SPREAD) {
            let seconds = voice.lines.0 * (voice.lines.1 / voice.lines.0).powf(spread) * scale;
            let length = prime(seconds, line.capacity().saturating_sub(margin));
            if snap {
                tap.snap(length - 1);
            } else {
                tap.aim(length - 1);
            }
        }
        let (short, long, _) = voice.diffusion;
        for (pass, spread) in self.loop_pass.iter_mut().zip(LOOP_SPREAD) {
            let seconds = short * (long / short).powf(spread) * scale;
            pass.drive(prime(seconds, usize::MAX), snap);
        }
        for (chain, seconds) in self.input_pass.iter_mut().zip(INPUT_SECONDS) {
            for (pass, seconds) in chain.iter_mut().zip(seconds) {
                pass.drive(prime(seconds * voice.input.0, usize::MAX), snap);
            }
        }
        self.reflect(size, snap);
        self.applied = (self.mode, size);
        self.retunes = self.retunes.wrapping_add(1);
    }

    /// First reflections of a box-shaped room by the image-source method: the
    /// source mirrored in each of the six walls, heard at two points one
    /// metre apart. Each arrives later than the direct sound by its extra
    /// path, and weaker by the ratio of the paths times a wall loss.
    fn reflect(&mut self, size: f32, snap: bool) {
        let height = 2.4 + 3.6 * size;
        let room = [1.6 * height, 2.3 * height, height];
        let source = [0.31 * room[0], 0.22 * room[1], 0.45 * room[2]];
        let limit = self.early_line.capacity().saturating_sub(4);
        let distance = |a: [f32; 3], b: [f32; 3]| {
            ((a[0] - b[0]).powi(2) + (a[1] - b[1]).powi(2) + (a[2] - b[2]).powi(2)).sqrt()
        };
        let sides = self.early_taps.iter_mut().zip(self.early_gains.iter_mut());
        for (side, (taps, gains)) in sides.enumerate() {
            let offset = if side == 0 { -0.5 } else { 0.5 };
            let ear = [0.63 * room[0] + offset, 0.71 * room[1], 0.52 * room[2]];
            let direct = distance(source, ear);
            for (wall, (tap, gain)) in taps.iter_mut().zip(gains.iter_mut()).enumerate() {
                let axis = wall / 2;
                let mut image = source;
                if let (Some(coordinate), Some(&length)) = (image.get_mut(axis), room.get(axis)) {
                    let plane = if wall % 2 == 0 { 0.0 } else { length };
                    *coordinate = 2.0 * plane - *coordinate;
                }
                let path = distance(image, ear);
                let delay = ((path - direct) / SPEED_OF_SOUND * self.sample_rate) as usize;
                let delay = delay.clamp(1, limit.max(1));
                *gain = 0.8 * direct / path.max(direct);
                if snap {
                    tap.snap(delay);
                } else {
                    tap.aim(delay);
                }
            }
        }
    }
}

impl Engine for Network {
    /// Clears one buffer per call, so going to sleep never costs one long
    /// block. Returns true when `step` was the last.
    fn clear_step(&mut self, step: usize) -> bool {
        match step {
            0..=7 => {
                if let Some(line) = self.lines.get_mut(step) {
                    line.clear();
                }
            }
            8..=11 => {
                if let Some(pass) = self.loop_pass.get_mut(step - 8) {
                    pass.clear();
                }
            }
            12..=19 => {
                let pass = self
                    .input_pass
                    .get_mut((step - 12) / 4)
                    .and_then(|chain| chain.get_mut((step - 12) % 4));
                if let Some(pass) = pass {
                    pass.clear();
                }
            }
            20 => self.early_line.clear(),
            _ => {
                self.clear_shifters();
                self.damp = [0.0; 8];
                return true;
            }
        }
        false
    }

    /// One control tick. `active` is false while the engine only rings out;
    /// `snap` sets everything at once when the effect starts.
    fn tick(&mut self, settings: &Settings, active: bool, snap: bool) {
        if active && let Some(voice) = voicing(settings.mode) {
            self.voice = voice;
            self.mode = settings.mode;
        }
        let voice = self.voice;
        let rate = self.sample_rate;
        let resized = (settings.size - self.applied.1).abs() > 0.004;
        if snap || ((self.mode != self.applied.0 || resized) && self.idle()) {
            self.retune(settings.size, snap);
        }
        let hold = follow(
            &mut self.hold,
            if active { settings.freeze } else { 0.0 },
            snap,
        );
        let decay = if active {
            settings.decay
        } else {
            settings.decay.min(RING_OUT_SECONDS)
        };
        self.input_amount.drive(voice.input.1, snap);
        self.loop_amount.drive(voice.diffusion.2, snap);
        self.early_level.drive(voice.early, snap);
        self.bloom.drive(if voice.bloom { 1.0 } else { 0.0 }, snap);

        // Loop lengths in seconds, with the all-pass each line of the second half carries.
        let mut seconds = [0.0_f32; 8];
        for (i, (value, tap)) in seconds.iter_mut().zip(&self.taps).enumerate() {
            let extra = self
                .loop_pass
                .get(i.wrapping_sub(4))
                .map_or(0, Allpass::delay);
            *value = (tap.target() + 1 + extra) as f32 / rate;
        }

        // Coupling between the halves: in Bloom, the share of energy that
        // crosses per pass is set so the level builds over the build time.
        let mean = seconds.iter().sum::<f32>() / 8.0;
        // Energy evens out between the halves with a time constant of
        // `mean / 2 share`, set to the build time. The heard half then peaks
        // at `(1 - e^(-t/build)) e^(-t/fall)`, `fall` being the time the
        // energy takes to fall by e; the input is raised to make up for it.
        let (share, rise) = if voice.bloom {
            let build = settings.build.max(0.05);
            let fall = settings.decay.max(0.05) * (0.5 / LN_1000);
            let peak = build * (1.0 + fall / build).ln();
            let heard = 0.5 * (1.0 - (-peak / build).exp()) * (-peak / fall).exp();
            (
                (0.5 * mean / build).clamp(0.002, 0.5),
                (1.0 / heard.max(1.0e-3).sqrt()).min(4.0),
            )
        } else {
            (0.5, 1.0)
        };
        self.drive
            .drive(voice.level * decay_trim(settings.decay) * rise, snap);
        let (cos, sin) = passive_pair(follow(&mut self.share, share, snap));
        self.mix_cos.drive(cos, snap);
        self.mix_sin.drive(sin, snap);
        self.plain = self.bloom.rests_at(0.0)
            && self.share.current() == 0.5
            && self.mix_cos.rests_at(cos)
            && self.mix_sin.rests_at(sin);

        // Shimmer: the share of two lines that passes through the shifters.
        let amount = if voice.shimmer {
            settings.shimmer * (1.0 - hold)
        } else {
            0.0
        };
        let amount = follow(&mut self.shimmer, amount, snap);
        if amount > 0.0 && self.shifters_stale {
            self.clear_shifters();
            self.shimmer_feed.snap(0.0);
            self.shifters_stale = false;
        }
        self.shimmer_feed
            .drive(if self.shifters_stale { 0.0 } else { 1.0 }, snap);
        let (cos, sin) = passive_pair(SHIMMER_SHARE * amount);
        self.shimmer_cos.drive(cos, snap);
        self.shimmer_sin.drive(sin, snap);
        if amount == 0.0 && self.shimmer_sin.rests_at(0.0) {
            self.shifters_stale = true;
        }
        let ratio = match settings.interval {
            1 => 1.498_307, // 2^(7/12), a fifth in equal temperament
            2 => 0.5,
            _ => 2.0,
        };
        let ratio = follow(&mut self.ratio, ratio, snap);
        let sweeps = self.sweep.iter_mut().zip(self.shimmer_inner.iter_mut());
        for ((sweep, inner), grain) in sweeps.zip(GRAIN_SECONDS) {
            *sweep = (grain * rate * (ratio - 1.0).abs()).max(16.0);
            *inner = loop_gain(0.5 * *sweep / rate, decay, hold);
        }

        // Modulation: sine offsets, updated here and interpolated per sample.
        let depth = voice.modulation.0 * settings.modulation * rate * (1.0 - hold);
        let depth = follow(&mut self.depth, depth, snap);
        let step = voice.modulation.1 * 4.0_f32.powf(settings.speed - 0.5) * TICK as f32 / rate;
        let mut modulated = false;
        let lfos = self.phases.iter_mut().zip(self.offsets.iter_mut());
        for ((phase, offset), multiple) in lfos.zip(MOD_RATE) {
            if multiple > 0.0 {
                *phase += step * multiple;
                *phase -= phase.floor();
                let target = depth * (TAU * *phase).sin();
                offset.drive(target, snap);
                modulated |= !offset.rests_at(0.0);
            }
        }
        self.modulated = modulated;

        // Absorption: per-line gains from the decay time, top of the band faster.
        let key = (decay, settings.tone, hold, self.retunes);
        if snap || key != self.last {
            self.last = key;
            let (coefficient, reach) = absorb_corner(rate, 1000.0 * 7.0_f32.powf(settings.tone));
            self.corner = coefficient;
            let faster = 1.0 / lerp(0.12, 1.0, settings.tone) - 1.0;
            for (i, &whole) in seconds.iter().enumerate() {
                let extra = self
                    .loop_pass
                    .get(i.wrapping_sub(4))
                    .map_or(0, Allpass::delay);
                let extra = extra as f32 / rate;
                if let Some(gain) = self.gain.get_mut(i) {
                    *gain = loop_gain(whole - extra, decay, hold);
                }
                if let Some(cut) = self.cut.get_mut(i) {
                    *cut = absorb_cut(loop_gain(whole * faster, decay, hold), reach);
                }
                if let Some(inner) = self.loop_inner.get_mut(i.wrapping_sub(4)) {
                    *inner = loop_gain(extra, decay, hold);
                }
            }
        }
    }

    /// Processes one stretch of samples, adding the wet signal to the
    /// outputs. Returns the largest level seen inside, for the sleep logic.
    #[inline]
    fn process(&mut self, in_l: &[f32], in_r: &[f32], out_l: &mut [f32], out_r: &mut [f32]) -> f32 {
        let mut peak = 0.0_f32;
        let early_on = !self.early_level.rests_at(0.0);
        let shimmering = !self.shimmer_sin.rests_at(0.0);
        let ratio = self.ratio.current();
        let frames = in_l
            .iter()
            .zip(in_r)
            .zip(out_l.iter_mut().zip(out_r.iter_mut()));
        for ((&xl, &xr), (out_l, out_r)) in frames {
            let drive = self.drive.next();
            let (xl, xr) = (xl * drive, xr * drive);
            peak = peak.max(xl.abs()).max(xr.abs());

            // Early reflections: taps of the dry signal.
            self.early_line.write(0.5 * (xl + xr));
            let early = self.early_level.next();
            let (mut early_l, mut early_r) = (0.0, 0.0);
            if early_on {
                for (tap, gain) in self.early_taps[0].iter_mut().zip(self.early_gains[0]) {
                    early_l += gain * tap.read(&self.early_line);
                }
                if self.stereo {
                    for (tap, gain) in self.early_taps[1].iter_mut().zip(self.early_gains[1]) {
                        early_r += gain * tap.read(&self.early_line);
                    }
                }
            }

            // Input diffusion.
            let amount = self.input_amount.next();
            let mut left = xl;
            for pass in &mut self.input_pass[0] {
                left = pass.process(left, amount);
            }
            let mut right = left;
            if self.stereo {
                right = xr;
                for pass in &mut self.input_pass[1] {
                    right = pass.process(right, amount);
                }
            }

            // Read the eight lines.
            let mut v = [0.0_f32; 8];
            let reads = self.taps.iter_mut().zip(&self.lines).zip(&mut self.offsets);
            for ((value, ((tap, line), offset)), multiple) in v.iter_mut().zip(reads).zip(MOD_RATE)
            {
                *value = if self.modulated && multiple > 0.0 {
                    tap.read_frac(line, offset.next())
                } else {
                    tap.read(line)
                };
                peak = peak.max(value.abs());
            }

            // Two outputs from different sign patterns, so they are unalike.
            let bloom = self.bloom.next();
            let near = 1.0 - bloom;
            let wet_l = near * (v[0] - v[1] + v[2] - v[3]) + (v[4] - v[5] + v[6] - v[7]);
            let wet_r = near * (v[0] + v[1] - v[2] - v[3]) + (v[4] + v[5] - v[6] - v[7]);

            // Absorption, then the feedback mix.
            let losses = self.gain.iter().zip(&self.cut);
            for ((value, state), (&gain, &cut)) in v.iter_mut().zip(&mut self.damp).zip(losses) {
                *value = absorb(state, *value, self.corner, gain, cut);
            }
            if self.plain {
                hadamard8(&mut v);
            } else {
                coupled(&mut v, self.mix_cos.next(), self.mix_sin.next());
            }

            // Shimmer: part of two lines goes round through a pitch shifter.
            if shimmering {
                let (cos, sin) = (self.shimmer_cos.next(), self.shimmer_sin.next());
                let feed = self.shimmer_feed.next();
                let shifters = self.shifters.iter_mut().zip(&mut self.band);
                let filters = self.rumble.iter_mut().zip(SHIMMER_LINES);
                let trims = self.sweep.iter().zip(&self.shimmer_inner);
                for (((shifter, band), (rumble, line)), (&sweep, &inner)) in
                    shifters.zip(filters).zip(trims)
                {
                    if let Some(value) = v.get_mut(line) {
                        band.process(*value);
                        let shifted = shifter.process(feed * band.low(), ratio, sweep);
                        let shifted = guard(rumble.highpass(shifted));
                        *value = cos * *value + sin * inner * shifted;
                    }
                }
            }

            // Write back: the input enters here; the second half passes its
            // all-passes on the way, so the tail thickens on every pass.
            let inject_near = 0.5 + (FRAC_1_SQRT_2 - 0.5) * bloom;
            let inject_far = 0.5 * near;
            let amount = self.loop_amount.next();
            let (a, b) = ([v[0], v[1], v[2], v[3]], [v[4], v[5], v[6], v[7]]);
            let (first, second) = self.lines.split_at_mut(4);
            for (i, (line, value)) in first.iter_mut().zip(a).enumerate() {
                let input = if i % 2 == 0 { left } else { right };
                line.write(value + inject_near * input);
            }
            let passes = self.loop_pass.iter_mut().zip(&self.loop_inner);
            for (i, ((line, value), (pass, &inner))) in
                second.iter_mut().zip(b).zip(passes).enumerate()
            {
                let input = if i % 2 == 0 { left } else { right };
                line.write(pass.process_lossy(value, amount, inner) + inject_far * input);
            }

            *out_l += OUTPUT_SCALE * wet_l + early * early_l;
            *out_r += OUTPUT_SCALE * wet_r + early * early_r;
        }
        peak
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn coupled_mix_keeps_energy_and_matches_hadamard_at_equal_shares() {
        let original = [1.0, -2.0, 3.0, 0.5, -1.0, 4.0, 0.25, 2.0];
        let energy = |v: &[f32; 8]| v.iter().map(|x| x * x).sum::<f32>();
        for share in [0.002, 0.1, 0.3, 0.5] {
            let (cos, sin) = passive_pair(share);
            let mut v = original;
            coupled(&mut v, cos, sin);
            assert!(energy(&v) <= energy(&original) * 1.000_001);
            assert!(energy(&v) >= energy(&original) * 0.999_99);
        }
        let (cos, sin) = passive_pair(0.5);
        let (mut a, mut b) = (original, original);
        coupled(&mut a, cos, sin);
        hadamard8(&mut b);
        assert!(a.iter().zip(b).all(|(x, y)| (x - y).abs() < 1e-5));
    }

    #[test]
    fn line_lengths_are_distinct_primes_at_every_size_and_rate() {
        for rate in [44_100.0, 48_000.0, 96_000.0] {
            let mut network = Network::new(rate, true);
            for mode in [0, 1, 4, 5, 6] {
                for size in [0.0, 0.5, 1.0] {
                    network.mode = mode;
                    network.voice = voicing(mode).unwrap();
                    network.retune(size, true);
                    let mut lengths: Vec<usize> =
                        network.taps.iter().map(|tap| tap.target() + 1).collect();
                    for &length in &lengths {
                        assert_eq!(prime_at_or_above(length), length);
                    }
                    lengths.sort_unstable();
                    lengths.dedup();
                    assert_eq!(lengths.len(), 8, "mode {mode} size {size} rate {rate}");
                }
            }
        }
    }
}
