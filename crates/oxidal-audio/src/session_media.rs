//! Session media rings: fixed-capacity, lock-free single-producer /
//! single-consumer sample rings between a non-realtime reader or writer thread
//! and the audio callback. Capacity is allocated once at construction; push
//! and pop never allocate, lock or block, so the callback can use them.
//! Samples are stored as `f32` bits in atomics, which keeps the crate free of
//! unsafe code.
//! @see docs/media.md
use std::sync::Arc;
use std::sync::atomic::{AtomicU32, AtomicUsize, Ordering};

#[derive(Debug)]
struct Shared {
    samples: Box<[AtomicU32]>,
    /// Total samples ever written; only the producer stores it.
    written: AtomicUsize,
    /// Total samples ever read; only the consumer stores it.
    read: AtomicUsize,
}

/// Writing half of a ring. Exactly one thread owns it.
#[derive(Debug)]
pub struct Producer {
    shared: Arc<Shared>,
    written: usize,
}

/// Reading half of a ring. Exactly one thread owns it.
#[derive(Debug)]
pub struct Consumer {
    shared: Arc<Shared>,
    read: usize,
}

/// A ring holding at most `capacity` samples (at least one).
pub fn ring(capacity: usize) -> (Producer, Consumer) {
    let shared = Arc::new(Shared {
        samples: (0..capacity.max(1)).map(|_| AtomicU32::new(0)).collect(),
        written: AtomicUsize::new(0),
        read: AtomicUsize::new(0),
    });
    (
        Producer {
            shared: Arc::clone(&shared),
            written: 0,
        },
        Consumer { shared, read: 0 },
    )
}

impl Producer {
    /// Copies as many samples as fit and returns how many were taken.
    pub fn push(&mut self, samples: &[f32]) -> usize {
        let capacity = self.shared.samples.len();
        let read = self.shared.read.load(Ordering::Acquire);
        let free = capacity - (self.written - read);
        let count = free.min(samples.len());
        for (offset, sample) in samples[..count].iter().enumerate() {
            self.shared.samples[(self.written + offset) % capacity]
                .store(sample.to_bits(), Ordering::Relaxed);
        }
        self.written += count;
        self.shared.written.store(self.written, Ordering::Release);
        count
    }
    pub fn free(&self) -> usize {
        self.shared.samples.len() - (self.written - self.shared.read.load(Ordering::Acquire))
    }
}

impl Consumer {
    /// Fills the front of `target` with available samples and returns how many.
    pub fn pop(&mut self, target: &mut [f32]) -> usize {
        let capacity = self.shared.samples.len();
        let written = self.shared.written.load(Ordering::Acquire);
        let count = (written - self.read).min(target.len());
        for (offset, sample) in target[..count].iter_mut().enumerate() {
            *sample = f32::from_bits(
                self.shared.samples[(self.read + offset) % capacity].load(Ordering::Relaxed),
            );
        }
        self.read += count;
        self.shared.read.store(self.read, Ordering::Release);
        count
    }
    pub fn available(&self) -> usize {
        self.shared.written.load(Ordering::Acquire) - self.read
    }
}

/// What feeds the rig in place of, or alongside, the live guitar.
#[derive(Debug)]
pub enum InputSource {
    /// The live interface input (default).
    Live,
    /// A mono DI recording replaces the live input for a reamp job. With
    /// `trim_and_gate` the unit's input trim and gate apply, as they did when
    /// the DI was captured raw; without it the DI reaches the rig unchanged.
    Reamp {
        frames: Consumer,
        trim_and_gate: bool,
    },
    /// Silence into the rig: a reamp's source has ended and the tail rings out.
    Silent,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wraps_and_refuses_overfill_without_losing_order() {
        let (mut tx, mut rx) = ring(5);
        assert_eq!(tx.push(&[1.0, 2.0, 3.0]), 3);
        let mut out = [0.0; 2];
        assert_eq!(rx.pop(&mut out), 2);
        assert_eq!(out, [1.0, 2.0]);
        assert_eq!(tx.push(&[4.0, 5.0, 6.0, 7.0, 8.0]), 4, "only four free");
        assert_eq!(tx.free(), 0);
        let mut out = [0.0; 8];
        assert_eq!(rx.pop(&mut out), 5);
        assert_eq!(out[..5], [3.0, 4.0, 5.0, 6.0, 7.0]);
        assert_eq!(rx.pop(&mut out), 0, "empty ring reads nothing");
        assert_eq!(rx.available(), 0);
    }

    #[test]
    fn a_thread_pair_moves_every_sample_in_order() {
        let (mut tx, mut rx) = ring(1024);
        let total = 200_000usize;
        let writer = std::thread::spawn(move || {
            let mut next = 0usize;
            let mut chunk = [0.0f32; 300];
            while next < total {
                let n = chunk.len().min(total - next);
                for (i, s) in chunk[..n].iter_mut().enumerate() {
                    *s = (next + i) as f32;
                }
                let mut sent = 0;
                while sent < n {
                    sent += tx.push(&chunk[sent..n]);
                    std::thread::yield_now();
                }
                next += n;
            }
        });
        let mut expected = 0usize;
        let mut block = [0.0f32; 128];
        while expected < total {
            let n = rx.pop(&mut block);
            for s in &block[..n] {
                assert_eq!(*s, expected as f32);
                expected += 1;
            }
            if n == 0 {
                std::thread::yield_now();
            }
        }
        writer.join().unwrap();
    }
}
