# Sources and references — Oxidal Hold

Oxidal Hold is original code. It uses published Fourier and phase-vocoder
methods, plus Oxidal's own peak selection and stereo-width rules.

| Part              | Method                                                                           | Source                                     | Oxidal choice                                                          |
| ----------------- | -------------------------------------------------------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------- |
| Spectrum analysis | Radix-2 FFT with a Hann window                                                   | Cooley and Tukey [1]; Harris [2]           | Frame size keeps about 85 ms at 48 kHz and scales with sample rate     |
| Held pitch        | Keep magnitudes and advance each bin by its measured phase change between frames | Flanagan and Golden [3]; Dolson [4]        | Two frames one quarter-frame apart                                     |
| Resynthesis       | Inverse FFT, synthesis window and quarter-frame overlap-add                      | Dolson [4]; Smith [5]                      | Gain correction is derived in the source comment                       |
| Focus             | Keep bins around strong local peaks and reduce the remainder                     | Local-maximum selection written for Oxidal | Neighbourhood, spread and threshold values were chosen and tested here |
| Width             | Move each stereo spectrum toward its mid spectrum                                | Mid/side definition                        | The control is a linear interpolation written for Oxidal               |

## References

1. J. W. Cooley and J. W. Tukey, "An algorithm for the machine calculation of complex Fourier series", _Mathematics of Computation_ 19(90), 1965. <https://doi.org/10.1090/S0025-5718-1965-0178586-1>
2. F. J. Harris, "On the use of windows for harmonic analysis with the discrete Fourier transform", _Proceedings of the IEEE_ 66(1), 1978. <https://doi.org/10.1109/PROC.1978.10837>
3. J. L. Flanagan and R. M. Golden, "Phase Vocoder", _Bell System Technical Journal_ 45(9), 1966. <https://doi.org/10.1002/j.1538-7305.1966.tb01706.x>
4. M. Dolson, "The Phase Vocoder: A Tutorial", _Computer Music Journal_ 10(4), 1986. <https://doi.org/10.2307/3680093>
5. J. O. Smith, _Spectral Audio Signal Processing_, W3K Publishing, 2011. <https://ccrma.stanford.edu/~jos/sasp/>
