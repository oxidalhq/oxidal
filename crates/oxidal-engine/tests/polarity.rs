#![cfg(feature = "native")]
//! A negative merge gain inverts that path's polarity (Sprint 07 7.26), and
//! different left/right gains pan it. Host routing only; no plugins.
use oxidal_engine::PreparedPorts;
use oxidal_presets::Bundle;
use serde_json::json;
use std::collections::BTreeMap;

fn bundle(left: [f64; 2], right: [f64; 2]) -> Bundle {
    let edge = |a: &str, ap: u8, b: &str, bp: u8| json!({"from":{"node":a,"port":ap},"to":{"node":b,"port":bp}});
    let value = json!({"format":"oxidal.preset","formatVersion":1,
        "id":"0b8e6a43-5f4e-4b9e-9a61-2a7b7f0c9d11","name":"Polarity",
        "tone3000":{"instances":[]},"resources":[],"extensions":{},"requiredExtensions":[],
        "oxidal":{"graph":{"nodes":[
            {"id":"in","kind":"input","audioInputs":0,"audioOutputs":2},
            {"id":"split-left","kind":"split","audioInputs":1,"audioOutputs":2},
            {"id":"split-right","kind":"split","audioInputs":1,"audioOutputs":2},
            {"id":"merge-left","kind":"merge","audioInputs":2,"audioOutputs":1,"inputGains":left},
            {"id":"merge-right","kind":"merge","audioInputs":2,"audioOutputs":1,"inputGains":right},
            {"id":"out","kind":"output","audioInputs":2,"audioOutputs":0}],
            "edges":[
                edge("in",0,"split-left",0),edge("in",1,"split-right",0),
                edge("split-left",0,"merge-left",0),edge("split-left",1,"merge-left",1),
                edge("split-right",0,"merge-right",0),edge("split-right",1,"merge-right",1),
                edge("merge-left",0,"out",0),edge("merge-right",0,"out",1)]},
        "lv2":[],"recall":{"tails":"cut"}}});
    Bundle::from_parts(serde_json::to_vec(&value).unwrap(), BTreeMap::new()).unwrap()
}

fn render(left: [f64; 2], right: [f64; 2]) -> (f32, f32) {
    let mut graph =
        PreparedPorts::new(&bundle(left, right), BTreeMap::new(), 48000.0, 64, 1 << 20).unwrap();
    let input = [0.5f32; 64];
    let (mut l, mut r) = ([0.0f32; 64], [0.0f32; 64]);
    graph
        .process(&[&input, &input], &mut [&mut l, &mut r])
        .unwrap();
    (l[63], r[63])
}

#[test]
fn an_inverted_path_cancels_its_twin_and_unequal_sides_pan_it() {
    // Path 2 inverted: identical paths cancel on both channels.
    let (l, r) = render([1.0, -1.0], [1.0, -1.0]);
    assert!(l.abs() < 1e-6 && r.abs() < 1e-6, "{l} {r}");
    // Path 2 panned hard left: it adds to the left only.
    let (l, r) = render([1.0, 1.0], [1.0, 0.0]);
    assert!((l - 1.0).abs() < 1e-6 && (r - 0.5).abs() < 1e-6, "{l} {r}");
}
