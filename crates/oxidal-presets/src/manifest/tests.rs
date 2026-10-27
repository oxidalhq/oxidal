use super::*;
use serde_json::json;

fn fixture(name: &str) -> Value {
    serde_json::from_str(match name {
        "pure-edited" => include_str!("../../../../docs/presets/examples/pure-edited.json"),
        "mixed-delay" => include_str!("../../../../docs/presets/examples/mixed-delay.json"),
        "compatible-copy" => include_str!("../../../../docs/presets/examples/compatible-copy.json"),
        "lv2-only" => include_str!("../../../../docs/presets/examples/lv2-only.json"),
        _ => panic!("Unknown fixture"),
    })
    .unwrap()
}
#[test]
fn documented_schema_and_rust_share_conformance_vectors() {
    let cases: Vec<Value> =
        serde_json::from_str(include_str!("../../../../docs/presets/conformance.json")).unwrap();
    for case in cases {
        let mut value = fixture(case["base"].as_str().unwrap());
        for change in case["changes"].as_array().unwrap() {
            let (parent, key) = change["path"].as_str().unwrap().rsplit_once('/').unwrap();
            let parent = value.pointer_mut(parent).unwrap();
            if change["op"] == "remove" {
                match parent {
                    Value::Array(values) => {
                        values.remove(key.parse::<usize>().unwrap());
                    }
                    Value::Object(values) => {
                        values.remove(key);
                    }
                    _ => panic!("Invalid conformance path"),
                }
            } else {
                match parent {
                    Value::Array(values) => {
                        values[key.parse::<usize>().unwrap()] = change["value"].clone()
                    }
                    Value::Object(values) => {
                        values.insert(key.into(), change["value"].clone());
                    }
                    _ => panic!("Invalid conformance path"),
                }
            }
        }
        let bytes = serde_json::to_vec(&value).unwrap();
        let shape = Manifest::parse_shape(&bytes);
        assert_eq!(
            shape.is_ok(),
            case["shape"].as_bool().unwrap(),
            "shape {}: {shape:?}",
            case["name"]
        );
        let parsed = Manifest::parse(&bytes);
        assert_eq!(
            parsed.is_ok(),
            case["valid"].as_bool().unwrap(),
            "semantic {}: {parsed:?}",
            case["name"]
        );
        if let Ok(manifest) = parsed {
            assert_eq!(
                Manifest::parse(&manifest.encode().unwrap()).unwrap(),
                manifest
            );
        }
    }
}
#[test]
fn strict_json_rejects_duplicate_escaped_nested_keys_and_trailing_values() {
    let source = serde_json::to_string(&fixture("pure-edited")).unwrap();
    let duplicate = source.replacen("\"name\":", "\"na\\u006de\":\"shadow\",\"name\":", 1);
    assert!(Manifest::parse(duplicate.as_bytes()).is_err());
    let nested = source.replace(
        "\"extensions\":{}",
        "\"extensions\":{\"urn:test:x\":{\"x\":1,\"x\":2}}",
    );
    assert_ne!(nested, source);
    assert!(Manifest::parse(nested.as_bytes()).is_err());
    assert!(Manifest::parse(format!("{source} {{}}").as_bytes()).is_err());
    assert!(Manifest::parse(&vec![b' '; MAX_MANIFEST_BYTES + 1]).is_err());
    assert!(strict::parse(format!("{}0{}", "[".repeat(65), "]".repeat(65)).as_bytes()).is_err());
    assert!(strict::parse(b"1e999").is_err());
}
fn parse(value: &Value) -> Result<Manifest> {
    Manifest::parse(&serde_json::to_vec(value).unwrap())
}
#[test]
fn empty_rigs_and_native_counts_do_not_require_dummy_assets_or_a_fixed_ceiling() {
    for channels in [1, 2] {
        let mut value = fixture("lv2-only");
        value["oxidal"]["lv2"] = json!([]);
        value["oxidal"]["graph"] = json!({
            "nodes":[{"id":"in","kind":"input","audioInputs":0,"audioOutputs":channels},
                     {"id":"out","kind":"output","audioInputs":channels,"audioOutputs":0}],
            "edges":(0..channels).map(|p| json!({"from":{"node":"in","port":p},"to":{"node":"out","port":p}})).collect::<Vec<_>>()
        });
        parse(&value).unwrap();
    }
    let mut value = fixture("mixed-delay");
    let template = value["tone3000"]["instances"][0].clone();
    let host = &mut value["oxidal"];
    host["lv2"] = json!([]);
    let mut nodes = vec![json!({"id":"in","kind":"input","audioInputs":0,"audioOutputs":1})];
    let mut instances = vec![];
    let mut edges = vec![];
    let mut previous = "in".to_owned();
    for i in 0..100 {
        let id = format!("native{i}");
        let mut instance = template.clone();
        instance["id"] = json!(id);
        instances.push(instance);
        nodes.push(json!({"id":id,"kind":"tone3000","audioInputs":1,"audioOutputs":1,"instance":id,"bypassed":false}));
        edges.push(json!({"from":{"node":previous,"port":0},"to":{"node":id,"port":0}}));
        previous = id;
    }
    nodes.push(json!({"id":"out","kind":"output","audioInputs":1,"audioOutputs":0}));
    edges.push(json!({"from":{"node":previous,"port":0},"to":{"node":"out","port":0}}));
    host["graph"] = json!({"nodes":nodes,"edges":edges});
    value["tone3000"]["instances"] = json!(instances);
    value["resources"].as_array_mut().unwrap().pop(); // no unused LV2 state
    parse(&value).unwrap(); // document validity only, not DSP capacity
}
fn parallel() -> Value {
    let mut value = fixture("lv2-only");
    value["oxidal"]["lv2"] = json!([]);
    value["oxidal"]["graph"] = json!({
        "nodes":[
            {"id":"merge","kind":"merge","audioInputs":2,"audioOutputs":1,"inputGains":[0.25,0.75]},
            {"id":"out","kind":"output","audioInputs":1,"audioOutputs":0},
            {"id":"split","kind":"split","audioInputs":1,"audioOutputs":2},
            {"id":"in","kind":"input","audioInputs":0,"audioOutputs":1}
        ],
        "edges":[
            {"from":{"node":"in","port":0},"to":{"node":"split","port":0}},
            {"from":{"node":"split","port":0},"to":{"node":"merge","port":0}},
            {"from":{"node":"split","port":1},"to":{"node":"merge","port":1}},
            {"from":{"node":"merge","port":0},"to":{"node":"out","port":0}}
        ]
    });
    value
}
#[test]
fn explicit_split_merge_is_order_independent_and_cycles_gains_and_islands_fail() {
    let value = parallel();
    parse(&value).unwrap();
    let mut bad = value.clone();
    bad["oxidal"]["graph"]["nodes"][0]["inputGains"] = json!([1]);
    assert!(parse(&bad).is_err());
    let mut bad = value.clone();
    bad["oxidal"]["graph"]["nodes"][0]["inputGains"] = json!([1, -1]);
    assert!(parse(&bad).is_err());
    let mut cycle = value.clone();
    // Fully connected input ports can still contain a feedback cycle.
    cycle["oxidal"]["graph"]["edges"][0]["from"]["node"] = json!("merge");
    cycle["oxidal"]["graph"]["edges"][3]["from"]["node"] = json!("in");
    assert!(parse(&cycle).unwrap_err().to_string().contains("cycles"));
    let mut island = value;
    island["oxidal"]["graph"]["nodes"][1]["id"] = json!("unusedOutput");
    assert!(parse(&island).is_err());
}
#[test]
fn unknown_optional_metadata_is_preserved_but_required_semantics_are_not_ignored() {
    let mut value = fixture("pure-edited");
    value["extensions"] = json!({"urn:future:feature":{"nested":[{"setting":true}]}});
    let optional = parse(&value).unwrap();
    optional.check_required_extensions().unwrap();
    assert_eq!(
        serde_json::to_value(optional).unwrap()["extensions"],
        value["extensions"]
    );
    value["requiredExtensions"] = json!(["urn:future:feature"]);
    assert!(parse(&value).unwrap().check_required_extensions().is_err());
}

#[test]
fn resource_budget_and_exclusive_lv2_ownership_are_checked_without_allocating_assets() {
    let mut too_large = fixture("pure-edited");
    let source = too_large["resources"][1].clone();
    for i in 0..4 {
        let mut resource = source.clone();
        resource["id"] = json!(format!("source{i}"));
        resource["path"] = json!(format!("origins/source{i}.t3kpreset"));
        resource["bytes"] = json!(MAX_RESOURCE_BYTES);
        too_large["resources"]
            .as_array_mut()
            .unwrap()
            .push(resource);
    }
    assert!(parse(&too_large).unwrap_err().to_string().contains("1 GiB"));
    let mut shared = fixture("mixed-delay");
    let mut second = shared["oxidal"]["lv2"][0].clone();
    second["id"] = json!("second");
    shared["oxidal"]["lv2"].as_array_mut().unwrap().push(second);
    assert!(
        parse(&shared)
            .unwrap_err()
            .to_string()
            .contains("multiple owners")
    );
    let mut unused = fixture("lv2-only");
    let mut second = unused["oxidal"]["lv2"][0].clone();
    second["id"] = json!("unused");
    unused["oxidal"]["lv2"].as_array_mut().unwrap().push(second);
    assert!(
        parse(&unused)
            .unwrap_err()
            .to_string()
            .contains("Unused processing")
    );
}

#[test]
fn partition_peers_bind_source_roles_recipe_and_complete_graph_ownership() {
    let mut value = fixture("mixed-delay");
    value["resources"].as_array_mut().unwrap().pop();
    value["oxidal"]["lv2"] = json!([]);
    let mut amp = value["tone3000"]["instances"][0].clone();
    amp["id"] = json!("amp");
    amp["processingRole"] = json!("amp");
    amp["partition"] = json!({"version":1,"pair":"pair","amp":"sourceAmp","cab":"sourceCab","input":"left","controls":{}});
    let mut cab = amp.clone();
    cab["id"] = json!("cab");
    cab["processingRole"] = json!("cab");
    value["tone3000"]["instances"] = json!([amp, cab]);
    value["oxidal"]["graph"] = json!({"nodes":[
        {"id":"in","kind":"input","audioInputs":0,"audioOutputs":1},
        {"id":"amp","kind":"tone3000","audioInputs":1,"audioOutputs":1,"instance":"amp","bypassed":false},
        {"id":"cab","kind":"tone3000","audioInputs":1,"audioOutputs":1,"instance":"cab","bypassed":false},
        {"id":"out","kind":"output","audioInputs":1,"audioOutputs":0}],
        "edges":[{"from":{"node":"in","port":0},"to":{"node":"amp","port":0}},
            {"from":{"node":"amp","port":0},"to":{"node":"cab","port":0}},
            {"from":{"node":"cab","port":0},"to":{"node":"out","port":0}}]});
    parse(&value).unwrap();
    for (path, replacement) in [
        ("/tone3000/instances/1/processingRole", json!("amp")),
        ("/tone3000/instances/1/profile", json!("other")),
        ("/tone3000/instances/1/partition/input", json!("right")),
        ("/tone3000/instances/1/partition/amp", json!("different")),
        ("/tone3000/instances/1/partition/cab", json!("sourceAmp")),
        ("/tone3000/instances/1/partition/pair", json!("missing")),
        (
            "/tone3000/instances/0/partition/controls",
            json!({"outputLevel":1.1}),
        ),
    ] {
        let mut invalid = value.clone();
        *invalid.pointer_mut(path).unwrap() = replacement;
        assert!(parse(&invalid).is_err(), "Accepted {path}");
    }
    let encoded = parse(&value).unwrap().encode().unwrap();
    assert_eq!(parse(&value).unwrap(), Manifest::parse(&encoded).unwrap());
}
