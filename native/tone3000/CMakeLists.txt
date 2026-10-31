cmake_minimum_required(VERSION 3.24)
project(OxidalTone3000 LANGUAGES C CXX)
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)
if(NOT APPLE AND NOT CMAKE_SYSTEM_NAME STREQUAL "Linux")
  message(FATAL_ERROR "Native qualification supports macOS and Linux")
endif()
if(NOT TONE3000_SOURCE)
  message(FATAL_ERROR "Use the repository native build command to supply verified dependencies")
endif()
add_subdirectory("${TONE3000_SOURCE}/libs/juce" "${CMAKE_BINARY_DIR}/juce" EXCLUDE_FROM_ALL)
set(NAM_SRC "${TONE3000_SOURCE}/plugin/NeuralAmpModelerCore/NAM")
add_library(NAM STATIC
  ${NAM_SRC}/activations.cpp ${NAM_SRC}/conv1d.cpp ${NAM_SRC}/container.cpp
  ${NAM_SRC}/convnet.cpp ${NAM_SRC}/dsp.cpp ${NAM_SRC}/get_dsp.cpp
  ${NAM_SRC}/linear.cpp ${NAM_SRC}/lstm.cpp ${NAM_SRC}/ring_buffer.cpp ${NAM_SRC}/util.cpp
  ${NAM_SRC}/wavenet/a2_fast.cpp ${NAM_SRC}/wavenet/model.cpp ${NAM_SRC}/wavenet/slimmable.cpp)
target_include_directories(NAM PUBLIC
  "${TONE3000_SOURCE}/plugin/NeuralAmpModelerCore"
  "${TONE3000_SOURCE}/plugin/NeuralAmpModelerCore/Dependencies/eigen"
  "${TONE3000_SOURCE}/plugin/NeuralAmpModelerCore/Dependencies/nlohmann")
target_compile_definitions(NAM PRIVATE NAM_ENABLE_A2_FAST)
set_target_properties(NAM PROPERTIES CXX_VISIBILITY_PRESET hidden VISIBILITY_INLINES_HIDDEN TRUE)
set(PROCESSOR_SOURCES AutoOffset BlockEq BlockSpectrum LegacyParamIds MidiMapper NamEngine
  PresetFile PresetManager Processor ProcessorChain ProcessorHistory ProcessorModelLoader
  ProcessorPresets ProcessorState Spread StandaloneStateAutosave PitchShift StereoOffset
  TunerDetector Tone3000StageSession)
add_library(oxidal_tone3000 SHARED bridge.cpp)
foreach(name IN LISTS PROCESSOR_SOURCES)
  target_sources(oxidal_tone3000 PRIVATE "${TONE3000_SOURCE}/plugin/src/${name}.cpp")
endforeach()
target_include_directories(oxidal_tone3000 PRIVATE
  "${TONE3000_SOURCE}/plugin/include"
  "${TONE3000_SOURCE}/plugin/AudioDSPTools"
  "${TONE3000_SOURCE}/plugin/AudioDSPTools/dsp/ResamplingContainer/Dependencies"
  "${TONE3000_SOURCE}/plugin/NeuralAmpModelerCore"
  "${TONE3000_SOURCE}/plugin/NeuralAmpModelerCore/Dependencies/eigen"
  "${TONE3000_SOURCE}/plugin/NeuralAmpModelerCore/Dependencies/nlohmann")
target_compile_definitions(oxidal_tone3000 PRIVATE HEADLESS=1 JUCE_WEB_BROWSER=0
  JUCE_USE_WEBP=0 JUCE_USE_CURL=0 JUCE_MODAL_LOOPS_PERMITTED=1 NAM_ENABLE_A2_FAST)
target_compile_options(oxidal_tone3000 PRIVATE -fsigned-char)
target_link_libraries(oxidal_tone3000 PRIVATE juce::juce_dsp juce::juce_audio_formats
  juce::juce_audio_processors "$<LINK_LIBRARY:WHOLE_ARCHIVE,NAM>"
  juce::juce_recommended_config_flags)
add_dependencies(oxidal_tone3000 NAM)
set_target_properties(oxidal_tone3000 PROPERTIES CXX_VISIBILITY_PRESET hidden VISIBILITY_INLINES_HIDDEN TRUE)

include(CTest)
if(BUILD_TESTING)
  find_package(Python3 REQUIRED COMPONENTS Interpreter)
  execute_process(COMMAND "${Python3_EXECUTABLE}"
    "${CMAKE_CURRENT_SOURCE_DIR}/tests/convolution_reference.py"
    "${TONE3000_SOURCE}/libs/juce" "${CMAKE_CURRENT_BINARY_DIR}/convolution-engines.h"
    COMMAND_ERROR_IS_FATAL ANY)
  add_executable(convolution_schedule_test tests/ConvolutionSchedule.cpp)
  target_include_directories(convolution_schedule_test PRIVATE "${CMAKE_CURRENT_BINARY_DIR}")
  target_compile_definitions(convolution_schedule_test PRIVATE
    JUCE_GLOBAL_MODULE_SETTINGS_INCLUDED=1 JUCE_USE_CURL=0 JUCE_WEB_BROWSER=0)
  target_link_libraries(convolution_schedule_test PRIVATE juce::juce_dsp)
  add_test(NAME convolution-schedule-equivalence COMMAND convolution_schedule_test)
endif()
