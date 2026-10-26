# Oxidal TONE3000 adapter

An optional, single-owner Rust wrapper over the real native TONE3000 processor for offline qualification. Default workspace builds expose no native engine; the `native` feature links an explicitly built shared library.

Run `pnpm native:check` from the repository root. See [native qualification](../../docs/native-tone3000.md) for dependency pins, isolation, tests and limitations. The daemon is not yet wired to this adapter. Live ALSA/LV2, multi-instance processing and full settings/preset workflows remain pending.

This crate alone contains the reviewed unsafe FFI boundary. Other core crates retain `unsafe_code = "forbid"`. The safe wrapper validates buffers and keeps creation, calls and destruction on one thread.
