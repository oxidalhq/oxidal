# Sources and references — LV2 plugin interface

Written for Oxidal from the published specifications named here. No
third-party source code was copied, ported or used as a base. See
[the clean code rule](../../docs/native-effects.md).

| Part                    | What it is                                                      | Source                                                                                                                | Constants                      |
| ----------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| `Descriptor`            | The plugin descriptor and its eight members, in order           | LV2 core specification, `LV2_Descriptor` (<https://lv2plug.in/ns/lv2core>)                                            | Layout from the specification  |
| `lv2_descriptor` export | The library entry point, one descriptor per index               | LV2 core specification, "lv2_descriptor"                                                                              | None                           |
| Plugin lifecycle        | instantiate, connect_port, activate, run, cleanup               | LV2 core specification, the descriptor's callback documentation                                                       | None                           |
| In-place handling       | Inputs are copied before processing, so shared buffers are safe | LV2 core specification (`inPlaceBroken` describes the hazard); the copy is our own design                             | Block limit of 1,024 frames    |
| `denormals::Guard`      | Sets the processor's flush-to-zero mode during `run`            | Arm Architecture Reference Manual (FPCR, FZ bit 24); Intel Software Developer's Manual (MXCSR, FTZ bit 15, DAZ bit 6) | Bit positions from the manuals |
