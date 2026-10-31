import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('seed_factory', Path(__file__).parents[1] / 'scripts/seed_factory.py')
seed_factory = importlib.util.module_from_spec(spec)
spec.loader.exec_module(seed_factory)


class FactorySeedTests(unittest.TestCase):
    def test_partial_retry_reuses_manifests_and_completion_never_recreates_deleted_sounds(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            marker, catalog = root / 'complete.json', root / 'catalog.json'
            manifest = {'resources': [], 'tone3000': {'instances': []},
                'extensions': {'urn:oxidal:authoring': {'origin': 'oxidal_example'}}, 'oxidal': {'lv2': []}}
            body = {'manifest_json': json.dumps(manifest), 'resources': {}}
            catalog.write_text(json.dumps({'version': 1, 'sounds': [
                {'id': name, 'request': body, 'description': name, 'categories': ['Ambient']} for name in ['a', 'b']]}))
            published, fail = [], True
            def api(path, request=None):
                nonlocal fail
                if path.startswith('plugins/'):
                    return {'plugins': []}
                if path == 'presets/rigs':
                    published.append(request)
                    if fail and len(published) == 2:
                        raise RuntimeError('interrupted publication')
                    return {'revision': 'a' * 64}
                return {'revision': 1}
            with self.assertRaisesRegex(RuntimeError, 'interrupted'):
                seed_factory.seed(catalog, marker, api)
            self.assertFalse(marker.exists())
            fail = False
            self.assertEqual(seed_factory.seed(catalog, marker, api), 2)
            self.assertEqual(published[:2], published[2:])
            self.assertEqual(len(json.loads(marker.read_text())['revisions']), 2)
            self.assertEqual(seed_factory.seed(catalog, marker, lambda *_: self.fail('Completed seed must not contact daemon')), 0)

    def test_capture_payload_is_rejected_before_any_publication(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            catalog = root / 'catalog.json'
            catalog.write_text(json.dumps({'version': 1, 'sounds': [{'request': {
                'resources': {'model': {}}, 'manifest_json': '{}'}}]}))
            with self.assertRaisesRegex(ValueError, 'asset-free'):
                seed_factory.seed(catalog, root / 'complete.json', lambda *_: self.fail('No API mutation allowed'))
