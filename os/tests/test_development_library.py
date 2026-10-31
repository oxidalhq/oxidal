import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('development_library', Path(__file__).parents[1] / 'scripts/development_library.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class DevelopmentLibraryTests(unittest.TestCase):
    def archive(self, path, extra):
        with tarfile.open(path, 'w') as tar:
            entries = [('manifest.json', json.dumps({'format': 1, 'content': 'Oxidal library backup'}).encode()), ('presets', None), *extra]
            for name, data in entries:
                info = tarfile.TarInfo(name)
                if data is None:
                    info.type = tarfile.DIRTYPE
                elif isinstance(data, tarfile.TarInfo):
                    tar.addfile(data)
                    continue
                else:
                    info.size = len(data)
                tar.addfile(info, io.BytesIO(data) if data is not None else None)

    def test_preserves_library_and_strips_credentials_and_autostart(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source, target = root / 'backup.tar', root / 'overlay.tar'
            self.archive(source, [('presets/audition-models/sample.wav', b'IR bytes'),
                ('presets/accounts/tone3000-account.json', b'secret'),
                ('presets/boot-audio.json', b'autostart'), ('mappings.json', b'{}')])
            report = module.overlay(source, target)
            self.assertEqual([f['path'] for f in report['files']], ['presets/audition-models/sample.wav', 'mappings.json'])
            with tarfile.open(target) as tar:
                self.assertEqual(tar.extractfile('var/lib/oxidal/presets/audition-models/sample.wav').read(), b'IR bytes')
                self.assertFalse(any('accounts' in n or 'boot-audio' in n for n in tar.getnames()))
                self.assertTrue(all(m.uid == 0 and m.gid == 0 for m in tar))
                self.assertIn('var/lib/oxidal/factory-installed.json', tar.getnames())
            with self.assertRaises(ValueError):
                module.overlay(source, target)

    def test_rejects_before_output_for_unsafe_paths_duplicates_links_and_collisions(self):
        link = tarfile.TarInfo('presets/link')
        link.type, link.linkname = tarfile.SYMTYPE, '/etc'
        for entries in [[('presets/../escape', b'x')], [('presets/a', b'x'), ('presets/a', b'y')],
                        [('presets/link', link)], [('presets/file', b'x'), ('presets/file/child', b'y')]]:
            with self.subTest(entries=entries), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                self.archive(root / 'backup.tar', entries)
                with self.assertRaises(ValueError):
                    module.overlay(root / 'backup.tar', root / 'overlay.tar')
                self.assertFalse((root / 'overlay.tar').exists())
