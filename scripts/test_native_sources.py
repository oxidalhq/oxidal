"""Native source overlay integrity checks in the standard Python tooling suite."""
import difflib
import hashlib
import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location(
    'native_builder', Path(__file__).resolve().parents[1] / 'native/tone3000/build.py')


def sha(data):
    return hashlib.sha256(data).hexdigest()


class NativeSources(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.builder = importlib.util.module_from_spec(SPEC)
        SPEC.loader.exec_module(self.builder)
        b = self.builder
        b.ROOT = self.root
        b.BASE = self.root / '.local/tone3000'
        b.SOURCE = b.BASE / 'source'
        b.HERE = self.root / 'overlay'
        (b.HERE / 'patches').mkdir(parents=True)
        b.REPOSITORIES = {'tone3000': b.SOURCE, 'juce': b.SOURCE / 'libs/juce',
                          'audiodsp': b.SOURCE / 'plugin/AudioDSPTools'}
        for name, repo in b.REPOSITORIES.items():
            repo.mkdir(parents=True, exist_ok=True)
            self.git(repo, 'init', '-q')
            (repo / '.gitignore').write_text('libs/\nplugin/\n')
            (repo / 'model').write_text('fixture model')
            (repo / 'alias.h').write_text('before\n')
            (repo / 'unreviewed.h').write_text('unchanged\n')
            self.git(repo, 'add', '.')
            self.git(repo, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
                     '-c', 'core.hooksPath=/nonexistent', 'commit', '-qm', 'fixture')
        patch = ''.join(difflib.unified_diff(['before\n'], ['after\n'],
                                           fromfile='a/alias.h', tofile='b/alias.h')).encode()
        (b.HERE / 'patches/alias.patch').write_bytes(patch)
        b.PINS = {name: {'revision': b.revision(repo)} for name, repo in b.REPOSITORIES.items()}
        b.PINS.update({
            'patches': [{'namespace': 'audiodsp', 'path': 'alias.h', 'patch': 'alias.patch',
                         'before': sha(b'before\n'), 'after': sha(b'after\n'), 'patch_sha256': sha(patch)}],
            'submodules': [{'path': 'plugin/AudioDSPTools', 'revision': b.revision(b.REPOSITORIES['audiodsp'])}],
            'addons': [], 'qualification_model': {'path': 'model', 'sha256': sha(b'fixture model')},
        })

    @staticmethod
    def git(repo, *args):
        return subprocess.check_output(['git', '-C', str(repo), *args], stderr=subprocess.STDOUT)

    def test_exact_dependency_patch_is_repeatable(self):
        self.builder.prepare()
        target = self.builder.REPOSITORIES['audiodsp'] / 'alias.h'
        self.assertEqual(target.read_text(), 'after\n')
        self.builder.prepare()
        self.assertEqual(target.read_text(), 'after\n')

    def test_reviewed_previous_overlay_migrates_without_accepting_drift(self):
        b = self.builder
        target = b.REPOSITORIES['audiodsp'] / 'alias.h'
        target.write_text('previous overlay\n')
        b.PINS['patches'][0]['previous_after'] = [sha(b'previous overlay\n')]
        b.prepare()
        self.assertEqual(target.read_text(), 'after\n')
        b.prepare()
        self.assertEqual(target.read_text(), 'after\n')
        target.write_text('unreviewed overlay\n')
        with self.assertRaisesRegex(ValueError, 'Pinned patch input differs'):
            b.prepare()

    def test_reviewed_path_does_not_allow_unreviewed_bytes(self):
        self.builder.prepare()
        (self.builder.REPOSITORIES['audiodsp'] / 'alias.h').write_text('drift\n')
        with self.assertRaisesRegex(ValueError, 'Pinned patch input differs'):
            self.builder.prepare()

    def test_unreviewed_dependency_changes_are_rejected(self):
        (self.builder.REPOSITORIES['audiodsp'] / 'unreviewed.h').write_text('drift\n')
        with self.assertRaisesRegex(ValueError, 'Unreviewed submodule'):
            self.builder.prepare()

    def test_patch_artifact_tampering_is_rejected(self):
        (self.builder.HERE / 'patches/alias.patch').write_text('drift\n')
        with self.assertRaisesRegex(ValueError, 'Patch artifact differs'):
            self.builder.prepare()

    def test_external_git_directory_is_rejected(self):
        outside = self.root / 'outside'
        outside.mkdir()
        self.git(outside, 'init', '-q')
        linked = self.builder.SOURCE / 'external'
        linked.mkdir()
        (linked / '.git').write_text(f'gitdir: {outside / ".git"}\n')
        with self.assertRaisesRegex(ValueError, 'external Git'):
            self.builder.owned_checkout(linked)
