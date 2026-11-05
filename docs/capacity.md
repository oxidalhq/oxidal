# Capacity and buffer size

Figures measured on one Raspberry Pi 5 with a Hotone Jogg USB interface at 48 kHz.
They are a guide for this hardware, not a guarantee. Other interfaces, supplies,
cooling and other loads change them.

## How many NAM models can play together

A prepared rig keeps every ready branch processing, so the audio thread pays for
every native NAM instance in every ready rig at once. Count instances, not blocks.

| Buffer     | Time per buffer | Instances that ran cleanly |
| ---------- | --------------- | -------------------------- |
| 256 frames | 5.33 ms         | 14 or more (15 tested)     |
| 128 frames | 2.67 ms         | 6                          |
| 64 frames  | 1.33 ms         | 3 to 4 (not yet settled)   |

Heavier models cost more than the lightest ones, so a set of large A2 models fits
fewer instances than these figures. At 256 frames, 7 instances from heavy presets
fit and 10 did not.

## How many effects

Effects cost far less than NAM. One NAM followed by up to 32 stereo effects ran
cleanly at 128 and 64 frames. Effects before the amp, reverbs only and parallel
branches (up to 16 effects) also ran cleanly. Each effect costs roughly 20 to 70 µs.
Reverbs and parallel branches cost the most.

## What is not yet measured

- Round-trip latency through the interface. Buffer size alone does not give it.
- Runs longer than a few minutes at the limits above.
- Other interfaces, other Pi power supplies and sustained thermal load.

Check Sound Check and Monitor while you play. A rising xrun count or a DSP peak near
the buffer time means the rig is too heavy for that buffer size. Use a larger buffer
or fewer instances.
