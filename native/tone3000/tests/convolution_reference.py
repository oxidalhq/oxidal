"""Extract the pinned upstream and reviewed engines for exact scheduling comparison.

Generated headers remain build artifacts; no second vendored implementation is kept.
"""
import hashlib
import json
from pathlib import Path
import subprocess
import sys

source, output = map(Path, sys.argv[1:])
pins = json.loads((Path(__file__).resolve().parents[1] / 'sources.json').read_text())
relative = 'modules/juce_dsp/frequency/juce_Convolution.cpp'
record = next(p for p in pins['patches'] if p['namespace'] == 'juce' and p['path'] == relative)
original = subprocess.check_output(['git', '-c', 'safe.directory=' + str(source), 'show', pins['juce']['revision'] + ':' + relative], cwd=source).replace(b'\r\n', b'\n')
changed = (source / relative).read_bytes().replace(b'\r\n', b'\n')
result = '#pragma once\n#include <juce_dsp/juce_dsp.h>\nnamespace juce::dsp {\n'
for name, text, checksum in [('ReferenceConvolutionEngine', original, record['before']), ('ScheduledConvolutionEngine', changed, record['after'])]:
    if hashlib.sha256(text).hexdigest() != checksum:
        raise ValueError('Convolution qualification source differs from reviewed hash')
    text = text.decode()
    start = text.index('struct ConvolutionEngine\n')
    end = text.index('class MultichannelEngine\n', start)
    result += text[start:end].replace('ConvolutionEngine', name) + '\n'
output.write_text(result + '}\n')
