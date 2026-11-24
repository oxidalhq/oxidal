//! Offline reference rendering. Never opens an audio or MIDI device.
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Target {
    Tone3000 {
        id: String,
        owned: bool,
    },
    Scene {
        revision: String,
        scene: Option<String>,
    },
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Request {
    pub target: Target,
    pub stream: oxidal_audio::StreamConfig,
    pub peak_db: f32,
    pub seconds: f32,
}

#[cfg(feature = "native")]
pub fn measure(root: &std::path::Path, request: Request) -> Result<f32, String> {
    use oxidal_audio::tools::{HostSignal, HostUtility};
    use oxidal_tone3000::Engine;
    request.stream.validate()?;
    if !request.peak_db.is_finite()
        || !(-60.0..=0.0).contains(&request.peak_db)
        || !request.seconds.is_finite()
        || !(1.0..=30.0).contains(&request.seconds)
    {
        return Err("Invalid measurement duration or reference level".into());
    }
    let rate = request.stream.input.sample_rate;
    let frames = request.stream.input.period_frames as usize;
    enum Renderer {
        Native(Engine),
        Mixed(crate::ResidentSet),
    }
    let mut renderer = match request.target {
        Target::Tone3000 { id, owned } => {
            let bytes = if owned {
                oxidal_presets::OwnedStore::new(root.join("owned"))
                    .read(&id)
                    .map_err(|e| e.to_string())?
                    .1
            } else {
                oxidal_presets::Store::new(root.to_path_buf())
                    .original(&id)
                    .map_err(|e| e.to_string())?
            };
            let mut engine = Engine::new(f64::from(rate), frames).map_err(|e| e.to_string())?;
            engine.load_preset(&bytes).map_err(|e| e.to_string())?;
            engine.wait_ready().map_err(|e| e.to_string())?;
            Renderer::Native(engine)
        }
        Target::Scene { revision, scene } => {
            let store = oxidal_presets::BundleStore::new(root.join("bundles"));
            let world = oxidal_lv2::World::discover().map_err(|e| e.to_string())?;
            let settings = crate::protocol::StartRig {
                revision,
                stream: request.stream.clone(),
                recall: None,
                prepared: vec![],
                midi: None,
            };
            let mut rig = crate::ResidentSet::new_with_models(
                &store,
                &world,
                &settings,
                crate::protocol::BUFFER_BUDGET,
                Some(root),
            )?;
            if let Some(scene) = scene {
                rig.active_mut().prepare_initial_scene(scene)?;
            }
            Renderer::Mixed(rig)
        }
    };
    // Hold captures the preceding audio, so a fresh offline instance must hear
    // the riff before its saved Hold-on state is restored.
    // @see docs/native-hold.md
    let mut holds = Vec::new();
    if let Renderer::Mixed(rig) = &mut renderer {
        let session = rig.active_mut();
        for control in session.snapshot().controls {
            if let crate::protocol::Target::Lv2 { node, symbol } = &control.target
                && symbol == "hold"
                && control.value > 0.0
                && session
                    .bundle
                    .manifest()
                    .oxidal
                    .as_ref()
                    .is_some_and(|rig| {
                        rig.lv2.iter().any(|plugin| {
                            plugin.id == *node
                                && matches!(
                                    plugin.plugin_uri.as_str(),
                                    "urn:oxidal:plugin:hold#mono" | "urn:oxidal:plugin:hold#stereo"
                                )
                        })
                    })
            {
                holds.push((control.target, control.value));
            }
        }
        for (target, _) in &holds {
            let state = session.snapshot();
            session.apply(crate::protocol::ControlCommand {
                session: state.session,
                expected_revision: state.revision,
                target: target.clone(),
                value: 0.0,
            })?;
        }
    }
    let mut priming_frames = 0usize;
    let mut host = HostSignal::new(rate, false, request.stream.levels);
    host.command(HostUtility::Reference {
        enabled: true,
        peak_db: request.peak_db,
    });
    let mut left = vec![0.0; frames];
    let mut right = left.clone();
    let mut out_left = left.clone();
    let mut out_right = left.clone();
    // Pace background work below realtime. Low-priority scheduling is established
    // before processors are constructed so their threads inherit it too.
    let pause = std::time::Duration::from_secs_f64(frames as f64 / f64::from(rate));
    loop {
        host.input(&mut left, &mut right);
        match &mut renderer {
            Renderer::Native(engine) => {
                engine.pump().map_err(|e| e.to_string())?;
                engine
                    .process(&mut left, &mut right)
                    .map_err(|e| e.to_string())?;
            }
            Renderer::Mixed(rig) => {
                rig.process(&[&left, &right], &mut [&mut out_left, &mut out_right])?;
                rig.pump()?;
                left.copy_from_slice(&out_left);
                right.copy_from_slice(&out_right);
            }
        }
        if !holds.is_empty() {
            priming_frames += frames;
            if priming_frames >= rate as usize * 2 {
                if let Renderer::Mixed(rig) = &mut renderer {
                    let session = rig.active_mut();
                    for (target, value) in holds.drain(..) {
                        let state = session.snapshot();
                        session.apply(crate::protocol::ControlCommand {
                            session: state.session,
                            expected_revision: state.revision,
                            target,
                            value,
                        })?;
                    }
                }
                // Exclude the seed audio from the measured held scene.
                host = HostSignal::new(rate, false, request.stream.levels);
                host.command(HostUtility::Reference {
                    enabled: true,
                    peak_db: request.peak_db,
                });
            }
            std::thread::sleep(pause);
            continue;
        }
        host.output(&mut left, &mut right);
        if let Some(reading) = host.state().reference
            && reading.seconds >= request.seconds
        {
            return reading
                .lufs
                .filter(|v| v.is_finite())
                .ok_or_else(|| "The preset made no sound from the reference riff".into());
        }
        std::thread::sleep(pause);
    }
}

#[cfg(all(test, feature = "qualification"))]
mod tests {
    use super::*;
    use serde_json::json;

    /// A pad-only scene must capture reference audio before Hold is engaged.
    /// @see docs/native-hold.md
    #[test]
    fn measures_a_hold_only_pad_from_a_fresh_instance() {
        let root = std::env::temp_dir().join(format!("oxidal-hold-measure-{}", std::process::id()));
        let bundle = oxidal_presets::Bundle::from_parts(
            serde_json::to_vec(&json!({
                "format":"oxidal.preset","formatVersion":1,
                "id":"0b8f8d4e-9a39-4a43-a0f2-3c8f3b6d9a12","name":"Held pad measurement",
                "tone3000":{"instances":[]},"resources":[],"requiredExtensions":[],"extensions":{},
                "oxidal":{"graph":{"nodes":[
                    {"id":"in","kind":"input","audioInputs":0,"audioOutputs":2},
                    {"id":"hold","kind":"lv2","audioInputs":2,"audioOutputs":2,"instance":"hold","bypassed":false},
                    {"id":"out","kind":"output","audioInputs":2,"audioOutputs":0}],
                    "edges":[
                        {"from":{"node":"in","port":0},"to":{"node":"hold","port":0}},
                        {"from":{"node":"in","port":1},"to":{"node":"hold","port":1}},
                        {"from":{"node":"hold","port":0},"to":{"node":"out","port":0}},
                        {"from":{"node":"hold","port":1},"to":{"node":"out","port":1}}]},
                    "lv2":[{"id":"hold","pluginUri":"urn:oxidal:plugin:hold#stereo",
                        "controls":{"hold":1,"dry":0,"attack":10,"level":-6,"release":1500,"focus":80,"width":50},
                        "assets":[],"requiredFeatures":[]}],"recall":{"tails":"cut"}}
            }))
            .unwrap(),
            Default::default(),
        )
        .unwrap();
        let revision = oxidal_presets::BundleStore::new(root.join("bundles"))
            .save(&bundle)
            .unwrap();
        let probe = |direction| oxidal_audio::AudioProbe {
            endpoint: "nonexistent-measurement-device".into(),
            direction,
            sample_rate: 48000,
            channels: 2,
            format: oxidal_audio::SampleFormat::Float,
            period_frames: 256,
            periods: 3,
        };
        let lufs = measure(
            &root,
            Request {
                target: Target::Scene {
                    revision,
                    scene: None,
                },
                peak_db: -18.0,
                seconds: 1.0,
                stream: oxidal_audio::StreamConfig {
                    hear_yourself: false,
                    levels: Default::default(),
                    input: probe(oxidal_audio::Direction::Capture),
                    output: probe(oxidal_audio::Direction::Playback),
                    input_map: [0, 1],
                    output_map: [0, 1],
                    venue: None,
                },
            },
        )
        .unwrap();
        assert!((-60.0..0.0).contains(&lufs), "{lufs}");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn renders_reference_without_an_audio_device_and_tracks_amplitude() {
        let root =
            std::env::temp_dir().join(format!("oxidal-offline-measure-{}", std::process::id()));
        let edge = |port| json!({"from":{"node":"in","port":port},"to":{"node":"out","port":port}});
        let bundle = oxidal_presets::Bundle::from_parts(
            serde_json::to_vec(&json!({
                "format":"oxidal.preset","formatVersion":1,
                "id":"0b8f8d4e-9a39-4a43-a0f2-3c8f3b6d9a12","name":"Dry measurement",
                "tone3000":{"instances":[]},"resources":[],"requiredExtensions":[],"extensions":{},
                "oxidal":{"graph":{"nodes":[
                    {"id":"in","kind":"input","audioInputs":0,"audioOutputs":2},
                    {"id":"out","kind":"output","audioInputs":2,"audioOutputs":0}],
                    "edges":[edge(0),edge(1)]},"lv2":[],"recall":{"tails":"cut"}}
            }))
            .unwrap(),
            Default::default(),
        )
        .unwrap();
        let revision = oxidal_presets::BundleStore::new(root.join("bundles"))
            .save(&bundle)
            .unwrap();
        let probe = |direction| oxidal_audio::AudioProbe {
            endpoint: "nonexistent-measurement-device".into(),
            direction,
            sample_rate: 48000,
            channels: 2,
            format: oxidal_audio::SampleFormat::Float,
            period_frames: 256,
            periods: 3,
        };
        let stream = oxidal_audio::StreamConfig {
            hear_yourself: false,
            levels: Default::default(),
            input: probe(oxidal_audio::Direction::Capture),
            output: probe(oxidal_audio::Direction::Playback),
            input_map: [0, 1],
            output_map: [0, 1],
            venue: None,
        };
        let render = |peak_db| {
            measure(
                &root,
                Request {
                    target: Target::Scene {
                        revision: revision.clone(),
                        scene: None,
                    },
                    stream: stream.clone(),
                    peak_db,
                    seconds: 1.0,
                },
            )
            .unwrap()
        };
        let quiet = render(-24.0);
        let loud = render(-18.0);
        assert!(quiet.is_finite());
        assert!((loud - quiet - 6.0).abs() < 0.1, "{quiet} -> {loud}");
        std::fs::remove_dir_all(root).unwrap();
    }
}
