//! Actual native A2 + installed LV2 composition, part of the Linux native gate.
#[path = "qualify_mixed/partition.rs"]
mod partition;
#[path = "qualify_mixed/portable.rs"]
mod portable;
#[path = "qualify_mixed/worker.rs"]
mod worker;
use oxidal_engine::{PreparedRig, Processor};
use oxidal_graph::{BlockKind, Edge, Node, Rig};
use oxidal_lv2::{Plugin, World};
use oxidal_tone3000::{Engine, InputMode};
use std::{collections::BTreeMap, error::Error, path::Path};

fn native(bytes: &[u8], frames: usize) -> Result<Engine, Box<dyn Error>> {
    let mut p = Engine::new(48000.0, frames)?;
    p.load_preset(bytes)?;
    p.wait_ready()?;
    p.set_input_mode(InputMode::Left)?;
    p.set_normalized("gateEnabled", 0.0)?;
    p.set_normalized("inputLevel", 0.5)?;
    p.set_normalized("outputLevel", 0.5)?;
    Ok(p)
}
fn rig(serial: bool) -> Rig {
    // Deliberately store nodes out of signal order.
    let nodes = [
        ("out", BlockKind::Output),
        ("a", BlockKind::Native),
        ("fx", BlockKind::Lv2),
        ("in", BlockKind::Input),
        ("b", BlockKind::Native),
    ]
    .into_iter()
    .map(|(id, kind)| Node {
        id: id.into(),
        kind,
        level: 1.0,
    })
    .collect();
    let edges = if serial {
        vec![("in", "a"), ("a", "fx"), ("fx", "b"), ("b", "out")]
    } else {
        vec![
            ("in", "a"),
            ("in", "b"),
            ("a", "fx"),
            ("b", "fx"),
            ("fx", "out"),
        ]
    };
    Rig {
        nodes,
        edges: edges
            .into_iter()
            .map(|(from, to)| Edge {
                from: from.into(),
                to: to.into(),
            })
            .collect(),
    }
}
fn main() -> Result<(), Box<dyn Error>> {
    let root = std::env::var("OXIDAL_QUALIFICATION_DATA")?;
    let bytes = std::fs::read(Path::new(&root).join("a2-preset.t3kpreset"))?;
    let bundles =
        std::env::var("OXIDAL_LV2_EXTERNAL_DIR").unwrap_or_else(|_| "/usr/lib/lv2".into());
    let world = World::bundle(&Path::new(&bundles).join("amp-swh.lv2"))?;
    let args: Vec<_> = std::env::args().skip(1).collect();
    if args == ["--models"] {
        return portable::qualify_models(&world, &bytes, Path::new(&root));
    }
    if args == ["--authoring"] {
        return portable::qualify_authoring(&world, &bytes, Path::new(&root));
    }
    if args == ["--scenes"] {
        return portable::qualify_scenes(&world, &bytes, Path::new(&root));
    }
    if !args.is_empty() {
        return Err("Unknown mixed qualification selection".into());
    }
    qualify_admission_and_failure(&world)?;
    partition::qualify(&world, Path::new(&root))?;
    portable::qualify(&world, &bytes, Path::new(&root))?;
    portable::qualify_authoring(&world, &bytes, Path::new(&root))?;
    let frames = 128;
    let mut fx = Plugin::new(
        &world,
        "http://plugin.org.uk/swh-plugins/amp",
        48000.0,
        frames,
    )?;
    let port = fx
        .info()
        .ports
        .iter()
        .find(|p| p.symbol == "gain")
        .ok_or("missing gain")?
        .index;
    let db = fx.set(port, -6.0206)?;
    let mut gain = 10.0_f32.powf(db / 20.0);
    let processors = BTreeMap::from([
        ("a".into(), Processor::Native(native(&bytes, frames)?)),
        ("b".into(), Processor::Native(native(&bytes, frames)?)),
        ("fx".into(), Processor::Lv2(fx)),
    ]);
    let mut graph = PreparedRig::new(rig(false), processors, 48000.0, frames)?;
    let mut reference_a = native(&bytes, frames)?;
    let mut reference_b = native(&bytes, frames)?;
    let mut error = 0.0_f32;
    let mut peak = 0.0_f32;
    for block in 0..750 {
        if block == 450 {
            let Some(Processor::Lv2(p)) = graph.processor_mut("fx") else {
                panic!("LV2 node")
            };
            gain = 10.0_f32.powf(p.set(port, 0.0)? / 20.0);
        }
        if block == 500 {
            let mut invalid = rig(false);
            invalid.edges.push(Edge {
                from: "fx".into(),
                to: "a".into(),
            });
            assert!(graph.reroute(invalid).is_err());
        }
        if block == 550 {
            graph.reroute(rig(true))?;
        }
        if block == 650 {
            let Some(Processor::Native(p)) = graph.processor_mut("a") else {
                panic!("native node")
            };
            p.set_normalized("inputLevel", 0.56)?;
            reference_a.set_normalized("inputLevel", 0.56)?;
        }
        for id in ["a", "b"] {
            let Some(Processor::Native(p)) = graph.processor_mut(id) else {
                panic!("native node")
            };
            p.pump()?;
        }
        reference_a.pump()?;
        reference_b.pump()?;
        let mut left: Vec<f32> = (0..frames)
            .map(|i| {
                if block < 400 {
                    0.0
                } else {
                    ((block * frames + i) as f32 * 0.019).sin() * 0.02 + 0.003
                }
            })
            .collect();
        let mut right: Vec<f32> = left.iter().map(|x| -x * 0.3).collect();
        let (mut a, mut b) = (left.clone(), right.clone());
        reference_a.process(&mut a, &mut b)?;
        if block < 550 {
            let (mut c, mut d) = (left.clone(), right.clone());
            reference_b.process(&mut c, &mut d)?;
            for i in 0..frames {
                a[i] = (a[i] + c[i]) * gain;
                b[i] = (b[i] + d[i]) * gain;
            }
        } else {
            for sample in a.iter_mut().chain(&mut b) {
                *sample *= gain;
            }
            reference_b.process(&mut a, &mut b)?;
        }
        graph.process(&mut left, &mut right)?;
        if block >= 400 {
            for (actual, expected) in left.iter().chain(&right).zip(a.iter().chain(&b)) {
                assert!(actual.is_finite());
                error = error.max((actual - expected).abs());
                peak = peak.max(actual.abs());
            }
        }
    }
    assert!(peak > 1e-4, "silent comparison");
    assert!(
        error < 1e-5,
        "mixed graph differs from ordered native/LV2 reference: {error}"
    );
    let mut left = vec![f32::NAN; frames];
    let mut right = vec![1.0; frames];
    assert!(graph.process(&mut left, &mut right).is_err());
    assert!(left.iter().chain(&right).all(|x| *x == 0.0));
    graph.process(&mut left, &mut right)?;
    println!(
        "mixed graph: A2 + installed LV2, parallel sum, persistent serial reroute, live scalar changes, rejected cycle preservation; max_error={error}"
    );
    Ok(())
}

fn qualify_admission_and_failure(world: &World) -> Result<(), Box<dyn Error>> {
    let mut simple = rig(false);
    simple
        .nodes
        .retain(|n| !matches!(n.kind, BlockKind::Native));
    simple.edges = [("in", "fx"), ("fx", "out")]
        .into_iter()
        .map(|(from, to)| Edge {
            from: from.into(),
            to: to.into(),
        })
        .collect();
    let plugin = || Plugin::new(world, "http://plugin.org.uk/swh-plugins/amp", 48000.0, 128);
    assert!(
        PreparedRig::new(
            simple.clone(),
            BTreeMap::from([("fx".into(), Processor::Lv2(plugin()?))]),
            44100.0,
            128
        )
        .is_err()
    );
    assert!(
        PreparedRig::new(
            simple.clone(),
            BTreeMap::from([("fx".into(), Processor::Lv2(plugin()?))]),
            48000.0,
            64
        )
        .is_err()
    );
    let mut wrong = simple.clone();
    wrong.nodes.iter_mut().find(|n| n.id == "fx").unwrap().kind = BlockKind::Native;
    assert!(
        PreparedRig::new(
            wrong,
            BTreeMap::from([("fx".into(), Processor::Lv2(plugin()?))]),
            48000.0,
            128
        )
        .is_err()
    );
    let mono = Plugin::new_ports(world, "http://plugin.org.uk/swh-plugins/amp", 48000.0, 128)?;
    assert!(
        PreparedRig::new(
            simple.clone(),
            BTreeMap::from([("fx".into(), Processor::Lv2(mono))]),
            48000.0,
            128
        )
        .is_err()
    );
    let mut loud = plugin()?;
    let port = loud
        .info()
        .ports
        .iter()
        .find(|p| p.symbol == "gain")
        .unwrap()
        .index;
    loud.set(port, 70.0)?;
    let mut failed = PreparedRig::new(
        simple,
        BTreeMap::from([("fx".into(), Processor::Lv2(loud))]),
        48000.0,
        128,
    )?;
    let mut left = [f32::MAX; 128];
    let mut right = left;
    assert!(failed.process(&mut left, &mut right).is_err());
    assert!(left.iter().chain(&right).all(|x| *x == 0.0));
    assert!(failed.process(&mut left, &mut right).is_err());
    assert!(failed.processor_mut("fx").is_none());
    Ok(())
}
