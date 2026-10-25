use oxidal_nam::Model;
use serde::Deserialize;

#[derive(Deserialize)]
struct Suite {
    cases: Vec<Case>,
}
#[derive(Deserialize)]
struct Case {
    name: String,
    model: serde_json::Value,
    warm_up: u32,
    input: Vec<f32>,
    expected: Vec<f32>,
}

#[test]
fn matches_pinned_cpp_oracle_with_no_process_allocations() {
    let suite: Suite = serde_json::from_str(include_str!("fixtures/parity.json")).unwrap();
    for case in suite.cases {
        let mut model =
            Model::from_json(&serde_json::to_vec(&case.model).unwrap(), 48000, 64).unwrap();
        assert_eq!(model.info().version, "0.5.4");
        model.warm_up(case.warm_up).unwrap();
        let mut output = vec![0.0; case.input.len()];
        let allocations = allocation_counter::measure(|| {
            for (input, output) in case.input.chunks(64).zip(output.chunks_mut(64)) {
                model.process(input, output).unwrap();
            }
        });
        assert_eq!(allocations.count_total, 0, "{} allocated", case.name);
        let maximum = output
            .iter()
            .zip(&case.expected)
            .map(|(a, b)| (a - b).abs())
            .fold(0.0_f32, f32::max);
        assert!(maximum <= 4e-6, "{} maximum error {}", case.name, maximum);
        model.reset();
        model.warm_up(case.warm_up).unwrap();
        for (input, output) in case.input.chunks(7).zip(output.chunks_mut(7)) {
            model.process(input, output).unwrap();
        }
        let split_error = output
            .iter()
            .zip(&case.expected)
            .map(|(a, b)| (a - b).abs())
            .fold(0.0_f32, f32::max);
        assert!(
            split_error <= 4e-6,
            "{} split error {}",
            case.name,
            split_error
        );
    }
}
