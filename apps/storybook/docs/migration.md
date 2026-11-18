# Moving the product onto the design system

This maps every interface file in `apps/web/src` to the part of
`@oxidal/design-system` that replaces it, in the order to do it. The design
system lives in `packages/ui`; the product imports it as
`@oxidal/design-system/<folder>/<name>`.

The owner has visually approved the Storybook stories as the target for
`apps/web`. Deliver their screens and improved workflows, including backend
changes where required. Existing layouts, API limitations and test selectors
are implementation inputs, not the target UX. Preserve working sound, saved
data, edit ownership and recovery while adapting the implementation and tests.
The readiness table below describes the starting code, not permission to omit
an approved feature from the completed product.

## How the product connects

Two lines in `apps/web/src/styles.css`:

```css
@import '@oxidal/design-system/styles/theme.css'; /* in place of ./theme.css */
@source '../../../packages/ui/src'; /* so Tailwind sees the design system's classes */
```

Checked on 2026-11-18: with those two lines and three patterns imported
(`tool-dock`, `plugin-panel`, `sound-browser`), `pnpm --dir apps/web build`
succeeds and the built CSS contains the design system's classes. The design
system's theme has every token the product's `theme.css` has (99 of 99, same
names); three default values differ (`--popover`, `--panel-radius`,
`--display-radius`), so those surfaces change slightly when the theme is
swapped.

Both sides already share React 19, Tailwind 4, Radix, Recharts and Phosphor
at the same versions.

## Rules for every wave

- A design-system component takes data as props and reports changes through
  callbacks. The product keeps its API calls, feeds and stores (`api.ts`,
  `monitorFeed.ts`, `lib/*Feed.ts`, `useScreenSession.ts`, `workspaceMemory.ts`)
  and passes their values in. `*.demo.tsx` and `*.data.ts` files show the
  shape of that wiring; they are not exported.
- Replace a screen whole, with its tests, then delete its CSS file. Do not
  mix old and new parts inside one screen.
- Keep regression coverage of sound, data, ownership, recovery and supported
  operations. Adapt interaction steps, names and assertions to the approved UX;
  legacy layouts and selectors do not veto the rewrite.
- After each wave: `pnpm check` at the root, then try it on the Pi.

## Order

| Wave | What                                    | Why first                                                               |
| ---- | --------------------------------------- | ----------------------------------------------------------------------- |
| 0    | Theme and source lines; `App.tsx` shell | Everything else depends on the tokens and the shell                     |
| 1    | Primitives in `components/ui`           | Small, used everywhere, low risk                                        |
| 2    | Settings                                | Forms and lists; no audio risk; proves the wiring                       |
| 3    | Library                                 | Large list surface; run backend prerequisites before dependent sections |
| 4    | Guitars and Levels                      | Meters and Venue EQ reuse the product's maths                           |
| 5    | Stage                                   | Must be tried at a rehearsal before it ships                            |
| 6    | Rig                                     | Last: the most behaviour, and it waits on the engine work below         |

## Wave 0 and 1: shell and primitives

| Product file                                                                                                         | Replaced by                                                                                  |
| -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `theme.css`                                                                                                          | `styles/theme.css`                                                                           |
| `App.tsx` (frame, navigation), `ResourceStrip.tsx`, `RecoveryNotice.tsx`                                             | `patterns/app-shell`, `widgets/resource-strip`, `widgets/health-status`, `components/states` |
| `components/ui/button`, `badge`, `checkbox`, `dialog`, `select`, `slider`, `switch`, `tabs`, `toggle-group`, `chart` | Same names in `components/*` (`toggle-group` becomes `segmented` and `toggle`)               |
| `components/ui/confirm`, `NoticeTray`, `notices.ts`                                                                  | `components/confirm`, `components/notice-tray`, `notices`                                    |
| `components/ui/alert`, `failure`, `loading`, `state-notice`, `steps`                                                 | `components/states` (EmptyState, Progress, StepProgress, failure and loading states)         |
| `DragFader.tsx`, `TouchAdjust.tsx`, `AdjustmentDialog.tsx`, `SettingDialog.tsx`                                      | `components/number-field`, `components/slider`                                               |
| `GearIcon.tsx`, `blockGlyphs.ts`                                                                                     | `widgets/block-glyph`, `lib/block-glyphs` (a copy of the product's 38 glyphs)                |
| `components/media/StateChip.tsx`, `ToolRow.tsx`                                                                      | `components/badge`, `components/list-row`                                                    |

## Wave 2: Settings

| Product file                                                                                                                   | Replaced by                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| Settings frame in `App.tsx`                                                                                                    | `patterns/settings-page`, `components/text` (Description)                                  |
| `AudioSettings.tsx`, `HostAudioControls.tsx`, `AudioReconfigure.tsx`, `BufferFinder.tsx`                                       | `patterns/audio-change` (AudioChange, BufferFinder), `patterns/confirm-change`             |
| `BootPlayback.tsx`, `StorageLock.tsx`, `DebugConsole.tsx`, `WebTerminal.tsx`, `DevicePower.tsx`                                | `patterns/device-flows`                                                                    |
| `EngineSettings.tsx`, `NativeDefaults.tsx`, `EffectsPlaybackSettings.tsx`, `PlaybackSettings.tsx`, `MixedPlaybackSettings.tsx` | `patterns/engine-settings` (NamEngineSettings, BuiltInEffects)                             |
| `EffectPacks.tsx`                                                                                                              | `patterns/engine-settings` (PluginPacks)                                                   |
| `NetworkSettings.tsx`, `DeviceAccess.tsx`                                                                                      | `patterns/network-settings`, `patterns/confirm-change`, `patterns/device-access`           |
| `Tone3000Account.tsx`                                                                                                          | `patterns/tone3000` (Tone3000Account)                                                      |
| `MidiSettings.tsx`, `MidiMapScreen.tsx`, `ControllerSetup.tsx`, `ExtraControllers.tsx`, `SceneMidi.tsx`, `ControlAudit.tsx`    | `widgets/midi-map`, `widgets/midi`, `patterns/controller-setup`, `patterns/switch-layouts` |
| `About.tsx`                                                                                                                    | `patterns/about-page`, `patterns/credits`, `lib/credits`                                   |
| (new) Before you play                                                                                                          | `patterns/guitar-tools` (SoundCheck with a title)                                          |

## Wave 3: Library

| Product file                                                                                                                                                          | Replaced by                                                                    |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `Library.tsx`, `LibraryManagement.tsx`, `SavedRigs.tsx`, `features/library/PresetRow.tsx`, `components/media/MediaRow.tsx`                                            | `patterns/workspace`, `patterns/library-list`                                  |
| `features/library/NewPresetDialog`, `MineDialogs`, `DeleteSoundDialog`, `CreatedPreset`, `StarterOffer`, `OfflineEditor`; `PresetDetails.tsx`, `PresetManagement.tsx` | `patterns/preset-dialogs`                                                      |
| `features/library/oxidal/OxidalSounds`, `SoundCard`, `DetailsSheet`, `ToneLink`                                                                                       | `patterns/sound-browser`                                                       |
| `features/library/oxidal/GetTonesDialog`, `ModelLibrary.tsx`, `LibraryModelAudition.tsx`, `LibraryModelPreview.tsx`, `ModelPicker.tsx`                                | `patterns/tone3000` (GetTones), `patterns/library-list`, `patterns/swap-sheet` |
| `ToneDetails.tsx`, `AssetArtwork.tsx`                                                                                                                                 | `widgets/block-source` (SourceCard, SourceLine)                                |
| `components/media/BackingTracks`, `TrackDialogs`, `UploadQueue`                                                                                                       | `patterns/library-list`, `components/states`                                   |
| `components/media/StemSongs`, `StemMixEditor`, `StemMixer`, `StemImportForm`, `SongLinkControls`                                                                      | `patterns/stem-workspace`, `widgets/stem-strip`                                |
| `components/media/DiReamps`                                                                                                                                           | `patterns/device-flows` (DiReamps)                                             |
| Set list and Songbook sections of `Library.tsx`                                                                                                                       | `widgets/set-list-editor`, `widgets/sheet-viewer`, `lib/song`                  |

## Wave 4: Guitars and Levels

| Product file                                                                          | Replaced by                                         |
| ------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `GuitarSettings.tsx`, `SoundCheck.tsx`, `LevelMatch.tsx`, `EvenOut.tsx`               | `patterns/guitar-tools`                             |
| `MasterLevel.tsx`, `BoostControl.tsx`                                                 | `components/slider`, `widgets/meter`                |
| `components/media/VenueEq`, `VenueDialogs`, `BandEditor`, `EqGraph`; `lib/venueEq.ts` | `widgets/venue-eq`, `lib/venue-eq` (the same maths) |
| `Monitoring.tsx`, `MonitoringHistory.tsx`                                             | `patterns/device-dashboard`, `components/chart`     |
| `GlobalTuner.tsx`, `TunerButton.tsx`                                                  | `widgets/tuner-face`                                |

## Wave 5: Stage

| Product file                                                                                                                                     | Replaced by                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| `PerformView.tsx`, `features/stage/StageControls.tsx`, `PresetNavigation.tsx`, `RigPresetSelector.tsx`                                           | `widgets/footswitches`, `widgets/scene-pad`, `widgets/preset-step`, `widgets/meter` |
| `components/media/PlayerSheet`, `TransportBar`, `PositionBar`, `PracticeControls`, `NowPlaying`, `PerformPlayerRow`, `BackingPlayerControls.tsx` | `widgets/transport`, `widgets/practice`, `patterns/backing-panel`                   |
| (new) tools kept open beside any page                                                                                                            | `patterns/tool-dock`                                                                |

## Wave 6: Rig

| Product file                                                                                                                                                                        | Replaced by                                                                                                                      |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `LiveRig.tsx`, `MixedRig.tsx`, `features/rig/RigHeader`, `RigHeaderDuplicate`, `RigChainSurface`, `components/RouteTree`, `ChainView.tsx`, `SignalChain.tsx`, `components/RigSheet` | `patterns/rig-surface`, `widgets/route-view`, `widgets/chain`, `lib/route`                                                       |
| `features/rig/SelectedBlockPanel`, `ControlGrid`, `ControlAdjustDialog`, `SelectedModelControls`; `ControlEditor.tsx`, `NativeEditor.tsx`, `LiveEq.tsx`                             | `widgets/block-editor`, `widgets/visual-control`, `widgets/ir-facts`, `patterns/plugin-panel`, `patterns/device-flows` (BlockEq) |
| `AddBlockChooser.tsx`, `SlotChooser.tsx`, `features/rig/RigChoosers`, `RigChainSurfaceChooser`                                                                                      | `patterns/block-chooser`, `patterns/swap-sheet`                                                                                  |
| `features/rig/PathLevel`, `PathLevelsDialog`                                                                                                                                        | Split popover in `widgets/route-view`                                                                                            |
| `features/rig/SceneEditor`, `SceneEditorControls`, `SceneEditorMenu`; `ScenePads.tsx`, `SceneChange.tsx`                                                                            | `widgets/scene-editor`, `widgets/scene-manager`, `widgets/scene-pad`, `widgets/scene-change`, `lib/scene`                        |
| `NativeAuthoring.tsx`, `NativeTools.tsx`, `NativeSplitDialog.tsx`                                                                                                                   | `patterns/nam-block`                                                                                                             |
| `RigComposer.tsx`, `GraphAuthor.tsx`                                                                                                                                                | `patterns/rig-surface` (editing a preset without playing it)                                                                     |

## Stylesheets

The screen tables above name 141 of the 143 non-test TSX modules in the
starting product tree. The remaining two are retained integration owners:
`main.tsx` mounts the application, and
`components/media/SessionMediaProvider.tsx` owns shared media state. Keep their
provider lifetimes while replacing the presentation. Paths in grouped rows are
relative to `apps/web/src`; a shortened filename uses the same directory as
the preceding full path.

Keep API adapters, stores, feeds, native/graph/mixed edit ownership and their
tests even when their presenting TSX file disappears. In particular, preserve
`api.ts`, `monitorFeed.ts`, `lib/*Feed.ts`, `useScreenSession.ts`,
`workspaceMemory.ts`, and the route/state adapters under `features/rig`.
Move or adapt behaviour tests with each screen rather than deleting them with
its stylesheet. Import runtime exports through the package's declared paths;
do not import Storybook demos/data as product defaults. The package does not
serve the product's public assets: retain `apps/web/public/brand` and the
device-served source artwork.

The table accounts for all 26 starting CSS files. A stylesheet goes when the
last screen that uses it has moved. Shared theme adoption and a Settings frame
do not establish whole-screen adoption for the still-unmigrated page bodies.

| Wave                    | Stylesheets removed                                                                                                                                                                                                                                         |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0                       | `theme.css`                                                                                                                                                                                                                                                 |
| 3                       | `Library.css`, `LibraryManagement.css`, `ToneDetails.css`, `PresetPicker.css`, `features/library/StarterOffer.css`, `features/library/oxidal/oxidal.css`                                                                                                    |
| 4                       | `GuitarSettings.css`, `SoundCheck.css`, `MasterLevel.css`, `Monitoring.css`, `Tuner.css`, `components/media/venue.css`                                                                                                                                      |
| 5 / last media consumer | `PerformView.css`, `components/media/media.css`                                                                                                                                                                                                             |
| 6                       | `ChainView.css`, `RigControls.css`, `RigComposer.css`, `RigTools.css`, `ScenePads.css`, `components/RouteTree.css`, `components/RigSheet.css`, `features/rig/RigHeaderDuplicate.css`, `features/rig/SceneEditor.css`, `features/rig/SelectedBlockPanel.css` |
| Last                    | `styles.css` shrinks to the two connection lines and the Tailwind import                                                                                                                                                                                    |

## What the design shows that the product cannot do yet

The following is a source inventory, not runtime or hardware qualification.
Intermediate unavailable states allow incremental integration; they do not
satisfy an approved workflow. Backend prerequisites run before their consumers,
even though the visual screen order above stays the same. Recheck readiness
against actual handlers and confirmed readback rather than the presence of a
story or exported component.

| Design feature                                                       | Status                            | What is missing                                                                                                                                           | Fallback until then                                                                               |
| -------------------------------------------------------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Other screens in waves 0 to 5                                        | Audit per screen                  | Existing stores can be reused, but reference compositions do not prove complete command paths                                                             | Preserve truthful states while connecting the approved workflows                                  |
| Tool dock (pinned backing track, chord sheet, Venue EQ, tuner)       | Needs product integration         | Add shell placement/open-state ownership, preserve existing media/tuner/EQ owners, and implement chord-sheet storage; viewer memory alone is insufficient | Connect each supported tool to its confirmed owner before enabling it                             |
| Mute my part in the backing panel                                    | Ready                             | It sets one stem's mute in the live stem mix the player already has                                                                                       | Hidden for tracks without stems                                                                   |
| Scene grid: branch levels per scene                                  | Ready                             | Scenes already store merge gains                                                                                                                          |                                                                                                   |
| Scene grid: any block on or off per scene                            | Needs engine work                 | Current scenes set LV2 controls, not generic bypass; NAM, IR and Oxidal block state needs versioned support                                               | Intermediate: only qualified existing operations; do not imply every LV2 plugin has a bypass port |
| Scene values per block                                               | Needs engine work                 | Works for LV2 controls today (32 per scene); TONE3000 capture controls are not scene controls                                                             | Offer it on LV2 blocks only                                                                       |
| A scene that plays any mix of branches                               | Ready                             | Product scenes are one branch each today; the format already allows any mix of merge gains                                                                |                                                                                                   |
| Sleep silent branches                                                | Needs engine work                 | Every ready branch processes; only whole presets sleep today                                                                                              | Leave the switch out                                                                              |
| Move, add or remove a block while playing, with no gap               | Needs engine work                 | LV2 nodes cannot be inserted, removed or reordered live                                                                                                   | Apply the edit with the short restart the product has                                             |
| Trails between presets                                               | Needs a measurement               | Ready presets crossfade already; gapless is not yet measured on the Pi                                                                                    | Say "ready to switch", not "no gap"                                                               |
| LV2 plugin panel: names, units, groups, hidden controls              | Needs API fields                  | The port record has symbol, range, flags and named values only: add `name`, `unit`, `group`, `display_priority`, `not_on_gui`                             | Label from the symbol, one list (the Bare story)                                                  |
| LV2 plugin panel: picture, description, website                      | Needs API fields                  | Add the plugin's comment, homepage and a picture served by the device                                                                                     | Block glyph and maker only                                                                        |
| Block source: TONE3000 creator's profile link                        | Needs an API field                | The creator record has a username only                                                                                                                    | Link to the tone's page                                                                           |
| Block source: LV2 pack licence                                       | Needs an API field                | The pack record has no licence                                                                                                                            | Leave the line out                                                                                |
| Network: download the device's certificate                           | Needs provisioning and UI wiring  | Package the original public CA, exact restricted HTTP/HTTPS routes and computed fingerprint; verify installed chain and retain credentials                | Report unavailable certificate data explicitly during integration                                 |
| Network: no browser warning at the Wi-Fi address                     | Existing certificate limitation   | The device certificate names only `oxidal.local` and `10.42.0.1`, and its signing key is not on the device                                                | Explain the Wi-Fi IP name mismatch and offer the covered addresses                                |
| Tuner: mute while tuning                                             | Ready                             | The tuner API takes `output_muted`; the choice is remembered in the browser                                                                               | None needed                                                                                       |
| Change sheet: search TONE3000 by list and gear                       | Ready                             | `tone3000Tones` takes `collection`, `gear`, `query` and `page`; `stageTone3000` plays a model before it is kept                                           | None needed                                                                                       |
| NAM and IR blocks: their controls                                    | Ready                             | Enabled, Normalize, Input gain, Output gain and Mix per stage; Bass, Middle and Treble are the tone controls                                              | None needed. There are no movable microphones: an IR is a fixed recording                         |
| Switch layouts: stomp, scene and preset modes per preset             | Needs API work                    | Device-local preset-keyed maps/templates already exist in `oxidal-presets/src/midi.rs`; extend them for modes/layouts and additional actions              | Existing real mappings during integration; approved modes remain required                         |
| Tap tempo note values and freeze on a switch                         | Needs API work                    | Tap exists; a note value per switch and a freeze action are new                                                                                           | Tap only                                                                                          |
| Processing card: cost per capture size before adding                 | Needs a measurement               | Per-size cost on the Pi 5 is not measured                                                                                                                 | Show the measured total only                                                                      |
| Step through amp, cab or pedal models in the block panel             | Ready                             | The product already swaps a block's model and auditions library models; loudness comes from the model's measured level                                    | Without a measured level, step without matching                                                   |
| Tone details: pictures, creator, gear, format, model counts, licence | Ready                             | All in the tone record the device already keeps, pictures included (fetched once, then served offline)                                                    |                                                                                                   |
| IR details: sample rate, bit depth, channels, length                 | Ready                             | In the model record (`audio`)                                                                                                                             |                                                                                                   |
| Chord sheets (Library › Songbook, Stage, the dock)                   | Needs API work                    | The product has no chord sheets: add storage, a list and a link to a track; the parser is `lib/song`                                                      | Leave Songbook and the dock's Chord sheet out                                                     |
| Count-in; markers that change scene with the song                    | Needs API work                    | The player knows beats, not sections                                                                                                                      | Leave out                                                                                         |
| Device dashboard: per-core history and audit log                     | Mixed                             | Aggregate CPU/history and audit already exist; per-core history/assignment and some storage readings need actual backend data                             | Mark unsupported/empty readings; implement required data instead of fixture numbers               |
| Named preset versions and default, Saved/Edited listening            | Needs storage/API and integration | Superseded saved revisions are not named versions; the shared controlled comparison contract must reach confirmed audio state                             | Connect real confirmed comparison and version Save/reopen before acceptance                       |
| Set-list version/starting-scene/track/sheet entries                  | Needs storage/API                 | Current membership/order and logical song links need stable entry and version identities, migration and explicit follow-save rules                        | Preserve current recall while integrating richer entries                                          |
| Audio Keep/Revert countdown                                          | Needs backend transaction         | Current apply/failure rollback does not establish browser-independent timed confirmation                                                                  | Do not claim automatic timeout rollback until device-owned state exists                           |
| Editable looping DI as live input                                    | Needs audio/API work              | Current finite reamp writes a result and locks rig edits                                                                                                  | A separate audition-input lifecycle; not implicit relaxation of recording guards                  |

## Runtime contract corrections before screen integration

- `RigSurface` must expose controlled scene/transition/comparison/tuner state
  and commands. Its local scene models and hearing badge cannot stand in for
  daemon readback. Change tracking must include model identity, branch gains,
  scene values and structure, not just scalar controls and bypass.
- Adapt route displays without losing stereo/pan/polarity/assets/plugin state.
  `apps/web/src/features/rig/graphRoute.ts` makes some display-only IDs: never
  use those projections to rebuild a graph. Scene sparse overrides need complete
  matching target sets and native units when written to the current format.
- Read real NAM size/settings descriptors. The Standard/Feather/Nano fixture
  labels have no agreed mapping to Lite/25%/50%/75%/Full; retain supported 8×
  oversampling, instance settings and channel mapping within the improved UX.
  Buffer arithmetic is not a measured round-trip delay.
- Network policies must represent the real Never/NoEthernet/NotAtHome/
  NoRemembered/Always choices and retain managed connection/transaction IDs.
  Public CA download also requires provisioning and restricted HTTP bootstrap;
  the existing image includes server certificates, not the original public CA.
- Share the current player/tuner/Venue EQ owners across pages and dock panels.
  Practice controls must not emit default loop/speed/click on mount; stem Undo/
  Redo must reach playback. Venue EQ needs active-profile/remote readback and
  working rename/duplicate/delete handlers, without applying the first profile
  merely because a panel mounted.
- Preserve complete real splitter/capture job lifecycles and the interactive
  unprivileged/admin terminals. The three-state stem example and output-only
  timed console are incomplete replacements.
- Keep Simple health visible during scrolling, preserve owned touch cancellation
  and touch Fine/restore, and separate persistent viewer placement from whether
  a dock panel is open. Missing/empty/stale data must render safely.
- Keep daemon-owned MIDI with input identity, relative/gate/toggle semantics and
  browser-closed operation. Storybook's mounted-handler dispatcher is not the
  product action service. New defaults retain existing saved maps.
- `main.tsx`, `SessionMediaProvider.tsx`, API/feed modules and native adapters
  remain integration code. Package imports do not copy public assets: verify
  web-served brand/source images and exclude demos/fixtures from runtime imports.
- The integrated Moment effect belongs in the catalogue, About and block panels:
  use its 24 real controls and memory-only loop semantics from
  `docs/native-moment.md`; the original four-effect fixture list is incomplete.
