/* Generated from Rust. Run pnpm contract:generate; do not edit. */

export type AudioAction =
  | {
      kind: "start";
      settings: StartAudio;
    }
  | {
      kind: "stop";
    }
  | {
      kind: "restart";
    }
  | {
      enabled: boolean;
      kind: "set_boot";
    };
export type Direction = "capture" | "playback";
export type SampleFormat = "s16" | "s24" | "s24_packed" | "s32" | "float";
export type AudioPhase = "unavailable" | "stopped" | "starting" | "running" | "stopping" | "failed";
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
export type BlockKind = "input" | "nam" | "cabinet" | "lv2" | "delay" | "reverb" | "output";
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
export type GraphAudioAction =
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
      command: Command;
      kind: "control";
    };
export type Framing = "legacy" | "current";
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
    };

/**
 * Schema generation root. Rust wire types are the contract source of truth.
 * @see docs/architecture.md
 */
export interface Contract {
  audio_command: AudioCommand;
  audio_devices: AudioDevices;
  audio_probe: AudioProbe;
  audio_probe_result: AudioProbeResult;
  audio_state: AudioState;
  capabilities: Capabilities;
  command: Command;
  error: ApiError;
  graph_audio_command: GraphAudioCommand;
  graph_audio_state: GraphAudioState;
  library: Library;
  native_command: EditorCommand;
  native_editor: EditorSnapshot;
  preset: Inspection;
  rig: Rig;
  snapshot: Snapshot;
  validation: Validation;
}
export interface AudioCommand {
  action: AudioAction;
  expected_revision: number;
  session: string;
}
export interface StartAudio {
  owned: boolean;
  /**
   * Immutable imported/owned preset identity, never a browser-supplied file path.
   */
  preset_id: string;
  stream: StreamConfig;
}
export interface StreamConfig {
  input: AudioProbe;
  /**
   * Zero-based channels; duplicate input indexes copy mono to both processor channels.
   *
   * @minItems 2
   * @maxItems 2
   */
  input_map: [number, number];
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
  configured?: StartAudio | null;
  /**
   * Remains true until the worker is reaped, including failed shutdowns.
   */
  device_owned: boolean;
  error?: string | null;
  experimental: boolean;
  phase: AudioPhase;
  revision: number;
  session: string;
  /**
   * Explicitly opt in to restoring this saved preset/device configuration after daemon startup.
   */
  start_on_boot: boolean;
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
  rig: Rig;
  stream: StreamConfig;
}
export interface Binding {
  node: string;
  uri: string;
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
  session: string;
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
export interface EditorCommand {
  action: EditorAction;
  expected_revision: number;
  request_id: string;
  session: string;
}
export interface EditorSnapshot {
  block_controls: BlockControl[];
  dirty: boolean;
  edit?: Editing | null;
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
export interface OwnedPreset {
  id: string;
  preset: Inspection;
  source_sha256: string;
}
export interface Parameter2 {
  automatable: boolean;
  default: number;
  id: string;
  interval: number;
  machine_default: boolean;
  maximum: number;
  minimum: number;
  normalized: number;
  tone: boolean;
  value: number;
}
export interface Validation {
  errors: string[];
  valid: boolean;
}
