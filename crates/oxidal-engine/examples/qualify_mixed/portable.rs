//! Persisted native payload plus explicit scalar split/merge and installed mono
//! LV2 processors. This is an offline core qualification, not a live Save flow.
use oxidal_engine::{PreparedPorts, Processor};
use oxidal_lv2::{Plugin, World};
use oxidal_presets::{Bundle, BundleStore, inspect};
use serde_json::{Value, json};
use std::{collections::BTreeMap, error::Error, path::Path};
const AMP: &str = "http://plugin.org.uk/swh-plugins/amp";
fn node(id: &str, kind: &str, input: u8, output: u8) -> Value {
    json!({"id":id,"kind":kind,"audioInputs":input,"audioOutputs":output})
}
fn edge(from: &str, output: u8, to: &str, input: u8) -> Value {
    json!({"from":{"node":from,"port":output},"to":{"node":to,"port":input}})
}
fn declaration(bytes: &[u8]) -> Result<Value, Box<dyn Error>> {
    let inspection = inspect(bytes)?;
    let mut nodes = vec![node("out", "output", 2, 0), node("in", "input", 0, 2)];
    let mut native = node("tone", "tone3000", 2, 2);
    native["instance"] = json!("native");
    native["bypassed"] = json!(false);
    nodes.push(native);
    let mut edges = vec![edge("in", 0, "tone", 0), edge("in", 1, "tone", 1)];
    let mut lv2 = vec![];
    for (port, side, gain) in [(0, "l", -6.0206), (1, "r", 6.0206)] {
        let (split, fx, merge) = (
            format!("split_{side}"),
            format!("fx_{side}"),
            format!("merge_{side}"),
        );
        nodes.push(node(&split, "split", 1, 2));
        let mut n = node(&fx, "lv2", 1, 1);
        n["instance"] = json!(fx);
        n["bypassed"] = json!(side == "r");
        nodes.push(n);
        let mut n = node(&merge, "merge", 2, 1);
        n["inputGains"] = json!([0.25, 0.75]);
        nodes.push(n);
        edges.extend([
            edge("tone", port, &split, 0),
            edge(&split, 0, &fx, 0),
            edge(&split, 1, &merge, 1),
            edge(&fx, 0, &merge, 0),
            edge(&merge, 0, "out", port),
        ]);
        lv2.push(json!({"id":fx,"pluginUri":AMP,"controls":{"gain":gain},"assets":[],"requiredFeatures":[]}));
    }
    Ok(json!({
        "format":"oxidal.preset","formatVersion":1,"id":"68448a6d-0168-4fc8-b337-c12959165271","name":"Authored mixed qualification",
        "tone3000":{"instances":[{"id":"native","preset":"current","profile":oxidal_engine::native_profile_id()?}]},
        "oxidal":{"graph":{"nodes":nodes,"edges":edges},"lv2":lv2,"recall":{"tails":"cut"}},
        "resources":[{"id":"current","path":"native/current.t3kpreset","kind":"tone3000-preset","bytes":bytes.len(),"sha256":inspection.sha256}],
        "extensions":{},"requiredExtensions":[]
    }))
}
fn processors(
    world: &World,
    bundle: &Bundle,
) -> Result<BTreeMap<String, Processor>, Box<dyn Error>> {
    let bytes = bundle.resource("current").ok_or("missing native payload")?;
    Ok(BTreeMap::from([
        (
            "native".into(),
            Processor::Native(super::native(bytes, 128)?),
        ),
        (
            "fx_l".into(),
            Processor::Lv2(Plugin::new_ports(world, AMP, 48000.0, 128)?),
        ),
        (
            "fx_r".into(),
            Processor::Lv2(Plugin::new_ports(world, AMP, 48000.0, 128)?),
        ),
    ]))
}
pub fn qualify(world: &World, original: &[u8], root: &Path) -> Result<(), Box<dyn Error>> {
    qualify_routing()?;
    qualify_lv2_admission(world)?;
    let mut author = super::native(original, 128)?;
    let current = author.save_preset("Portable authored fixture")?;
    drop(author);
    let source = root.join("portable-working.t3kpreset");
    std::fs::write(&source, &current)?;
    let bundle = Bundle::from_parts(
        serde_json::to_vec(&declaration(&current)?)?,
        BTreeMap::from([("current".into(), std::fs::read(&source)?)]),
    )?;
    let store = BundleStore::new(root.join("portable-rigs"));
    let id = store.save(&bundle)?;
    std::fs::remove_file(source)?;
    drop(bundle);
    let bundle = BundleStore::new(root.join("portable-rigs")).read(&id)?;
    assert!(PreparedPorts::new(&bundle, processors(world, &bundle)?, 48000.0, 128, 1).is_err());
    let mut changed = bundle.manifest().clone();
    changed.oxidal.as_mut().unwrap().recall.tails = oxidal_presets::manifest::Tails::Preserve;
    let unsupported = Bundle::from_parts(
        changed.encode()?,
        BTreeMap::from([(
            "current".into(),
            bundle.resource("current").unwrap().to_vec(),
        )]),
    )?;
    assert!(
        PreparedPorts::new(
            &unsupported,
            processors(world, &bundle)?,
            48000.0,
            128,
            1024 * 1024
        )
        .is_err()
    );
    for role in [false, true] {
        let mut invalid = bundle.manifest().clone();
        if role {
            invalid.tone3000.instances[0].processing_role =
                Some(oxidal_presets::manifest::ProcessingRole::Amp);
        } else {
            invalid.tone3000.instances[0].profile = "tone3000-plugin:unsupported".into();
        }
        let invalid = Bundle::from_parts(
            invalid.encode()?,
            BTreeMap::from([(
                "current".into(),
                bundle.resource("current").unwrap().to_vec(),
            )]),
        )?;
        assert!(PreparedPorts::from_bundle(&invalid, world, 48000.0, 128, 1024 * 1024).is_err());
    }
    let mut graph = PreparedPorts::from_bundle(&bundle, world, 48000.0, 128, 1024 * 1024)?;
    assert_eq!(graph.channels(), (2, 2));
    let mut reference = super::native(bundle.resource("current").unwrap(), 128)?;
    reference.set_input_mode(oxidal_tone3000::InputMode::Stereo)?;
    let mut amp = Plugin::new_ports(world, AMP, 48000.0, 128)?;
    amp.set(0, -6.0206)?;
    let mut peak = 0.0_f32;
    let mut difference = 0.0_f32;
    let mut stable_difference = 0.0_f32;
    let mut worst_block = 0;
    // Native wait_ready feeds a variable number of silent blocks while loaders
    // settle. Measure routing after the existing qualification prewarm window;
    // retain startup difference separately for the prepared-transition gate.
    for block in 0..650 {
        let Some(Processor::Native(p)) = graph.processor_mut("tone") else {
            panic!("native processor")
        };
        p.pump()?;
        reference.pump()?;
        let left: Vec<_> = (0..128)
            .map(|i| {
                if block < 400 {
                    0.0
                } else {
                    ((block * 128 + i) as f32 * 0.013).sin() * 0.03 + 0.002
                }
            })
            .collect();
        let right: Vec<_> = left.iter().map(|v| -*v * 0.4).collect();
        let (mut a, mut b) = (left.clone(), right.clone());
        reference.process(&mut a, &mut b)?;
        let mut wet = a.clone();
        amp.process_mono(&mut wet)?;
        for (dry, wet) in a.iter_mut().zip(wet) {
            *dry = wet * 0.25 + *dry * 0.75;
        }
        // Right LV2 is retained but bypassed: explicit merge is 0.25+0.75 dry.
        for sample in &mut b {
            *sample = *sample * 0.25 + *sample * 0.75;
        }
        let (mut actual_l, mut actual_r) = ([0.0; 128], [0.0; 128]);
        graph.process(&[&left, &right], &mut [&mut actual_l, &mut actual_r])?;
        for (actual, expected) in actual_l.iter().chain(&actual_r).zip(a.iter().chain(&b)) {
            peak = peak.max(actual.abs());
            let error = (actual - expected).abs();
            if error > difference {
                difference = error;
                worst_block = block;
            }
            if block >= 400 {
                stable_difference = stable_difference.max(error);
            }
        }
    }
    println!(
        "portable render diagnostic: max={difference}, worst_block={worst_block}, after_prewarm={stable_difference}"
    );
    assert!(peak > 1e-4, "silent persisted comparison");
    assert!(
        stable_difference < 1e-5,
        "settled persisted scalar-port graph differs: {stable_difference}"
    );
    let (mut left, mut right) = ([1.0; 128], [1.0; 128]);
    assert!(
        graph
            .process(
                &[&[f32::NAN; 128], &[0.0; 128]],
                &mut [&mut left, &mut right]
            )
            .is_err()
    );
    assert_eq!(left, [0.0; 128]);
    assert_eq!(right, [0.0; 128]);
    graph.process(&[&[0.0; 128], &[0.0; 128]], &mut [&mut left, &mut right])?;
    println!(
        "portable mixed recall: exact embedded native payload, two explicit mono LV2 declarations, weighted split/merge, bypass retained, cache-independent disk recall; settled_max_error={stable_difference}; startup_max_error={difference}; host_buffers={} bytes",
        graph.buffer_bytes()
    );
    Ok(())
}

fn qualify_routing() -> Result<(), Box<dyn Error>> {
    let mut nodes = vec![node("input", "input", 0, 1)];
    let mut edges = vec![];
    let mut previous = "input".to_owned();
    // More than the old 64-node ceiling, with explicit multi-level branches.
    for i in 0..80 {
        let split = format!("split{i}");
        let merge = format!("merge{i}");
        nodes.push(node(&split, "split", 1, 2));
        let mut sum = node(&merge, "merge", 2, 1);
        sum["inputGains"] = json!([0.25, 0.75]);
        nodes.push(sum);
        edges.extend([
            edge(&previous, 0, &split, 0),
            edge(&split, 0, &merge, 0),
            edge(&split, 1, &merge, 1),
        ]);
        previous = merge;
    }
    nodes.push(node("output", "output", 1, 0));
    edges.push(edge(&previous, 0, "output", 0));
    nodes.reverse();
    let mut value = json!({"format":"oxidal.preset","formatVersion":1,"id":"923d6592-d2ab-4833-9008-35bb8423aebd","name":"Explicit routing fixture",
        "tone3000":{"instances":[]},"oxidal":{"graph":{"nodes":nodes,"edges":edges},"lv2":[],"recall":{"tails":"cut"}},"resources":[],"extensions":{},"requiredExtensions":[]});
    let bundle = Bundle::from_parts(serde_json::to_vec(&value)?, BTreeMap::new())?;
    let mut graph = PreparedPorts::new(&bundle, BTreeMap::new(), 48000.0, 128, 1024 * 1024)?;
    let input = [0.125; 128];
    let mut output = [0.0; 128];
    graph.process(&[&input], &mut [&mut output])?;
    assert_eq!(output, input);
    value["oxidal"]["graph"]["nodes"][1]["inputGains"] = json!([4.0, 4.0]);
    let loud = Bundle::from_parts(serde_json::to_vec(&value)?, BTreeMap::new())?;
    let mut graph = PreparedPorts::new(&loud, BTreeMap::new(), 48000.0, 128, 1024 * 1024)?;
    assert!(
        graph
            .process(&[&[f32::MAX; 128]], &mut [&mut output])
            .is_err()
    );
    assert_eq!(output, [0.0; 128]);
    assert!(graph.process(&[&input], &mut [&mut output]).is_err());
    println!(
        "explicit port routing: 162 nodes, 80 split/merge pairs, reversed declaration order, buffer budget and overflow failure latching pass"
    );
    Ok(())
}

fn qualify_lv2_admission(world: &World) -> Result<(), Box<dyn Error>> {
    let mut fx = node("fx", "lv2", 1, 1);
    fx["instance"] = json!("fx");
    fx["bypassed"] = json!(false);
    let value = json!({"format":"oxidal.preset","formatVersion":1,"id":"6306a58f-6a12-4e8b-96e0-af98e0fc1d9e","name":"Mono admission",
        "tone3000":{"instances":[]},"resources":[],"extensions":{},"requiredExtensions":[],
        "oxidal":{"graph":{"nodes":[node("in","input",0,1),fx,node("out","output",1,0)],"edges":[edge("in",0,"fx",0),edge("fx",0,"out",0)]},
            "lv2":[{"id":"fx","pluginUri":AMP,"controls":{"gain":-6.0206},"assets":[],"requiredFeatures":[]}],"recall":{"tails":"cut"}}});
    let bundle = Bundle::from_parts(serde_json::to_vec(&value)?, BTreeMap::new())?;
    let bindings = || -> Result<BTreeMap<String, Processor>, String> {
        Ok(BTreeMap::from([(
            "fx".into(),
            Processor::Lv2(Plugin::new_ports(world, AMP, 48000.0, 128)?),
        )]))
    };
    let wrong_layout = BTreeMap::from([(
        "fx".into(),
        Processor::Lv2(Plugin::new(world, AMP, 48000.0, 128)?),
    )]);
    assert!(PreparedPorts::new(&bundle, wrong_layout, 48000.0, 128, 1024 * 1024).is_err());
    assert!(PreparedPorts::new(&bundle, bindings()?, 44100.0, 128, 1024 * 1024).is_err());
    assert!(PreparedPorts::new(&bundle, bindings()?, 48000.0, 64, 1024 * 1024).is_err());
    for (key, replacement) in [
        ("pluginUri", json!("urn:unknown:plugin")),
        ("controls", json!({})),
        ("controls", json!({"wrong":0.0})),
        ("controls", json!({"gain":999.0})),
        ("requiredFeatures", json!(["urn:unknown:feature"])),
    ] {
        let mut invalid = value.clone();
        invalid["oxidal"]["lv2"][0][key] = replacement;
        let invalid = Bundle::from_parts(serde_json::to_vec(&invalid)?, BTreeMap::new())?;
        assert!(PreparedPorts::from_bundle(&invalid, world, 48000.0, 128, 1024 * 1024).is_err());
        assert!(
            PreparedPorts::new(&invalid, bindings()?, 48000.0, 128, 1024 * 1024).is_err(),
            "admitted invalid {key}"
        );
    }
    let mut graph = PreparedPorts::new(&bundle, bindings()?, 48000.0, 128, 1024 * 1024)?;
    let mut output = [0.0; 128];
    graph.process(&[&[0.5; 128]], &mut [&mut output])?;
    assert!(output.iter().all(|v| (*v - 0.25).abs() < 1e-5));
    println!(
        "portable LV2 admission: exact mono ports, full symbol controls, ranges, features and configuration checks pass"
    );
    Ok(())
}
