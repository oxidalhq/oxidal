// Copyright (c) 2026 PiPedal contributors (adapter, ported to Oxidal)
// SPDX-License-Identifier: MIT
#include "../OxidalPitch.hpp"
#include <dlfcn.h>
#include <array>
#include <cstring>
#include <iostream>
#include <stdexcept>

/** Load the actual module artifact and exercise both exported descriptors.
 * @see docs/native-pitch.md
 */
int main(int argc, char** argv) {
    try {
        if (argc != 2) throw std::runtime_error("Expected module path");
        auto* module = dlopen(argv[1], RTLD_NOW | RTLD_LOCAL);
        if (!module) throw std::runtime_error(dlerror());
        const auto descriptors = reinterpret_cast<const LV2_Descriptor*(*)(uint32_t)>(dlsym(module, "lv2_descriptor"));
        if (!descriptors || descriptors(2)) throw std::runtime_error("Invalid LV2 descriptor export");
        for (uint32_t index = 0; index < 2; ++index) {
            const auto* descriptor = descriptors(index);
            if (!descriptor || std::strcmp(descriptor->URI, index ? oxidal_pitch::StereoUri : oxidal_pitch::MonoUri))
                throw std::runtime_error("Artifact URI differs from public contract");
            auto instance = descriptor->instantiate(descriptor, 48000, nullptr, nullptr);
            if (!instance) throw std::runtime_error("Artifact instantiate failed");
            std::array<float, 5> controls{0, -7, 1, 20000, 1}; float latency = -1;
            for (uint32_t port = 0; port < 5; ++port) descriptor->connect_port(instance, port, &controls[port]);
            descriptor->connect_port(instance, oxidal_pitch::Latency, &latency);
            float inputMode = 0;
            descriptor->connect_port(instance, oxidal_pitch::InputMode, &inputMode);
            std::array<float, 16> left{.1f,.2f,-.3f,.4f}, right{-.2f,.3f,-.1f,.7f}, outL{}, outR{};
            descriptor->connect_port(instance, oxidal_pitch::InputL, left.data());
            descriptor->connect_port(instance, oxidal_pitch::OutputL, outL.data());
            if (index) {
                descriptor->connect_port(instance, oxidal_pitch::InputR, right.data());
                descriptor->connect_port(instance, oxidal_pitch::OutputR, outR.data());
            }
            descriptor->activate(instance); descriptor->run(instance, 16);
            if (left != outL || (index && right != outR) || latency != 0) throw std::runtime_error("Artifact bypass failed");
            inputMode = 2; descriptor->run(instance, 16);
            if ((index && (outL != right || outR != right)) || (!index && outL != left))
                throw std::runtime_error("Artifact source selection port failed");
            inputMode = 0;
            controls[0] = 1; descriptor->run(instance, 16);
            if (latency != 768) throw std::runtime_error("Artifact latency port failed");
            descriptor->deactivate(instance); descriptor->cleanup(instance);
        }
        dlclose(module);
        std::cout << "Actual LV2 module exports and mono/stereo lifecycle passed.\n";
        return 0;
    } catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
}
