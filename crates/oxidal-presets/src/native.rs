use crate::{Error, Result};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;

pub const MAX_FILE_BYTES: usize = 32 * 1024 * 1024;
const MAX_STRING_BYTES: usize = 1024 * 1024;
const MAX_DEPTH: usize = 64;
const MAX_ITEMS: usize = 65536;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Framing {
    Legacy,
    Current,
}

/// Structural inspection only. Original bytes, not this summary, remain authoritative.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Inspection {
    pub sha256: String,
    pub name: String,
    pub source_id: Option<String>,
    pub framing: Framing,
    pub size_bytes: u32,
    pub parameter_count: u32,
    pub block_count: u32,
    pub embedded_bytes: u32,
    pub playback_available: bool,
}

#[derive(Debug)]
enum Value<'a> {
    Void,
    Integer(i64),
    Float,
    Bool,
    Text(&'a str),
    Binary(usize),
    Array,
    Opaque,
}
#[derive(Debug)]
struct Tree<'a> {
    kind: &'a str,
    properties: Vec<(&'a str, Value<'a>)>,
    children: Vec<Tree<'a>>,
}
impl<'a> Tree<'a> {
    fn property(&self, key: &str) -> Option<&Value<'a>> {
        self.properties
            .iter()
            .find(|(name, _)| *name == key)
            .map(|(_, value)| value)
    }
    fn text(&self, key: &str) -> Result<Option<&'a str>> {
        match self.property(key) {
            None => Ok(None),
            Some(Value::Text(value)) => Ok(Some(value)),
            _ => Err(Error::Invalid("Invalid preset identity")),
        }
    }
}

struct Reader<'a> {
    bytes: &'a [u8],
    offset: usize,
    items: usize,
    embedded: usize,
}
impl<'a> Reader<'a> {
    fn take(&mut self, size: usize) -> Result<&'a [u8]> {
        let end = self
            .offset
            .checked_add(size)
            .ok_or(Error::Invalid("Invalid native length"))?;
        let value = self
            .bytes
            .get(self.offset..end)
            .ok_or(Error::Invalid("Truncated native preset"))?;
        self.offset = end;
        Ok(value)
    }
    fn byte(&mut self) -> Result<u8> {
        Ok(self.take(1)?[0])
    }
    fn count(&mut self) -> Result<usize> {
        let width = self.byte()?;
        // Counts and lengths may never be negative, signed-overflowed or over-wide.
        if width > 4 {
            return Err(Error::Invalid("Invalid native count"));
        }
        let mut bytes = [0; 4];
        bytes[..usize::from(width)].copy_from_slice(self.take(usize::from(width))?);
        let count = u32::from_le_bytes(bytes);
        if count > i32::MAX as u32 {
            return Err(Error::Invalid("Invalid native count"));
        }
        Ok(count as usize)
    }
    fn budget(&mut self, amount: usize) -> Result<()> {
        self.items = self
            .items
            .checked_add(amount)
            .ok_or(Error::Invalid("Native structure limit exceeded"))?;
        if self.items > MAX_ITEMS {
            return Err(Error::Invalid("Native structure limit exceeded"));
        }
        Ok(())
    }
    fn string(&mut self) -> Result<&'a str> {
        let rest = &self.bytes[self.offset..];
        let length = rest
            .iter()
            .take(MAX_STRING_BYTES + 1)
            .position(|b| *b == 0)
            .ok_or(Error::Invalid("Native string is unterminated or too long"))?;
        let bytes = self.take(length + 1)?;
        std::str::from_utf8(&bytes[..length]).map_err(|_| Error::Invalid("Invalid native UTF-8"))
    }
    fn value(&mut self, depth: usize) -> Result<Value<'a>> {
        if depth > MAX_DEPTH {
            return Err(Error::Invalid("Native nesting limit exceeded"));
        }
        self.budget(1)?;
        let length = self.count()?;
        if length == 0 {
            return Ok(Value::Void);
        }
        let payload = self.take(length)?;
        let mut value = Reader {
            bytes: payload,
            offset: 1,
            items: self.items,
            embedded: self.embedded,
        };
        let result = match payload[0] {
            1 => Value::Integer(i32::from_le_bytes(value.take(4)?.try_into().unwrap()) as i64),
            2 | 3 => Value::Bool,
            4 => {
                let number = f64::from_le_bytes(value.take(8)?.try_into().unwrap());
                if !number.is_finite() {
                    return Err(Error::Invalid("Non-finite native number"));
                }
                Value::Float
            }
            5 => Value::Text(value.string()?),
            6 => Value::Integer(i64::from_le_bytes(value.take(8)?.try_into().unwrap())),
            7 => {
                let count = value.count()?;
                if count > MAX_ITEMS {
                    return Err(Error::Invalid("Native array limit exceeded"));
                }
                for _ in 0..count {
                    value.value(depth + 1)?;
                }
                Value::Array
            }
            8 => {
                value.embedded += length - 1;
                value.offset = length;
                Value::Binary(length - 1)
            }
            _ => {
                value.offset = length;
                Value::Opaque
            }
        };
        if value.offset != length {
            return Err(Error::Invalid("Invalid native value length"));
        }
        self.items = value.items;
        self.embedded = value.embedded;
        Ok(result)
    }
    fn tree(&mut self, depth: usize) -> Result<Tree<'a>> {
        if depth > MAX_DEPTH {
            return Err(Error::Invalid("Native nesting limit exceeded"));
        }
        self.budget(1)?;
        let kind = self.string()?;
        if kind.is_empty() || kind.len() > 256 {
            return Err(Error::Invalid("Invalid native tree type"));
        }
        let count = self.count()?;
        if count > MAX_ITEMS {
            return Err(Error::Invalid("Native property limit exceeded"));
        }
        let mut properties = Vec::new();
        let mut names = BTreeSet::new();
        for _ in 0..count {
            let name = self.string()?;
            if name.is_empty() || name.len() > 256 || !names.insert(name) {
                return Err(Error::Invalid("Invalid or duplicate native property"));
            }
            properties.push((name, self.value(depth + 1)?));
        }
        let count = self.count()?;
        if count > MAX_ITEMS {
            return Err(Error::Invalid("Native child limit exceeded"));
        }
        let mut children = Vec::new();
        for _ in 0..count {
            children.push(self.tree(depth + 1)?);
        }
        Ok(Tree {
            kind,
            properties,
            children,
        })
    }
}
fn parse(bytes: &[u8]) -> Result<(Tree<'_>, usize)> {
    let mut reader = Reader {
        bytes,
        offset: 0,
        items: 0,
        embedded: 0,
    };
    let tree = reader.tree(0)?;
    if reader.offset != bytes.len() {
        return Err(Error::Invalid("Trailing native data"));
    }
    Ok((tree, reader.embedded))
}
fn unique_child<'a, 'b>(tree: &'b Tree<'a>, kind: &str) -> Result<&'b Tree<'a>> {
    let mut children = tree.children.iter().filter(|c| c.kind == kind);
    let child = children
        .next()
        .ok_or(Error::Invalid("Missing preset section"))?;
    if children.next().is_some() {
        return Err(Error::Invalid("Duplicate preset section"));
    }
    Ok(child)
}

/// Validate framing and bounded ValueTree structure without dropping unknown bytes.
/// Native semantic compatibility and audio readiness are deliberately not inferred.
pub fn inspect(bytes: &[u8]) -> Result<Inspection> {
    if bytes.len() > MAX_FILE_BYTES {
        return Err(Error::Invalid("Preset exceeds 32 MiB admission limit"));
    }
    let (framing, header, body_bytes) = match bytes.get(..4) {
        Some(b"T3KB") => (Framing::Legacy, None, &bytes[4..]),
        Some(b"T3KH") => {
            let length = bytes
                .get(4..8)
                .ok_or(Error::Invalid("Truncated preset header"))?;
            let length = u32::from_le_bytes(length.try_into().unwrap()) as usize;
            if length == 0 || length > 65536 {
                return Err(Error::Invalid("Invalid preset header size"));
            }
            let header = bytes
                .get(8..8 + length)
                .ok_or(Error::Invalid("Truncated preset header"))?;
            (
                Framing::Current,
                Some(parse(header)?.0),
                &bytes[8 + length..],
            )
        }
        _ => return Err(Error::Invalid("Not a TONE3000 preset")),
    };
    let (body, embedded) = parse(body_bytes)?;
    if body.kind != "T3KPreset"
        || !matches!(body.property("schemaVersion"), Some(Value::Integer(1)))
    {
        return Err(Error::Invalid("Unsupported native preset schema"));
    }
    let name = body
        .text("name")?
        .ok_or(Error::Invalid("Missing preset name"))?;
    let id = body.text("id")?;
    if name.trim().is_empty() || name.len() > 4096 || id.is_some_and(|id| id.len() > 1024) {
        return Err(Error::Invalid("Invalid preset identity"));
    }
    if let Some(header) = header
        && (header.kind != "T3KPresetHeader"
            || header.text("id")?.unwrap_or("") != id.unwrap_or("")
            || header.text("name")? != Some(name))
    {
        return Err(Error::Invalid("Preset header and body disagree"));
    }
    let snapshot = unique_child(&body, "ChainSnapshot")?;
    let params = unique_child(&body, "Params")?;
    let mut ids = BTreeSet::new();
    for param in &params.children {
        let id = param
            .text("id")?
            .ok_or(Error::Invalid("Missing parameter id"))?;
        if param.kind != "Param"
            || id.is_empty()
            || !ids.insert(id)
            || !matches!(
                param.property("value"),
                Some(Value::Integer(_) | Value::Float)
            )
        {
            return Err(Error::Invalid("Invalid or duplicate native parameter"));
        }
    }
    let mut blocks = 0;
    let mut block_ids = BTreeSet::new();
    for lane in ["ChainBlocks", "RightChainBlocks"] {
        // Some legacy mono snapshots omit the dormant right lane.
        let candidates: Vec<_> = snapshot
            .children
            .iter()
            .filter(|c| c.kind == lane)
            .collect();
        if candidates.len() > 1 {
            return Err(Error::Invalid("Duplicate native lane"));
        }
        for lane in candidates {
            for block in &lane.children {
                if block.kind != "ChainBlock" {
                    continue;
                }
                let id = block
                    .text("id")?
                    .ok_or(Error::Invalid("Missing block id"))?;
                if id.is_empty() || !block_ids.insert(id) {
                    return Err(Error::Invalid("Invalid or duplicate block id"));
                }
                blocks += 1;
                for cache in block.children.iter().filter(|c| c.kind == "ModelCache") {
                    for model in &cache.children {
                        if model.kind == "CachedModel"
                            && !matches!(model.property("data"), Some(Value::Binary(n)) if *n > 0)
                        {
                            return Err(Error::Invalid("Invalid embedded model payload"));
                        }
                    }
                }
            }
        }
    }
    Ok(Inspection {
        sha256: format!("{:x}", Sha256::digest(bytes)),
        name: name.into(),
        source_id: id.filter(|id| !id.is_empty()).map(str::to_owned),
        framing,
        size_bytes: bytes.len() as u32,
        parameter_count: params.children.len() as u32,
        block_count: blocks,
        embedded_bytes: embedded as u32,
        playback_available: false,
    })
}
