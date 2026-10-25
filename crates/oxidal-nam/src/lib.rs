use serde::Deserialize;

/// Supported inference scope, not a universal NAM compatibility claim.
/// @see docs/architecture.md
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ModelInfo {
    pub architecture: String,
    pub sample_rate: u32,
    pub version: String,
}

/// Allocation-free process failures. Rejected input does not advance model state.
/// @see docs/architecture.md
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProcessError {
    LengthMismatch,
    BlockTooLarge,
    NonFiniteInput,
    NonFiniteOutput,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct Document {
    version: String,
    architecture: String,
    config: serde_json::Value,
    sample_rate: u32,
    weights: Vec<f32>,
    metadata: Option<serde_json::Value>,
}
fn mono() -> usize {
    1
}
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct LinearConfig {
    receptive_field: usize,
    bias: bool,
    #[serde(default = "mono")]
    in_channels: usize,
    #[serde(default = "mono")]
    out_channels: usize,
}
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct LstmConfig {
    input_size: usize,
    hidden_size: usize,
    num_layers: usize,
    #[serde(default = "mono")]
    in_channels: usize,
    #[serde(default = "mono")]
    out_channels: usize,
}

/// Project-owned pure Rust inference. Parsing/preparation allocate; processing uses preallocated state.
/// @see docs/architecture.md
#[derive(Debug, Clone)]
pub struct Model {
    info: ModelInfo,
    engine: Engine,
    max_block: usize,
}
#[derive(Debug, Clone)]
enum Engine {
    Linear(Linear),
    Lstm(Lstm),
}
#[derive(Debug, Clone)]
struct Linear {
    taps: Vec<f32>,
    bias: f32,
    history: Vec<f32>,
    cursor: usize,
}
#[derive(Debug, Clone)]
struct Cell {
    input_size: usize,
    hidden_size: usize,
    weights: Vec<f32>,
    bias: Vec<f32>,
    hidden: Vec<f32>,
    cell: Vec<f32>,
    initial_hidden: Vec<f32>,
    initial_cell: Vec<f32>,
    gates: Vec<f32>,
}
#[derive(Debug, Clone)]
struct Lstm {
    layers: Vec<Cell>,
    head: Vec<f32>,
    bias: f32,
}

impl Model {
    /// Bounded loader for mono Linear/LSTM NAM 0.5.4 exports at their training sample rate.
    /// Other versions/architectures/channel layouts fail explicitly, including WaveNet/A2.
    /// @see docs/architecture.md
    pub fn from_json(bytes: &[u8], sample_rate: u32, max_block: usize) -> Result<Self, String> {
        if bytes.len() > 16 * 1024 * 1024 || !(1..=8192).contains(&max_block) {
            return Err("model_or_block_limit".into());
        }
        let document: Document =
            serde_json::from_slice(bytes).map_err(|e| format!("invalid_model_json: {e}"))?;
        if document.version != "0.5.4" {
            return Err("unsupported_model_version".into());
        }
        if !(8000..=192000).contains(&sample_rate) || document.sample_rate != sample_rate {
            return Err("sample_rate_mismatch".into());
        }
        if document.weights.len() > 1_000_000 || document.weights.iter().any(|w| !w.is_finite()) {
            return Err("invalid_weights".into());
        }
        // Metadata is retained by the asset layer; inference does not apply loudness/calibration gains.
        let _metadata = document.metadata;
        let engine = match document.architecture.as_str() {
            "Linear" => {
                let config: LinearConfig = serde_json::from_value(document.config)
                    .map_err(|_| "unsupported_linear_config")?;
                if config.in_channels != 1
                    || config.out_channels != 1
                    || !(1..=65536).contains(&config.receptive_field)
                {
                    return Err("unsupported_linear_shape".into());
                }
                if document.weights.len() != config.receptive_field + usize::from(config.bias) {
                    return Err("weight_count_mismatch".into());
                }
                Engine::Linear(Linear {
                    taps: document.weights[..config.receptive_field].to_vec(),
                    bias: if config.bias {
                        document.weights[config.receptive_field]
                    } else {
                        0.0
                    },
                    history: vec![0.0; config.receptive_field],
                    cursor: 0,
                })
            }
            "LSTM" => {
                let config: LstmConfig = serde_json::from_value(document.config)
                    .map_err(|_| "unsupported_lstm_config")?;
                let h = config.hidden_size;
                if config.input_size != 1
                    || config.in_channels != 1
                    || config.out_channels != 1
                    || !(1..=64).contains(&h)
                    || !(1..=4).contains(&config.num_layers)
                {
                    return Err("unsupported_lstm_shape".into());
                }
                let expected = (0..config.num_layers)
                    .map(|layer| 4 * h * (if layer == 0 { 1 } else { h } + h) + 6 * h)
                    .sum::<usize>()
                    + h
                    + 1;
                if document.weights.len() != expected {
                    return Err("weight_count_mismatch".into());
                }
                let mut offset = 0;
                let mut take = |count: usize| {
                    let values = document.weights[offset..offset + count].to_vec();
                    offset += count;
                    values
                };
                let mut layers = Vec::with_capacity(config.num_layers);
                for layer in 0..config.num_layers {
                    let input = if layer == 0 { 1 } else { h };
                    let weights = take(4 * h * (input + h));
                    let bias = take(4 * h);
                    let hidden = take(h);
                    let cell = take(h);
                    layers.push(Cell {
                        input_size: input,
                        hidden_size: h,
                        weights,
                        bias,
                        initial_hidden: hidden.clone(),
                        initial_cell: cell.clone(),
                        hidden,
                        cell,
                        gates: vec![0.0; 4 * h],
                    });
                }
                Engine::Lstm(Lstm {
                    layers,
                    head: take(h),
                    bias: take(1)[0],
                })
            }
            _ => return Err("unsupported_architecture".into()),
        };
        Ok(Self {
            info: ModelInfo {
                architecture: document.architecture,
                sample_rate,
                version: document.version,
            },
            engine,
            max_block,
        })
    }

    /// Describes only the model actually loaded; does not imply appliance/audio readiness.
    /// @see docs/architecture.md
    pub fn info(&self) -> &ModelInfo {
        &self.info
    }

    /// Restores serialized initial recurrent state or clears convolution history without allocation.
    /// @see docs/architecture.md
    pub fn reset(&mut self) {
        match &mut self.engine {
            Engine::Linear(linear) => {
                linear.history.fill(0.0);
                linear.cursor = 0;
            }
            Engine::Lstm(lstm) => {
                for layer in &mut lstm.layers {
                    layer.hidden.copy_from_slice(&layer.initial_hidden);
                    layer.cell.copy_from_slice(&layer.initial_cell);
                    layer.gates.fill(0.0);
                }
            }
        }
    }

    /// Explicit non-RT prewarming; bounded to two seconds. Exact upstream comparison uses the same sample count.
    /// @see docs/architecture.md
    pub fn warm_up(&mut self, samples: u32) -> Result<(), String> {
        if samples > self.info.sample_rate * 2 {
            return Err("warmup_limit".into());
        }
        for _ in 0..samples {
            if !self.sample(0.0).is_finite() {
                self.reset();
                return Err("non_finite_warmup".into());
            }
        }
        Ok(())
    }

    /// Processes finite mono samples without resizing, locking, I/O, or allocation.
    /// Output is silenced on failure; internal numeric overflow also resets recurrent state.
    /// @see docs/architecture.md
    pub fn process(&mut self, input: &[f32], output: &mut [f32]) -> Result<(), ProcessError> {
        let error = if input.len() != output.len() {
            Some(ProcessError::LengthMismatch)
        } else if input.len() > self.max_block {
            Some(ProcessError::BlockTooLarge)
        } else if input.iter().any(|x| !x.is_finite()) {
            Some(ProcessError::NonFiniteInput)
        } else {
            None
        };
        if let Some(error) = error {
            output.fill(0.0);
            return Err(error);
        }
        for (sample, result) in input.iter().zip(output.iter_mut()) {
            *result = self.sample(*sample);
            if !result.is_finite() {
                output.fill(0.0);
                self.reset();
                return Err(ProcessError::NonFiniteOutput);
            }
        }
        Ok(())
    }
    fn sample(&mut self, input: f32) -> f32 {
        match &mut self.engine {
            Engine::Linear(linear) => {
                linear.history[linear.cursor] = input;
                let mut result = linear.bias;
                for (delay, tap) in linear.taps.iter().enumerate() {
                    let index =
                        (linear.cursor + linear.history.len() - delay) % linear.history.len();
                    result += tap * linear.history[index];
                }
                linear.cursor = (linear.cursor + 1) % linear.history.len();
                result
            }
            Engine::Lstm(lstm) => {
                for index in 0..lstm.layers.len() {
                    let (previous, remaining) = lstm.layers.split_at_mut(index);
                    let layer = &mut remaining[0];
                    for row in 0..4 * layer.hidden_size {
                        let mut sum = layer.bias[row];
                        for col in 0..layer.input_size {
                            let x = if index == 0 {
                                input
                            } else {
                                previous[index - 1].hidden[col]
                            };
                            sum += layer.weights
                                [row * (layer.input_size + layer.hidden_size) + col]
                                * x;
                        }
                        for col in 0..layer.hidden_size {
                            sum += layer.weights[row * (layer.input_size + layer.hidden_size)
                                + layer.input_size
                                + col]
                                * layer.hidden[col];
                        }
                        layer.gates[row] = sum;
                    }
                    let h = layer.hidden_size;
                    let sigmoid = |x: f32| 1.0 / (1.0 + (-x).exp());
                    for n in 0..h {
                        layer.cell[n] = sigmoid(layer.gates[h + n]) * layer.cell[n]
                            + sigmoid(layer.gates[n]) * layer.gates[2 * h + n].tanh();
                        layer.hidden[n] = sigmoid(layer.gates[3 * h + n]) * layer.cell[n].tanh();
                    }
                }
                let last = &lstm.layers[lstm.layers.len() - 1].hidden;
                lstm.head
                    .iter()
                    .zip(last)
                    .fold(lstm.bias, |sum, (w, h)| sum + w * h)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn linear() -> Vec<u8> {
        br#"{"version":"0.5.4","architecture":"Linear","config":{"receptive_field":3,"bias":true},"sample_rate":48000,"weights":[1,0.5,-0.25,0.1]}"#.to_vec()
    }
    #[test]
    fn causal_convolution_state_survives_block_boundaries_and_reset() {
        let mut model = Model::from_json(&linear(), 48000, 64).unwrap();
        let mut first = [0.0; 2];
        let mut second = [0.0; 2];
        model.process(&[1.0, 0.0], &mut first).unwrap();
        model.process(&[0.0, 0.0], &mut second).unwrap();
        assert!((first[0] - 1.1).abs() < 1e-6);
        assert!((first[1] - 0.6).abs() < 1e-6);
        assert!((second[0] + 0.15).abs() < 1e-6);
        model.reset();
        model.process(&[1.0, 0.0], &mut first).unwrap();
        assert!((first[0] - 1.1).abs() < 1e-6);
    }
    #[test]
    fn rejects_unqualified_models_and_bad_processing_without_advancing_state() {
        assert!(Model::from_json(&linear(), 44100, 64).is_err());
        let unsupported = String::from_utf8(linear())
            .unwrap()
            .replace("Linear", "WaveNet");
        assert!(Model::from_json(unsupported.as_bytes(), 48000, 64).is_err());
        let mut model = Model::from_json(&linear(), 48000, 2).unwrap();
        let mut out = [7.0; 2];
        assert_eq!(
            model.process(&[f32::NAN, 0.0], &mut out),
            Err(ProcessError::NonFiniteInput)
        );
        assert_eq!(out, [0.0; 2]);
        model.process(&[1.0, 0.0], &mut out).unwrap();
        assert!((out[0] - 1.1).abs() < 1e-6);
        assert_eq!(
            model.process(&[0.0], &mut out),
            Err(ProcessError::LengthMismatch)
        );
        assert_eq!(
            model.process(&[0.0; 3], &mut [0.0; 3]),
            Err(ProcessError::BlockTooLarge)
        );
    }
}
