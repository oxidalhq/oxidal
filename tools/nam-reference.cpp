#include <algorithm>
#include <fstream>
#include <iostream>
#include <memory>
#include <vector>
#include "NAM/dsp.h"
#include "NAM/lstm.h"
#include "json.hpp"

// Independent pinned C++ oracle for project-authored synthetic NAM fixtures.
// @see docs/architecture.md
int main(int argc, char** argv) {
  if (argc != 2) return 2;
  nlohmann::json suite; std::ifstream(argv[1]) >> suite;
  nam::activations::Activation::using_fast_tanh = false;
  for (auto& item : suite["cases"]) {
    auto model = item["model"]; auto config = model["config"];
    auto weights = model["weights"].get<std::vector<float>>();
    std::unique_ptr<nam::DSP> dsp;
    if (model["architecture"] == "Linear") dsp = std::make_unique<nam::Linear>(1,1,config["receptive_field"],config["bias"],weights,48000);
    else dsp = std::make_unique<nam::lstm::LSTM>(1,1,config["num_layers"],1,config["hidden_size"],weights,48000);
    int remaining = item["warm_up"].get<int>();
    float zeros[64] = {}, warm[64] = {}; float* z[] = {zeros}; float* w[] = {warm};
    while (remaining > 0) { int count=std::min(64,remaining);dsp->process(z,w,count);remaining-=count; }
    auto input=item["input"].get<std::vector<float>>(); std::vector<float> output(input.size());
    for (size_t offset=0;offset<input.size();offset+=64) {
      float* in[] = {input.data()+offset}; float* out[] = {output.data()+offset};
      dsp->process(in,out,static_cast<int>(std::min<size_t>(64,input.size()-offset)));
    }
    item["expected"] = output;
  }
  std::cout << suite.dump(2) << '\n';
}
