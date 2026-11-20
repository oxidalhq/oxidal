#![cfg(feature = "native")]
//! Display metadata read from real LV2 description files by Lilv.
//! @see docs/lv2.md
use oxidal_lv2::{PluginCatalog, PluginInfo, Port, World};
use std::path::Path;

fn catalog() -> Vec<PluginInfo> {
    let world = World::bundle(Path::new(env!("OXIDAL_LV2_METADATA_FIXTURE"))).unwrap();
    let plugins = world.plugins(48000.0).unwrap();
    PluginCatalog {
        sample_rate: 48000,
        plugins: plugins.clone(),
    }
    .validate()
    .expect("every discovered record passes catalog validation");
    plugins
}
fn plugin(name: &str) -> PluginInfo {
    let uri = format!("urn:oxidal:test:{name}");
    catalog().into_iter().find(|p| p.uri == uri).unwrap()
}
fn port<'a>(info: &'a PluginInfo, symbol: &str) -> &'a Port {
    info.ports.iter().find(|p| p.symbol == symbol).unwrap()
}
const UNITS: &str = "http://lv2plug.in/ns/extensions/units#";

#[test]
fn catalog_and_lookup_only_admit_unambiguous_bundle_pngs() {
    let world = World::bundle(Path::new(env!("OXIDAL_LV2_METADATA_FIXTURE"))).unwrap();
    let plugins = catalog();
    for name in [
        "metadata-rich",
        "metadata-poor",
        "artwork-escape",
        "artwork-text",
        "artwork-remote",
        "artwork-two-guis",
        "artwork-two-thumbnails",
    ] {
        let uri = format!("urn:oxidal:test:{name}");
        let plugin = plugins.iter().find(|p| p.uri == uri).unwrap();
        let expected = (name == "metadata-rich")
            .then_some(&include_bytes!("fixtures/metadata/thumbnail.png")[..]);
        assert_eq!(plugin.artwork, expected.is_some(), "{}", plugin.uri);
        assert_eq!(
            world.artwork(&plugin.uri).unwrap().as_deref(),
            expected,
            "{}",
            plugin.uri
        );
    }
    assert!(world.artwork("urn:oxidal:test:unknown").unwrap().is_none());
}

#[test]
fn rich_plugin_reports_names_units_groups_priority_and_flags() {
    let info = plugin("metadata-rich");
    assert_eq!(
        info.comment.as_deref(),
        Some("Line one.\nLine two\tafter a tab.")
    );
    assert_eq!(
        info.homepage.as_deref(),
        Some("https://example.org/oxidal/rich")
    );

    let time = port(&info, "time");
    assert_eq!(time.name.as_deref(), Some("Delay time"));
    assert_eq!(time.unit.as_deref(), Some("ms"));
    assert_eq!(time.unit_uri.as_deref(), Some(&*format!("{UNITS}ms")));
    assert_eq!(time.group.as_deref(), Some("Echo"));
    assert_eq!(
        time.group_uri.as_deref(),
        Some("urn:oxidal:test:group:echo")
    );
    assert_eq!(time.group_symbol.as_deref(), Some("echo"));
    assert_eq!(time.display_priority, Some(1));

    // A unit written inside the port has its own symbol and no address.
    let ratio = port(&info, "ratio");
    assert_eq!(ratio.unit.as_deref(), Some("pts"));
    assert_eq!(ratio.unit_uri, None);
    assert_eq!(ratio.display_priority, Some(0));

    for (symbol, unit) in [
        ("low_cut", "Hz"),
        ("high_cut", "kHz"),
        ("level", "dB"),
        ("mix", "%"),
        ("pitch", "semi"),
        ("speed", "BPM"),
    ] {
        assert_eq!(port(&info, symbol).unit.as_deref(), Some(unit), "{symbol}");
    }
    assert_eq!(port(&info, "level").display_priority, Some(i32::MAX));
    assert!(port(&info, "level").output);
}

#[test]
fn inline_groups_with_one_label_keep_their_own_symbols() {
    let info = plugin("metadata-rich");
    let (low, high) = (port(&info, "low_cut"), port(&info, "high_cut"));
    assert_eq!(low.group.as_deref(), Some("Filter"));
    assert_eq!(high.group.as_deref(), Some("Filter"));
    assert_eq!(low.group_symbol.as_deref(), Some("low"));
    assert_eq!(high.group_symbol.as_deref(), Some("high"));
    assert_eq!((&low.group_uri, &high.group_uri), (&None, &None));
}

#[test]
fn only_the_enumeration_flag_makes_a_choice_and_scale_points_stay_exact() {
    let info = plugin("metadata-rich");
    let mode = port(&info, "mode");
    assert!(mode.enumeration);
    let labels: Vec<_> = mode.scale_points.iter().map(|p| p.label.as_str()).collect();
    assert_eq!(labels, ["Mono", "Stereo"]);
    // Named points alone do not turn a number into a choice.
    let shape = port(&info, "shape");
    assert!(!shape.enumeration);
    assert_eq!(shape.scale_points.len(), 2);
    assert!(port(&info, "secret").not_on_gui);
    assert!(!port(&info, "time").not_on_gui);
    assert!(!port(&info, "time").enumeration);
}

#[test]
fn raw_ranges_do_not_change_when_display_fields_are_present() {
    let info = plugin("metadata-rich");
    for symbol in ["time", "mix", "pitch", "level"] {
        let p = port(&info, symbol);
        assert_eq!(
            (p.minimum, p.maximum, p.default),
            (Some(0.0), Some(4.0), Some(0.0)),
            "{symbol}"
        );
        assert!(!p.integer && !p.toggled && !p.logarithmic);
    }
}

#[test]
fn plugin_without_display_metadata_gets_the_plain_fallback() {
    let info = plugin("metadata-poor");
    assert_eq!((&info.comment, &info.homepage), (&None, &None));
    let gain = port(&info, "gain");
    assert_eq!(gain.name.as_deref(), Some("Gain"));
    for field in [
        &gain.unit,
        &gain.unit_uri,
        &gain.group,
        &gain.group_uri,
        &gain.group_symbol,
    ] {
        assert_eq!(field, &None);
    }
    assert_eq!(gain.display_priority, None);
    assert!(!gain.not_on_gui && !gain.enumeration);
}

#[test]
fn ambiguous_values_are_left_out_instead_of_guessed() {
    let info = plugin("metadata-ambiguous");
    // Two homepages are unclear. Lilv 0.24 itself shows only one of two repeated text or
    // number values (comment, priority, unit symbol), so those cannot be recognised.
    assert_eq!(info.homepage, None);
    let two_units = port(&info, "two_units");
    assert_eq!((&two_units.unit, &two_units.unit_uri), (&None, &None));
    let two_groups = port(&info, "two_groups");
    assert_eq!(
        (
            &two_groups.group,
            &two_groups.group_uri,
            &two_groups.group_symbol
        ),
        (&None, &None, &None)
    );
}

#[test]
fn invalid_oversized_or_wrongly_typed_values_are_left_out() {
    let info = plugin("metadata-invalid");
    assert_eq!((&info.comment, &info.homepage), (&None, &None));
    for symbol in [
        "negative_priority",
        "fraction_priority",
        "text_priority",
        "huge_priority",
    ] {
        assert_eq!(port(&info, symbol).display_priority, None, "{symbol}");
    }
    assert_eq!(port(&info, "long_name").name, None);
    assert_eq!(port(&info, "long_unit").unit, None);
    assert_eq!(port(&info, "line_unit").unit, None);
    assert_eq!(port(&info, "long_unit_uri").unit_uri, None);
    assert_eq!(port(&info, "string_unit").unit, None);
    // A group written inside the port needs a symbol; without one it is not reported.
    let unnamed = port(&info, "no_symbol_group");
    assert_eq!((&unnamed.group, &unnamed.group_symbol), (&None, &None));
    // An oversized label falls back to the group's own symbol.
    let long_label = port(&info, "long_label_group");
    assert_eq!(long_label.group.as_deref(), Some("long_label"));
    assert_eq!(long_label.group_symbol.as_deref(), Some("long_label"));
}

#[test]
fn homepage_with_credentials_or_a_text_value_is_left_out() {
    assert_eq!(plugin("metadata-credentials").homepage, None);
    let text = plugin("metadata-plugin-two");
    assert_eq!((&text.homepage, &text.comment), (&None, &None));
}
