#![cfg(feature = "native")]
use oxidal_control::{
    Action, Command, EDIT_LEASE, Edit, MappingFile, MidiCurve, MidiInput, MidiMapping, MidiMode,
    Snapshot,
};
use oxidal_graph::{BlockKind, Edge, Node, Rig};
use oxidal_lv2::{Binding, PreparedGraph, World};
use std::{path::Path, time::Instant};

fn rig(parallel: bool) -> Rig {
    Rig {
        nodes: [
            ("in", BlockKind::Input),
            ("a", BlockKind::Lv2),
            ("b", BlockKind::Lv2),
            ("out", BlockKind::Output),
        ]
        .into_iter()
        .map(|(id, kind)| Node {
            id: id.into(),
            kind,
            level: 1.0,
        })
        .collect(),
        edges: if parallel {
            vec![("in", "a"), ("in", "b"), ("a", "out"), ("b", "out")]
        } else {
            vec![("in", "a"), ("a", "b"), ("b", "out")]
        }
        .into_iter()
        .map(|(from, to)| Edge {
            from: from.into(),
            to: to.into(),
        })
        .collect(),
    }
}
fn setup(parallel: bool) -> PreparedGraph {
    let world = World::bundle(Path::new(env!("OXIDAL_LV2_FIXTURE"))).unwrap();
    PreparedGraph::new(
        &world,
        rig(parallel),
        &bindings("urn:oxidal:test:contract"),
        48000.0,
        64,
    )
    .unwrap()
}
fn bindings(uri: &str) -> Vec<Binding> {
    ["a", "b"]
        .map(|node| Binding {
            node: node.into(),
            uri: uri.into(),
        })
        .into()
}
fn command(g: &PreparedGraph, action: Action) -> Command {
    let s = g.snapshot();
    Command {
        session: s.session,
        protocol: 1,
        request_id: "graph-test".into(),
        expected_revision: Some(s.revision),
        action,
    }
}
fn send(g: &mut PreparedGraph, action: Action) -> Snapshot {
    g.apply(command(g, action), true).unwrap()
}
fn set(g: &mut PreparedGraph, target: &str, value: f64) {
    send(
        g,
        Action::Set {
            target: target.into(),
            value,
        },
    );
}
fn check_audio(g: &mut PreparedGraph, expected: f32) {
    let mut l = [0.25; 64];
    let mut r = [-0.125; 64];
    g.process(&mut l, &mut r).unwrap();
    assert!(
        l.iter().all(|v| (*v - expected).abs() < 1e-5),
        "left {:?}, expected {expected}",
        &l[..3]
    );
    assert!(r.iter().all(|v| (*v + expected * 0.5).abs() < 1e-5));
}
fn mappings(pickup: bool, mode: MidiMode) -> Action {
    Action::Mappings {
        file: MappingFile {
            version: 1,
            mappings: vec![MidiMapping {
                id: "encoder".into(),
                device: "test-controller".into(),
                channel: 1,
                cc: 21,
                target: "a.gain".into(),
                mode,
                pickup,
                feedback: true,
                min: 0.0,
                max: 1.0,
                curve: MidiCurve::Linear,
            }],
        },
    }
}
fn midi(value: u8) -> Action {
    Action::Midi {
        input: MidiInput {
            device: "test-controller".into(),
            channel: 1,
            cc: 21,
            value,
        },
    }
}
#[test]
fn serial_parallel_routing_and_rejections_reach_actual_audio() {
    let mut g = setup(false);
    set(&mut g, "a.gain", 0.25); // Native gain 0.5.
    set(&mut g, "b.gain", 0.25);
    check_audio(&mut g, 0.0625);
    send(&mut g, Action::Routing { rig: rig(true) });
    check_audio(&mut g, 0.25); // Unity sum of two independent half-gain paths.
    let rev = g.snapshot().revision;
    let mut cyclic = rig(true);
    cyclic.edges.push(Edge {
        from: "out".into(),
        to: "a".into(),
    });
    assert!(
        g.apply(command(&g, Action::Routing { rig: cyclic }), true)
            .is_err()
    );
    assert!(
        g.apply(
            command(
                &g,
                Action::Set {
                    target: "rig.preset".into(),
                    value: 1.0
                }
            ),
            true
        )
        .is_err()
    );
    let mut changed = rig(true);
    changed.nodes.swap(1, 2);
    assert!(
        g.apply(command(&g, Action::Routing { rig: changed }), true)
            .is_err()
    );
    assert_eq!(g.snapshot().revision, rev);
    check_audio(&mut g, 0.25);
    set(&mut g, "rig.bypass", 1.0);
    check_audio(&mut g, 0.25);
    set(&mut g, "rig.bypass", 0.0);
    let old = command(&g, midi(0));
    set(&mut g, "a.gain", 0.5);
    assert_eq!(g.apply(old, true).unwrap_err(), "revision_conflict");
    check_audio(&mut g, 0.375);
}
#[test]
fn midi_pickup_owned_edits_expiry_feedback_and_relative_controls_render() {
    let mut g = setup(false);
    send(&mut g, mappings(true, MidiMode::Absolute));
    send(&mut g, midi(0));
    check_audio(&mut g, 0.25); // Pickup hasn't crossed default.
    send(&mut g, midi(127));
    check_audio(&mut g, 0.5);
    set(&mut g, "a.gain", 0.25); // Web edit resets pickup latch.
    send(&mut g, midi(127));
    check_audio(&mut g, 0.125);
    send(&mut g, midi(0));
    check_audio(&mut g, 0.0);
    send(&mut g, mappings(false, MidiMode::RelativeTwosComplement));
    send(&mut g, midi(1));
    send(&mut g, midi(1));
    check_audio(&mut g, 0.01);
    send(
        &mut g,
        Action::Edit {
            edit: Edit::Begin {
                owner: "browser".into(),
                token: "one".into(),
                target: "a.gain".into(),
            },
        },
    );
    send(
        &mut g,
        Action::Edit {
            edit: Edit::Preview {
                owner: "browser".into(),
                token: "one".into(),
                sequence: 1,
                value: 0.75,
            },
        },
    );
    check_audio(&mut g, 0.375);
    let s = send(&mut g, midi(1)); // MIDI wins over preview, advancing baseline 0.02 to 0.03.
    assert!(s.edit.is_none());
    assert_eq!(s.feedback[0].value, 4);
    check_audio(&mut g, 0.015);
    send(
        &mut g,
        Action::Edit {
            edit: Edit::Cancel {
                owner: "browser".into(),
                token: "one".into(),
            },
        },
    );
    check_audio(&mut g, 0.015); // Late browser cancel cannot undo physical-source edit.
    send(
        &mut g,
        Action::Edit {
            edit: Edit::Begin {
                owner: "browser".into(),
                token: "two".into(),
                target: "a.gain".into(),
            },
        },
    );
    send(
        &mut g,
        Action::Edit {
            edit: Edit::Preview {
                owner: "browser".into(),
                token: "two".into(),
                sequence: 1,
                value: 0.9,
            },
        },
    );
    g.expire_edit(Instant::now() + EDIT_LEASE).unwrap().unwrap();
    check_audio(&mut g, 0.015);
    assert!(g.apply(command(&g, midi(1)), false).is_err());
    assert!((g.native_value("a.gain").unwrap() - 0.06).abs() < 1e-6);
}
#[test]
fn histories_survive_routing_and_failed_preparation_does_not_replace_graph() {
    let mut g = setup(false);
    set(&mut g, "a.feedback", 0.5 / 0.9);
    let mut l = [0.0; 64];
    let mut r = [0.0; 64];
    l[0] = 1.0;
    r[0] = -0.5;
    g.process(&mut l, &mut r).unwrap();
    send(&mut g, Action::Routing { rig: rig(true) });
    l.fill(0.0);
    r.fill(0.0);
    g.process(&mut l, &mut r).unwrap();
    assert!((l[0] - 0.5).abs() < 1e-6);
    assert!((r[0] + 0.25).abs() < 1e-6);
    let world = World::bundle(Path::new(env!("OXIDAL_LV2_FIXTURE"))).unwrap();
    assert!(PreparedGraph::new(&world, rig(false), &bindings("urn:missing"), 48000.0, 64).is_err());
    l.fill(0.0);
    r.fill(0.0);
    g.process(&mut l, &mut r).unwrap();
    assert!((l[0] - 0.25).abs() < 1e-6);
    set(&mut g, "a.gain", 1.0);
    l.fill(f32::MAX);
    r.fill(0.0);
    assert!(g.process(&mut l, &mut r).is_err());
    assert_eq!(l, [0.0; 64]);
    assert!(g.apply(command(&g, midi(0)), true).is_err());
    assert!(g.process(&mut l, &mut r).is_err());
}
#[test]
fn external_plugin_graph_midi_changes_native_gain_and_rendered_samples() {
    let root = std::env::var("OXIDAL_LV2_EXTERNAL_DIR").unwrap();
    let world = World::bundle(&Path::new(&root).join("amp-swh.lv2")).unwrap();
    let mut g = PreparedGraph::new(
        &world,
        rig(false),
        &bindings("http://plugin.org.uk/swh-plugins/amp"),
        48000.0,
        64,
    )
    .unwrap();
    let mut action = mappings(false, MidiMode::Absolute);
    if let Action::Mappings { file } = &mut action {
        file.mappings[0].min = (70.0 - 6.0206) / 140.0;
        file.mappings[0].max = 0.5;
    }
    send(&mut g, action);
    send(&mut g, midi(0));
    assert!((g.native_value("a.gain").unwrap() + 6.0206).abs() < 1e-4);
    check_audio(&mut g, 0.125);
    send(&mut g, midi(127));
    check_audio(&mut g, 0.25);
}

#[test]
fn discrete_plugin_readback_drives_snapshot_and_midi_feedback() {
    let world = World::bundle(Path::new(env!("OXIDAL_LV2_FIXTURE"))).unwrap();
    let mut g = PreparedGraph::new(
        &world,
        rig(false),
        &bindings("urn:oxidal:test:quantized"),
        48000.0,
        64,
    )
    .unwrap();
    send(&mut g, mappings(false, MidiMode::Absolute));
    set(&mut g, "a.gain", 0.33);
    let state = g.snapshot();
    assert_eq!(g.native_value("a.gain").unwrap(), 1.0);
    assert_eq!(
        state
            .parameters
            .iter()
            .find(|p| p.id == "a.gain")
            .unwrap()
            .value,
        0.25
    );
    assert_eq!(state.feedback[0].value, 32);
    check_audio(&mut g, 0.25);
    send(&mut g, midi(90)); // 90/127 maps to native 3, then confirmed normalized 0.75.
    assert_eq!(g.native_value("a.gain").unwrap(), 3.0);
    assert_eq!(g.snapshot().feedback[0].value, 95);
    check_audio(&mut g, 0.75);
}

// Per-thread accounting avoids parallel-test allocations affecting this assertion.
struct CountingAllocator;
thread_local! {
    static COUNTING: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
    static ALLOCATIONS: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
}
fn count_allocation() {
    if COUNTING.try_with(|c| c.get()).unwrap_or(false) {
        let _ = ALLOCATIONS.try_with(|n| n.set(n.get() + 1));
    }
}
// SAFETY: all memory operations are forwarded unchanged to the system allocator.
unsafe impl std::alloc::GlobalAlloc for CountingAllocator {
    unsafe fn alloc(&self, layout: std::alloc::Layout) -> *mut u8 {
        count_allocation();
        // SAFETY: same allocation contract as the caller.
        unsafe { std::alloc::System.alloc(layout) }
    }
    unsafe fn dealloc(&self, ptr: *mut u8, layout: std::alloc::Layout) {
        // SAFETY: unchanged pointer/layout provided by caller.
        unsafe { std::alloc::System.dealloc(ptr, layout) }
    }
    unsafe fn realloc(&self, ptr: *mut u8, layout: std::alloc::Layout, size: usize) -> *mut u8 {
        count_allocation();
        // SAFETY: unchanged system-owned pointer/layout and requested size.
        unsafe { std::alloc::System.realloc(ptr, layout, size) }
    }
}
#[global_allocator]
static ALLOCATOR: CountingAllocator = CountingAllocator;
#[test]
fn successful_graph_blocks_do_not_allocate_rust_memory() {
    let mut g = setup(true);
    let mut l = [0.25; 64];
    let mut r = [-0.125; 64];
    ALLOCATIONS.with(|n| n.set(0));
    COUNTING.with(|c| c.set(true));
    for _ in 0..100 {
        l.fill(0.25);
        r.fill(-0.125);
        g.process(&mut l, &mut r).unwrap();
    }
    COUNTING.with(|c| c.set(false));
    assert_eq!(ALLOCATIONS.with(|n| n.get()), 0);
    assert_eq!(l, [0.5; 64]);
}
