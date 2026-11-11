//! Venue EQ profiles: built-in starting points and user profiles for the main
//! outputs, one active profile, bypass, and an owned preview. Every change is
//! revision-checked, so two clients cannot silently overwrite each other.
//! Edits are audible at once but saved only on Save; a reboot restores the
//! saved profile, never a preview. A preview left untouched for five minutes
//! (a phone that slept mid-soundcheck) crossfades back to the saved sound.
//! @see docs/media.md
use crate::{Shared, failure};
use axum::{
    Json,
    extract::{State, rejection::JsonRejection},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
};
use oxidal_audio::tools::HostUtility;
use oxidal_audio::venue::{VenueApplied, VenueBandSettings, VenueSettings};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::{Arc, Weak};
use std::time::{Duration, Instant};
use tokio::sync::{Mutex, watch};

/// The only destination today; profiles are keyed by it so per-output EQ can
/// follow without migrating files.
const MAIN: &str = "main";
const FLAT: &str = "builtin-flat";
const PREVIEW_TIMEOUT: Duration = Duration::from_secs(5 * 60);

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct VenueProfile {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub notes: String,
    /// Read-only starting point; Save makes a user copy.
    #[serde(default)]
    pub builtin: bool,
    #[serde(default)]
    pub updated_at: Option<String>,
    pub eq: VenueSettings,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct VenuePreview {
    /// The profile being edited.
    pub base: String,
    pub eq: VenueSettings,
    /// Temporarily hearing the saved profile instead of the edit.
    pub compare_saved: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct VenueState {
    pub revision: u64,
    pub destination: String,
    pub active: String,
    pub bypass: bool,
    pub profiles: Vec<VenueProfile>,
    pub preview: Option<VenuePreview>,
    /// Shown once, e.g. after an unsaved edit timed out.
    pub notice: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum VenueCommand {
    /// Switch the active profile (any preview is discarded).
    Activate {
        profile: String,
    },
    SetBypass {
        bypass: bool,
    },
    /// Hear an edit of the active profile now; not saved.
    Preview {
        eq: VenueSettings,
    },
    CompareSaved {
        saved: bool,
    },
    Revert,
    /// Save the preview into the active profile; a built-in becomes a copy.
    Save,
    /// Save the current sound as a new profile and make it active.
    SaveAs {
        name: String,
        #[serde(default)]
        notes: String,
    },
    Rename {
        profile: String,
        name: String,
        #[serde(default)]
        notes: Option<String>,
    },
    Duplicate {
        profile: String,
    },
    Delete {
        profile: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VenueRequest {
    pub expected_revision: u64,
    pub command: VenueCommand,
}

/// `venues.json`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Saved {
    schema: u32,
    revision: u64,
    active: BTreeMap<String, String>,
    bypass: BTreeMap<String, bool>,
    profiles: Vec<VenueProfile>,
}

#[derive(Debug)]
struct Inner {
    revision: u64,
    active: String,
    bypass: bool,
    user: Vec<VenueProfile>,
    preview: Option<VenuePreview>,
    touched: Instant,
    notice: Option<String>,
}

#[derive(Debug)]
pub struct Venues {
    inner: Mutex<Inner>,
    events: watch::Sender<VenueState>,
    path: PathBuf,
}

/// Starting points to tune by ear, not measured corrections.
pub(crate) fn builtins() -> Vec<VenueProfile> {
    let base = VenueSettings::default();
    let with = |id: &str, name: &str, notes: &str, edit: &dyn Fn(&mut [VenueBandSettings; 7])| {
        let mut eq = base;
        edit(&mut eq.bands);
        VenueProfile {
            id: id.into(),
            name: name.into(),
            notes: notes.into(),
            builtin: true,
            updated_at: None,
            eq,
        }
    };
    vec![
        with(FLAT, "Flat", "No correction", &|_| {}),
        with(
            "builtin-small-pa",
            "Small PA",
            "High-pass 80 Hz, high shelf −2 dB",
            &|b| {
                b[0].enabled = true;
                b[0].freq_hz = 80.0;
                b[5].gain_db = -2.0;
            },
        ),
        with(
            "builtin-boomy-room",
            "Boomy room",
            "High-pass 100 Hz, low mid −3 dB at 200 Hz",
            &|b| {
                b[0].enabled = true;
                b[0].freq_hz = 100.0;
                b[2].freq_hz = 200.0;
                b[2].gain_db = -3.0;
                b[2].q = 1.4;
            },
        ),
        with(
            "builtin-harsh-room",
            "Harsh room",
            "High mid −3 dB at 3 kHz, low-pass 12 kHz",
            &|b| {
                b[4].freq_hz = 3000.0;
                b[4].gain_db = -3.0;
                b[4].q = 2.0;
                b[6].enabled = true;
                b[6].freq_hz = 12_000.0;
            },
        ),
        with(
            "builtin-headphones",
            "Headphones",
            "High-pass 30 Hz",
            &|b| {
                b[0].enabled = true;
                b[0].freq_hz = 30.0;
            },
        ),
    ]
}

type Refusal = (StatusCode, String);

impl Inner {
    fn profiles(&self) -> Vec<VenueProfile> {
        builtins()
            .into_iter()
            .chain(self.user.iter().cloned())
            .collect()
    }
    fn profile(&self, id: &str) -> Option<VenueProfile> {
        self.profiles().into_iter().find(|p| p.id == id)
    }
    fn state(&self) -> VenueState {
        VenueState {
            revision: self.revision,
            destination: MAIN.into(),
            active: self.active.clone(),
            bypass: self.bypass,
            profiles: self.profiles(),
            preview: self.preview.clone(),
            notice: self.notice.clone(),
        }
    }
    /// What the outputs should hear now.
    fn applied(&self) -> VenueApplied {
        let saved = self
            .profile(&self.active)
            .map_or_else(VenueSettings::default, |p| p.eq);
        let settings = match &self.preview {
            Some(preview) if !preview.compare_saved => preview.eq,
            _ => saved,
        };
        VenueApplied {
            settings,
            bypass: self.bypass,
        }
    }
    fn saved(&self) -> Saved {
        Saved {
            schema: 1,
            revision: self.revision,
            active: BTreeMap::from([(MAIN.to_owned(), self.active.clone())]),
            bypass: BTreeMap::from([(MAIN.to_owned(), self.bypass)]),
            profiles: self.user.clone(),
        }
    }
}

fn valid_name(name: &str) -> Result<String, Refusal> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 60 || name.chars().any(char::is_control) {
        Err((
            StatusCode::UNPROCESSABLE_ENTITY,
            "Profile names are 1–60 characters".into(),
        ))
    } else {
        Ok(name.to_owned())
    }
}

impl Venues {
    pub fn load(path: PathBuf) -> Self {
        let saved: Option<Saved> = std::fs::read(&path)
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .filter(|s: &Saved| s.schema == 1);
        let mut inner = Inner {
            revision: 1,
            active: FLAT.into(),
            bypass: false,
            user: Vec::new(),
            preview: None,
            touched: Instant::now(),
            notice: None,
        };
        if let Some(saved) = saved {
            inner.revision = saved.revision.max(1);
            inner.user = saved
                .profiles
                .into_iter()
                .filter(|p| !p.builtin && p.id.starts_with("user-") && p.eq.validate().is_ok())
                .collect();
            if let Some(active) = saved.active.get(MAIN)
                && inner.profile(active).is_some()
            {
                inner.active = active.clone();
            }
            inner.bypass = saved.bypass.get(MAIN).copied().unwrap_or(false);
        }
        let (events, _) = watch::channel(inner.state());
        Self {
            inner: Mutex::new(inner),
            events,
            path,
        }
    }

    /// The saved sound, for the first stream start after boot.
    pub fn applied_now(&self) -> VenueApplied {
        self.inner.try_lock().map_or(
            VenueApplied {
                settings: VenueSettings::default(),
                bypass: false,
            },
            |inner| inner.applied(),
        )
    }

    pub fn subscribe(&self) -> watch::Receiver<VenueState> {
        self.events.subscribe()
    }

    async fn persist(&self, inner: &Inner) -> Result<(), Refusal> {
        let path = self.path.clone();
        let bytes = serde_json::to_vec_pretty(&inner.saved()).expect("venues serialize");
        let written = tokio::task::spawn_blocking(move || -> std::io::Result<()> {
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent)?;
            }
            let tmp = path.with_extension("json.tmp");
            std::fs::write(&tmp, bytes)?;
            std::fs::File::open(&tmp)?.sync_all()?;
            std::fs::rename(&tmp, &path)
        })
        .await;
        match written {
            Ok(Ok(())) => Ok(()),
            _ => Err((
                StatusCode::INSUFFICIENT_STORAGE,
                "Cannot save venue profiles: storage is full or read-only".into(),
            )),
        }
    }
}

/// Makes the outputs use the current sound: stored for the next stream start
/// and sent to the running worker, if any.
async fn apply(shared: &Shared, inner: &Inner, crossfade: bool) {
    let applied = inner.applied();
    shared.levels.set_venue(Some(applied));
    let _ = crate::player::send_utility(
        shared,
        HostUtility::Venue {
            venue: Some(applied),
            crossfade,
        },
    )
    .await;
}

fn new_user_id() -> String {
    format!("user-{}", crate::media::new_id())
}

pub(crate) async fn command(
    State(shared): State<Arc<Shared>>,
    body: Result<Json<VenueRequest>, JsonRejection>,
) -> Response {
    if let Some(reason) = shared.protect.refuse(false) {
        return crate::protect::locked(reason).into_response();
    }
    let Ok(Json(request)) = body else {
        return failure(StatusCode::BAD_REQUEST, "Send a venue command");
    };
    let venues = &shared.venues;
    let mut inner = venues.inner.lock().await;
    if request.expected_revision != inner.revision {
        // Someone else changed the venue EQ: show them both the current state.
        return (
            StatusCode::CONFLICT,
            [(header::CACHE_CONTROL, "no-store")],
            Json(inner.state()),
        )
            .into_response();
    }
    let before = (inner.active.clone(), inner.user.clone(), inner.bypass);
    let crossfade = match run(&mut inner, request.command) {
        Ok(crossfade) => crossfade,
        Err((status, reason)) => return failure(status, &reason),
    };
    inner.revision += 1;
    inner.notice = None;
    let saved_changed = before != (inner.active.clone(), inner.user.clone(), inner.bypass);
    if saved_changed && let Err((status, reason)) = venues.persist(&inner).await {
        return failure(status, &reason);
    }
    apply(&shared, &inner, crossfade).await;
    venues.events.send_replace(inner.state());
    (
        StatusCode::OK,
        [(header::CACHE_CONTROL, "no-store")],
        Json(inner.state()),
    )
        .into_response()
}

/// Applies one command; returns whether the sound should crossfade (true) or
/// glide (false, knob edits).
fn run(inner: &mut Inner, command: VenueCommand) -> Result<bool, Refusal> {
    let missing = || {
        (
            StatusCode::NOT_FOUND,
            "That venue profile no longer exists".to_owned(),
        )
    };
    match command {
        VenueCommand::Activate { profile } => {
            inner.profile(&profile).ok_or_else(missing)?;
            inner.active = profile;
            inner.preview = None;
            Ok(true)
        }
        VenueCommand::SetBypass { bypass } => {
            inner.bypass = bypass;
            Ok(true)
        }
        VenueCommand::Preview { eq } => {
            eq.validate()
                .map_err(|e| (StatusCode::UNPROCESSABLE_ENTITY, e))?;
            let was_comparing = inner.preview.as_ref().is_some_and(|p| p.compare_saved);
            inner.preview = Some(VenuePreview {
                base: inner.active.clone(),
                eq,
                compare_saved: false,
            });
            inner.touched = Instant::now();
            Ok(was_comparing)
        }
        VenueCommand::CompareSaved { saved } => {
            let preview = inner.preview.as_mut().ok_or((
                StatusCode::CONFLICT,
                "There is no unsaved edit to compare".to_owned(),
            ))?;
            preview.compare_saved = saved;
            inner.touched = Instant::now();
            Ok(true)
        }
        VenueCommand::Revert => {
            inner.preview = None;
            Ok(true)
        }
        VenueCommand::Save => {
            let preview = inner.preview.take().ok_or((
                StatusCode::CONFLICT,
                "There is no unsaved edit to save".to_owned(),
            ))?;
            let base = inner.profile(&preview.base).ok_or_else(missing)?;
            if base.builtin {
                let id = new_user_id();
                inner.user.push(VenueProfile {
                    id: id.clone(),
                    name: format!("{} (edited)", base.name),
                    notes: base.notes,
                    builtin: false,
                    updated_at: Some(crate::media::now_iso()),
                    eq: preview.eq,
                });
                inner.active = id;
            } else if let Some(profile) = inner.user.iter_mut().find(|p| p.id == preview.base) {
                profile.eq = preview.eq;
                profile.updated_at = Some(crate::media::now_iso());
            }
            Ok(false)
        }
        VenueCommand::SaveAs { name, notes } => {
            let name = valid_name(&name)?;
            let eq = inner.applied().settings;
            let id = new_user_id();
            inner.user.push(VenueProfile {
                id: id.clone(),
                name,
                notes: notes
                    .chars()
                    .filter(|c| !c.is_control() || *c == '\n')
                    .take(500)
                    .collect(),
                builtin: false,
                updated_at: Some(crate::media::now_iso()),
                eq,
            });
            inner.active = id;
            inner.preview = None;
            Ok(false)
        }
        VenueCommand::Rename {
            profile,
            name,
            notes,
        } => {
            let name = valid_name(&name)?;
            let target = inner.user.iter_mut().find(|p| p.id == profile).ok_or((
                StatusCode::CONFLICT,
                "Built-in profiles cannot be renamed".to_owned(),
            ))?;
            target.name = name;
            if let Some(notes) = notes {
                target.notes = notes.chars().take(500).collect();
            }
            target.updated_at = Some(crate::media::now_iso());
            Ok(false)
        }
        VenueCommand::Duplicate { profile } => {
            let source = inner.profile(&profile).ok_or_else(missing)?;
            inner.user.push(VenueProfile {
                id: new_user_id(),
                name: format!("{} copy", source.name).chars().take(60).collect(),
                notes: source.notes,
                builtin: false,
                updated_at: Some(crate::media::now_iso()),
                eq: source.eq,
            });
            Ok(false)
        }
        VenueCommand::Delete { profile } => {
            let before = inner.user.len();
            inner.user.retain(|p| p.id != profile);
            if inner.user.len() == before {
                return Err((
                    StatusCode::CONFLICT,
                    "Built-in profiles cannot be deleted".into(),
                ));
            }
            if inner.active == profile {
                inner.active = FLAT.into();
                inner.preview = None;
            }
            Ok(true)
        }
    }
}

pub(crate) async fn state(State(shared): State<Arc<Shared>>) -> Response {
    let state = shared.venues.inner.lock().await.state();
    (
        StatusCode::OK,
        [(header::CACHE_CONTROL, "no-store")],
        Json(state),
    )
        .into_response()
}

/// Keeps an unsaved preview alive while the editor is open.
pub(crate) async fn keep(State(shared): State<Arc<Shared>>) -> Response {
    let mut inner = shared.venues.inner.lock().await;
    if inner.preview.is_some() {
        inner.touched = Instant::now();
    }
    StatusCode::NO_CONTENT.into_response()
}

/// Discards a preview nobody has touched for five minutes.
pub(crate) fn expire(shared: Weak<Shared>) {
    tokio::spawn(async move {
        let mut timer = tokio::time::interval(Duration::from_secs(5));
        timer.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            timer.tick().await;
            let Some(shared) = shared.upgrade() else {
                break;
            };
            let mut inner = shared.venues.inner.lock().await;
            if inner.preview.is_some() && inner.touched.elapsed() > PREVIEW_TIMEOUT {
                inner.preview = None;
                inner.revision += 1;
                inner.notice = Some("Your unsaved venue edit was discarded".into());
                apply(&shared, &inner, true).await;
                shared.venues.events.send_replace(inner.state());
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn inner() -> Inner {
        Inner {
            revision: 1,
            active: FLAT.into(),
            bypass: false,
            user: Vec::new(),
            preview: None,
            touched: Instant::now(),
            notice: None,
        }
    }

    #[test]
    fn builtins_are_valid_and_match_their_labels() {
        let all = builtins();
        assert_eq!(all.len(), 5);
        for profile in &all {
            profile.eq.validate().unwrap();
            assert!(profile.builtin);
        }
        let boomy = all.iter().find(|p| p.id == "builtin-boomy-room").unwrap();
        assert!(boomy.eq.bands[0].enabled && boomy.eq.bands[0].freq_hz == 100.0);
        assert_eq!(
            (
                boomy.eq.bands[2].freq_hz,
                boomy.eq.bands[2].gain_db,
                boomy.eq.bands[2].q
            ),
            (200.0, -3.0, 1.4)
        );
        assert_eq!(all[0].eq, VenueSettings::default(), "Flat is flat");
    }

    #[test]
    fn preview_compare_save_and_revert_follow_the_design() {
        let mut v = inner();
        let mut edit = VenueSettings::default();
        edit.bands[3].gain_db = -4.0;
        assert!(
            !run(&mut v, VenueCommand::Preview { eq: edit }).unwrap(),
            "edits glide"
        );
        assert_eq!(v.applied().settings, edit, "audible at once");
        run(&mut v, VenueCommand::CompareSaved { saved: true }).unwrap();
        assert_eq!(
            v.applied().settings,
            VenueSettings::default(),
            "hear the saved one"
        );
        run(&mut v, VenueCommand::CompareSaved { saved: false }).unwrap();
        // Saving an edit of a built-in creates a user copy and keeps it active.
        run(&mut v, VenueCommand::Save).unwrap();
        assert_eq!(v.user.len(), 1);
        assert_eq!(v.user[0].name, "Flat (edited)");
        assert_eq!(v.active, v.user[0].id);
        assert_eq!(v.applied().settings, edit);
        // Revert drops an unsaved edit of a user profile.
        let mut louder = edit;
        louder.trim_db = -2.0;
        run(&mut v, VenueCommand::Preview { eq: louder }).unwrap();
        run(&mut v, VenueCommand::Revert).unwrap();
        assert_eq!(v.applied().settings, edit);
        assert!(run(&mut v, VenueCommand::Save).is_err(), "nothing to save");
        // Bypass is flat whatever is active.
        run(&mut v, VenueCommand::SetBypass { bypass: true }).unwrap();
        assert!(v.applied().bypass);
    }

    #[test]
    fn user_profiles_rename_duplicate_and_delete_back_to_flat() {
        let mut v = inner();
        run(
            &mut v,
            VenueCommand::Activate {
                profile: "builtin-small-pa".into(),
            },
        )
        .unwrap();
        run(
            &mut v,
            VenueCommand::SaveAs {
                name: "  Blue Note stage ".into(),
                notes: "PA tweeter harsh".into(),
            },
        )
        .unwrap();
        let id = v.active.clone();
        assert!(id.starts_with("user-"));
        assert_eq!(v.profile(&id).unwrap().name, "Blue Note stage");
        assert_eq!(
            v.profile(&id).unwrap().eq,
            v.profile("builtin-small-pa").unwrap().eq
        );
        run(
            &mut v,
            VenueCommand::Rename {
                profile: id.clone(),
                name: "Blue Note".into(),
                notes: None,
            },
        )
        .unwrap();
        run(
            &mut v,
            VenueCommand::Duplicate {
                profile: id.clone(),
            },
        )
        .unwrap();
        assert_eq!(v.user[1].name, "Blue Note copy");
        assert!(
            run(
                &mut v,
                VenueCommand::Rename {
                    profile: FLAT.into(),
                    name: "x".into(),
                    notes: None
                }
            )
            .is_err()
        );
        assert!(
            run(
                &mut v,
                VenueCommand::Delete {
                    profile: FLAT.into()
                }
            )
            .is_err()
        );
        assert!(
            run(
                &mut v,
                VenueCommand::SaveAs {
                    name: "".into(),
                    notes: String::new()
                }
            )
            .is_err()
        );
        run(&mut v, VenueCommand::Delete { profile: id }).unwrap();
        assert_eq!(
            v.active, FLAT,
            "deleting the active profile switches to Flat"
        );
        assert!(
            run(
                &mut v,
                VenueCommand::Activate {
                    profile: "user-gone".into()
                }
            )
            .is_err()
        );
        let mut bad = VenueSettings::default();
        bad.bands[0].freq_hz = 1000.0;
        assert!(run(&mut v, VenueCommand::Preview { eq: bad }).is_err());
    }
}
