//! The control table in the code and the port list in `lv2/motion.ttl` must
//! describe the same ports, for both plugins.
//! @see docs/native-motion.md

use oxidal_lv2_plugin::Plugin;
use oxidal_motion::{CONTROLS, DIVISIONS, Mode, Motion};

const TTL: &str = include_str!("../lv2/motion.ttl");

/// The value after `key` on a port line, up to the next `;` or the closing
/// bracket, without quotes.
fn field<'a>(line: &'a str, key: &str) -> &'a str {
    let start = line
        .find(key)
        .unwrap_or_else(|| panic!("no {key} in {line}"))
        + key.len();
    let rest = line[start..].trim_start();
    let end = rest
        .find(" ;")
        .or_else(|| rest.find(" ]"))
        .unwrap_or(rest.len());
    rest[..end].trim().trim_matches('"')
}

fn number(line: &str, key: &str) -> f32 {
    field(line, key)
        .parse()
        .unwrap_or_else(|_| panic!("{key} is not a number in {line}"))
}

/// The text of the plugin whose URI ends in `kind`.
fn section(kind: &str) -> &'static str {
    let start = TTL
        .find(&format!("<urn:oxidal:plugin:motion#{kind}> a lv2:Plugin"))
        .unwrap_or_else(|| panic!("no {kind} plugin"));
    let rest = &TTL[start..];
    let end = rest[1..]
        .find("<urn:oxidal:plugin:motion#")
        .map_or(rest.len(), |at| at + 1);
    &rest[..end]
}

fn check(kind: &str, name: &str, audio: &[(&str, &str)]) {
    let text = section(kind);
    assert!(text.contains(&format!("doap:name \"Oxidal Motion ({name})\"")));
    assert!(text.contains("lv2:ModulatorPlugin") && text.contains("rdfs:comment"));
    for banned in [
        "ext/atom",
        "ext/state",
        "ext/worker",
        "requiredFeature",
        "reportsLatency",
        "OutputPort, lv2:ControlPort",
    ] {
        assert!(!text.contains(banned), "{kind} mentions {banned}");
    }
    let controls: Vec<&str> = text
        .lines()
        .filter(|line| line.contains("lv2:ControlPort"))
        .collect();
    assert_eq!(controls.len(), CONTROLS.len(), "{kind} control count");
    for (index, (line, control)) in controls.iter().zip(CONTROLS).enumerate() {
        assert!(line.contains("lv2:InputPort"), "{}", control.symbol);
        assert_eq!(
            number(line, "lv2:index "),
            index as f32,
            "{}",
            control.symbol
        );
        assert_eq!(field(line, "lv2:symbol "), control.symbol);
        assert_eq!(
            number(line, "lv2:minimum "),
            control.minimum,
            "{}",
            control.symbol
        );
        assert_eq!(
            number(line, "lv2:maximum "),
            control.maximum,
            "{}",
            control.symbol
        );
        assert_eq!(
            number(line, "lv2:default "),
            control.default,
            "{}",
            control.symbol
        );
        assert!(!field(line, "lv2:name ").is_empty());
        let logarithmic = line.contains("port-props#logarithmic");
        assert_eq!(logarithmic, control.symbol == "rate");
        assert!(!logarithmic || control.minimum > 0.0);
    }
    let ports: Vec<&str> = text
        .lines()
        .filter(|line| line.contains("lv2:AudioPort"))
        .collect();
    assert_eq!(ports.len(), audio.len(), "{kind} audio port count");
    for (offset, (line, (direction, symbol))) in ports.iter().zip(audio).enumerate() {
        assert!(line.contains(direction), "{symbol}");
        assert_eq!(number(line, "lv2:index "), (CONTROLS.len() + offset) as f32);
        assert_eq!(field(line, "lv2:symbol "), *symbol);
    }
    // Scale points, in file order: the modes, the divisions, the shapes.
    let labels: Vec<&str> = text
        .split("rdfs:label \"")
        .skip(1)
        .map(|rest| &rest[..rest.find('"').unwrap_or(0)])
        .collect();
    let mut expected: Vec<&str> = Mode::ALL.iter().map(|mode| mode.name()).collect();
    expected.extend(DIVISIONS.iter().map(|(name, _)| *name));
    expected.extend(["A", "B", "C"]);
    assert_eq!(labels, expected, "{kind} scale points");
    for (list, start) in [(Mode::ALL.len(), 0), (DIVISIONS.len(), Mode::ALL.len())] {
        for value in 0..list {
            let label = labels[start + value];
            assert!(
                text.contains(&format!("rdfs:label \"{label}\" ; <http://www.w3.org/1999/02/22-rdf-syntax-ns#value> {value} ]")),
                "{label} should have the value {value}"
            );
        }
    }
}

#[test]
fn the_control_table_matches_the_ttl_file() {
    check(
        "mono",
        "Mono",
        &[("lv2:InputPort", "in_l"), ("lv2:OutputPort", "out_l")],
    );
    check(
        "stereo",
        "Stereo",
        &[
            ("lv2:InputPort", "in_l"),
            ("lv2:InputPort", "in_r"),
            ("lv2:OutputPort", "out_l"),
            ("lv2:OutputPort", "out_r"),
        ],
    );
    assert_eq!(<Motion<1> as Plugin>::CONTROLS, CONTROLS.len());
    assert_eq!(<Motion<1> as Plugin>::CHANNELS, 1);
    assert_eq!(<Motion<2> as Plugin>::CHANNELS, 2);
    assert!(CONTROLS.len() <= 20);
    for control in CONTROLS {
        assert!(control.minimum < control.maximum);
        assert!((control.minimum..=control.maximum).contains(&control.default));
    }
}

#[test]
fn the_manifest_names_both_plugins_and_the_library() {
    let manifest = include_str!("../lv2/manifest.ttl");
    for kind in ["mono", "stereo"] {
        assert!(manifest.contains(&format!("<urn:oxidal:plugin:motion#{kind}> a lv2:Plugin")));
    }
    assert!(
        manifest.contains("lv2:binary <oxidal_motion.so>")
            && manifest.contains("rdfs:seeAlso <motion.ttl>")
    );
}
