# Sources and references — Oxidal Fuzz

Oxidal Fuzz is original code. It does not copy a commercial pedal, recording or
third-party DSP source.

| Part          | Method                                                           | Source                                                         | Oxidal choice                                                              |
| ------------- | ---------------------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Waveshaper    | Hyperbolic tangent used as a bounded odd nonlinearity            | Zölzer, _DAFX_, chapter 4, nonlinear processing [1]            | Drive maps to the input multiplier; output is bounded before level control |
| Tone          | One-pole low-pass state blended with the shaped signal           | Smith, _Introduction to Digital Filters_, one-pole filters [2] | The Tone control sets both the bright feed and smoothing coefficient       |
| Mix and level | Linear dry/wet blend followed by decibel-to-amplitude conversion | Definitions of linear interpolation and `10^(dB/20)`           | Ranges and defaults were chosen for Oxidal                                 |

## References

1. U. Zölzer (ed.), _DAFX: Digital Audio Effects, 2nd edition_, Wiley, 2011. <https://doi.org/10.1002/9781119991298>
2. J. O. Smith, _Introduction to Digital Filters with Audio Applications_, W3K Publishing, 2007. <https://ccrma.stanford.edu/~jos/filters/>
