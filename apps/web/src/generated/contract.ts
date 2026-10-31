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
    };
export type BranchMode = "toggle" | "gate";
export type Target =
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
export type Direction = "capture" | "playback";
export type SampleFormat = "s16" | "s24" | "s24_packed" | "s32" | "float";
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
export type Phase = "idle" | "listening" | "done" | "timeout";
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
export type ModelPhase = "verifying" | "preparing" | "ready" | "applying" | "applied" | "failed" | "cancelled";
export type AudioPhase = "unavailable" | "stopped" | "starting" | "running" | "stopping" | "failed";
export type CalibrationAction = "run" | "run_all" | "cancel" | "reset";
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
export type GraphAudioAction =
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
export type Framing = "legacy" | "current";
export type LibraryKind = "original" | "owned" | "graph" | "rig";
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
    };
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
      type: "status";
    }
  | {
      type: "scan";
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
    };
export type PowerAction = "reboot" | "shutdown";
export type Mode = "never" | "no_ethernet" | "not_at_home" | "no_remembered" | "always";
export type RigAudioAction =
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

/**
 * Schema generation root. Rust wire types are the contract source of truth.
 * @see docs/architecture.md
 */
export interface Contract {
  account_command: AccountCommand;
  account_state: AccountState;
  artwork: AssetArtwork[];
  audio_command: AudioCommand;
  audio_devices: AudioDevices;
  audio_probe: AudioProbe;
  audio_probe_result: AudioProbeResult;
  audio_state: AudioState;
  boost_update: BoostUpdate;
  boosts: BoostState;
  calibration: CalibrationState;
  calibration_command: CalibrationCommand;
  capabilities: Capabilities;
  command: Command;
  control_audit: AuditHistory;
  debug_command: Command2;
  debug_state: State;
  error: ApiError;
  graph_audio_command: GraphAudioCommand;
  graph_audio_state: GraphAudioState;
  graph_presets: SavedGraph[];
  guitars: Guitars;
  library: Library;
  library_catalog: LibraryCatalog;
  library_update: LibraryUpdate;
  local_model: LocalModel;
  local_model_page: LocalModelPage;
  lv2_catalog: PluginCatalog;
  midi_devices: Devices;
  model_page: Page2;
  model_query: ModelQuery;
  monitoring: Monitoring;
  monitoring_history: History;
  native_command: EditorCommand;
  native_defaults: NativeDefaults;
  native_defaults_update: NativeDefaultsUpdate;
  native_editor: EditorSnapshot;
  network_command: Command3;
  network_state: NetworkState;
  preset: Inspection;
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
  snapshot: Snapshot;
  stage_model: StageModel;
  staged_model: StagedModel;
  terminal_command: TerminalCommand;
  terminal_state: TerminalState;
  tone_page: Page;
  tone_query: ToneQuery;
  unit_levels: HostLevels;
  validation: Validation;
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
 * Device-local configuration, deliberately absent from portable sound data.
 */
export interface Settings2 {
  bindings: Binding2[];
  branch_bindings?: BranchBinding[];
  /**
   * 0 accepts all MIDI channels; otherwise 1–16.
   */
  channel: number;
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
export interface ParameterBinding {
  controller: number;
  mode?: "absolute" | "toggle" | "relative_twos_complement" | "relative_offset64";
  target: Target;
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
  state: Phase;
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
export interface ApiError {
  error: string;
}
export interface GraphAudioCommand {
  action: GraphAudioAction;
  expected_revision: number;
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
  hear_yourself: boolean;
  levels?: HostLevels2;
  /**
   * The calibration measurement while the reference riff plays.
   */
  reference?: ReferenceReading | null;
  test_tone_active: boolean;
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
  items: LibraryItem[];
  revision: string;
}
export interface LibraryItem {
  archived: boolean;
  id: string;
  kind: LibraryKind;
  name: string;
  source_name: string;
}
export interface LibraryUpdate {
  action: LibraryAction;
  entry_kind: LibraryKind;
  expected_revision: string;
  id: string;
}
export interface LibraryReference {
  id: string;
  kind: LibraryKind;
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
  /**
   * The declared author or maker, used to group effects by source.
   */
  author?: string | null;
  /**
   * The LV2 class label, such as "Delay" or "Reverb", when one is declared.
   */
  category?: string | null;
  name: string;
  ports: Port[];
  unsupported?: string | null;
  uri: string;
}
export interface Port {
  atom?: boolean;
  audio: boolean;
  control: boolean;
  default?: number | null;
  index: number;
  input: boolean;
  integer: boolean;
  latency: boolean;
  logarithmic: boolean;
  maximum?: number | null;
  minimum?: number | null;
  output: boolean;
  symbol: string;
  toggled: boolean;
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
export interface Monitoring {
  audio?: Snapshot2 | null;
  audio_age_ms?: number | null;
  audio_phase: string;
  error?: string | null;
  graph_phase: string;
  host: Host;
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
  available: boolean;
  interfaces: Interface[];
  message: string;
  networks: AccessPoint[];
  pending?: Pending | null;
  policy?: Settings | null;
  radio?: Radio | null;
  saved: SavedNetwork[];
  wireless_enabled: boolean;
}
export interface Interface {
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
  uuid: string;
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
export interface ModelRemoval {
  bytes: number;
  format: string;
  id: string;
  name: string;
  protected_by: string[];
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
  target: Target;
  value: number;
}
export interface NodeWorking {
  node: string;
  receipt: string;
}
export interface ControlCommand {
  expected_revision: number;
  session: string;
  target: Target;
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
}
export interface Snapshot3 {
  authoring?: NodeAuthoring[];
  branches?: BranchState[];
  buffer_bytes: number;
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
export interface Control {
  display: string;
  integer: boolean;
  label: string;
  logarithmic: boolean;
  maximum: number;
  minimum: number;
  target: Target;
  toggle: boolean;
  value: number;
}
export interface Status1 {
  connected: boolean;
  error?: string | null;
  events: number;
  last?: Message | null;
}
export interface NodeModelChange {
  node: string;
  progress: ModelProgress;
}
export interface PreparedStatus {
  error?: string | null;
  modified: boolean;
  name: string;
  revision: string;
}
export interface Scenes {
  branches?: Scene[];
  fade_ms: number;
  scenes: Scene[];
}
export interface Scene {
  gains: SceneGain[];
  id: string;
  name: string;
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
  name: string;
  native_instances: number;
  revision: string;
  /**
   * Scene names in pad order; empty for a preset without scenes.
   */
  scenes?: string[];
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
export interface Validation {
  errors: string[];
  valid: boolean;
}
