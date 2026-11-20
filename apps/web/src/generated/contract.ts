/* Generated from Rust. Run pnpm contract:generate; do not edit. */

export type AccountAction =
  | {
      client_id: string;
      kind: "connect";
    }
  | {
      kind: "cancel";
    }
  | {
      kind: "disconnect";
    };
export type AccountPhase = "disconnected" | "requesting" | "waiting" | "connected" | "reconnecting" | "error";
export type AudioChangeRequest =
  | {
      expected_revision: number;
      input: AudioProbe;
      /**
       * @minItems 2
       * @maxItems 2
       */
      input_map: [number, number];
      kind: "apply";
      output: AudioProbe;
      /**
       * @minItems 2
       * @maxItems 2
       */
      output_map: [number, number];
      owner: AudioChangeOwner;
      session: string;
    }
  | {
      id: string;
      kind: "keep";
    }
  | {
      id: string;
      kind: "revert";
    }
  | {
      id: string;
      kind: "stop";
    };
export type Direction = "capture" | "playback";
export type SampleFormat = "s16" | "s24" | "s24_packed" | "s32" | "float";
export type AudioChangeOwner = "native" | "mixed" | "effects";
export type AudioChangePhase = "idle" | "restarting" | "proving" | "reverting" | "kept" | "reverted" | "failed";
export type AudioAction =
  | {
      command: HostUtility;
      kind: "host_utility";
    }
  | {
      kind: "midi";
      settings?: Settings2 | null;
    }
  | {
      kind: "midi_test";
      message: Message;
    }
  | {
      kind: "midi_learn";
      on: boolean;
    }
  | {
      kind: "create";
      name: string;
      stream: StreamConfig;
    }
  | {
      kind: "start";
      settings: StartAudio;
    }
  | {
      kind: "load_preset";
      owned: boolean;
      preset_id: string;
    }
  | {
      kind: "stop";
    }
  | {
      kind: "restart";
    }
  | {
      kind: "resume";
    }
  | {
      kind: "reconfigure";
      stream: StreamConfig;
    }
  | {
      enabled: boolean;
      kind: "set_boot";
    }
  | {
      block_id: string;
      edit: EqEdit;
      kind: "set_eq";
    }
  | {
      kind: "set_control";
      target: string;
      value: number;
    }
  | {
      assignment: ModelAssignment;
      kind: "replace_model";
    }
  | {
      kind: "cancel_model";
      request: number;
    }
  | {
      kind: "save_copy";
      name: string;
    }
  | {
      keep: boolean;
      kind: "resolve_copy";
    }
  | {
      action: AuthoringAction;
      kind: "authoring";
    };
/**
 * Device/session utilities, deliberately outside native or portable tone state.
 */
export type HostUtility =
  | {
      enabled: boolean;
      kind: "hear_yourself";
    }
  | {
      enabled: boolean;
      kind: "output_mute";
    }
  | {
      kind: "output_mute_toggle";
    }
  | {
      enabled: boolean;
      kind: "tuner";
    }
  | {
      kind: "test_tone";
    }
  | {
      kind: "stop_test_tone";
    }
  | {
      kind: "levels";
      levels: HostLevels;
    }
  | {
      enabled: boolean;
      kind: "reference";
      peak_db: number;
    }
  | {
      command: BackingCommand;
      kind: "backing";
    }
  | {
      command: CaptureCommand;
      kind: "capture";
    }
  | {
      crossfade: boolean;
      kind: "venue";
      venue?: VenueApplied | null;
    };
export type BackingCommand =
  | {
      asset: MediaId;
      channels: number;
      click?: Click | null;
      frames: number;
      from: number;
      gain_db: number;
      kind: "play";
      range?: LoopRange | null;
      repeat: boolean;
      seq: number;
      speed?: number | null;
      /**
       * Play these stems mixed live instead of the asset's render.
       */
      stems?: StemMix2 | null;
    }
  | {
      /**
       * @minItems 6
       * @maxItems 6
       */
      gains: [number, number, number, number, number, number];
      kind: "stem_gains";
    }
  | {
      kind: "stop";
      seq: number;
    }
  | {
      gain_db: number;
      kind: "gain";
    }
  | {
      kind: "repeat";
      repeat: boolean;
    };
export type MediaId = string;
export type Click =
  | {
      bpm_tenths: number;
      first_frame: number;
      kind: "manual";
      level_db: number;
    }
  | {
      kind: "detected";
      level_db: number;
      timing: MediaId;
    };
export type CaptureCommand =
  | {
      kind: "record_di";
      output: MediaId;
      seq: number;
    }
  | {
      channel: number;
      /**
       * Channels in the source render, and which one to use.
       */
      channels: number;
      frames: number;
      kind: "reamp";
      latency_frames: number;
      /**
       * Hear the reamp while it runs; off mutes the outputs (not the result).
       */
      monitoring: boolean;
      output: MediaId;
      seq: number;
      source: MediaId;
      tail_frames: number;
      trim_and_gate: boolean;
    }
  | {
      keep: boolean;
      kind: "stop";
      seq: number;
    };
export type BranchMode = "toggle" | "gate";
export type Target2 =
  | {
      kind: "native";
      node: string;
      parameter: string;
    }
  | {
      kind: "lv2";
      node: string;
      symbol: string;
    }
  | {
      kind: "bypass";
      node: string;
    }
  | {
      kind: "merge";
      node: string;
      port: number;
    };
export type Message =
  | {
      channel: number;
      kind: "program";
      program: number;
    }
  | {
      channel: number;
      controller: number;
      kind: "control";
      value: number;
    };
/**
 * One immediate, revision-owned edit; UI cancellation sends its original value.
 */
export type EqEdit =
  | {
      kind: "reset";
    }
  | {
      kind: "enabled";
      value: boolean;
    }
  | {
      kind: "pre";
      value: boolean;
    }
  | {
      band: EqBand;
      index: number;
      kind: "band";
    };
export type EqType = "lowcut" | "lowshelf" | "bell" | "highshelf" | "highcut";
export type AuthoringAction =
  | {
      block_id: string;
      kind: "refresh_metadata";
      tone: any;
    }
  | {
      block_id: string;
      enabled: boolean;
      kind: "spectrum";
    }
  | {
      block_id: string;
      kind: "select_model";
      model_id: number;
    }
  | {
      block_id: string;
      edit: EqEdit;
      kind: "eq";
    }
  | {
      edit: LiveGesture;
      kind: "gesture";
    }
  | {
      command: Command4;
      kind: "utility";
    }
  | {
      block_id: string;
      kind: "copy";
    }
  | {
      kind: "inspect";
    }
  | {
      kind: "parameter";
      parameter: string;
      value: number;
    }
  | {
      edit: StructureEdit;
      kind: "edit";
    }
  | {
      block_id: string;
      kind: "remove";
    }
  | {
      kind: "undo";
    }
  | {
      kind: "redo";
    };
export type LiveGesture =
  | {
      owner: string;
      phase: "begin";
      target: string;
      token: string;
    }
  | {
      owner: string;
      phase: "preview";
      sequence: number;
      token: string;
      value: number;
    }
  | {
      owner: string;
      phase: "commit";
      sequence: number;
      token: string;
      value: number;
    }
  | {
      owner: string;
      phase: "cancel";
      token: string;
    };
export type Command4 =
  | {
      kind: "solo";
      side: Solo;
    }
  | {
      enabled: boolean;
      kind: "tuner";
    }
  | {
      kind: "balance";
    }
  | {
      kind: "align";
    }
  | {
      kind: "cancel";
    }
  | {
      kind: "poll";
    };
export type Solo = "none" | "left" | "right";
export type StructureEdit =
  | {
      kind: "reset";
    }
  | {
      kind: "swap";
    }
  | {
      index: number;
      kind: "paste";
      lane: ChainLane;
    }
  | {
      kind: "input";
      mode: InputMode;
    }
  | {
      block_ids: string[];
      kind: "reorder";
      lane: ChainLane;
    }
  | {
      block_id: string;
      index: number;
      kind: "move";
      lane: ChainLane;
    }
  | {
      block_id: string;
      index: number;
      kind: "duplicate";
      lane: ChainLane;
    }
  | {
      enabled: boolean;
      kind: "stereo";
    };
export type ChainLane = "left" | "right";
export type InputMode = "stereo" | "left" | "right" | "dual";
export type Phase2 = "idle" | "listening" | "done" | "timeout";
export type ModelPhase = "verifying" | "preparing" | "ready" | "applying" | "applied" | "failed" | "cancelled";
export type AudioPhase = "unavailable" | "stopped" | "starting" | "running" | "stopping" | "failed";
export type CalibrationAction = "run" | "run_all" | "cancel" | "reset";
export type CaptureKind = "di" | "reamp";
export type JobPhase = ("running" | "done" | "failed" | "cancelled") | "starting" | "finishing";
/**
 * One command entry point; relative edits are applied to current authoritative state.
 * @see docs/architecture.md
 */
export type Action =
  | {
      target: string;
      type: "set";
      value: number;
    }
  | {
      delta: number;
      target: string;
      type: "adjust";
    }
  | {
      rig: Rig;
      type: "routing";
    }
  | {
      file: MappingFile;
      type: "mappings";
    }
  | {
      input: MidiInput;
      type: "midi";
    }
  | {
      edit: Edit;
      type: "edit";
    };
export type BlockKind = ("input" | "nam" | "cabinet" | "lv2" | "delay" | "reverb" | "output") | "native";
/**
 * Scaling policy for a mapped absolute knob.
 * @see docs/architecture.md
 */
export type MidiCurve = "linear" | "logarithmic";
export type MidiMode = "absolute" | "relative_twos_complement";
export type Edit =
  | {
      owner: string;
      phase: "begin";
      target: string;
      token: string;
    }
  | {
      owner: string;
      phase: "preview";
      sequence: number;
      token: string;
      value: number;
    }
  | {
      owner: string;
      phase: "commit";
      sequence: number;
      token: string;
      value: number;
    }
  | {
      owner: string;
      phase: "cancel";
      token: string;
    };
export type Operation =
  | "native_audio"
  | "mixed_audio"
  | "effects_audio"
  | "effect_packs"
  | "storage"
  | "network"
  | "account"
  | "native_editor"
  | "native_defaults"
  | "preset_import"
  | "preset_library"
  | "rig_save"
  | "model_import"
  | "model_collection"
  | "model_download"
  | "controls";
export type Outcome = "accepted" | "rejected" | "failed";
export type Command2 =
  | {
      type: "status";
    }
  | {
      type: "enable";
    }
  | {
      type: "disable";
    }
  | {
      command: string;
      type: "run";
    }
  | {
      id: string;
      type: "cancel";
    };
export type PackAction = "install" | "remove";
export type GraphAudioAction =
  | {
      command: PluginDefaultsCommand;
      kind: "restore_plugin_defaults";
    }
  | {
      command: HostUtility;
      kind: "host_utility";
    }
  | {
      enabled: boolean;
      kind: "set_boot";
    }
  | {
      kind: "reconfigure";
      stream: StreamConfig;
    }
  | {
      kind: "configure";
      stream: StreamConfig;
    }
  | {
      kind: "start";
      settings: StartGraph;
    }
  | {
      kind: "stop";
    }
  | {
      kind: "restart";
    }
  | {
      kind: "save_copy";
      name: string;
    }
  | {
      command: Command;
      kind: "control";
    };
export type CaptureFault = "disk" | "source" | "overflow";
export type Framing = "legacy" | "current";
export type LibraryKind = ("original" | "owned" | "graph") | "rig";
export type LibraryAction =
  | {
      kind: "rename";
      name: string;
    }
  | {
      archived: boolean;
      kind: "visibility";
    }
  | {
      kind: "move";
      up: boolean;
    }
  | {
      before?: LibraryReference | null;
      kind: "place";
    }
  | {
      kind: "set_list";
      member: boolean;
    }
  | {
      entries: LibraryReference[];
      kind: "starter";
    }
  | {
      kind: "duplicate";
    };
export type MediaKind = "backing" | "di" | "reamp";
export type UploadFormat = "wav" | "mp3";
/**
 * Where a received file is in the import pipeline.
 */
export type ImportPhase =
  | {
      state: "receiving";
    }
  | {
      state: "queued";
    }
  | {
      progress: number;
      state: "preparing";
    }
  | {
      asset: string;
      state: "ready";
    }
  | {
      existing: string;
      state: "duplicate";
      title: string;
    }
  | {
      reason: string;
      state: "failed";
    };
/**
 * Which kind of preset assignment a [`Disabled`] marker refers to.
 */
export type AssignmentKind = "scene" | "branch" | "parameter";
export type MidiDirection = "previous" | "next";
export type EditorAction =
  | {
      id: string;
      kind: "load";
      owned: boolean;
    }
  | {
      kind: "begin";
      owner: string;
      target: string;
      token: string;
    }
  | {
      kind: "preview";
      owner: string;
      sequence: number;
      token: string;
      value: number;
    }
  | {
      kind: "commit";
      owner: string;
      sequence: number;
      token: string;
      value: number;
    }
  | {
      kind: "cancel";
      owner: string;
      token: string;
    }
  | {
      kind: "save";
      name: string;
    }
  | {
      block_id: string;
      kind: "remove_block";
    }
  | {
      edit: StructureEdit;
      kind: "structure";
    }
  | {
      kind: "undo";
    }
  | {
      kind: "redo";
    };
export type Command3 =
  | {
      action: PowerAction;
      type: "power";
    }
  | {
      expected_mode: StorageMode;
      type: "restart_storage";
    }
  | {
      type: "status";
    }
  | {
      type: "scan";
    }
  | {
      type: "network_capabilities";
    }
  | {
      interface: string;
      ssid: string;
      type: "join_open";
    }
  | {
      channel: number;
      country: string;
      interface: string;
      type: "hotspot_radio";
    }
  | {
      interface: string;
      type: "connect";
      uuid: string;
    }
  | {
      interface: string;
      password: string;
      ssid: string;
      type: "join";
    }
  | {
      channel?: number | null;
      country?: string | null;
      interface: string;
      password: string;
      ssid: string;
      type: "hotspot";
    }
  | {
      settings: Settings;
      type: "policy";
    }
  | {
      transaction: string;
      type: "confirm";
    }
  | {
      transaction: string;
      type: "cancel";
    }
  | {
      type: "forget";
      uuid: string;
    }
  | {
      type: "packs";
    }
  | {
      action: PackAction;
      id: string;
      type: "pack";
    }
  | {
      type: "storage_status";
    }
  | {
      mode: StorageMode;
      type: "storage";
    };
export type PowerAction = "reboot" | "shutdown";
export type StorageMode = "unlocked" | "locked";
export type Mode = "never" | "no_ethernet" | "not_at_home" | "no_remembered" | "always";
export type PlayerCommand =
  | {
      kind: "toggle_play";
    }
  | {
      kind: "play";
    }
  | {
      kind: "pause";
    }
  | {
      kind: "stop";
    }
  | {
      kind: "skip_by";
      seconds: number;
    }
  | {
      frame: number;
      kind: "seek_to";
    }
  | {
      kind: "previous";
    }
  | {
      kind: "next";
    }
  | {
      asset: MediaId;
      kind: "cue";
    }
  | {
      kind: "set_repeat";
      repeat: boolean;
    }
  | {
      kind: "set_practice_range";
      range?: LoopRange | null;
    }
  | {
      click?: Click | null;
      kind: "set_click";
    }
  | {
      kind: "set_speed";
      percent: number;
    }
  | {
      kind: "cue_stems";
      recipe: MixRecipe;
      source: MediaId;
      split: MediaId;
    }
  | {
      kind: "set_stem_mix";
      recipe: MixRecipe;
    }
  | {
      db: number;
      kind: "set_level";
    }
  | {
      delta_db: number;
      kind: "adjust_level";
    };
/**
 * The editable settings saved with a generated stereo mix.
 * @see docs/media.md#stem-mix-recipes
 */
export type MixRecipe =
  | {
      bass: StemMix;
      drums: StemMix;
      mode: "four";
      other: StemMix;
      vocals: StemMix;
    }
  | {
      bass: StemMix;
      drums: StemMix;
      guitar: StemMix;
      mode: "six";
      other: StemMix;
      piano: StemMix;
      vocals: StemMix;
    };
export type Origin = "ui" | "midi" | "api";
export type PlayerState = ("empty" | "ready" | "playing" | "paused" | "ended") | "interrupted" | "unavailable";
/**
 * The role from the split manifest, independent of the model's tensor order.
 */
export type StemRole = "vocals" | "drums" | "bass" | "other" | "guitar" | "piano";
export type RigAudioAction =
  | {
      command: PluginDefaultsCommand;
      kind: "restore_plugin_defaults";
    }
  | {
      command: HostUtility;
      kind: "host_utility";
    }
  | {
      command: AuthoringCommand;
      kind: "authoring";
    }
  | {
      enabled: boolean;
      kind: "set_boot";
    }
  | {
      kind: "start";
      settings: StartRig;
    }
  | {
      kind: "stop";
    }
  | {
      kind: "restart";
    }
  | {
      kind: "reconfigure";
      stream: StreamConfig;
    }
  | {
      command: ControlCommand;
      kind: "control";
    }
  | {
      command: EqCommand;
      kind: "eq";
    }
  | {
      command: SwitchCommand;
      kind: "switch";
    }
  | {
      command: SceneCommand;
      kind: "scene";
    }
  | {
      command: BranchCommand;
      kind: "branch";
    }
  | {
      kind: "midi";
      settings?: Settings2 | null;
    }
  | {
      kind: "midi_test";
      message: Message;
    }
  | {
      kind: "midi_learn";
      on: boolean;
    }
  | {
      command: ModelCommand;
      kind: "model";
    }
  | {
      kind: "save";
      name: string;
    };
export type ModelOperation =
  | {
      assignment: ModelAssignment;
      kind: "prepare";
    }
  | {
      kind: "poll";
    }
  | {
      kind: "commit";
    }
  | {
      kind: "cancel";
    };
export type PortableNodeKind = "input" | "output" | "tone3000" | "lv2" | "split" | "merge" | "gain";
export type PortableTails = "cut" | "preserve";
export type PortableResourceKind = "tone3000-preset" | "tone3000-source" | "lv2-state" | "lv2-asset";
export type PortablePartitionInput = "left" | "right";
export type PortableProcessingRole = "whole" | "amp" | "cab";
export type LibraryOrigin = "tone3000" | "oxidal_example" | "mine";
export type RigTopology = "serial" | "parallel" | "scenes";
export type ResourceSource =
  | {
      kind: "original";
      preset: string;
    }
  | {
      kind: "owned";
      preset: string;
    }
  | {
      kind: "bundle";
      resource: string;
      revision: string;
    };
export type SheetTarget =
  | {
      kind: "preset";
      preset: LibraryReference;
    }
  | {
      asset: string;
      kind: "track";
    };
export type SheetFormat = "chordpro" | "markdown" | "text";
/**
 * Stable failure kinds shared by every endpoint.
 * @see docs/architecture.md
 */
export type ErrorCode =
  "invalid" | "not_found" | "conflict" | "busy" | "locked" | "unavailable" | "timeout" | "storage" | "internal";
export type SplitMode = "four" | "six";
export type Phase = "running" | "ready" | "failed" | "cancelled" | "interrupted";
/**
 * What a running split is doing, with an overall percentage for one bar.
 */
export type SplitStage = "preparing" | "separating" | "saving";
export type Scope = "rig" | "set_list";
/**
 * What starts when Oxidal starts (7.25). `Pinned` keeps the exact saved
 * session; `Follow` replaces it with each preset the player explicitly plays.
 */
export type StartupPolicy = "off" | "follow" | "pinned";
export type StartupOwner = "native" | "mixed" | "effects";
export type TerminalCommand =
  | {
      cursor: number;
      id?: string | null;
      type: "read";
    }
  | {
      cols: number;
      id: string;
      rows: number;
      type: "start";
    }
  | {
      bytes: number[];
      id: string;
      sequence: number;
      type: "input";
    }
  | {
      cols: number;
      id: string;
      rows: number;
      type: "resize";
    }
  | {
      id: string;
      type: "end";
    };
/**
 * TONE3000 gear types a tone list can be narrowed to.
 */
export type Gear = "amp" | "amp-cab" | "pedal" | "outboard" | "cab" | "space" | "experimental";
export type VenueCommand =
  | {
      kind: "activate";
      profile: string;
    }
  | {
      bypass: boolean;
      kind: "set_bypass";
    }
  | {
      eq: VenueSettings;
      kind: "preview";
    }
  | {
      kind: "compare_saved";
      saved: boolean;
    }
  | {
      kind: "revert";
    }
  | {
      kind: "save";
    }
  | {
      kind: "save_as";
      name: string;
      notes?: string;
    }
  | {
      kind: "rename";
      name: string;
      notes?: string | null;
      profile: string;
    }
  | {
      kind: "duplicate";
      profile: string;
    }
  | {
      kind: "delete";
      profile: string;
    };

/**
 * Schema generation root. Rust wire types are the contract source of truth.
 * @see docs/architecture.md
 */
export interface Contract {
  account_command: AccountCommand;
  account_state: AccountState;
  artwork: AssetArtwork[];
  audio_change_request: AudioChangeRequest;
  audio_change_state: AudioChangeState;
  audio_command: AudioCommand;
  audio_devices: AudioDevices;
  audio_probe: AudioProbe;
  audio_probe_result: AudioProbeResult;
  audio_state: AudioState;
  boost_update: BoostUpdate;
  boosts: BoostState;
  calibration: CalibrationState;
  calibration_command: CalibrationCommand;
  calibration_coverage: CalibrationCoverage;
  capabilities: Capabilities;
  capture_state: CaptureState;
  capture_stop: StopRequest;
  command: Command;
  control_audit: AuditHistory;
  debug_command: Command2;
  debug_state: State;
  device_certificate: PublicCertificate;
  effect_packs: PackState;
  error: ApiError;
  graph_audio_command: GraphAudioCommand;
  graph_audio_state: GraphAudioState;
  graph_presets: SavedGraph[];
  guitars: Guitars;
  keep_ready: KeepReady;
  library: Library;
  library_catalog: LibraryCatalog;
  library_update: LibraryUpdate;
  local_model: LocalModel;
  local_model_page: LocalModelPage;
  lv2_catalog: PluginCatalog;
  media_asset_update: AssetUpdate;
  media_library: MediaLibrary;
  media_upload_request: UploadRequest;
  media_upload_state: UploadState;
  midi_action: MidiAction;
  midi_devices: Devices;
  midi_learn: MidiLearn;
  midi_map: MidiMap;
  midi_map_update: MidiMapUpdate;
  midi_navigate: MidiNavigate;
  midi_position: MidiPosition;
  midi_template_apply: MidiTemplateApply;
  midi_test: MidiTest;
  model_page: Page2;
  model_query: ModelQuery;
  model_removal_preview: ModelRemovalPreview;
  model_removal_request: ModelRemovalRequest;
  model_removal_result: ModelRemovalResult;
  monitoring: Monitoring;
  monitoring_history: History;
  native_command: EditorCommand;
  native_defaults: NativeDefaults;
  native_defaults_update: NativeDefaultsUpdate;
  native_editor: EditorSnapshot;
  network_command: Command3;
  network_state: NetworkState;
  player_order: PlayerOrder;
  player_request: PlayerRequest;
  player_snapshot: PlayerSnapshot;
  practice_timing: Timing;
  preset: Inspection;
  preset_details: DetailsCatalog;
  preset_details_update: DetailsUpdate;
  protect_state: ProtectState;
  reamp_request: ReampRequest;
  removal_preview: RemovalPreview;
  removal_request: RemovalRequest;
  removal_result: RemovalResult;
  rig: Rig;
  rig_audio_command: RigAudioCommand;
  rig_audio_state: RigAudioState;
  rig_document: RigDocument;
  rig_library: RigPage;
  rig_native_sources: RigNativeSource[];
  rig_publish: RigPublish;
  scene_blend_update: BlendUpdate;
  scene_blends: Blends;
  scene_draft: SceneDraftState;
  scene_draft_update: SceneDraftUpdate;
  sheet_archive: SheetArchive;
  sheet_delete: SheetDelete;
  sheet_document: SheetDocument;
  sheet_failure: SheetFailure;
  sheet_link_update: SheetLinkUpdate;
  sheet_links: SheetLinks;
  sheet_mutation: SheetMutation;
  sheet_page: SheetPage;
  sheet_references: SheetReferences;
  sheet_restore: SheetRestore;
  sheet_restored: SheetRestored;
  sheet_write: SheetWrite;
  snapshot: Snapshot;
  song_current_split: CurrentSplit;
  song_import_stems: ImportStems;
  song_link_update: Update;
  song_links: Links;
  song_list: SongList;
  song_mix_revision: MixRevision;
  song_save_mix: SaveMix;
  song_split_job: SplitJob;
  song_split_options: Options;
  song_start_split: StartSplit;
  song_view: SongView;
  stage_model: StageModel;
  staged_model: StagedModel;
  startup_state: StartupState;
  startup_update: StartupUpdate;
  storage_request: StorageRequest;
  storage_state: StorageState;
  terminal_command: TerminalCommand;
  terminal_state: TerminalState;
  tone_page: Page;
  tone_query: ToneQuery;
  tuner_state: TunerState;
  tuner_update: TunerUpdate;
  unit_levels: HostLevels;
  validation: Validation;
  venue_request: VenueRequest;
  venue_state: VenueState;
  voice_list: VoiceList;
  voice_ready: VoiceReady;
  voice_request: VoiceRequest;
}
export interface AccountCommand {
  action: AccountAction;
  expected_revision: number;
  session: string;
}
export interface AccountState {
  /**
   * Public application identifier, never the secret key or an access token.
   */
  client_id?: string | null;
  error?: string | null;
  expires_at?: number | null;
  phase: AccountPhase;
  revision: number;
  session: string;
  user_code?: string | null;
  verification_uri?: string | null;
}
export interface AssetArtwork {
  block_id: string;
  cached: boolean;
  gear: string;
  /**
   * Hash of the metadata URL; URLs (potentially signed) never reach the browser or logs.
   */
  key?: string | null;
  title: string;
}
export interface AudioProbe {
  channels: number;
  direction: Direction;
  endpoint: string;
  format: SampleFormat;
  period_frames: number;
  periods: number;
  sample_rate: number;
}
export interface AudioChangeState {
  candidate?: AudioChangeHardware | null;
  id?: string | null;
  message?: string | null;
  observed?: AudioChangeObservation | null;
  owner?: AudioChangeOwner | null;
  phase: AudioChangePhase;
  previous?: AudioChangeHardware | null;
  remaining_ms?: number | null;
}
export interface AudioChangeHardware {
  input: AudioProbe;
  /**
   * @minItems 2
   * @maxItems 2
   */
  input_map: [number, number];
  output: AudioProbe;
  /**
   * @minItems 2
   * @maxItems 2
   */
  output_map: [number, number];
}
export interface AudioChangeObservation {
  deadline_misses?: number | null;
  frames: number;
  invalid_samples?: number | null;
  xruns?: number | null;
}
export interface AudioCommand {
  action: AudioAction;
  expected_revision: number;
  session: string;
}
/**
 * Unit-wide gain staging around every rig: guitar input trim before the rig,
 * master output level after it. Never stored in presets.
 */
export interface HostLevels {
  /**
   * Calibration offset plus boost of the playing preset and scene in dB
   * (−24 to +24), added to the
   * output level. Set by the daemon from the boost store, never by a view.
   */
  boost_db?: number;
  /**
   * Noise gate threshold after the trim, in dBFS (−96 to −20); none plays
   * ungated. Set from the active guitar's measured noise floor.
   */
  gate_db?: number | null;
  /**
   * Input trim in dB, applied before the rig (−24 to +24).
   */
  input_trim_db: number;
  /**
   * Sum left and right to both outputs: for mono PAs and for checking that a
   * wide rig survives mono without thinning out.
   */
  mono?: boolean;
  /**
   * Master output level in dB, applied after the rig (−60 to +12; −60 is silent).
   */
  output_level_db: number;
}
/**
 * What the daemon asks the worker's backing player to do.
 */
export interface LoopRange {
  a: number;
  b: number;
}
/**
 * Play a split's stems instead of one render, mixed live with `gains`.
 */
export interface StemMix2 {
  /**
   * Linear gain per entry of [`STEM_NAMES`]; 0 is silent. Absent stems
   * must be 0.
   *
   * @minItems 6
   * @maxItems 6
   */
  gains: [number, number, number, number, number, number];
  /**
   * Bit `i` set when the split has stem `STEM_NAMES[i]`.
   */
  present: number;
  source: MediaId;
  split: MediaId;
}
/**
 * What the outputs should use now: settings, or bypassed (flat, no trim).
 */
export interface VenueApplied {
  bypass: boolean;
  settings: VenueSettings;
}
/**
 * A whole venue EQ: seven bands and output trim.
 */
export interface VenueSettings {
  /**
   * @minItems 7
   * @maxItems 7
   */
  bands: [
    VenueBandSettings,
    VenueBandSettings,
    VenueBandSettings,
    VenueBandSettings,
    VenueBandSettings,
    VenueBandSettings,
    VenueBandSettings
  ];
  trimDb: number;
}
/**
 * One band's settings. Which kind it is follows from its position.
 */
export interface VenueBandSettings {
  enabled: boolean;
  freqHz: number;
  /**
   * Shelves and bells only.
   */
  gainDb?: number;
  /**
   * Bells only (0.3–8); shelves use 0.707 and pass filters Butterworth.
   */
  q?: number;
  /**
   * Pass filters only: 24 dB/oct instead of 12.
   */
  steep?: boolean;
}
/**
 * Device-local configuration, deliberately absent from portable sound data.
 */
export interface Settings2 {
  bindings: Binding2[];
  branch_bindings?: BranchBinding[];
  /**
   * 0 accepts all MIDI channels; otherwise 1–16.
   */
  channel: number;
  /**
   * Further controllers listened to at once, each enabled explicitly. Their
   * messages share these mappings but keep their own channel and bank state.
   */
  extra_inputs?: ExtraInput[];
  input: string;
  parameter_bindings?: ParameterBinding[];
}
export interface Binding2 {
  controller?: number | null;
  /**
   * Exactly one trigger is required. Programs are wire values 0–127.
   */
  program?: number | null;
  scene: string;
}
export interface BranchBinding {
  branch: string;
  controller: number;
  mode: BranchMode;
}
/**
 * One more controller: its own endpoint and channel filter (0 accepts all).
 */
export interface ExtraInput {
  channel: number;
  input: string;
}
export interface ParameterBinding {
  controller: number;
  mode?: "absolute" | "toggle" | "relative_twos_complement" | "relative_offset64";
  target: Target2;
}
export interface StreamConfig {
  hear_yourself?: boolean;
  input: AudioProbe;
  /**
   * Zero-based channels; duplicate input indexes copy mono to both processor channels.
   *
   * @minItems 2
   * @maxItems 2
   */
  input_map: [number, number];
  levels?: HostLevels1;
  output: AudioProbe;
  /**
   * Duplicate output indexes mix the stereo processor output equally into mono.
   *
   * @minItems 2
   * @maxItems 2
   */
  output_map: [number, number];
  /**
   * Venue EQ on the main outputs from the first sample; the daemon fills it
   * at every start, like the levels.
   */
  venue?: VenueApplied | null;
}
/**
 * Unit-wide gain staging around every rig: guitar input trim before the rig,
 * master output level after it. Never stored in presets.
 */
export interface HostLevels1 {
  /**
   * Calibration offset plus boost of the playing preset and scene in dB
   * (−24 to +24), added to the
   * output level. Set by the daemon from the boost store, never by a view.
   */
  boost_db?: number;
  /**
   * Noise gate threshold after the trim, in dBFS (−96 to −20); none plays
   * ungated. Set from the active guitar's measured noise floor.
   */
  gate_db?: number | null;
  /**
   * Input trim in dB, applied before the rig (−24 to +24).
   */
  input_trim_db: number;
  /**
   * Sum left and right to both outputs: for mono PAs and for checking that a
   * wide rig survives mono without thinning out.
   */
  mono?: boolean;
  /**
   * Master output level in dB, applied after the rig (−60 to +12; −60 is silent).
   */
  output_level_db: number;
}
export interface StartAudio {
  /**
   * An immutable working base created locally, separate from imported/saved libraries.
   */
  draft?: boolean;
  midi?: Settings2 | null;
  owned: boolean;
  /**
   * Immutable imported/owned preset identity, never a browser-supplied file path.
   */
  preset_id: string;
  stream: StreamConfig;
  /**
   * Verified local authoring checkpoint tied to this immutable preset.
   */
  working?: string | null;
}
export interface EqBand {
  freqHz: number;
  gainDb: number;
  q: number;
  type: EqType;
}
/**
 * Immutable verified asset assigned to a native block. Insert position is issued
 * by the playback owner, preserving replay order from the immutable working base.
 */
export interface ModelAssignment {
  asset: string;
  insertion?: SlotPosition | null;
  target: string;
}
export interface SlotPosition {
  index: number;
  lane: number;
}
export interface AudioDevices {
  backend_available: boolean;
  endpoints: AudioEndpoint[];
  /**
   * Discovery support must never be mistaken for an implemented playback engine.
   */
  streaming_available: boolean;
  warnings: string[];
}
export interface AudioEndpoint {
  direction: Direction;
  /**
   * ALSA card ID plus PCM device; re-enumerate before using it. Not a USB serial number.
   */
  id: string;
  name: string;
}
export interface AudioProbeResult {
  buffer_frames: number;
  configuration: AudioProbe;
  /**
   * Only a point-in-time open/configure/readback/close check, never live readiness.
   */
  streaming_available: boolean;
}
export interface AudioState {
  authoring?: AuthoringStatus | null;
  /**
   * Shared boot policy failure; clearing it never requires a working audio device.
   */
  boot_error?: string | null;
  configured?: StartAudio | null;
  /**
   * Confirmed controls of the sounding worker; cleared whenever it stops.
   */
  controls: LiveControl[];
  /**
   * A first edit promoted a read-only original into Mine. Keep or Discard
   * resolves this prompt; the immutable source is never modified.
   */
  copy_on_edit?: CopyOnEdit | null;
  /**
   * Remains true until the worker is reaped, including failed shutdowns.
   */
  device_owned: boolean;
  eq?: BlockEqState[];
  error?: string | null;
  experimental: boolean;
  midi?: Status;
  model_change?: ModelProgress | null;
  models?: ModelAssignment[];
  /**
   * Session edits are not written back to the immutable starting preset.
   */
  modified: boolean;
  phase: AudioPhase;
  preset_name?: string | null;
  revision: number;
  /**
   * Last copy saved from this exact control revision; restart still uses configured.
   */
  saved_copy?: string | null;
  session: string;
  slots?: NativeSlot[];
  /**
   * Explicitly opt in to restoring the captured confirmed session after daemon startup.
   */
  start_on_boot: boolean;
  /**
   * Startup or a lost session is waiting for its audio interface to be
   * connected; audio starts by itself when it appears (Sprint 07).
   */
  waiting_for_device?: boolean;
}
export interface AuthoringStatus {
  can_paste?: boolean;
  can_redo: boolean;
  can_undo: boolean;
  gesture?: GestureOwner | null;
  history_error?: string | null;
  layout: ChainLayout;
  setting_steps?: {
    [k: string]: number;
  };
  settings?: LiveControl[];
  tools?: State2;
  /**
   * Immutable local working-state receipt; never a file path or portable preset.
   */
  working?: string | null;
}
export interface GestureOwner {
  owner: string;
  target: string;
  token: string;
}
export interface ChainLayout {
  input_mode?: "stereo" | "left" | "right" | "dual";
  left: ChainBlock[];
  right: ChainBlock[];
  stereo: boolean;
}
/**
 * Exact native lane order, including insertion tiles. No provider credentials or model paths.
 */
export interface ChainBlock {
  active_model?: number | null;
  id: string;
  insert: boolean;
  tone_id?: number | null;
  variants?: ModelVariant[];
}
export interface ModelVariant {
  id: number;
  name: string;
}
/**
 * Native playback controls use normalized values; display text comes from the DSP.
 */
export interface LiveControl {
  display: string;
  label: string;
  target: string;
  toggle: boolean;
  value: number;
}
export interface State2 {
  alignment: Measurement;
  balance: Measurement;
  error?: string | null;
  solo?: "none" | "left" | "right";
  spectrum?: Spectrum | null;
  tuner?: TunerReading | null;
  tuner_enabled: boolean;
}
export interface Measurement {
  confidence?: number | null;
  matchedDb?: number | null;
  matchedMs?: number | null;
  peakSharpness?: number | null;
  polarityFlipped?: boolean | null;
  progress?: number;
  state: Phase2;
}
export interface Spectrum {
  bins: number[];
  block_id: string;
}
export interface TunerReading {
  confidence: number;
  frequency: number;
  level: number;
}
export interface CopyOnEdit {
  copy_id: string;
  source_id: string;
  source_name: string;
}
/**
 * Exact per-block EQ readback, retained independently of scalar controls.
 */
export interface BlockEqState {
  block_id: string;
  eq: EqState;
}
export interface EqState {
  /**
   * @minItems 6
   * @maxItems 6
   */
  bands: [EqBand, EqBand, EqBand, EqBand, EqBand, EqBand];
  enabled: boolean;
  pre: boolean;
}
export interface Status {
  connected: boolean;
  error?: string | null;
  events: number;
  last?: Message | null;
  /**
   * True while passive learning suppresses action dispatch.
   */
  learning?: boolean;
  /**
   * Oldest first, at most [`RECENT_LIMIT`]. A gap after the last `seq` a
   * consumer processed means older events were overwritten; a lower `events`
   * count means the worker restarted.
   */
  recent?: Observed[];
  /**
   * One entry per extra controller, in the order of `Settings::extra_inputs`.
   */
  sources?: SourceStatus[];
}
/**
 * One received PC/CC message with its position in the input's event count.
 */
export interface Observed {
  message: Message;
  /**
   * Equals `Status::events` after this message; consecutive messages differ by one.
   */
  seq: number;
  /**
   * Which controller sent it: 0 is the first input, then the extras in order.
   */
  source?: number;
}
/**
 * Connection state of one extra controller.
 */
export interface SourceStatus {
  connected: boolean;
  error?: string | null;
}
export interface ModelProgress {
  assignment: ModelAssignment;
  error?: string | null;
  phase: ModelPhase;
  /**
   * Start-command serial within the audio session; rejects cancellation of a newer selection.
   */
  request: number;
}
export interface NativeSlot {
  position: SlotPosition;
  target: string;
}
/**
 * Sets one boost; 0 dB removes it.
 */
export interface BoostUpdate {
  boost_db: number;
  key: string;
}
export interface BoostState {
  /**
   * Calibration plus boosts as applied at the output, clamped to −24…+24 dB.
   */
  applied_db: number;
  boosts: {
    [k: string]: number;
  };
  /**
   * The calibration offset of what is playing (Even out all), in dB.
   */
  calibrated_db?: number;
  /**
   * Keys of what is playing: the preset, then its scene when it has one.
   */
  playing: string[];
}
export interface CalibrationState {
  entries: CalibrationEntry[];
  progress: Progress;
  target_lufs?: number | null;
}
export interface CalibrationEntry {
  key: string;
  lufs: number;
  name: string;
  offset_db: number;
}
export interface Progress {
  current?: string | null;
  done: number;
  error?: string | null;
  /**
   * Presets or scenes that could not be measured this run, with why.
   */
  failed?: string[];
  /**
   * Measured this run; the rest were already measured and unchanged.
   */
  measured: number;
  running: boolean;
  total: number;
}
export interface CalibrationCommand {
  action: CalibrationAction;
}
export interface CalibrationCoverage {
  /**
   * Cached measurements whose content still matches the visible item.
   */
  measured: number;
  /**
   * Cached measurements whose preset or scene content has changed.
   */
  stale: number;
  /**
   * Visible presets and scenes currently eligible for measurement.
   */
  total: number;
  /**
   * Visible items that have never been measured.
   */
  unmeasured: number;
}
/**
 * Development appliance capabilities; audio is deliberately unavailable.
 * @see docs/architecture.md
 */
export interface Capabilities {
  audio_available: boolean;
  midi_transport: string;
  native_editor: boolean;
  protocol: number;
  version: string;
}
export interface CaptureState {
  job?: CaptureJob | null;
  revision: number;
}
export interface CaptureJob {
  /**
   * The saved asset, once there is one.
   */
  asset?: string | null;
  frames: number;
  /**
   * Also the ID of the asset it produces.
   */
  id: string;
  /**
   * The result is shorter than intended (stopped early or a fault).
   */
  incomplete: boolean;
  kind: CaptureKind;
  lostSamples: number;
  monitoring: boolean;
  peakDbfs: number;
  phase: JobPhase;
  rate: number;
  reason?: string | null;
  source?: string | null;
  title: string;
  /**
   * Reamp only: frames the job will write in total.
   */
  totalFrames?: number | null;
}
export interface StopRequest {
  /**
   * Keep what was written (Stop and keep) or discard it (Cancel).
   */
  keep: boolean;
}
export interface Command {
  action: Action;
  expected_revision?: number | null;
  protocol: number;
  request_id: string;
  session: string;
}
/**
 * Persisted routing data, independent of UI layout and audio resources.
 * @see docs/architecture.md
 */
export interface Rig {
  edges: Edge[];
  nodes: Node[];
}
export interface Edge {
  from: string;
  to: string;
}
/**
 * Stable block identity and a declared PoC block kind.
 * @see docs/architecture.md
 */
export interface Node {
  id: string;
  kind: BlockKind;
  level: number;
}
export interface MappingFile {
  mappings: MidiMapping[];
  version: number;
}
/**
 * Versioned MIDI mapping. Feedback uses a separate output route, never an input route.
 * @see docs/architecture.md
 */
export interface MidiMapping {
  cc: number;
  channel: number;
  curve: MidiCurve;
  device: string;
  feedback: boolean;
  id: string;
  max: number;
  min: number;
  mode: MidiMode;
  pickup: boolean;
  target: string;
}
export interface MidiInput {
  cc: number;
  channel: number;
  device: string;
  value: number;
}
export interface AuditHistory {
  dropped_records: number;
  records: AuditRecord[];
  skipped_records: number;
  storage_error: boolean;
  storage_limit_bytes: number;
}
export interface AuditRecord {
  completed_at_ms: number;
  http_status: number;
  operation: Operation;
  outcome: Outcome;
  requested_at_ms: number;
  schema: number;
}
export interface State {
  available: boolean;
  directory: string;
  enabled: boolean;
  identity: string;
  job?: Job | null;
  message: string;
  remaining_seconds: number;
}
export interface Job {
  elapsed_ms: number;
  exit_code?: number | null;
  id: string;
  output: string;
  phase: string;
}
/**
 * Static public-certificate metadata served by the appliance HTTPS proxy.
 * @see docs/device-service.md
 */
export interface PublicCertificate {
  file_name: string;
  fingerprint_sha256: string;
  hotspot_download?: string | null;
  https_download: string;
  schema_version: number;
  server_names: string[];
}
export interface PackState {
  audio_running: boolean;
  available: boolean;
  job?: PackJob | null;
  message: string;
  packs: EffectPack[];
  storage_writable: boolean;
}
export interface PackJob {
  action: PackAction;
  pack: string;
  phase: string;
}
export interface EffectPack {
  copyright_available?: boolean | null;
  id: string;
  installed: boolean;
  name: string;
  package: string;
  qualification: string;
  size_mib: number;
  usable_plugins: number;
  version?: string | null;
  website: string;
}
export interface ApiError {
  /**
   * What kind of failure this is, so a client can choose one recovery
   * action without parsing the sentence (Sprint 07 7.24).
   */
  code: "invalid" | "not_found" | "conflict" | "busy" | "locked" | "unavailable" | "timeout" | "storage" | "internal";
  error: string;
}
export interface GraphAudioCommand {
  action: GraphAudioAction;
  expected_revision: number;
  session: string;
}
/**
 * The selected instance in the current worker snapshot.
 */
export interface PluginDefaultsCommand {
  expected_revision: number;
  node: string;
  session: string;
}
export interface StartGraph {
  bindings: Binding[];
  /**
   * Immutable library source, retained across working edits and restart.
   */
  library_id?: string | null;
  /**
   * Working name belongs to the audible session, not an individual browser view.
   */
  name?: string | null;
  recall?: GraphRecall | null;
  rig: Rig;
  stream: StreamConfig;
}
export interface Binding {
  node: string;
  uri: string;
}
/**
 * Durable scalar/MIDI values, independent of transient command sessions and edit leases.
 */
export interface GraphRecall {
  bypassed: boolean;
  mappings: MappingFile;
  values: GraphValue[];
}
export interface GraphValue {
  normalized: number;
  target: string;
}
export interface GraphAudioState {
  configured?: StartGraph | null;
  control?: Snapshot | null;
  device_owned: boolean;
  error?: string | null;
  experimental: boolean;
  native_values: NativeValue[];
  phase: AudioPhase;
  processed_frames: number;
  revision: number;
  saved_copy?: string | null;
  session: string;
  start_on_boot: boolean;
  telemetry?: Snapshot2 | null;
  /**
   * Startup or a lost session is waiting for its audio interface to be
   * connected; audio starts by itself when it appears (Sprint 07).
   */
  waiting_for_device?: boolean;
}
/**
 * Every subscriber receives a complete, revisioned snapshot; dropped intermediates resync safely.
 * @see docs/architecture.md
 */
export interface Snapshot {
  actions: ActionDescriptor[];
  audio_available: boolean;
  bypassed: boolean;
  edit?: EditStatus | null;
  feedback: MidiFeedback[];
  last_midi?: MidiInput | null;
  mappings: MappingFile;
  midi_mapped: boolean;
  origin: string;
  parameters: Parameter[];
  preset: string;
  protocol: number;
  request_id: string;
  revision: number;
  rig: Rig;
  session: string;
}
/**
 * Enumerated commands are discoverable alongside numeric parameters.
 * @see docs/architecture.md
 */
export interface ActionDescriptor {
  id: string;
  label: string;
  options: string[];
}
export interface EditStatus {
  owner: string;
  target: string;
}
export interface MidiFeedback {
  cc: number;
  channel: number;
  device: string;
  mapping: string;
  value: number;
}
/**
 * Discoverable controls share stable IDs across MIDI and web adapters.
 * @see docs/architecture.md
 */
export interface Parameter {
  default: number;
  id: string;
  label: string;
  max: number;
  min: number;
  step: number;
  unit: string;
  value: number;
  writable: boolean;
}
export interface NativeValue {
  target: string;
  value: number;
}
export interface Snapshot2 {
  /**
   * Callbacks reaching/exceeding one period, not necessarily ALSA underruns.
   */
  deadline_misses?: number | null;
  deadline_us: number;
  frames: number;
  /**
   * @minItems 2
   * @maxItems 2
   */
  input: [Channel, Channel];
  invalid_samples: number;
  monitoring?: HostState | null;
  /**
   * @minItems 2
   * @maxItems 2
   */
  output: [Channel, Channel];
  process_us_max: number;
  process_us_p50: number;
  process_us_p95: number;
  /**
   * Largest callback duration since this stream began, independent of polling.
   */
  process_us_peak?: number | null;
  /**
   * Recovered transport overruns/underruns in this worker lifetime.
   */
  xruns?: number | null;
}
export interface Channel {
  /**
   * Samples at or above full scale, cumulative for this worker lifetime.
   */
  clips: number;
  peak_dbfs: number;
  rms_dbfs: number;
}
export interface HostState {
  /**
   * The worker's backing player, when its stream has one.
   */
  backing?: BackingStatus | null;
  /**
   * The worker's Record DI or reamp job, when one has run.
   */
  capture?: CaptureStatus | null;
  hear_yourself: boolean;
  levels?: HostLevels2;
  output_muted?: boolean;
  /**
   * The calibration measurement while the reference riff plays.
   */
  reference?: ReferenceReading | null;
  test_tone_active: boolean;
  /**
   * The input tuner's newest pitch; none without a clear note.
   */
  tuner?: TunerReading | null;
  /**
   * Whether the input tuner is listening.
   */
  tuner_enabled?: boolean;
}
/**
 * Where the worker's backing player is, reported with every telemetry snapshot.
 */
export interface BackingStatus {
  /**
   * Reached the last frame with Repeat off.
   */
  ended: boolean;
  /**
   * Frame last sent to the outputs.
   */
  frame: number;
  /**
   * The render could not be opened.
   */
  missing: boolean;
  playing: boolean;
  /**
   * The command sequence this status describes.
   */
  seq: number;
  /**
   * Blocks that ran out of data and played silence, this worker lifetime.
   */
  underruns: number;
}
/**
 * Where the worker's capture job is.
 */
export interface CaptureStatus {
  discarded: boolean;
  fault?: CaptureFault | null;
  /**
   * The file is complete on disk and synced; the daemon may finalize it.
   */
  finished: boolean;
  /**
   * Frames on disk.
   */
  frames: number;
  kind: CaptureKind;
  /**
   * Samples the audio thread could not hand over.
   */
  lost: number;
  /**
   * Largest recent input sample, for the recording meter (dBFS).
   */
  peakDbfs: number;
  /**
   * Still taking audio.
   */
  running: boolean;
  seq: number;
}
/**
 * Unit-wide gain staging around every rig: guitar input trim before the rig,
 * master output level after it. Never stored in presets.
 */
export interface HostLevels2 {
  /**
   * Calibration offset plus boost of the playing preset and scene in dB
   * (−24 to +24), added to the
   * output level. Set by the daemon from the boost store, never by a view.
   */
  boost_db?: number;
  /**
   * Noise gate threshold after the trim, in dBFS (−96 to −20); none plays
   * ungated. Set from the active guitar's measured noise floor.
   */
  gate_db?: number | null;
  /**
   * Input trim in dB, applied before the rig (−24 to +24).
   */
  input_trim_db: number;
  /**
   * Sum left and right to both outputs: for mono PAs and for checking that a
   * wide rig survives mono without thinning out.
   */
  mono?: boolean;
  /**
   * Master output level in dB, applied after the rig (−60 to +12; −60 is silent).
   */
  output_level_db: number;
}
/**
 * Loudness of the rig's output while the reference riff plays.
 */
export interface ReferenceReading {
  /**
   * K-weighted loudness (LUFS) over those seconds; none until measured.
   */
  lufs?: number | null;
  /**
   * Seconds measured so far (the first second after starting is skipped).
   */
  seconds: number;
}
export interface SavedGraph {
  id: string;
  preset: GraphPreset;
}
export interface GraphPreset {
  bindings: Binding[];
  name: string;
  recall: GraphRecall;
  rig: Rig;
  sample_rate: number;
  version: number;
}
export interface Guitars {
  active?: string | null;
  guitars: Guitar[];
  /**
   * Presets that always play with one guitar: preset key (as boosts use
   * it) to guitar id. Starting such a preset selects its guitar.
   */
  presets?: {
    [k: string]: string;
  };
  /**
   * The guitar presets were set up with: Measure matches others to its strum.
   */
  reference?: string | null;
}
export interface Guitar {
  /**
   * Gate this guitar just above its measured noise.
   */
  gate?: boolean;
  id: string;
  name: string;
  /**
   * Peak hiss and hum with the strings muted, before any trim, in dBFS.
   */
  noise_dbfs?: number | null;
  /**
   * Peak of the player's loudest stage strum, before any trim, in dBFS.
   */
  peak_dbfs?: number | null;
  /**
   * Input trim for this guitar in dB (−24 to +24), applied before every rig.
   */
  trim_db?: number;
  /**
   * Input path used for the latest strum or noise measurement.
   */
  verification?: InputVerification | null;
}
/**
 * Server-owned provenance for a guitar measurement. ALSA's stable card name is
 * the best identity currently available; it is not presented as a USB serial.
 */
export interface InputVerification {
  channels: number;
  endpoint: string;
  format: SampleFormat;
  /**
   * @minItems 2
   * @maxItems 2
   */
  input_map: [number, number];
  period_frames: number;
  periods: number;
  sample_rate: number;
  verified_at_ms: number;
}
export interface KeepReady {
  revisions: string[];
}
export interface Library {
  presets: Inspection[];
}
/**
 * Structural inspection only. Original bytes, not this summary, remain authoritative.
 */
export interface Inspection {
  block_count: number;
  embedded_bytes: number;
  framing: Framing;
  name: string;
  parameter_count: number;
  playback_available: boolean;
  sha256: string;
  size_bytes: number;
  source_id?: string | null;
}
export interface LibraryCatalog {
  /**
   * The preset a `duplicate` made, in Mine and not in the set list.
   */
  created?: LibraryReference | null;
  items: LibraryItem[];
  revision: string;
  /**
   * The starter set list was added or declined on this unit; it is offered
   * at most once automatically.
   */
  starter_offered?: boolean;
}
export interface LibraryReference {
  id: string;
  kind: LibraryKind;
}
export interface LibraryItem {
  archived: boolean;
  id: string;
  /**
   * In the Set list (MIDI program changes and Previous/Next follow it).
   * Presets in Mine are members unless taken out; read-only Oxidal sounds
   * are members only when added. Earlier revisions and archived entries
   * never are.
   */
  in_set_list?: boolean;
  kind: LibraryKind;
  name: string;
  origin?: "tone3000" | "oxidal_example" | "mine";
  source_name: string;
  /**
   * An earlier saved revision of a preset that was saved again. It is kept
   * as history and hidden from Library and the Removed list.
   */
  superseded?: boolean;
}
export interface LibraryUpdate {
  action: LibraryAction;
  entry_kind?: ("original" | "owned" | "graph") | "rig";
  expected_revision: string;
  id?: string;
}
export interface LocalModel {
  /**
   * Actual bounded WAV-header readings; absent for NAM/unsupported headers.
   */
  audio?: WavInfo | null;
  /**
   * Display-only relative import folder; never used as a storage path.
   */
  folder?: string;
  format: string;
  /**
   * The tone's gear type (amp, pedal, cab…), when known.
   */
  gear?: string;
  id: string;
  nam?: NamInfo | null;
  name: string;
  /**
   * Persisted metadata of this downloaded tone, available without an account request.
   */
  provider_tone?: Tone | null;
  sha256: string;
  title: string;
  /**
   * The TONE3000 tone it came from; absent for a file added on this unit,
   * which carries no provider data.
   */
  tone_id?: number;
}
export interface WavInfo {
  bits_per_sample: number;
  channels: number;
  duration_ms: number;
  floating_point: boolean;
  frames: number;
  sample_rate: number;
}
export interface NamInfo {
  author?: string | null;
  gear?: string | null;
  name?: string | null;
  source_tone_id?: number | null;
  source_url?: string | null;
  trainer?: string | null;
}
export interface Tone {
  a1_models_count?: number;
  a2_models_count?: number;
  custom_models_count?: number;
  format: string;
  gear: string;
  id: number;
  images?: string[] | null;
  license: string;
  models_count: number;
  title: string;
  url: string;
  user: Creator;
}
export interface Creator {
  display_name?: string | null;
  profile_url?: string | null;
  username: string;
}
export interface LocalModelPage {
  data: LocalModel[];
  next?: string | null;
}
/**
 * Fresh installed metadata, checked against the same admission rules as the host.
 * This is not an instantiation, state-restoration or real-time guarantee.
 */
export interface PluginCatalog {
  plugins: PluginInfo[];
  sample_rate: number;
}
export interface PluginInfo {
  artwork?: boolean;
  /**
   * The declared author or maker, used to group effects by source.
   */
  author?: string | null;
  /**
   * The LV2 class label, such as "Delay" or "Reverb", when one is declared.
   */
  category?: string | null;
  comment?: string | null;
  homepage?: string | null;
  name: string;
  /**
   * Installed Debian pack owning the bundle manifest selected by Lilv.
   */
  pack_id?: string | null;
  ports: Port[];
  unsupported?: string | null;
  uri: string;
}
export interface Port {
  atom?: boolean;
  audio: boolean;
  control: boolean;
  default?: number | null;
  /**
   * pprops:displayPriority, not an lv2core property.
   */
  display_priority?: number | null;
  enumeration?: boolean;
  group?: string | null;
  group_symbol?: string | null;
  group_uri?: string | null;
  index: number;
  input: boolean;
  integer: boolean;
  latency: boolean;
  logarithmic: boolean;
  maximum?: number | null;
  minimum?: number | null;
  name?: string | null;
  not_on_gui?: boolean;
  output: boolean;
  /**
   * Named values (`lv2:scalePoint`), sorted by value; empty when none.
   */
  scale_points?: ScalePoint[];
  symbol: string;
  toggled: boolean;
  /**
   * Declared display symbol only; raw values are never converted.
   */
  unit?: string | null;
  unit_uri?: string | null;
}
/**
 * One named value of a control, such as a mode or note division, so the
 * interface can show "Ping-pong" rather than "2".
 * @see docs/lv2.md
 */
export interface ScalePoint {
  label: string;
  value: number;
}
/**
 * Rename or re-trim an asset; files never change.
 */
export interface AssetUpdate {
  title?: string | null;
  trimDb?: number | null;
}
/**
 * The Library view of the store.
 */
export interface MediaLibrary {
  assets: MediaManifest[];
  quarantined: Quarantined[];
  /**
   * Absent where free space cannot be measured.
   */
  space?: Space | null;
  usedBytes: number;
}
/**
 * `manifest.json`, schema 1. Written last; its presence makes an asset real.
 */
export interface MediaManifest {
  created_at: string;
  id: string;
  kind: MediaKind;
  playback?: MediaPlayback;
  /**
   * Set for reamp results: which DI and preset produced them.
   */
  provenance?: {
    [k: string]: any;
  };
  renders: MediaRender[];
  schema: number;
  source?: MediaSource | null;
  title: string;
}
export interface MediaPlayback {
  /**
   * Per-track trim in dB (−24 to +6), set from loudness at import.
   */
  trim_db: number;
}
/**
 * Raw interleaved little-endian float32 at one stream rate.
 */
export interface MediaRender {
  channels: number;
  file: string;
  frames: number;
  loudness_lufs?: number | null;
  peak_dbfs?: number | null;
  rate: number;
  resampler?: string | null;
  sha256: string;
}
/**
 * The file as uploaded, kept byte-exact for download and re-rendering.
 */
export interface MediaSource {
  bytes: number;
  channels: number;
  codec: string;
  container: string;
  file: string;
  frames: number;
  lossy: boolean;
  rate: number;
  sha256: string;
}
/**
 * An asset that failed its startup check, kept for inspection.
 */
export interface Quarantined {
  entry: string;
  reason: string;
}
export interface Space {
  availableBytes: number;
  reserveBytes: number;
  totalBytes: number;
}
export interface UploadRequest {
  /**
   * The file's name on the sending device; becomes the default title.
   */
  name: string;
  size: number;
  /**
   * Keep the upload staged for a song import instead of making a Library track.
   */
  stem?: boolean;
}
export interface UploadState {
  complete: boolean;
  format: UploadFormat;
  id: string;
  import: ImportPhase;
  /**
   * Bytes received and confirmed; the next chunk must start here.
   */
  offset: number;
  size: number;
  title: string;
}
/**
 * Outcome of the newest device-wide MIDI action. `seq` increases with each one
 * so a client can tell a new refusal from a repeat of the previous text.
 */
export interface MidiAction {
  message: string;
  ok: boolean;
  seq: number;
}
export interface Devices {
  available: boolean;
  inputs: Endpoint[];
  warnings: string[];
}
export interface Endpoint {
  id: string;
  name: string;
}
/**
 * Start or end passive learning on the playing preset's controller input.
 */
export interface MidiLearn {
  on: boolean;
}
export interface MidiMap {
  channel: number;
  entries: MidiMapEntry[];
  /**
   * Further controllers heard at once, each enabled explicitly (at most three).
   */
  extra_inputs?: ExtraInput[];
  input?: string | null;
  navigation?: Navigation;
  revision: string;
  saved_layouts?: SavedLayout[];
  template?: MidiTemplate | null;
}
export interface MidiMapEntry {
  bindings: Binding2[];
  branch_bindings: BranchBinding[];
  /**
   * Assignments kept but switched off; they do nothing until enabled.
   */
  disabled?: Disabled[];
  entry: LibraryReference;
  parameter_bindings: ParameterBinding[];
}
/**
 * An assignment kept in the map but switched off. Identified by its trigger, which
 * is unique inside a preset. A disabled Program no longer overrides set-list recall.
 */
export interface Disabled {
  controller?: number | null;
  kind: AssignmentKind;
  program?: number | null;
}
/**
 * Device-wide actions through the current Mine set-list and playing engine.
 * They sit outside every preset map, so no preset can silently change what
 * they do.
 */
export interface Navigation {
  backing?: BackingTriggers;
  /**
   * Selects the next guitar profile, wrapping after the last.
   */
  guitar?: Trigger | null;
  /**
   * Flips the output mute, like the Mute button.
   */
  mute?: Trigger | null;
  next?: Trigger | null;
  previous?: Trigger | null;
  /**
   * Opens the global tuner overlay when a browser is connected.
   */
  tuner?: Trigger | null;
}
/**
 * Backing-track player switches and level knob.
 */
export interface BackingTriggers {
  /**
   * A CC whose value (0–127) sets the player level, −60 to +6 dB.
   */
  level?: number | null;
  next?: Trigger | null;
  play_pause?: Trigger | null;
  previous?: Trigger | null;
  skip_back?: Trigger | null;
  skip_forward?: Trigger | null;
  stop?: Trigger | null;
}
/**
 * One PC or CC press that runs a device-wide action. A Program Change fires
 * on arrival; a CC fires on a value of 64 or more, like scene buttons.
 */
export interface Trigger {
  controller?: number | null;
  program?: number | null;
}
/**
 * A named starting layout the owner saved: the scene template and device-wide
 * triggers to apply together. It never contains preset mappings or device identity.
 */
export interface SavedLayout {
  id: string;
  name: string;
  navigation?: Navigation;
  /**
   * The controller profile it was made from, for display only.
   */
  profile: string;
  template?: MidiTemplate | null;
}
/**
 * Unit default for controllers whose buttons emit consecutive CC messages.
 * Program Change remains reserved for the Mine set-list; these buttons select
 * scenes inside the recalled preset.
 */
export interface MidiTemplate {
  first_controller: number;
  scene_buttons: number;
}
/**
 * Optimistic whole-map replacement used by the management screen and imports.
 * The revision is deliberately separate from the portable JSON payload so an
 * exported map cannot overwrite changes made after it was downloaded.
 */
export interface MidiMapUpdate {
  channel: number;
  entries: MidiMapEntry[];
  expected_revision: string;
  /**
   * Further controllers heard at once, each enabled explicitly (at most three).
   */
  extra_inputs?: ExtraInput[];
  input?: string | null;
  navigation?: Navigation;
  saved_layouts?: SavedLayout[];
  template?: MidiTemplate | null;
}
/**
 * Previous or next preset in the current Mine set-list, as the footswitch does.
 */
export interface MidiNavigate {
  direction: MidiDirection;
}
/**
 * Where the playing preset sits in the Set list.
 */
export interface MidiPosition {
  /**
   * Zero-based position of the playing preset; None when it is not in the list.
   */
  index?: number | null;
  length: number;
  next?: Neighbor | null;
  previous?: Neighbor | null;
}
/**
 * A neighbouring set-list preset and whether pressing Previous/Next would switch to it now.
 */
export interface Neighbor {
  /**
   * Plain-language state: prepared, loads on recall, or why it will refuse.
   */
  detail: string;
  name: string;
  ready: boolean;
}
export interface MidiTemplateApply {
  entry: LibraryReference;
  expected_revision: string;
}
export interface MidiTest {
  entry: LibraryReference;
  /**
   * None tests global preset recall. A message tests the playing preset's map.
   */
  message?: Message | null;
}
export interface Page2 {
  data: Model[];
  page?: number;
  total_pages?: number;
}
export interface Model {
  architecture_version?: string | null;
  id: number;
  name: string;
  size?: string | null;
  tone_id: number;
}
export interface ModelQuery {
  architecture?: ("1" | "2" | "custom") | "any";
  page?: number;
  tone_id: number;
}
/**
 * Direct deletion of one separate NAM/IR model file from Sounds.
 */
export interface ModelRemovalPreview {
  /**
   * Why this file cannot be deleted now, in plain words.
   */
  blocked?: string | null;
  model: ModelRemoval;
  token: string;
}
export interface ModelRemoval {
  bytes: number;
  format: string;
  id: string;
  name: string;
  protected_by: string[];
}
export interface ModelRemovalRequest {
  expected_preview: string;
  id: string;
}
export interface ModelRemovalResult {
  cleanup_pending: boolean;
  deleted: string;
}
export interface Monitoring {
  audio?: Snapshot2 | null;
  audio_age_ms?: number | null;
  audio_phase: string;
  error?: string | null;
  graph_phase: string;
  host: Host;
  /**
   * Actual saved source of the running owner; absent for unsaved drafts.
   */
  preset?: LibraryReference | null;
  rig_phase: string;
  sequence: number;
  source?: string | null;
  stream?: StreamConfig | null;
  /**
   * Recovered overruns/underruns for the current worker; unavailable with older workers.
   */
  xruns?: number | null;
}
export interface Host {
  cpu_percent?: number | null;
  memory_total_bytes?: number | null;
  memory_used_bytes?: number | null;
  temperature_c?: number | null;
  temperature_sensor?: string | null;
}
export interface History {
  dropped_samples: number;
  interval_seconds: number;
  records: Record[];
  skipped_records: number;
  storage_error: boolean;
  storage_limit_bytes: number;
}
export interface Record {
  audio_session?: string | null;
  elapsed_ms: number;
  readings: Monitoring;
  recorded_at_ms: number;
  recorder_session: string;
  schema: number;
}
export interface EditorCommand {
  action: EditorAction;
  expected_revision: number;
  request_id: string;
  session: string;
}
export interface NativeDefaults {
  revision: string;
  settings: NativeDefaultSettings;
}
export interface NativeDefaultSettings {
  multi_core: boolean;
  nam_size: number;
  /**
   * Normalized native parameter values, limited to the reference machine defaults.
   */
  parameters: {
    [k: string]: number;
  };
}
export interface NativeDefaultsUpdate {
  expected_revision: string;
  settings: NativeDefaultSettings;
}
export interface EditorSnapshot {
  block_controls: BlockControl[];
  can_redo: boolean;
  can_undo: boolean;
  dirty: boolean;
  edit?: Editing | null;
  layout?: ChainLayout1;
  live_audio: boolean;
  loaded?: string | null;
  owned: OwnedPreset[];
  parameters: Parameter2[];
  revision: number;
  session: string;
  source_sha256?: string | null;
  state_captures: number;
}
/**
 * Native block readback, with a server-issued edit target. Values are normalized 0–1.
 */
export interface BlockControl {
  block_id: string;
  id: string;
  lane: string;
  name: string;
  parameter: string;
  staged: boolean;
  step: number;
  value: number;
}
export interface Editing {
  owner: string;
  target: string;
}
export interface ChainLayout1 {
  input_mode?: "stereo" | "left" | "right" | "dual";
  left: ChainBlock[];
  right: ChainBlock[];
  stereo: boolean;
}
export interface OwnedPreset {
  id: string;
  preset: Inspection;
  /**
   * Original import lineage; None means authored from an empty native rig.
   */
  source_sha256?: string | null;
}
export interface Parameter2 {
  automatable: boolean;
  default: number;
  display: string;
  id: string;
  interval: number;
  label: string;
  machine_default: boolean;
  maximum: number;
  minimum: number;
  normalized: number;
  staged?: boolean;
  toggle: boolean;
  tone: boolean;
  value: number;
  /**
   * Adapter qualification, separate from the native automation flag.
   */
  writable?: boolean;
}
export interface Settings {
  home_ssid: string;
  interface: string;
  mode: Mode;
}
export interface NetworkState {
  address_message?: string | null;
  available: boolean;
  capabilities?: NetworkCapabilities | null;
  capabilities_message?: string | null;
  hotspot?: Hotspot | null;
  hotspot_message?: string | null;
  interfaces: Interface[];
  message: string;
  networks: AccessPoint[];
  pending?: Pending | null;
  policy?: Settings | null;
  radio?: Radio | null;
  saved: SavedNetwork[];
  saved_message?: string | null;
  wireless_enabled: boolean;
}
/**
 * Versioned privileged features; ordinary helper status replies omit this record.
 * @see docs/device-service.md
 */
export interface NetworkCapabilities {
  guarded_power?: boolean;
  hotspot_radio?: boolean;
  open_join?: boolean;
  saved_connect: boolean;
  schema_version: number;
}
/**
 * Public managed-profile settings, not a measurement of the current RF channel.
 * @see docs/device-service.md
 */
export interface Hotspot {
  /**
   * Zero means automatic channel selection.
   */
  channel: number;
  ssid: string;
}
export interface Interface {
  /**
   * Current canonical IPv4 addresses, enriched by the unprivileged API.
   */
  addresses?: string[];
  connection: string;
  kind: string;
  name: string;
  state: string;
}
export interface AccessPoint {
  active: boolean;
  security: string;
  signal: number;
  ssid: string;
}
export interface Pending {
  phase: string;
  seconds_remaining: number;
  transaction: string;
}
export interface Radio {
  channels: number[];
  country: string;
}
export interface SavedNetwork {
  active: boolean;
  managed: boolean;
  name: string;
  ssid?: string | null;
  uuid: string;
}
export interface PlayerOrder {
  order: string[];
}
export interface PlayerRequest {
  command: PlayerCommand;
  /**
   * The track the sender believes is cued; a mismatch is refused.
   */
  expectedCue?: string | null;
  origin: Origin;
  /**
   * Retries with the same ID return the first result instead of acting twice.
   */
  requestId: string;
}
/**
 * Saved settings for one stem. Store fixed tenths of a decibel so a reopened
 * editor can restore exactly the control value that was used for rendering.
 */
export interface StemMix {
  gain_tenths_db: number;
  muted: boolean;
  solo: boolean;
}
export interface PlayerSnapshot {
  click?: Click | null;
  /**
   * Frame at the moment this snapshot was taken. While `Playing`, clients
   * advance it locally until the next snapshot.
   */
  frame: number;
  levelDb: number;
  /**
   * Shown once after a preset change made the track pause briefly.
   */
  notice?: string | null;
  /**
   * The Backing list, in Library order (asset IDs).
   */
  order: string[];
  range?: LoopRange | null;
  reason?: string | null;
  repeat: boolean;
  revision: number;
  speedPercent?: number | null;
  state: PlayerState;
  /**
   * Stems playing live instead of a render, with the mix being heard.
   */
  stems?: LiveStemMix | null;
  track?: CuedTrack | null;
  underruns: number;
}
/**
 * The live stem mix: change it with `set_stem_mix` while it plays.
 */
export interface LiveStemMix {
  recipe: MixRecipe;
  /**
   * Stems this split has, in display order.
   */
  roles: StemRole[];
  source: string;
  split: string;
}
export interface CuedTrack {
  channels: number;
  frames: number;
  id: string;
  rate: number;
  title: string;
  trimDb: number;
}
export interface Timing {
  beats: number[];
  bpm?: number | null;
  frames: number;
  peaks: number[];
  rate: number;
  source: string;
}
export interface DetailsCatalog {
  entries: DetailsEntry[];
  revision: string;
}
export interface DetailsEntry {
  details: PresetDetails;
  entry: LibraryReference;
}
export interface PresetDetails {
  categories: string[];
  copied_from?: CopyCredit | null;
  description: string;
  /**
   * Absent on presets built without sound metadata.
   */
  metadata?: RecipeMetadata | null;
}
export interface CopyCredit {
  name: string;
  source: LibraryReference;
}
/**
 * Filterable sound metadata that travels with a built preset. Optional on
 * read: presets built before it existed carry none.
 */
export interface RecipeMetadata {
  /**
   * Derived: processing blocks in the sound.
   */
  block_count?: number;
  /**
   * `simple`, `layered` or `complex`.
   */
  complexity: string;
  /**
   * `lv2`, `tone3000-a2-lite`, `tone3000-a2-full` or `hybrid`.
   */
  engine: string;
  era?: string | null;
  /**
   * One to three entries from the fixed genre list.
   */
  genres: string[];
  inspiration?: string;
  /**
   * Derived: simultaneous NAM instances.
   */
  nam_instances?: number;
  performance?: string;
  /**
   * Derived: LV2 packs the sound needs.
   */
  required_packs?: string[];
  /**
   * Derived: TONE3000 tone ids the sound needs.
   */
  required_tones?: number[];
  techniques?: string[];
}
export interface DetailsUpdate {
  categories: string[];
  description: string;
  entry_kind: LibraryKind;
  expected_revision: string;
  id: string;
  /**
   * Omit to keep the sound metadata the preset already has.
   */
  metadata?: RecipeMetadata | null;
}
export interface ProtectState {
  on: boolean;
}
export interface ReampRequest {
  /**
   * For a stereo DI: 0 left, 1 right.
   */
  channel?: number;
  monitoring?: boolean;
  /**
   * No default: the user must choose (calibration applied once).
   */
  processing: "current" | "none";
  source: string;
  tailSeconds?: number;
}
export interface RemovalPreview {
  blocked?: string | null;
  embedded_bytes: number;
  entry: LibraryItem;
  model_cleanup_unavailable?: string | null;
  models: ModelRemoval[];
  preset_bytes: number;
  remembered_bytes: number;
  remembered_files: number;
  token: string;
}
export interface RemovalRequest {
  delete_models: boolean;
  entry_kind: LibraryKind;
  expected_preview: string;
  id: string;
}
export interface RemovalResult {
  cleanup_pending: boolean;
  deleted: LibraryReference;
  model_files_deleted: number;
}
export interface RigAudioCommand {
  action: RigAudioAction;
  expected_revision: number;
  session: string;
}
export interface AuthoringCommand {
  action: AuthoringAction;
  expected_revision: number;
  node: string;
  session: string;
}
export interface StartRig {
  midi?: Settings2 | null;
  /**
   * Resident alternatives are prepared before this transport opens PCM.
   */
  prepared?: PreparedRecall[];
  recall?: Recall | null;
  revision: string;
  stream: StreamConfig;
}
export interface PreparedRecall {
  recall?: Recall | null;
  revision: string;
}
export interface Recall {
  eq?: NodeEq[] | null;
  models?: NodeModels[];
  source_revision: string;
  values: Value[];
  working?: NodeWorking[];
}
/**
 * EQ belongs to a native graph node and its stable inner block identities.
 */
export interface NodeEq {
  blocks: BlockEqState[];
  node: string;
}
export interface NodeModels {
  assignments: ModelAssignment[];
  node: string;
}
export interface Value {
  target: Target2;
  value: number;
}
export interface NodeWorking {
  node: string;
  receipt: string;
}
export interface ControlCommand {
  expected_revision: number;
  session: string;
  target: Target2;
  value: number;
}
export interface EqCommand {
  block_id: string;
  edit: EqEdit;
  expected_revision: number;
  node: string;
  session: string;
}
export interface SwitchCommand {
  expected_revision: number;
  fade_frames: number;
  revision: string;
  session: string;
}
export interface SceneCommand {
  expected_revision: number;
  /**
   * How long the outgoing scene takes to fade out, in ms (up to 10 s); none
   * uses the preset's own fade, so delay and reverb tails ring out.
   */
  release_ms?: number | null;
  scene: string;
  session: string;
}
export interface BranchCommand {
  branch: string;
  enabled: boolean;
  expected_revision: number;
  session: string;
}
export interface ModelCommand {
  expected_revision: number;
  node: string;
  operation: ModelOperation;
  session: string;
}
export interface RigAudioState {
  configured?: StartRig | null;
  control?: Snapshot3 | null;
  device_owned: boolean;
  error?: string | null;
  phase: AudioPhase;
  processed_frames: number;
  /**
   * Checkpoint failure is separate from playback state and command authority.
   */
  recovery_error?: string | null;
  revision: number;
  save?: SaveState | null;
  session: string;
  start_on_boot: boolean;
  telemetry?: Snapshot2 | null;
  /**
   * Startup or a lost session is waiting for its audio interface to be
   * connected; audio starts by itself when it appears (Sprint 07).
   */
  waiting_for_device?: boolean;
}
export interface Snapshot3 {
  authoring?: NodeAuthoring[];
  branches?: BranchState[];
  buffer_bytes: number;
  /**
   * Capture control defaults from the immutable saved bundle.
   */
  capture_defaults?: SceneNativeControl[];
  controls: Control[];
  eq?: NodeEq[];
  /**
   * Reported algorithmic and alignment delay; excludes audio devices/transport.
   */
  latency_frames: number;
  midi?: Status1;
  model_change?: NodeModelChange | null;
  models?: NodeModels[];
  /**
   * Actual scalar values differ from the immutable source bundle.
   */
  modified: boolean;
  prepared?: PreparedStatus[];
  revision: number;
  scene?: string | null;
  scene_transitioning?: boolean;
  scenes?: Scenes | null;
  session: string;
  slots?: NodeSlots[];
  source_revision: string;
  working?: NodeWorking[];
}
export interface NodeAuthoring {
  node: string;
  status: AuthoringStatus;
}
export interface BranchState {
  enabled: boolean;
  id: string;
  name: string;
  partial: boolean;
}
export interface SceneNativeControl {
  node: string;
  parameter: string;
  value: number;
}
export interface Control {
  display: string;
  integer: boolean;
  label: string;
  logarithmic: boolean;
  maximum: number;
  minimum: number;
  /**
   * Named values of an LV2 port (`lv2:scalePoint`), sorted by value, so an
   * edit dialog can offer "Ping-pong" rather than "2"; empty when none.
   */
  scale_points?: ScalePoint[];
  target: Target2;
  toggle: boolean;
  value: number;
}
export interface Status1 {
  connected: boolean;
  error?: string | null;
  events: number;
  last?: Message | null;
  /**
   * True while passive learning suppresses action dispatch.
   */
  learning?: boolean;
  /**
   * Oldest first, at most [`RECENT_LIMIT`]. A gap after the last `seq` a
   * consumer processed means older events were overwritten; a lower `events`
   * count means the worker restarted.
   */
  recent?: Observed[];
  /**
   * One entry per extra controller, in the order of `Settings::extra_inputs`.
   */
  sources?: SourceStatus[];
}
export interface NodeModelChange {
  node: string;
  progress: ModelProgress;
}
export interface PreparedStatus {
  error?: string | null;
  modified: boolean;
  name: string;
  /**
   * This alternative is currently transitioning or rendering a tail.
   */
  rendering?: boolean;
  revision: string;
  /**
   * The alternative is rendering only its outgoing return.
   */
  tail?: boolean;
}
export interface Scenes {
  branches?: Scene[];
  fade_ms: number;
  initial_scene?: string | null;
  scenes: Scene[];
}
export interface Scene {
  bypass?: SceneBypass[];
  /**
   * Plugin control values this scene sets (none for branches). Continuous
   * controls ramp over `fade_ms`; stepped ones switch while silent.
   */
  controls?: SceneControl[];
  gains: SceneGain[];
  id: string;
  name: string;
  native_controls?: SceneNativeControl[];
}
export interface SceneBypass {
  node: string;
  value: boolean;
}
/**
 * One LV2 input control value of a scene, in the plugin's native units.
 * The engine checks the port, range and step when it prepares the rig.
 */
export interface SceneControl {
  node: string;
  symbol: string;
  value: number;
}
export interface SceneGain {
  node: string;
  port: number;
  value: number;
}
export interface NodeSlots {
  node: string;
  slots: NativeSlot[];
}
export interface SaveState {
  error?: string | null;
  running: boolean;
  saved_revision?: string | null;
  source_control_revision: number;
  source_session: string;
}
export interface RigDocument {
  manifest: PortableManifest;
  revision: string;
}
export interface PortableManifest {
  extensions: {
    [k: string]: {
      [k: string]: any;
    };
  };
  format: string;
  formatVersion: number;
  id: string;
  name: string;
  oxidal?: PortableHost | null;
  requiredExtensions: string[];
  resources: PortableResource[];
  tone3000: PortableNativeInstances;
}
export interface PortableHost {
  graph: PortableGraph;
  lv2: PortableLv2Instance[];
  recall: PortableRecall;
}
export interface PortableGraph {
  edges: PortableEdge[];
  nodes: PortableNode[];
}
export interface PortableEdge {
  from: PortableEndpoint;
  to: PortableEndpoint;
}
export interface PortableEndpoint {
  node: string;
  port: number;
}
export interface PortableNode {
  audioInputs: number;
  audioOutputs: number;
  bypassed?: boolean | null;
  id: string;
  inputGains?: number[] | null;
  instance?: string | null;
  kind: PortableNodeKind;
}
export interface PortableLv2Instance {
  assets: string[];
  controls: {
    [k: string]: number;
  };
  id: string;
  pluginUri: string;
  requiredFeatures: string[];
  state?: string | null;
}
export interface PortableRecall {
  tails: PortableTails;
}
export interface PortableResource {
  bytes: number;
  id: string;
  kind: PortableResourceKind;
  path: string;
  sha256: string;
}
export interface PortableNativeInstances {
  instances: PortableNativeInstance[];
}
export interface PortableNativeInstance {
  id: string;
  origin?: PortableOrigin | null;
  partition?: PortableNativePartition | null;
  preset: string;
  processingRole?: PortableProcessingRole | null;
  profile: string;
}
export interface PortableOrigin {
  resource: string;
  sourcePresetId?: string | null;
}
/**
 * Reproducible guarded derivation from the exact source preset, never imported
 * opaque JUCE bytes. Both roles share a pair/recipe; scalar overrides are local.
 */
export interface PortableNativePartition {
  amp: string;
  cab: string;
  controls: {
    [k: string]: number;
  };
  eq?: BlockEqState[] | null;
  input: PortablePartitionInput;
  pair: string;
  version: number;
}
export interface RigPage {
  native_profile: string;
  next?: string | null;
  presets: RigEntry[];
}
export interface RigEntry {
  id: string;
  lv2_instances: number;
  /**
   * Distinct LV2 plugin URIs the preset needs, so Effects can tell which
   * presets an effect-pack removal would leave unplayable (7.17).
   */
  lv2_plugins?: string[];
  name: string;
  native_instances: number;
  origin: LibraryOrigin;
  revision: string;
  /**
   * Scene names in pad order; empty for a preset without scenes.
   */
  scenes?: string[];
  topology: RigTopology;
}
export interface RigNativeSource {
  preset: Inspection;
  source: ResourceSource;
}
export interface RigPublish {
  /**
   * Exact manifest JSON: strict parsing also rejects duplicate keys in metadata.
   */
  manifest_json: string;
  /**
   * Each declared resource maps to an existing verified local payload.
   */
  resources: {
    [k: string]: ResourceSource;
  };
  /**
   * Existing rig whose description, categories and copy credit follow this
   * immutable revision. The source itself is never changed.
   */
  source?: LibraryReference | null;
}
/**
 * Sets one preset's blend; 0 returns it to trails.
 */
export interface BlendUpdate {
  blend_ms: number;
  preset: string;
}
/**
 * Blend times in ms by scene preset id; a preset without one trails.
 */
export interface Blends {
  blends: {
    [k: string]: number;
  };
}
/**
 * The shared draft; `revision` moves on every change so clients notice.
 */
export interface SceneDraftState {
  draft?: SceneDraft | null;
  revision: number;
}
/**
 * Scene levels changed with Update scene, by scene id, plus new scenes.
 */
export interface SceneDraft {
  added?: DraftScene[];
  bypass?: {
    [k: string]: SceneBypass[];
  };
  /**
   * Plugin control values changed with Update scene, by scene id.
   */
  controls?: {
    [k: string]: SceneControl[];
  };
  gains: {
    [k: string]: SceneGain2[];
  };
  native_controls?: {
    [k: string]: SceneNativeControl[];
  };
  session: string;
}
/**
 * A scene drafted with Save as new scene.
 */
export interface DraftScene {
  bypass?: SceneBypass[];
  /**
   * Plugin control values the new scene sets (see the preset's scenes).
   */
  controls?: SceneControl[];
  gains: SceneGain2[];
  id: string;
  name: string;
  native_controls?: SceneNativeControl[];
}
/**
 * One merge input level kept for a scene.
 */
export interface SceneGain2 {
  node: string;
  port: number;
  value: number;
}
/**
 * Replaces the draft; None clears it after Save or Discard.
 */
export interface SceneDraftUpdate {
  draft?: SceneDraft | null;
  /**
   * Required when the current or submitted draft has bypass or capture edits.
   */
  expected_revision?: number | null;
}
export interface SheetArchive {
  links: SheetLink[];
  schema: number;
  sheets: SheetDocument[];
}
export interface SheetLink {
  sheet: string;
  target: SheetTarget;
}
export interface SheetDocument {
  format: SheetFormat;
  id: string;
  revision: string;
  source: string;
  title: string;
}
export interface SheetDelete {
  expected: string;
  registry_revision: string;
}
export interface SheetFailure {
  code: ErrorCode;
  damaged_sha256?: string | null;
  error: string;
}
export interface SheetLinkUpdate {
  expected: string;
  sheet?: string | null;
  target: SheetTarget;
}
export interface SheetLinks {
  durability_warning?: string | null;
  links: ResolvedSheetLink[];
  registry_revision: string;
}
export interface ResolvedSheetLink {
  available: boolean;
  sheet: string;
  target: SheetTarget;
}
export interface SheetMutation {
  durability_warning?: string | null;
  registry_revision: string;
  sheet: SheetDocument;
}
export interface SheetPage {
  next?: string | null;
  registry_revision: string;
  sheets: SheetSummary[];
}
export interface SheetSummary {
  format: SheetFormat;
  id: string;
  revision: string;
  title: string;
}
export interface SheetReferences {
  links: ResolvedSheetLink[];
  registry_revision: string;
  sheet_revision: string;
}
export interface SheetRestore {
  archive: SheetArchive;
  damaged_sha256?: string | null;
  expected?: string | null;
}
export interface SheetRestored {
  durability_warning?: string | null;
  registry_revision: string;
  restored: number;
}
export interface SheetWrite {
  expected: string;
  format: SheetFormat;
  source: string;
  title: string;
}
/**
 * The one split running on this device, wherever it was started.
 */
export interface CurrentSplit {
  job: SplitJob;
  source: string;
}
export interface SplitJob {
  error?: string | null;
  id: string;
  mode: SplitMode;
  phase: Phase;
  /**
   * Live progress while the job runs in this daemon; absent once stored.
   */
  progress?: SplitProgress | null;
  requestId: string;
}
export interface SplitProgress {
  /**
   * 0 to 100 across the whole job.
   */
  percent: number;
  stage: SplitStage;
}
export interface ImportStems {
  stems: StemUpload[];
  title: string;
}
export interface StemUpload {
  role: StemRole;
  upload: string;
}
export interface Update {
  expected: string;
  mix?: MixLink | null;
  target: Target;
}
export interface MixLink {
  mix: string;
  source: string;
}
export interface Target {
  preset: LibraryReference;
  scope: Scope;
}
export interface Links {
  links: Resolved[];
  revision: string;
}
export interface Resolved {
  asset?: string | null;
  mix: MixLink;
  target: Target;
  title?: string | null;
}
/**
 * Every song with stems, newest first, for Library's Stems tab.
 */
export interface SongList {
  songs: SongView[];
}
export interface SongView {
  mixes: SavedMix[];
  source: string;
  splits: Split[];
}
export interface SavedMix {
  asset: string;
  id: string;
  recipe: MixRecipe;
  revision: string;
  split: string;
  title: string;
}
/**
 * A separation worker publishes this manifest last. Each role has a fixed
 * filename and shares the rate, channel count and frame count.
 */
export interface Split {
  frames: number;
  id: string;
  importedRoles?: StemRole[] | null;
  mode: SplitMode;
  modelSha256?: string | null;
  rate: number;
  sourceSha256: string;
}
export interface MixRevision {
  id: string;
  revision: string;
}
export interface SaveMix {
  recipe: MixRecipe;
  /**
   * A new ID is returned when this field is absent (Save as).
   */
  replace?: MixRevision | null;
  split: string;
  title: string;
}
export interface Options {
  modes: SplitMode[];
}
export interface StartSplit {
  mode: SplitMode;
  requestId: string;
}
export interface StageModel {
  model_id: number;
  tone_id: number;
}
export interface StagedModel {
  id: string;
  model_id: number;
  name: string;
  sha256: string;
  title: string;
  tone_id: number;
}
export interface StartupState {
  error?: string | null;
  policy: StartupPolicy;
  /**
   * The library entry that will start, when one is chosen.
   */
  target?: LibraryReference | null;
}
export interface StartupUpdate {
  capture?: StartupCapture | null;
  expected?: StartupState | null;
  follow: boolean;
}
/**
 * Session cursor of the saved sound reviewed in the browser.
 * @see docs/audio.md
 */
export interface StartupCapture {
  owner: StartupOwner;
  revision: number;
  session: string;
}
export interface StorageRequest {
  mode: StorageMode;
}
export interface StorageState {
  available: boolean;
  current?: StorageMode | null;
  message: string;
  next_boot?: StorageMode | null;
  reboot_required: boolean;
}
export interface TerminalState {
  available: boolean;
  directory: string;
  identity: string;
  session?: TerminalSession | null;
}
export interface TerminalSession {
  bytes: number[];
  cursor: number;
  dropped: boolean;
  exit_code?: number | null;
  id: string;
  next_input: number;
  running: boolean;
  start: number;
}
export interface Page {
  data: Tone[];
  page?: number;
  total_pages?: number;
}
export interface ToneQuery {
  collection?: "favorites" | "downloaded" | "created" | "trending" | "latest";
  /**
   * Only tones of this gear type; none lists every type.
   */
  gear?: Gear | null;
  page?: number;
  query?: string;
}
/**
 * What the tuner view shows.
 */
export interface TunerState {
  /**
   * Audio is running, so there is an input to listen to.
   */
  available: boolean;
  enabled: boolean;
  /**
   * The outputs are muted (the tuner mutes them by default).
   */
  output_muted: boolean;
  reading?: TunerReading | null;
  /**
   * The tuner opened the interface itself: nothing else is playing, so
   * there is no sound to hear.
   */
  standalone?: boolean;
}
export interface TunerUpdate {
  enabled: boolean;
  /**
   * Also mute or unmute the outputs; omitted leaves them alone.
   */
  output_muted?: boolean | null;
}
export interface Validation {
  errors: string[];
  valid: boolean;
}
export interface VenueRequest {
  command: VenueCommand;
  expectedRevision: number;
}
export interface VenueState {
  active: string;
  bypass: boolean;
  destination: string;
  /**
   * Shown once, e.g. after an unsaved edit timed out.
   */
  notice?: string | null;
  preview?: VenuePreview | null;
  profiles: VenueProfile[];
  revision: number;
}
export interface VenuePreview {
  /**
   * The profile being edited.
   */
  base: string;
  /**
   * Temporarily hearing the saved profile instead of the edit.
   */
  compareSaved: boolean;
  eq: VenueSettings;
}
export interface VenueProfile {
  /**
   * Read-only starting point; Save makes a user copy.
   */
  builtin?: boolean;
  eq: VenueSettings;
  id: string;
  name: string;
  notes?: string;
  updatedAt?: string | null;
}
export interface VoiceList {
  captures: VoiceCapture[];
  /**
   * TONE3000 models already downloaded to this unit, for example in Tones
   * and IRs, that are not yet a capture: adding one needs no download.
   */
  downloaded?: DownloadedModel[];
}
export interface VoiceCapture {
  model_id: number;
  source: RigNativeSource;
  tone_id: number;
}
export interface DownloadedModel {
  model_id: number;
  tone_id: number;
}
export interface VoiceReady {
  capture: VoiceCapture;
  /**
   * False when the device already held this capture and nothing was downloaded.
   */
  downloaded: boolean;
}
export interface VoiceRequest {
  model_id: number;
  /**
   * The name the player sees in their library, normally the capture's own title.
   */
  name: string;
  tone_id: number;
}
