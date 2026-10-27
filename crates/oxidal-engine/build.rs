// Cargo does not propagate a dependency's binary rpath to this crate's examples
// or future worker. Reuse the adapter's checked local/relocatable link policy.
include!("../oxidal-tone3000/build.rs");
