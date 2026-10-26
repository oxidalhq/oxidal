# Artwork HTTPS dependency notices

Exact upstream notice files from the locked crates.io releases are retained here
and copied into every host/appliance artifact. `manifest.json` records their
versions and SHA-256 values. These are dependency notices, not a license assignment
to Oxidal. No SoundShed code or assets were copied.

The narrowly versioned cargo-deny exceptions cover ISC for ring, rustls-webpki
and untrusted, and CDLA-Permissive-2.0 for webpki-roots certificate data. The latter
requires its agreement text to accompany shared certificate data. Read these
files and refresh the manifest/exception together when upgrading those crates.
Existing Apache/MIT terms remain in force; ring's nested notices are retained.
