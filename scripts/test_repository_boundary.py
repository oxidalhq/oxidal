"""Exercise staged and historical privacy violations in isolated repositories."""
from pathlib import Path
import subprocess
import tempfile
import unittest

CHECK = Path(__file__).with_name('check_repository.py').resolve()


class RepositoryBoundaryTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)
        self.git('init', '-q', '-b', 'main')
        self.git('config', 'user.name', 'Fixture')
        self.git('config', 'user.email', 'fixture@users.noreply.github.com')

    def tearDown(self):
        self.directory.cleanup()

    def git(self, *args):
        return subprocess.run(['git', *args], cwd=self.root, check=True,
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE)

    def stage(self, name, content):
        p = self.root / name
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content)
        self.git('add', name)

    def check(self):
        return subprocess.run(['python3', str(CHECK)], cwd=self.root,
                              capture_output=True, text=True)

    def test_clean_product_passes(self):
        self.stage('README.md', '# Product\n')
        self.git('commit', '-qm', 'docs: explain product')
        self.assertEqual(self.check().returncode, 0)

    def test_staged_private_file_fails_even_if_working_copy_changes(self):
        name = str(Path('docs') / 'specs' / 'plan.md')
        self.stage(name, 'Private plan\n')
        (self.root / name).unlink()
        self.assertNotEqual(self.check().returncode, 0)

    def test_deleted_credential_still_fails_history_scan(self):
        # Construct a synthetic token without embedding a token in this source.
        token = 'gh' + 'p_' + 'x' * 36
        self.stage('config.txt', token)
        self.git('commit', '-qm', 'chore: add fixture')
        self.git('rm', 'config.txt')
        self.git('commit', '-qm', 'chore: remove fixture')
        result = self.check()
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn(token, result.stderr)

    def test_removed_private_path_still_fails_history_scan(self):
        name = str(Path('docs') / 'research' / 'private.md')
        self.stage(name, 'Private research\n')
        self.git('commit', '-qm', 'docs: add fixture')
        self.git('rm', name)
        self.git('commit', '-qm', 'docs: remove fixture')
        self.assertNotEqual(self.check().returncode, 0)


if __name__ == '__main__':
    unittest.main()
