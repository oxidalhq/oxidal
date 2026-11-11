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


class FactoryMetadataTests(unittest.TestCase):
    def catalog(self, root, metadata):
        manifest = {'resources': [], 'tone3000': {'instances': []},
            'extensions': {'urn:oxidal:authoring': {'origin': 'oxidal_example'}}, 'oxidal': {'lv2': []}}
        sound = {'id': 'a', 'description': 'a', 'categories': ['Ambient'],
            'request': {'manifest_json': json.dumps(manifest), 'resources': {}}}
        if metadata is not None:
            sound['metadata'] = metadata
        path = root / 'catalog.json'
        path.write_text(json.dumps({'version': 1, 'sounds': [sound]}))
        return path

    def test_metadata_is_sent_with_details_and_invalid_metadata_is_rejected_before_publication(self):
        good = {'genres': ['Ambient', 'Post-rock'], 'engine': 'lv2', 'complexity': 'layered',
            'nam_instances': 0, 'block_count': 3}
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            sent = []
            def api(path, request=None):
                if path.startswith('plugins/'):
                    return {'plugins': []}
                if path == 'presets/details' and request:
                    sent.append(request)
                return {'revision': 'a' * 64}
            seed_factory.seed(self.catalog(root, good), root / 'one.json', api)
            self.assertEqual(sent[0]['metadata'], good)
            # Sounds without metadata still seed, with no metadata key.
            sent.clear()
            seed_factory.seed(self.catalog(root, None), root / 'two.json', api)
            self.assertNotIn('metadata', sent[0])
            for bad in [dict(good, genres=[]), dict(good, genres=['Metalcore']), dict(good, engine='hybrid'),
                    dict(good, complexity='epic'), dict(good, genres=['Clean', 'Funk', 'Blues', 'Jazz'])]:
                with self.assertRaises(ValueError):
                    seed_factory.seed(self.catalog(root, bad), root / 'bad.json',
                        lambda *_: self.fail('No API call before validation'))


class FactoryAvailabilityTests(unittest.TestCase):
    def test_examples_whose_effects_are_not_installed_are_left_for_later(self):
        def sound(name, uri):
            manifest = {'resources': [], 'tone3000': {'instances': []},
                'extensions': {'urn:oxidal:authoring': {'origin': 'oxidal_example'}},
                'oxidal': {'lv2': [{'pluginUri': uri, 'controls': {'mix': .5}}]}}
            return {'id': name, 'description': name, 'categories': ['Ambient'],
                'request': {'manifest_json': json.dumps(manifest), 'resources': {}}}
        port = {'symbol': 'mix', 'control': True, 'input': True, 'atom': False, 'minimum': 0, 'maximum': 1}
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            catalog = root / 'catalog.json'
            catalog.write_text(json.dumps({'version': 1, 'sounds': [
                sound('own', 'urn:oxidal:plugin:swell#stereo'), sound('pack', 'urn:example:not-installed'),
                sound('range', 'urn:example:other-version')]}))
            published = []
            def api(path, request=None):
                if path.startswith('plugins/'):
                    return {'plugins': [
                        {'uri': 'urn:oxidal:plugin:swell#stereo', 'unsupported': False, 'ports': [port]},
                        {'uri': 'urn:example:other-version', 'unsupported': False,
                            'ports': [dict(port, maximum=.25)]}]}
                if path == 'presets/rigs':
                    published.append(json.loads(request['manifest_json'])['oxidal']['lv2'][0]['pluginUri'])
                    return {'revision': 'a' * 64}
                return {'revision': 1}
            self.assertEqual(seed_factory.seed(catalog, root / 'done.json', api), 1)
            self.assertEqual(published, ['urn:oxidal:plugin:swell#stereo'])
            # One run only: a pack installed later is finished by the web interface.
            self.assertEqual(seed_factory.seed(catalog, root / 'done.json', lambda *_: self.fail('No retry')), 0)
