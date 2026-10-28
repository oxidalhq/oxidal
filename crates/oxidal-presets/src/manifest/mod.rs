//! Portable document declarations. Parsing does not authorize a backend, execute a
//! plugin, resolve resource files, or change the playing rig.
//! @see docs/presets/format.md
mod strict;
#[cfg(test)]
mod tests;
mod validation;

use crate::{Error, Result};
use schemars::JsonSchema;
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::{Map, Value};
use std::collections::BTreeMap;

pub const MAX_MANIFEST_BYTES: usize = 1024 * 1024;
pub const MAX_RESOURCE_BYTES: u64 = 256 * 1024 * 1024;
pub const MAX_BUNDLE_BYTES: u64 = 1024 * 1024 * 1024;

// JSON Schema integers include 1.0 and 1e0. Accept exact non-negative integer
// numbers, never strings or truncation; all format-1 numeric bounds are < 2^53.
fn integer<'de, D: Deserializer<'de>, T: TryFrom<u64>>(d: D) -> std::result::Result<T, D::Error> {
    use serde::de::Error;
    let number = serde_json::Number::deserialize(d)?;
    let value = number
        .as_u64()
        .or_else(|| {
            number
                .as_f64()
                .filter(|v| v.fract() == 0.0 && (0.0..=9007199254740991.0).contains(v))
                .map(|v| v as u64)
        })
        .ok_or_else(|| D::Error::custom("Expected unsigned integer"))?;
    T::try_from(value).map_err(|_| D::Error::custom("Integer out of range"))
}

// A missing optional field is permitted; an explicit null is not in the schema.
fn optional<'de, D: Deserializer<'de>, T: Deserialize<'de>>(
    d: D,
) -> std::result::Result<Option<T>, D::Error> {
    T::deserialize(d).map(Some)
}
fn host<'de, D: Deserializer<'de>>(d: D) -> std::result::Result<Option<Host>, D::Error> {
    Option::<Host>::deserialize(d)
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[schemars(rename = "PortableManifest")]
pub struct Manifest {
    pub format: String,
    #[serde(deserialize_with = "integer")]
    pub format_version: u32,
    pub id: String,
    pub name: String,
    pub tone3000: NativeInstances,
    // deserialize_with makes the nullable field required, unlike a bare Option.
    #[serde(deserialize_with = "host")]
    pub oxidal: Option<Host>,
    pub resources: Vec<Resource>,
    pub extensions: BTreeMap<String, Map<String, Value>>,
    pub required_extensions: Vec<String>,
}
impl Manifest {
    /// Strict JSON, shape and document semantics only. Resources and runtime
    /// capabilities must be verified separately before DSP preparation.
    pub fn parse(bytes: &[u8]) -> Result<Self> {
        let result = Self::parse_shape(bytes)?;
        result.validate()?;
        Ok(result)
    }
    fn parse_shape(bytes: &[u8]) -> Result<Self> {
        if bytes.len() > MAX_MANIFEST_BYTES {
            return Err(Error::Invalid("Preset manifest exceeds 1 MiB"));
        }
        let value = strict::parse(bytes)?;
        let result: Self = serde_json::from_value(value)
            .map_err(|_| Error::Invalid("Invalid preset manifest shape"))?;
        result.shape()?;
        Ok(result)
    }
    /// Recheck edited declarations before serialization. No backend is admitted.
    pub fn validate(&self) -> Result<()> {
        self.shape()?;
        self.semantics()
    }
    pub fn encode(&self) -> Result<Vec<u8>> {
        self.validate()?;
        let bytes = serde_json::to_vec(self)
            .map_err(|_| Error::Invalid("Cannot encode preset manifest"))?;
        if bytes.len() > MAX_MANIFEST_BYTES {
            return Err(Error::Invalid("Preset manifest exceeds 1 MiB"));
        }
        Ok(bytes)
    }
    /// Format 1 currently implements no required extension. Unknown optional
    /// metadata is preserved, never treated as a sonic capability.
    pub fn check_required_extensions(&self) -> Result<()> {
        if !self.required_extensions.is_empty() {
            return Err(Error::Invalid("Unsupported required preset extension"));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
#[serde(deny_unknown_fields)]
#[schemars(rename = "PortableNativeInstances")]
pub struct NativeInstances {
    pub instances: Vec<NativeInstance>,
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[schemars(rename = "PortableNativeInstance")]
pub struct NativeInstance {
    pub id: String,
    pub preset: String,
    pub profile: String,
    #[serde(
        default,
        deserialize_with = "optional",
        skip_serializing_if = "Option::is_none"
    )]
    pub origin: Option<Origin>,
    #[serde(
        default,
        deserialize_with = "optional",
        skip_serializing_if = "Option::is_none"
    )]
    pub processing_role: Option<ProcessingRole>,
    #[serde(
        default,
        deserialize_with = "optional",
        skip_serializing_if = "Option::is_none"
    )]
    pub partition: Option<NativePartition>,
}
impl NativeInstance {
    pub fn role(&self) -> ProcessingRole {
        self.processing_role.unwrap_or(ProcessingRole::Whole)
    }
}
/// Reproducible guarded derivation from the exact source preset, never imported
/// opaque JUCE bytes. Both roles share a pair/recipe; scalar overrides are local.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
#[serde(deny_unknown_fields)]
#[schemars(rename = "PortableNativePartition")]
pub struct NativePartition {
    #[serde(deserialize_with = "integer")]
    pub version: u32,
    pub pair: String,
    pub amp: String,
    pub cab: String,
    pub input: PartitionInput,
    pub controls: BTreeMap<String, f64>,
    #[serde(
        default,
        deserialize_with = "optional",
        skip_serializing_if = "Option::is_none"
    )]
    pub eq: Option<Vec<oxidal_audio::eq::BlockEqState>>,
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
#[schemars(rename = "PortablePartitionInput")]
pub enum PartitionInput {
    Left,
    Right,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
#[schemars(rename = "PortableProcessingRole")]
pub enum ProcessingRole {
    Whole,
    Amp,
    Cab,
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[schemars(rename = "PortableOrigin")]
pub struct Origin {
    pub resource: String,
    #[serde(
        default,
        deserialize_with = "optional",
        skip_serializing_if = "Option::is_none"
    )]
    pub source_preset_id: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
#[serde(deny_unknown_fields)]
#[schemars(rename = "PortableResource")]
pub struct Resource {
    pub id: String,
    pub path: String,
    pub kind: ResourceKind,
    pub sha256: String,
    #[serde(deserialize_with = "integer")]
    pub bytes: u64,
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
#[schemars(rename = "PortableResourceKind")]
pub enum ResourceKind {
    Tone3000Preset,
    Tone3000Source,
    Lv2State,
    Lv2Asset,
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
#[serde(deny_unknown_fields)]
#[schemars(rename = "PortableHost")]
pub struct Host {
    pub graph: Graph,
    pub lv2: Vec<Lv2Instance>,
    pub recall: Recall,
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
#[serde(deny_unknown_fields)]
#[schemars(rename = "PortableRecall")]
pub struct Recall {
    pub tails: Tails,
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
#[schemars(rename = "PortableTails")]
pub enum Tails {
    Cut,
    Preserve,
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[schemars(rename = "PortableLv2Instance")]
pub struct Lv2Instance {
    pub id: String,
    pub plugin_uri: String,
    pub controls: BTreeMap<String, f64>,
    #[serde(
        default,
        deserialize_with = "optional",
        skip_serializing_if = "Option::is_none"
    )]
    pub state: Option<String>,
    pub assets: Vec<String>,
    pub required_features: Vec<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
#[serde(deny_unknown_fields)]
#[schemars(rename = "PortableGraph")]
pub struct Graph {
    pub nodes: Vec<Node>,
    pub edges: Vec<Edge>,
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[schemars(rename = "PortableNode")]
pub struct Node {
    pub id: String,
    pub kind: NodeKind,
    #[serde(deserialize_with = "integer")]
    pub audio_inputs: u8,
    #[serde(deserialize_with = "integer")]
    pub audio_outputs: u8,
    #[serde(
        default,
        deserialize_with = "optional",
        skip_serializing_if = "Option::is_none"
    )]
    pub instance: Option<String>,
    #[serde(
        default,
        deserialize_with = "optional",
        skip_serializing_if = "Option::is_none"
    )]
    pub bypassed: Option<bool>,
    #[serde(
        default,
        deserialize_with = "optional",
        skip_serializing_if = "Option::is_none"
    )]
    pub input_gains: Option<Vec<f64>>,
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
#[schemars(rename = "PortableNodeKind")]
pub enum NodeKind {
    Input,
    Output,
    Tone3000,
    Lv2,
    Split,
    Merge,
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
#[schemars(rename = "PortableEdge")]
pub struct Edge {
    pub from: Endpoint,
    pub to: Endpoint,
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq, PartialOrd, Ord)]
#[serde(deny_unknown_fields)]
#[schemars(rename = "PortableEndpoint")]
pub struct Endpoint {
    pub node: String,
    #[serde(deserialize_with = "integer")]
    pub port: u8,
}
