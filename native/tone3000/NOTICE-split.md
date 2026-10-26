# Split-stage source attribution

`split.h` adapts `Tone3000Preset::PartitionAmpCab`, its asset validators, and
`Tone3000MixMatch` pitch extraction from PiPedal commit
`d7d627fe77d87ec9e6eaa4a40cc8f801c4063d2f`.

Copyright (c) 2026 PiPedal contributors.

The port uses JUCE ValueTree serialization and native parameter descriptors,
returns opaque stage states to Rust, and leaves the source processor unchanged.
It does not include PiPedal factory presets or their assets.

Original content in this project is covered under the following license.

MIT License

© Robin E.R. Davies

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the "Software"),
to deal in the Software without restriction, including without limitation
the rights to use, copy, modify, merge, publish, distribute, sublicense,
and/or sell copies of the Software, and to permit persons to whom the
Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
