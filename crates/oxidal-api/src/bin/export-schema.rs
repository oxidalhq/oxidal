/// Generate canonical JSON Schema for browser validation and TypeScript generation.
/// @see docs/architecture.md
fn main() {
    println!(
        "{}",
        serde_json::to_string_pretty(&schemars::schema_for!(oxidal_api::Contract))
            .expect("schema serializes")
    );
}
