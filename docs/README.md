# Oxidal documentation

Start with the page that matches what you are trying to do.

## Use and understand Oxidal

- [Audio and live playback](audio.md) — device setup, audio ownership, playback,
  scenes, levels and recovery.
- [Library](library.md) — presets, owned copies, models, artwork and removal.
- [Interface](interface.md) — navigation, responsive behavior and visual system.
- [Sound Check and monitoring](monitoring.md) — meters, health information and
  diagnostics.
- [Factory collection](factory-collection.md) — Oxidal-authored recipes and the
  third-party asset boundary.
- [Screenshot gallery](screenshots.md) — the current device interface running on
  the appliance.

## Build and contribute

- [Development](development.md) — toolchains, checks and release preparation.
- [Core service](core.md) — daemon setup and the portable Rust crates.
- [Architecture](architecture.md) — process boundaries, APIs and control rules.
- [OS image and installation](../os/README.md) — Linux bundles and Raspberry Pi
  image assembly.
- [Device service](device-service.md) — networking, power and the privileged helper
  boundary.
- [Debug console](debug-console.md) — explicitly enabled maintenance commands.

## Audio engines and formats

- [Mixed engine](mixed-engine.md) — native and LV2 processing in one prepared
  signal graph.
- [LV2 hosting](lv2.md) — supported plugin behavior and qualification.
- [Native TONE3000 adapter](native-tone3000.md) — pinned native integration and
  its qualification boundary.
- [Native Hold](native-hold.md) and [native pitch](native-pitch.md) — standalone
  native effects.
- [Preset format](presets/format.md) — the draft portable preset contract.
- [Storage locking](storage-lock.md) — library ownership and safe updates.
- [TONE3000 account](tone3000-account.md) — optional device authorization.

## Documentation rules

Describe what the current code does first. Put limitations next to the feature they
qualify, use one direct statement instead of repeated caveats, and link to the
authoritative implementation document for detail. Private sprint plans and research
do not belong in this repository.
