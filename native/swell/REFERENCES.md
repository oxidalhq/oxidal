# Sources and references — Oxidal Swell

Oxidal Swell is original code. It uses standard envelope-following and gain
smoothing methods; its note detection and control ranges were written for
Oxidal.

| Part               | Method                                                                  | Source                                        | Oxidal choice                                                            |
| ------------------ | ----------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------ |
| Level tracking     | Fast and slow one-pole peak followers with separate rise and fall times | Giannoulis, Massberg and Reiss [1]            | Time constants and stereo linking were chosen for note attacks           |
| New-note detection | Threshold, hysteresis and a fast-to-slow level ratio                    | Compressor detector principles [1]            | Sensitivity mapping, 50 ms hold-off and 4 ms duck were chosen for Oxidal |
| Swell              | Continuous progress value raised to a control-selected power            | Zölzer, _DAFX_, dynamics and gain shaping [2] | Progress timing and curve range were chosen for Oxidal                   |
| Control smoothing  | One-pole movement toward new time, curve and mix values                 | Smith, one-pole filters [3]                   | A 20 ms time constant with exact target settling                         |

## References

1. D. Giannoulis, M. Massberg and J. D. Reiss, "Digital Dynamic Range Compressor Design: A Tutorial and Analysis", _Journal of the Audio Engineering Society_ 60(6), 2012. <https://aes2.org/publications/elibrary-page/?id=16354>
2. U. Zölzer (ed.), _DAFX: Digital Audio Effects, 2nd edition_, Wiley, 2011. <https://doi.org/10.1002/9781119991298>
3. J. O. Smith, _Introduction to Digital Filters with Audio Applications_, W3K Publishing, 2007. <https://ccrma.stanford.edu/~jos/filters/>
