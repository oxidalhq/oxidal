//! Circular sample memory read at absolute, fractional positions.
//! @see docs/native-moment.md

/// Unity below 0.9, then bends smoothly towards 1. Anything stored in a memory
/// passes through it, so repeated passes can never grow without limit and a
/// quiet loop is stored unchanged.
#[inline]
pub fn knee(x: f32) -> f32 {
    const START: f32 = 0.9;
    const ROOM: f32 = 1.0 - START;
    let size = x.abs();
    if size <= START {
        return x;
    }
    let over = (size - START) / ROOM;
    (START + ROOM * over / (1.0 + over)).copysign(x)
}

/// One channel of sample memory; its length is a power of two.
pub struct Memory {
    data: Vec<f32>,
    mask: usize,
}

impl core::fmt::Debug for Memory {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.debug_struct("Memory")
            .field("length", &self.data.len())
            .finish_non_exhaustive()
    }
}

impl Memory {
    /// Allocates at least `length` samples. Not for the audio thread.
    pub fn new(length: usize) -> Self {
        let size = length.next_power_of_two().max(8);
        Self {
            data: vec![0.0; size],
            mask: size - 1,
        }
    }

    pub fn clear(&mut self) {
        self.data.fill(0.0);
    }

    pub fn len(&self) -> usize {
        self.data.len()
    }

    pub fn is_empty(&self) -> bool {
        self.data.is_empty()
    }

    /// The sample at `index`; any index is valid, the memory wraps round.
    #[inline]
    pub fn get(&self, index: i64) -> f32 {
        self.data[index as usize & self.mask]
    }

    #[inline]
    pub fn put(&mut self, index: i64, x: f32) {
        self.data[index as usize & self.mask] = x;
    }

    /// Four-point, third-order read between samples (Catmull-Rom form).
    #[inline]
    pub fn read(&self, position: f64) -> f32 {
        let whole = position.floor();
        let t = (position - whole) as f32;
        let i = whole as i64;
        if t == 0.0 {
            return self.get(i);
        }
        let (ym1, y0, y1, y2) = (
            self.get(i - 1),
            self.get(i),
            self.get(i + 1),
            self.get(i + 2),
        );
        let c1 = 0.5 * (y1 - ym1);
        let c2 = ym1 - 2.5 * y0 + 2.0 * y1 - 0.5 * y2;
        let c3 = 0.5 * (y2 - ym1) + 1.5 * (y0 - y1);
        ((c3 * t + c2) * t + c1) * t + y0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_knee_leaves_quiet_samples_alone_and_stays_below_one() {
        assert_eq!(knee(0.5), 0.5);
        assert_eq!(knee(-0.9), -0.9);
        assert!(knee(1.0e9) <= 1.0 && knee(-1.0e9) >= -1.0);
        let mut x = 0.0_f32;
        while x < 4.0 {
            assert!(knee(x + 0.001) >= knee(x));
            x += 0.001;
        }
    }

    #[test]
    fn reads_wrap_round_and_pass_through_every_stored_sample() {
        let mut memory = Memory::new(16);
        assert_eq!(memory.len(), 16);
        for i in 0..16 {
            memory.put(i, i as f32);
        }
        assert_eq!(memory.get(-1), 15.0);
        assert_eq!(memory.read(5.0), 5.0);
        assert!((memory.read(5.5) - 5.5).abs() < 1.0e-5);
    }
}
