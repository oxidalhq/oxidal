# Sources and references — Oxidal Wah

Oxidal Wah is original code. It does not copy a commercial pedal, recording,
component model or third-party DSP source.

| Part               | Method                                                                     | Source                                                                | Oxidal choice                                                          |
| ------------------ | -------------------------------------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Resonant filter    | State-variable low, band and high update; the band output is the wah voice | Zavalishin, _The Art of VA Filter Design_, state-variable filters [1] | The compact explicit update is used for zero latency and no allocation |
| Position and range | Controls map to the filter step size                                       | Zölzer, _DAFX_, filter effects [2]                                    | Bounds and control curve were chosen for Oxidal                        |
| Resonance and mix  | Feedback controls the peak; output is linearly blended with dry input      | State-variable filter definition [1] and linear interpolation         | Limits were chosen to keep the tested output finite                    |

## References

1. V. Zavalishin, _The Art of VA Filter Design_, revision 2.1.0, 2018. <https://www.native-instruments.com/fileadmin/ni_media/downloads/pdf/VAFilterDesign_2.1.0.pdf>
2. U. Zölzer (ed.), _DAFX: Digital Audio Effects, 2nd edition_, Wiley, 2011. <https://doi.org/10.1002/9781119991298>
