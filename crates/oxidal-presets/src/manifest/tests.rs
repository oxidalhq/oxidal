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
fn authoring_origin_defaults_to_mine_and_rejects_unknown_values() {
    let legacy = Manifest::parse(&serde_json::to_vec(&fixture("mixed-delay")).unwrap()).unwrap();
    assert_eq!(
        crate::LibraryOrigin::from_manifest(&legacy).unwrap(),
        crate::LibraryOrigin::Mine
    );
    let mut example = fixture("mixed-delay");
    example["extensions"]["urn:oxidal:authoring"] = json!({"origin":"oxidal_example"});
    let example = Manifest::parse(&serde_json::to_vec(&example).unwrap()).unwrap();
    assert_eq!(
        crate::LibraryOrigin::from_manifest(&example).unwrap(),
        crate::LibraryOrigin::OxidalExample
    );
    let mut invalid = fixture("mixed-delay");
    invalid["extensions"]["urn:oxidal:authoring"] = json!({"origin":"third_party"});
    assert!(Manifest::parse(&serde_json::to_vec(&invalid).unwrap()).is_err());
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
    // A negative gain inverts polarity (7.26); beyond ±4 is refused.
    let mut inverted = value.clone();
    inverted["oxidal"]["graph"]["nodes"][0]["inputGains"] = json!([1, -1]);
    parse(&inverted).unwrap();
    let mut bad = value.clone();
    bad["oxidal"]["graph"]["nodes"][0]["inputGains"] = json!([1, -4.5]);
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
    let bands: Vec<_> = (0..6).map(|i| json!({"type": match i {0 => "lowcut", 5 => "highcut", _ => "bell"}, "freqHz":1000.0,"gainDb":0.1,"q":0.7})).collect();
    let recipe = &mut value["tone3000"]["instances"][0]["partition"];
    recipe["version"] = json!(2);
    recipe["eq"] =
        json!([{"block_id":"sourceAmp","eq":{"enabled":true,"pre":false,"bands":bands}}]);
    parse(&value).unwrap();
    for (path, replacement) in [
        ("/tone3000/instances/0/partition/version", json!(1)),
        ("/tone3000/instances/0/partition/eq", json!([])),
        ("/tone3000/instances/0/partition/eq", json!(null)),
        (
            "/tone3000/instances/0/partition/eq/0/block_id",
            json!("sourceCab"),
        ),
        (
            "/tone3000/instances/0/partition/eq/0/eq/bands/1/freqHz",
            json!(99999),
        ),
    ] {
        let mut invalid = value.clone();
        *invalid.pointer_mut(path).unwrap() = replacement;
        assert!(parse(&invalid).is_err(), "Accepted partition EQ {path}");
    }
    let encoded = parse(&value).unwrap().encode().unwrap();
    assert_eq!(parse(&value).unwrap(), Manifest::parse(&encoded).unwrap());
}

#[test]
fn native_instance_settings_require_explicit_support_and_complete_valid_controls() {
    let mut value = fixture("mixed-delay");
    let id = value["tone3000"]["instances"][0]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    value["extensions"][NATIVE_SETTINGS_EXTENSION] = json!({"instances":{id.clone():{"input_mode":"left","parameters":{
        "osEnabled":0.0,"osFactor":0.5,"pitchEnabled":1.0,"pitchWindow":0.0,"inputCalibrationLevel":0.6,"calibrateInput":1.0,"targetLoudness":0.7
    }}}});
    assert!(
        Manifest::parse(&serde_json::to_vec(&value).unwrap()).is_err(),
        "sonic extension must be required"
    );
    value["requiredExtensions"]
        .as_array_mut()
        .unwrap()
        .push(json!(NATIVE_SETTINGS_EXTENSION));
    let parsed = Manifest::parse(&serde_json::to_vec(&value).unwrap()).unwrap();
    parsed.check_required_extensions().unwrap();
    assert_eq!(
        parsed.native_settings().unwrap().unwrap().instances[&id].input_mode,
        oxidal_audio::structure::InputMode::Left
    );
    for (key, bad) in [
        ("osEnabled", json!(0.5)),
        ("osFactor", json!(2.0)),
        ("calibrateInput", json!(-1.0)),
        ("unqualified", json!(0.5)),
    ] {
        let mut invalid = value.clone();
        invalid["extensions"][NATIVE_SETTINGS_EXTENSION]["instances"][&id]["parameters"][key] = bad;
        assert!(Manifest::parse(&serde_json::to_vec(&invalid).unwrap()).is_err());
    }
    let mut invalid = value.clone();
    invalid["extensions"][NATIVE_SETTINGS_EXTENSION]["instances"][&id]["parameters"]
        .as_object_mut()
        .unwrap()
        .remove("pitchWindow");
    assert!(Manifest::parse(&serde_json::to_vec(&invalid).unwrap()).is_err());
    value["extensions"][NATIVE_SETTINGS_EXTENSION]["instances"]["foreign"] =
        value["extensions"][NATIVE_SETTINGS_EXTENSION]["instances"][&id].clone();
    assert!(Manifest::parse(&serde_json::to_vec(&value).unwrap()).is_err());
}

/// Two branches into a merge, then a shared LV2 delay; both scenes set its time.
fn scene_controls_manifest() -> Value {
    let edge = |a: &str, ap: u8, b: &str, bp: u8| json!({"from":{"node":a,"port":ap},"to":{"node":b,"port":bp}});
    let gains = |a: f64, b: f64| json!([{"node":"merge","port":0,"value":a},{"node":"merge","port":1,"value":b}]);
    json!({"format":"oxidal.preset","formatVersion":1,
        "id":"68448a6d-0168-4fc8-b337-c12959165271","name":"Scene controls",
        "tone3000":{"instances":[]},"resources":[],
        "requiredExtensions":[SCENES_EXTENSION],
        "extensions":{SCENES_EXTENSION:{"fade_ms":40,"scenes":[
            {"id":"clean","name":"Clean","gains":gains(1.0,0.0),
             "controls":[{"node":"fx","symbol":"delay_time","value":0.25}]},
            {"id":"lead","name":"Lead","gains":gains(0.0,1.0),
             "controls":[{"node":"fx","symbol":"delay_time","value":0.5}]}]}},
        "oxidal":{"graph":{"nodes":[
            {"id":"in","kind":"input","audioInputs":0,"audioOutputs":2},
            {"id":"split","kind":"split","audioInputs":1,"audioOutputs":2},
            {"id":"merge","kind":"merge","audioInputs":2,"audioOutputs":1,"inputGains":[1.0,0.0]},
            {"id":"fx","kind":"lv2","audioInputs":1,"audioOutputs":1,"instance":"fx","bypassed":false},
            {"id":"out","kind":"output","audioInputs":2,"audioOutputs":0}],
            "edges":[edge("in",0,"split",0),edge("split",0,"merge",0),edge("split",1,"merge",1),
                     edge("merge",0,"fx",0),edge("fx",0,"out",0),edge("in",1,"out",1)]},
        "lv2":[{"id":"fx","pluginUri":"urn:test:delay","controls":{"delay_time":0.25},"assets":[],"requiredFeatures":[]}],
        "recall":{"tails":"cut"}}})
}
#[test]
fn scene_controls_round_trip_and_reject_foreign_partial_or_unbounded_targets() {
    let value = scene_controls_manifest();
    let manifest = Manifest::parse(&serde_json::to_vec(&value).unwrap()).unwrap();
    let scenes = manifest.scenes().unwrap().unwrap();
    assert_eq!(
        scenes.scenes[1].controls,
        vec![SceneControl {
            node: "fx".into(),
            symbol: "delay_time".into(),
            value: 0.5
        }]
    );
    // Scenes without controls keep their old encoding.
    let mut plain = value.clone();
    for scene in plain["extensions"][SCENES_EXTENSION]["scenes"]
        .as_array_mut()
        .unwrap()
    {
        scene.as_object_mut().unwrap().remove("controls");
    }
    let plain = Manifest::parse(&serde_json::to_vec(&plain).unwrap()).unwrap();
    assert!(
        !String::from_utf8(plain.encode().unwrap())
            .unwrap()
            .contains("controls\":[")
    );
    let path = |scene: usize| format!("/extensions/{SCENES_EXTENSION}/scenes/{scene}/controls");
    let rejected = |change: &dyn Fn(&mut Value)| {
        let mut value = scene_controls_manifest();
        change(&mut value);
        Manifest::parse(&serde_json::to_vec(&value).unwrap()).is_err()
    };
    // Not an LV2 node, a bad symbol, a non-finite value, a duplicate target,
    // a scene missing a control the others set, and too many controls.
    assert!(rejected(
        &|v| v.pointer_mut(&path(0)).unwrap()[0]["node"] = json!("merge")
    ));
    assert!(rejected(
        &|v| v.pointer_mut(&path(0)).unwrap()[0]["node"] = json!("gone")
    ));
    assert!(rejected(
        &|v| v.pointer_mut(&path(0)).unwrap()[0]["symbol"] = json!("9 bad")
    ));
    assert!(rejected(
        &|v| v.pointer_mut(&path(0)).unwrap()[0]["value"] = json!(f64::NAN)
    ));
    assert!(rejected(&|v| {
        let first = v.pointer(&path(0)).unwrap()[0].clone();
        v.pointer_mut(&path(0))
            .unwrap()
            .as_array_mut()
            .unwrap()
            .push(first);
    }));
    assert!(rejected(&|v| *v.pointer_mut(&path(1)).unwrap() = json!([])));
    assert!(rejected(&|v| {
        let many: Vec<_> = (0..=MAX_SCENE_CONTROLS)
            .map(|i| json!({"node":"fx","symbol":format!("p{i}"),"value":0.0}))
            .collect();
        *v.pointer_mut(&path(0)).unwrap() = json!(many.clone());
        *v.pointer_mut(&path(1)).unwrap() = json!(many);
    }));
    assert!(rejected(
        &|v| v["extensions"][SCENES_EXTENSION]["scenes"][0]["controls"][0]["extra"] = json!(1)
    ));
    // Branches name merge inputs only.
    assert!(rejected(&|v| {
        let mut branch = v["extensions"][SCENES_EXTENSION]["scenes"][0].clone();
        branch["gains"] = json!([{"node":"merge","port":0,"value":1.0}]);
        let mut other = v["extensions"][SCENES_EXTENSION]["scenes"][1].clone();
        other["gains"] = json!([{"node":"merge","port":1,"value":1.0}]);
        other.as_object_mut().unwrap().remove("controls");
        v["extensions"][SCENES_EXTENSION]["branches"] = json!([branch, other]);
    }));
}
/// Move a manifest's scenes to another version key, required list included.
fn scenes_as(mut value: Value, key: &str) -> Value {
    let extension = value["extensions"]
        .as_object_mut()
        .unwrap()
        .remove(SCENES_EXTENSION)
        .unwrap();
    value["extensions"][key] = extension;
    value["requiredExtensions"] = json!([key]);
    value
}
#[test]
fn scenes_read_both_versions_and_refuse_an_unknown_one_as_unsupported() {
    let parse = |value: &Value| Manifest::parse(&serde_json::to_vec(value).unwrap());
    // Version 1 with controls stays readable: presets saved before version 2.
    let legacy = parse(&scene_controls_manifest()).unwrap();
    legacy.check_required_extensions().unwrap();
    // Version 2 carries the same scenes.
    let current = parse(&scenes_as(
        scene_controls_manifest(),
        SCENES_CONTROLS_EXTENSION,
    ))
    .unwrap();
    current.check_required_extensions().unwrap();
    assert_eq!(current.scenes().unwrap(), legacy.scenes().unwrap());
    // A version this reader does not know is unsupported, not invalid.
    let future = scenes_as(scene_controls_manifest(), "urn:oxidal:scenes:6");
    assert_eq!(parse(&future).unwrap_err().to_string(), UNSUPPORTED_SCENES);
    // Even when only the required list names it.
    let mut named = scene_controls_manifest();
    named["requiredExtensions"] = json!([SCENES_EXTENSION, "urn:oxidal:scenes:9"]);
    named["extensions"]["urn:oxidal:scenes:9"] = json!({});
    assert_eq!(parse(&named).unwrap_err().to_string(), UNSUPPORTED_SCENES);
    // Both versions at once, or version 2 not marked required, is invalid.
    let mut both = scenes_as(scene_controls_manifest(), SCENES_CONTROLS_EXTENSION);
    both["extensions"][SCENES_EXTENSION] =
        scene_controls_manifest()["extensions"][SCENES_EXTENSION].clone();
    both["requiredExtensions"] = json!([SCENES_EXTENSION, SCENES_CONTROLS_EXTENSION]);
    assert!(parse(&both).is_err());
    let mut optional = scenes_as(scene_controls_manifest(), SCENES_CONTROLS_EXTENSION);
    optional["requiredExtensions"] = json!([]);
    assert!(parse(&optional).is_err());
}

#[test]
fn stomp_groups_round_trip_only_with_prepared_scene_targets() {
    let parse = |value: &Value| Manifest::parse(&serde_json::to_vec(value).unwrap());
    let key = STOMP_GROUPS_EXTENSION;
    let mut value = scenes_as(scene_controls_manifest(), SCENES_BYPASS_EXTENSION);
    for scene in value["extensions"][SCENES_BYPASS_EXTENSION]["scenes"]
        .as_array_mut()
        .unwrap()
    {
        scene["bypass"] = json!([{"node":"fx","value":false}]);
    }
    let wet = json!({"id":"wet_fx-1","name":"Wet","nodes":["fx"]});
    value["extensions"][key] = json!({"groups":[wet.clone()]});
    assert!(parse(&value).is_err(), "must be marked required");
    value["requiredExtensions"] = json!([SCENES_BYPASS_EXTENSION, key]);
    let parsed = parse(&value).unwrap();
    parsed.check_required_extensions().unwrap();
    let reopened = Manifest::parse(&parsed.encode().unwrap()).unwrap();
    assert_eq!(
        reopened.stomp_groups().unwrap(),
        parsed.stomp_groups().unwrap()
    );
    for groups in [
        json!([]),
        json!([wet, wet]),
        json!([{"id":"bad space","name":"Wet","nodes":["fx"]}]),
        json!([{"id":"wet","name":" Wet","nodes":["fx"]}]),
        json!([{"id":"wet","name":"Wet","nodes":["fx","fx"]}]),
        json!([{"id":"wet","name":"Wet","nodes":["in"]}]),
        json!([{"id":"wet","name":"Wet","nodes":["fx","gone"]}]),
    ] {
        let mut invalid = value.clone();
        invalid["extensions"][key]["groups"] = groups;
        assert!(parse(&invalid).is_err());
    }
}

#[test]
fn scene_bypass_requires_version_three_and_a_complete_processor_target_set() {
    let parse = |value: &Value| Manifest::parse(&serde_json::to_vec(value).unwrap());
    let key = SCENES_BYPASS_EXTENSION;
    let mut value = scenes_as(scene_controls_manifest(), key);
    for (scene, bypassed) in [false, true].into_iter().enumerate() {
        value["extensions"][key]["scenes"][scene]["bypass"] =
            json!([{"node":"fx","value":bypassed}]);
    }
    let admitted = parse(&value).unwrap();
    admitted.check_required_extensions().unwrap();
    let roundtrip = Manifest::parse(&admitted.encode().unwrap()).unwrap();
    assert_eq!(roundtrip.scenes().unwrap(), admitted.scenes().unwrap());
    assert_eq!(
        roundtrip.scenes().unwrap().unwrap().scenes[1].bypass,
        vec![SceneBypass {
            node: "fx".into(),
            value: true
        }]
    );

    let mut only_bypass = value.clone();
    for scene in only_bypass["extensions"][key]["scenes"]
        .as_array_mut()
        .unwrap()
    {
        scene["gains"] = json!([]);
        scene["controls"] = json!([]);
    }
    assert!(parse(&only_bypass).is_ok());

    for old in [SCENES_EXTENSION, SCENES_CONTROLS_EXTENSION] {
        let mut rejected = scenes_as(scene_controls_manifest(), old);
        rejected["extensions"][old]["scenes"][1]["bypass"] = json!([]);
        assert!(parse(&rejected).is_err());
        rejected["extensions"][old]["scenes"][1]["bypass"] = json!([{"node":"fx","value":true}]);
        assert!(parse(&rejected).is_err());
    }
    for bad in [
        json!([]),
        json!([{"node":"missing","value":true}]),
        json!([{"node":"merge","value":true}]),
        json!([{"node":"fx","value":1}]),
        json!([{"node":"fx","value":true},{"node":"fx","value":false}]),
        json!(vec![
            json!({"node":"fx","value":true});
            MAX_SCENE_BYPASS + 1
        ]),
    ] {
        let mut rejected = value.clone();
        rejected["extensions"][key]["scenes"][1]["bypass"] = bad;
        assert!(parse(&rejected).is_err());
    }
    let mut branches = value.clone();
    branches["extensions"][key]["branches"] = json!([
       {"id":"a","name":"A","gains":[{"node":"merge","port":0,"value":1.0}]},
       {"id":"b","name":"B","gains":[{"node":"merge","port":1,"value":1.0}]}
    ]);
    assert!(parse(&branches).is_ok());
    branches["extensions"][key]["branches"][0]["bypass"] = json!([{"node":"fx","value":true}]);
    assert!(parse(&branches).is_err());
    value["requiredExtensions"] = json!([]);
    assert!(parse(&value).is_err());
}

#[test]
fn native_capture_scenes_require_version_four_and_complete_exact_targets() {
    let version = SCENES_NATIVE_EXTENSION;
    let mut base = fixture("mixed-delay");
    base["requiredExtensions"] = json!([version]);
    base["extensions"] = json!({version:{"fade_ms":20,"initial_scene":"lead","scenes":[
        {"id":"clean","name":"Clean","gains":[],"native_controls":[
            {"node":"tone3000Node","parameter":"block:amp:inputGain","value":0.5}]},
        {"id":"lead","name":"Lead","gains":[],"native_controls":[
            {"node":"tone3000Node","parameter":"block:amp:inputGain","value":0.7}]}
    ]}});
    let manifest = parse(&base).unwrap();
    manifest.check_required_extensions().unwrap();
    assert_eq!(
        Manifest::parse(&manifest.encode().unwrap())
            .unwrap()
            .scenes()
            .unwrap()
            .unwrap()
            .initial_scene
            .as_deref(),
        Some("lead")
    );
    for malformed in [
        json!([]),
        json!([{"node":"echo","parameter":"block:amp:inputGain","value":0.7}]),
        json!([{"node":"tone3000Node","parameter":"inputLevel","value":0.7}]),
        json!([{"node":"tone3000Node","parameter":"block:amp:normalize","value":1}]),
        json!([{"node":"tone3000Node","parameter":"block:other:inputGain","value":0.7}]),
        json!([{"node":"tone3000Node","parameter":"block:amp:inputGain","value":1.001}]),
        json!(vec![base["extensions"][version]["scenes"][0]["native_controls"][0].clone(); 2]),
    ] {
        let mut bad = base.clone();
        bad["extensions"][version]["scenes"][1]["native_controls"] = malformed;
        assert!(parse(&bad).is_err());
    }
    let mut over = base.clone();
    for scene in over["extensions"][version]["scenes"]
        .as_array_mut()
        .unwrap()
    {
        scene["controls"] = json!(
            (0..MAX_SCENE_CONTROLS)
                .map(|i| json!({"node":"echo","symbol":format!("p{i}"),"value":0.5}))
                .collect::<Vec<_>>()
        );
    }
    assert!(parse(&over).is_err());
    for old in [
        SCENES_EXTENSION,
        SCENES_CONTROLS_EXTENSION,
        SCENES_BYPASS_EXTENSION,
    ] {
        let mut older = scenes_as(scene_controls_manifest(), old);
        older["extensions"][old]["scenes"][0]["native_controls"] = json!([]);
        assert!(parse(&older).is_err());
        older["extensions"][old]["scenes"][0]
            .as_object_mut()
            .unwrap()
            .remove("native_controls");
        older["extensions"][old]["initial_scene"] = json!("clean");
        assert!(parse(&older).is_err());
    }
    for starting in [json!("missing"), json!(null)] {
        let mut bad = base.clone();
        bad["extensions"][version]["initial_scene"] = starting;
        assert!(parse(&bad).is_err());
    }
}

#[test]
fn inner_bypass_needs_version_five_and_a_complete_bounded_bool_set() {
    let key = SCENES_INNER_BYPASS_EXTENSION;
    let mut bundle = fixture("mixed-delay");
    bundle["requiredExtensions"] = json!([key]);
    bundle["extensions"] = json!({key:{"fade_ms":25,"initial_scene":"dry","scenes":[
        {"id":"dry","name":"Dry","gains":[],"native_bypass":[
            {"node":"tone3000Node","block":"native:exact","value":true}]},
        {"id":"wet","name":"Wet","gains":[],"native_bypass":[
            {"node":"tone3000Node","block":"native:exact","value":false}]}
    ]}});
    let manifest = parse(&bundle).unwrap();
    manifest.check_required_extensions().unwrap();
    let scenes = Manifest::parse(&manifest.encode().unwrap())
        .unwrap()
        .scenes()
        .unwrap()
        .unwrap();
    assert_eq!(scenes.initial_scene.as_deref(), Some("dry"));
    assert!(scenes.scenes[0].native_bypass[0].value);
    for rows in [
        json!([]),
        json!([{"node":"echo","block":"native:exact","value":false}]),
        json!([{"node":"tone3000Node","block":"other","value":false}]),
        json!([{"node":"tone3000Node","block":"é".repeat(65),"value":false}]),
        json!([{"node":"tone3000Node","block":"native:exact","value":1}]),
        json!(vec![
            bundle["extensions"][key]["scenes"][1]["native_bypass"]
                [0]
            .clone();
            2
        ]),
    ] {
        let mut malformed = bundle.clone();
        malformed["extensions"][key]["scenes"][1]["native_bypass"] = rows;
        assert!(parse(&malformed).is_err());
    }
    let mut over = bundle.clone();
    for scene in over["extensions"][key]["scenes"].as_array_mut().unwrap() {
        scene["native_bypass"] = json!(
            (0..MAX_SCENE_BYPASS)
                .map(|i| json!({
                    "node":"tone3000Node","block":format!("b{i}"),"value":true
                }))
                .collect::<Vec<_>>()
        );
        scene["bypass"] = json!([{"node":"echo","value":true}]);
    }
    assert!(parse(&over).is_err());
    for old in [
        SCENES_EXTENSION,
        SCENES_CONTROLS_EXTENSION,
        SCENES_BYPASS_EXTENSION,
        SCENES_NATIVE_EXTENSION,
    ] {
        let mut older = scenes_as(scene_controls_manifest(), old);
        older["extensions"][old]["scenes"][0]["native_bypass"] = json!([]);
        assert!(parse(&older).is_err(), "{old}");
    }
}
