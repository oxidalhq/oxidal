# Symphonia notices

Oxidal decodes WAV and MP3 backing tracks at import with the
[Symphonia](https://github.com/pdeljanov/Symphonia) crates listed in
`manifest.json`. They are licensed under the Mozilla Public License 2.0, whose
text is in `LICENSE-MPL-2.0`. Oxidal uses them as unmodified crates.io
dependencies; their source is available from crates.io and the upstream
repository at the locked versions. MPL-2.0 applies file by file and does not
extend to Oxidal's own code.

The cargo-deny exception in `deny.toml` is scoped to these exact versions.
Refresh the manifest, exception and this notice together when upgrading.
