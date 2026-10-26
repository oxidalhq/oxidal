#![cfg(feature = "native")]
use oxidal_lv2::{Plugin, World};
use std::path::Path;
const URI: &str = "urn:oxidal:test:contract";
#[test]
fn contract_features_lifetime_bounds_readback_and_poison() {
    let world = World::bundle(Path::new(env!("OXIDAL_LV2_FIXTURE"))).unwrap();
    let catalog = world.plugins(48000.0).unwrap();
    assert_eq!(catalog.len(), 3);
    let info = catalog.iter().find(|p| p.uri == URI).unwrap();
    assert!(info.unsupported.is_none());
    assert_eq!(info.ports.len(), 6);
    assert!(Plugin::new(&world, "urn:oxidal:test:unsupported", 48000.0, 64).is_err());
    assert!(Plugin::new(&world, URI, 48000.0, 63).is_err());
    let mut plugin = Plugin::new(&world, URI, 48000.0, 64).unwrap();
    drop(world); // Instance keeps metadata/library owner alive.
    assert!(plugin.set(0, 1.0).is_err());
    assert!(plugin.set(1000, 1.0).is_err());
    assert!(plugin.set(4, f32::NAN).is_err());
    assert!(plugin.set(4, 3.0).is_err());
    assert_eq!(plugin.set(4, 0.5).unwrap(), 0.5);
    let mut left = [0.5; 64];
    let mut right = [-0.25; 64];
    plugin.process(&mut left, &mut right).unwrap();
    assert_eq!(left, [0.25; 64]);
    assert_eq!(right, [-0.125; 64]);
    assert!(plugin.process(&mut [0.0; 32], &mut [0.0; 32]).is_err());
    plugin.set(4, 2.0).unwrap();
    assert!(plugin.process(&mut [f32::MAX; 64], &mut [0.0; 64]).is_err());
    assert!(plugin.process(&mut [0.0; 64], &mut [0.0; 64]).is_err());
    assert!(plugin.set(4, 1.0).is_err());
}
#[test]
fn independent_external_mono_amp_and_delay_preserve_stereo() {
    // Explicit qualification dependency: fail if the external corpus is absent.
    let root = std::env::var("OXIDAL_LV2_EXTERNAL_DIR")
        .expect("Use pnpm lv2:check with installed swh-lv2");
    let world = World::bundle(&Path::new(&root).join("amp-swh.lv2")).unwrap();
    let mut amp = Plugin::new(&world, "http://plugin.org.uk/swh-plugins/amp", 48000.0, 64).unwrap();
    amp.set(0, -6.0206).unwrap();
    let mut left = [0.5; 64];
    let mut right = [-0.25; 64];
    amp.process(&mut left, &mut right).unwrap();
    assert!(left.iter().all(|v| (*v - 0.25).abs() < 1e-5));
    assert!(right.iter().all(|v| (*v + 0.125).abs() < 1e-5));
    let world = World::bundle(&Path::new(&root).join("delay-swh.lv2")).unwrap();
    let mut delay = Plugin::new(
        &world,
        "http://plugin.org.uk/swh-plugins/delay_n",
        48000.0,
        64,
    )
    .unwrap();
    delay.set(3, 128.0 / 48000.0).unwrap();
    let mut left = [0.0; 64];
    let mut right = [0.0; 64];
    left[0] = 0.5;
    right[0] = -0.25;
    delay.process(&mut left, &mut right).unwrap();
    assert_eq!(left, [0.0; 64]);
    assert_eq!(right, [0.0; 64]);
    delay.process(&mut left, &mut right).unwrap();
    assert_eq!(left, [0.0; 64]);
    delay.process(&mut left, &mut right).unwrap();
    assert!((left[0] - 0.5).abs() < 1e-6);
    assert!((right[0] + 0.25).abs() < 1e-6);
    assert!(left[1..].iter().chain(&right[1..]).all(|v| *v == 0.0));
    // Asymmetric routing is explicitly unsupported, not silently downmixed.
    let world = World::bundle(&Path::new(&root).join("gverb-swh.lv2")).unwrap();
    assert!(
        Plugin::new(
            &world,
            "http://plugin.org.uk/swh-plugins/gverb",
            48000.0,
            64
        )
        .is_err()
    );
}
