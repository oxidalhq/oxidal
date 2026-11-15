"""Clean code rule for Oxidal's own effects. See docs/native-effects.md."""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
# Oxidal's own effects in Rust, and the crates they share.
CRATES = ['oxidal-dsp', 'oxidal-lv2-plugin', 'oxidal-bloom', 'oxidal-sustain', 'oxidal-echo', 'oxidal-motion']
# Earlier original effects in C++ (no references file was kept for them).
NATIVE = ['hold', 'swell']
NAMES = re.compile(
    r'strymon|big ?sky|capistan|volante|sustainiac|freqout|guitarix|freeverb|'
    r'cloud ?seed|dragonfly|airwindows|rakarrack|\bjuce\b|\bfaust\b|daisysp',
    re.IGNORECASE,
)
TEXT = {'.rs', '.toml', '.ttl', '.md', '.cpp', '.hpp', '.h', '.txt', ''}


def dependencies(manifest: str):
    """Names in every dependency table of a Cargo manifest."""
    names, inside = [], False
    for line in manifest.splitlines():
        header = re.match(r'\s*\[([^\]]+)\]', line)
        if header:
            inside = header.group(1).split('.')[-1].endswith('dependencies')
        elif inside and (entry := re.match(r'\s*([A-Za-z0-9_-]+)\s*[.=]', line)):
            names.append(entry.group(1))
    return names


def directories():
    return [ROOT / 'crates' / name for name in CRATES] + [ROOT / 'native' / name for name in NATIVE]


class EffectsCleanTests(unittest.TestCase):
    def test_notice_states_original_code(self):
        for directory in directories():
            notice = (directory / 'NOTICE').read_text()
            self.assertIn('Original code', notice, directory.name)
            self.assertIn('No third-party DSP', notice, directory.name)

    def test_references_file_exists(self):
        for name in CRATES:
            record = ROOT / 'crates' / name / 'REFERENCES.md'
            self.assertTrue(record.is_file(), f'{name}: REFERENCES.md is missing')
            rows = [line for line in record.read_text().splitlines() if line.startswith('| ')]
            self.assertGreaterEqual(len(rows), 3, f'{name}: references table is empty')

    def test_rust_effects_depend_only_on_oxidal_crates(self):
        for name in CRATES:
            for dependency in dependencies((ROOT / 'crates' / name / 'Cargo.toml').read_text()):
                self.assertIn(dependency, CRATES, f'{name} depends on {dependency}')
            self.assertFalse((ROOT / 'crates' / name / 'build.rs').exists(), f'{name}: build script')

    def test_unsafe_code_stays_in_the_plugin_interface(self):
        for name in CRATES:
            if name == 'oxidal-lv2-plugin':
                continue
            for source in (ROOT / 'crates' / name).rglob('*.rs'):
                text = source.read_text()
                self.assertNotIn('unsafe', text.replace('unsafe_code', ''), str(source.relative_to(ROOT)))

    def test_no_maker_or_third_party_names(self):
        for directory in directories():
            for path in directory.rglob('*'):
                if path.is_file() and path.suffix in TEXT:
                    match = NAMES.search(path.read_text(errors='ignore'))
                    self.assertIsNone(match, f'{path.relative_to(ROOT)}: "{match.group(0) if match else ""}"')


if __name__ == '__main__':
    unittest.main()
