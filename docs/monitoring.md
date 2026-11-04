# Sound Check and monitoring

Use **Sound Check** while setting up a rig. Open **Monitor** for more detail
and to review recorded history.

| Reading                     | How to use it                                                                            |
| --------------------------- | ---------------------------------------------------------------------------------------- |
| Input and output level      | Check signal and headroom on each channel. These are digital levels in dBFS.             |
| Clips                       | A rising count means samples are reaching full scale. Lower the level and check again.   |
| DSP p95 / deadline          | Shows how much of one audio period processing usually takes. Check the session peak too. |
| Xruns                       | Where reported, watch for changes while playing or switching scenes.                     |
| CPU, memory and temperature | Check the host alongside the audio readings when a rig struggles.                        |

Processing time covers DSP work. Use a physical loopback to measure total
round-trip latency. See [audio setup](audio.md#physical-round-trip-latency).

## Recorded device history

Use recorded history to look back at device load and audio health. Freeze pauses
the displayed history while live resource status continues updating. E-paper
mode uses a slower refresh and skips chart animation.

## Control request audit

Open **Monitor → Control audit** to filter recorded actions by operation,
outcome or time range and export the matching records.

## References

- [Live monitoring](../crates/oxidal-api/src/monitor.rs)
- [Device history](../crates/oxidal-api/src/monitor_history.rs)
- [Control audit](../crates/oxidal-api/src/audit.rs)
