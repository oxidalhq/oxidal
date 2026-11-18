# Moving the product onto the design system

This maps every interface file in `apps/web/src` to the part of
`@oxidal/design-system` that replaces it, in the order to do it. The design
system lives in `apps/storybook`; the product imports it as
`@oxidal/design-system/<folder>/<name>`.

## How the product connects

Two lines in `apps/web/src/styles.css`:

```css
@import '@oxidal/design-system/styles/theme.css'; /* in place of ./theme.css */
@source '../../storybook/src'; /* so Tailwind sees the design system's classes */
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
- Keep each product behaviour test; change only how it finds things (roles
  and names stay, class names go).
- After each wave: `pnpm check` at the root, then try it on the Pi.

## Order

| Wave | What                                    | Why first                                                       |
| ---- | --------------------------------------- | --------------------------------------------------------------- |
| 0    | Theme and source lines; `App.tsx` shell | Everything else depends on the tokens and the shell             |
| 1    | Primitives in `components/ui`           | Small, used everywhere, low risk                                |
| 2    | Settings                                | Forms and lists; no audio risk; proves the wiring               |
| 3    | Library                                 | Largest surface; needs no engine change                         |
| 4    | Guitars and Levels                      | Meters and Venue EQ reuse the product's maths                   |
| 5    | Stage                                   | Must be tried at a rehearsal before it ships                    |
| 6    | Rig                                     | Last: the most behaviour, and it waits on the engine work below |

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
| `NetworkSettings.tsx`                                                                                                          | `patterns/network-settings`, `patterns/confirm-change`                                     |
| `Tone3000Account.tsx`                                                                                                          | `patterns/tone3000` (Tone3000Account)                                                      |
| `MidiSettings.tsx`, `MidiMapScreen.tsx`, `ControllerSetup.tsx`, `ExtraControllers.tsx`, `SceneMidi.tsx`, `ControlAudit.tsx`    | `widgets/midi-map`, `widgets/midi`, `patterns/controller-setup`, `patterns/switch-layouts` |
| `About.tsx`                                                                                                                    | `patterns/credits`                                                                         |
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
| `features/rig/SelectedBlockPanel`, `ControlGrid`, `ControlAdjustDialog`, `SelectedModelControls`; `ControlEditor.tsx`, `NativeEditor.tsx`, `LiveEq.tsx`                             | `widgets/block-editor`, `widgets/visual-control`, `widgets/cab-mics`, `patterns/plugin-panel`, `patterns/device-flows` (BlockEq) |
| `AddBlockChooser.tsx`, `SlotChooser.tsx`, `features/rig/RigChoosers`, `RigChainSurfaceChooser`                                                                                      | `patterns/block-chooser`, `patterns/swap-sheet`                                                                                  |
| `features/rig/PathLevel`, `PathLevelsDialog`                                                                                                                                        | Split popover in `widgets/route-view`                                                                                            |
| `features/rig/SceneEditor`, `SceneEditorControls`, `SceneEditorMenu`; `ScenePads.tsx`, `SceneChange.tsx`                                                                            | `widgets/scene-editor`, `widgets/scene-manager`, `widgets/scene-pad`, `widgets/scene-change`, `lib/scene`                        |
| `NativeAuthoring.tsx`, `NativeTools.tsx`, `NativeSplitDialog.tsx`                                                                                                                   | `patterns/nam-block`                                                                                                             |
| `RigComposer.tsx`, `GraphAuthor.tsx`                                                                                                                                                | `patterns/rig-surface` (editing a preset without playing it)                                                                     |

## Stylesheets

A stylesheet goes when the last screen that uses it has moved.

| Wave | Stylesheets removed                                                                                                                           |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | `theme.css`                                                                                                                                   |
| 3    | `Library.css`, `LibraryManagement.css`, `ToneDetails.css`, `PresetPicker.css`                                                                 |
| 4    | `GuitarSettings.css`, `SoundCheck.css`, `MasterLevel.css`, `Monitoring.css`, `Tuner.css`                                                      |
| 5    | `PerformView.css`                                                                                                                             |
| 6    | `ChainView.css`, `RigControls.css`, `RigComposer.css`, `RigTools.css`, `ScenePads.css`, `components/RouteTree.css`, `components/RigSheet.css` |
| Last | `styles.css` shrinks to the two connection lines and the Tailwind import                                                                      |

## What the design shows that the product cannot do yet

Each design feature is one of: ready (today's API is enough), needs an API
field, or needs engine work. The interface can move first wherever it has a
fallback.

| Design feature                                                       | Status              | What is missing                                                                                                               | Fallback until then                                                       |
| -------------------------------------------------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Everything in waves 0 to 5 not listed here                           | Ready               |                                                                                                                               |                                                                           |
| Tool dock (pinned backing track, chord sheet, Venue EQ, tuner)       | Ready               | Places are stored per viewer with `workspaceMemory.ts`                                                                        |                                                                           |
| Mute my part in the backing panel                                    | Ready               | It sets one stem's mute in the live stem mix the player already has                                                           | Hidden for tracks without stems                                           |
| Scene grid: branch levels per scene                                  | Ready               | Scenes already store merge gains                                                                                              |                                                                           |
| Scene grid: any block on or off per scene                            | Needs engine work   | A scene can set LV2 control values only; no per-scene bypass for NAM, IR or Oxidal effects                                    | Show on or off for LV2 blocks only                                        |
| Scene values per block                                               | Needs engine work   | Works for LV2 controls today (32 per scene); TONE3000 capture controls are not scene controls                                 | Offer it on LV2 blocks only                                               |
| A scene that plays any mix of branches                               | Ready               | Product scenes are one branch each today; the format already allows any mix of merge gains                                    |                                                                           |
| Sleep silent branches                                                | Needs engine work   | Every ready branch processes; only whole presets sleep today                                                                  | Leave the switch out                                                      |
| Move, add or remove a block while playing, with no gap               | Needs engine work   | LV2 nodes cannot be inserted, removed or reordered live                                                                       | Apply the edit with the short restart the product has                     |
| Trails between presets                                               | Needs a measurement | Ready presets crossfade already; gapless is not yet measured on the Pi                                                        | Say "ready to switch", not "no gap"                                       |
| LV2 plugin panel: names, units, groups, hidden controls              | Needs API fields    | The port record has symbol, range, flags and named values only: add `name`, `unit`, `group`, `display_priority`, `not_on_gui` | Label from the symbol, one list (the Bare story)                          |
| LV2 plugin panel: picture, description, website                      | Needs API fields    | Add the plugin's comment, homepage and a picture served by the device                                                         | Block glyph and maker only                                                |
| Block source: TONE3000 creator's profile link                        | Needs an API field  | The creator record has a username only                                                                                        | Link to the tone's page                                                   |
| Block source: LV2 pack licence                                       | Needs an API field  | The pack record has no licence                                                                                                | Leave the line out                                                        |
| Network: download the device's certificate                           | Needs an API field  | The image build makes `ca.crt`, but the device does not serve it or its fingerprint                                           | Hide the download; keep the steps and the addresses                       |
| Network: no browser warning at the Wi-Fi address                     | Needs engine work   | The device certificate names only `oxidal.local` and `10.42.0.1`, and its signing key is not on the device                    | The page says the browser warns at this address                           |
| Tuner: mute while tuning                                             | Ready               | The tuner API takes `output_muted`; the choice is remembered in the browser                                                   | None needed                                                               |
| Change sheet: search TONE3000 by list and gear                       | Ready               | `tone3000Tones` takes `collection`, `gear`, `query` and `page`; `stageTone3000` plays a model before it is kept               | None needed                                                               |
| NAM and IR blocks: their controls                                    | Ready               | Enabled, Normalize, Input gain, Output gain and Mix per stage; Bass, Middle and Treble are the tone controls                  | None needed. There are no movable microphones: an IR is a fixed recording |
| Switch layouts: stomp, scene and preset modes per preset             | Needs API work      | Mappings are device-scoped today; a per-preset layout and a mode switch are new                                               | One layout per controller                                                 |
| Tap tempo note values and freeze on a switch                         | Needs API work      | Tap exists; a note value per switch and a freeze action are new                                                               | Tap only                                                                  |
| Processing card: cost per capture size before adding                 | Needs a measurement | Per-size cost on the Pi 5 is not measured                                                                                     | Show the measured total only                                              |
| Step through amp, cab or pedal models in the block panel             | Ready               | The product already swaps a block's model and auditions library models; loudness comes from the model's measured level        | Without a measured level, step without matching                           |
| Tone details: pictures, creator, gear, format, model counts, licence | Ready               | All in the tone record the device already keeps, pictures included (fetched once, then served offline)                        |                                                                           |
| IR details: sample rate, bit depth, channels, length                 | Ready               | In the model record (`audio`)                                                                                                 |                                                                           |
| Chord sheets (Library › Songbook, Stage, the dock)                   | Needs API work      | The product has no chord sheets: add storage, a list and a link to a track; the parser is `lib/song`                          | Leave Songbook and the dock's Chord sheet out                             |
| Count-in; markers that change scene with the song                    | Needs API work      | The player knows beats, not sections                                                                                          | Leave out                                                                 |
| Device dashboard: per-core history and audit log                     | Ready               | `Monitoring` history and `ControlAudit` already carry them                                                                    |                                                                           |
