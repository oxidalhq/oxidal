//! Signal comparison using the installed factory reverb on the target CPU.
//! No PCM device is opened. @see docs/factory-collection.md
use oxidal_engine::{
    ResidentSet, Session,
    protocol::{PreparedRecall, StartRig, SwitchCommand},
};
use oxidal_lv2::World;
use oxidal_presets::{Bundle, BundleStore};
use serde_json::json;
use std::{collections::BTreeMap, error::Error};
fn main() -> Result<(), Box<dyn Error>> {
    let world = World::discover()?;
    let uri = "http://guitarix.sourceforge.net/plugins/gx_zita_rev1_stereo#_zita_rev1_stereo";
    let plugin = world
        .plugins(48000.0)?
        .into_iter()
        .find(|p| p.uri == uri)
        .ok_or("Install GxZita_rev1-Stereo")?;
    let mut controls: BTreeMap<_, _> = plugin
        .ports
        .iter()
        .filter(|p| p.input && p.control)
        .map(|p| Ok((p.symbol.clone(), p.default.ok_or("Missing default")?)))
        .collect::<Result<_, &str>>()?;
    controls.insert("DRY_WET_MIX".into(), 1.0);
    controls.insert("MID_RT60".into(), 4.0);
    controls.insert("LOW_RT60".into(), 4.0);
    let edge = |a, ap, b, bp| json!({"from":{"node":a,"port":ap},"to":{"node":b,"port":bp}});
    let make = |name, preserve| -> Result<Bundle, Box<dyn Error>> {
        let m = json!({"format":"oxidal.preset","formatVersion":1,
          "id":"68448a6d-0168-4fc8-b337-c12959165271","name":name,
          "tone3000":{"instances":[]},"resources":[],"extensions":{},"requiredExtensions":[],
          "oxidal":{"graph":{"nodes":[
            {"id":"in","kind":"input","audioInputs":0,"audioOutputs":2},
            {"id":"fx","kind":"lv2","audioInputs":2,"audioOutputs":2,"instance":"fx","bypassed":false},
            {"id":"out","kind":"output","audioInputs":2,"audioOutputs":0}],
            "edges":[edge("in",0,"fx",0),edge("in",1,"fx",1),edge("fx",0,"out",0),edge("fx",1,"out",1)]},
            "lv2":[{"id":"fx","pluginUri":uri,"controls":controls,"assets":[],"requiredFeatures":[]}],
            "recall":{"tails":if preserve {"preserve"} else {"cut"}}}});
        Ok(Bundle::from_parts(
            serde_json::to_vec(&m)?,
            BTreeMap::new(),
        )?)
    };
    let root = std::env::temp_dir().join(format!("oxidal-real-tails-{}", std::process::id()));
    let store = BundleStore::new(root.clone());
    let mut evidence = vec![];
    for preserve in [false, true] {
        let a = store.save(&make("Outgoing", preserve)?)?;
        let b = store.save(&make("Incoming", true)?)?;
        let capture = oxidal_audio::AudioProbe {
            endpoint: "hw:CARD=Qualification,DEV=0".into(),
            direction: oxidal_audio::Direction::Capture,
            sample_rate: 48000,
            channels: 2,
            format: oxidal_audio::SampleFormat::S16,
            period_frames: 192,
            periods: 3,
        };
        let mut playback = capture.clone();
        playback.direction = oxidal_audio::Direction::Playback;
        let settings = StartRig {
            revision: a,
            recall: None,
            prepared: vec![PreparedRecall {
                revision: b.clone(),
                recall: None,
            }],
            midi: None,
            stream: oxidal_audio::StreamConfig {
                input: capture,
                output: playback,
                input_map: [0, 1],
                output_map: [0, 1],
                hear_yourself: true,
                levels: Default::default(),
            },
        };
        let mut rig = ResidentSet::new(&store, &world, &settings, 1 << 24)?;
        let mut reference = Session::new(make("Reference", true)?, &world, 48000.0, 192, 1 << 24)?;
        let (mut actual_energy, mut expected_energy, mut max_error) = (0.0f64, 0.0f64, 0.0f32);
        let mut durations = vec![];
        for block in 0..2000 {
            if block == 250 {
                let state = rig.snapshot();
                rig.switch(SwitchCommand {
                    session: state.session,
                    expected_revision: state.revision,
                    revision: b.clone(),
                    fade_frames: 480,
                })?;
            }
            let mut input = [0.0f32; 192];
            if block < 25 {
                for (i, s) in input.iter_mut().enumerate() {
                    *s = 0.05 * ((block * 192 + i) as f32 * 0.0576).sin();
                }
            }
            let (mut l, mut r, mut e, mut er) = ([0.0; 192], [0.0; 192], [0.0; 192], [0.0; 192]);
            let start = std::time::Instant::now();
            rig.process(&[&input, &input], &mut [&mut l, &mut r])?;
            durations.push(start.elapsed().as_secs_f64() * 1e6);
            reference.process(&[&input, &input], &mut [&mut e, &mut er])?;
            for i in 0..192 {
                assert!(l[i].is_finite() && r[i].is_finite());
                if block > 260 {
                    actual_energy += f64::from(l[i]).powi(2) + f64::from(r[i]).powi(2);
                    expected_energy += f64::from(e[i]).powi(2) + f64::from(er[i]).powi(2);
                    max_error = max_error.max((l[i] - e[i]).abs()).max((r[i] - er[i]).abs());
                }
            }
        }
        assert!(expected_energy > 1e-7, "No useful reference tail");
        if preserve {
            assert!(
                max_error < 1e-6,
                "Preserve lost real reverb history: {max_error}"
            );
        } else {
            assert!(
                actual_energy < expected_energy * 1e-12,
                "Cut negative control retains an audible tail"
            );
        }
        durations.sort_by(f64::total_cmp);
        evidence.push(json!({"preserve":preserve,"plugin":uri,"post_switch_energy":actual_energy,"reference_energy":expected_energy,"max_sample_error":max_error,"offline_process_us_p95":durations[1900],"offline_process_us_max":durations[1999]}));
    }
    std::fs::remove_dir_all(root)?;
    println!("{}", serde_json::to_string_pretty(&evidence)?);
    Ok(())
}
