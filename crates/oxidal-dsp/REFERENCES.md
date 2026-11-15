# Sources and references — shared DSP blocks

Every block in `src/lib.rs` was written for Oxidal from the published
description named here. No third-party source code was copied, ported or used
as a base. See [the clean code rule](../../docs/native-effects.md).

| Block               | What it is                                       | Source                                                                                                                            | Constants                                                   |
| ------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `Smoothed`          | One-pole exponential lag                         | First-order recursive filter, any DSP textbook (for example Smith, _Introduction to Digital Filters_ [1], "One-Pole")             | Coefficient `1 − e^(−1/N)` for a time constant of N samples |
| `DelayLine`         | Circular buffer; linear and cubic reads          | Linear interpolation; cubic is the Catmull–Rom spline (Catmull and Rom (1974) [2]), written out from its definition               | Spline weights follow from the definition                   |
| `OnePole`           | First-order low-pass and its complement          | Same first-order recursion                                                                                                        | `1 − e^(−2πf/fs)`                                           |
| `StateVariable`     | Second-order state-variable filter               | Trapezoidal-integrator ("zero-delay feedback") form, Zavalishin, _The Art of VA Filter Design_ [3], state-variable filter chapter | `g = tan(πf/fs)`, `k = 1/Q`, solved by hand                 |
| `FirstOrderAllpass` | Phase shifter stage                              | First-order all-pass transfer function `(a + z⁻¹)/(1 + a z⁻¹)`, textbook; coefficient from the bilinear transform                 | `a = (tan(πf/fs) − 1)/(tan(πf/fs) + 1)`                     |
| `DiffuserAllpass`   | Delay-line all-pass                              | Schroeder (1962) [4]                                                                                                              | Gain and delay are parameters                               |
| `Lfo`               | Phase accumulator, sine and triangle             | Definition                                                                                                                        | None                                                        |
| `soft_clip`         | Bounded saturator                                | The algebraic sigmoid `x/√(1 + x²)`, from its definition                                                                          | None                                                        |
| `EnvelopeFollower`  | Rectifier with attack and release lags           | Two one-pole lags; textbook                                                                                                       | Time constants are parameters                               |
| `Noise`             | 32-bit xorshift generator                        | Marsaglia (2003) [5], shift triple 13, 17, 5 from the paper's table                                                               | From the paper                                              |
| `hadamard8`         | Fast Walsh–Hadamard transform, energy-preserving | Definition of the Hadamard matrix; its use as a feedback matrix: Jot and Chaigne (1991) [6]                                       | Scale `1/√8`                                                |
| `householder`       | Householder reflection                           | Definition (`I − (2/n)·1·1ᵀ`); feedback use from the same paper                                                                   | None                                                        |
| `prime_at_or_above` | Trial division                                   | Definition                                                                                                                        | None                                                        |
| `equal_power`       | Sine and cosine crossfade                        | Definition (`cos² + sin² = 1`)                                                                                                    | None                                                        |

## References

1. J. O. Smith, _Introduction to Digital Filters with Audio Applications_, W3K Publishing, 2007. <https://ccrma.stanford.edu/~jos/filters/>
2. E. Catmull and R. Rom, "A Class of Local Interpolating Splines", in Computer Aided Geometric Design, Academic Press, 1974. <https://doi.org/10.1016/B978-0-12-079050-0.50020-5>
3. V. Zavalishin, _The Art of VA Filter Design_, 2018 (rev. 2.1.0).
4. M. R. Schroeder, "Natural Sounding Artificial Reverberation", Journal of the Audio Engineering Society 10(3), pp. 219-223, 1962. <https://aes2.org/publications/elibrary-page/?id=849>
5. G. Marsaglia, "Xorshift RNGs", Journal of Statistical Software 8(14), 2003. <https://doi.org/10.18637/jss.v008.i14>
6. J.-M. Jot and A. Chaigne, "Digital Delay Networks for Designing Artificial Reverberators", AES 90th Convention, preprint 3030, 1991. <https://aes2.org/publications/elibrary-page/?id=5663>
