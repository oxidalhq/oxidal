"""Prepare hash-checked native dependencies and build the offline adapter.

This is build tooling, not a separate test harness. Rust qualification runs via
scripts/tooling.mjs and the crate's example. See docs/native-tone3000.md.
"""
import argparse
import hashlib
import json
import os
import platform
from pathlib import Path
import shutil
import subprocess

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
BASE = ROOT / '.local' / 'tone3000'
SOURCE = BASE / 'source'
PINS = json.loads((HERE / 'sources.json').read_text())
REPOSITORIES = {'tone3000': SOURCE, 'juce': SOURCE / 'libs/juce', 'audiodsp': SOURCE / 'plugin/AudioDSPTools'}


def run(*args, cwd=None):
    subprocess.run(args, cwd=cwd, check=True)


def revision(path):
    return subprocess.check_output(['git', '-C', str(path), 'rev-parse', 'HEAD'], text=True).strip()


def digest(data):
    return hashlib.sha256(data).hexdigest()


def normalized(path):
    return path.read_bytes().replace(b'\r\n', b'\n')


def owned_checkout(repo):
    """Never run a mutating Git command through a copied external .git pointer."""
    top = Path(subprocess.check_output(['git', '-C', str(repo), 'rev-parse', '--show-toplevel'], text=True).strip()).resolve()
    gitdir = Path(subprocess.check_output(['git', '-C', str(repo), 'rev-parse', '--absolute-git-dir'], text=True).strip()).resolve()
    if top != repo.resolve() or not gitdir.is_relative_to(SOURCE.resolve()):
        raise ValueError('Build copy points to an external Git worktree or directory')


def prepare(seed=None):
    for directory in (ROOT / '.local', BASE, SOURCE):
        if directory.is_symlink():
            raise ValueError('Symlinked native build cache is unsupported')
    BASE.mkdir(parents=True, exist_ok=True)
    if not SOURCE.exists():
        if seed:
            seed = seed.resolve(strict=True)
            if not (seed / '.git').is_dir() or not (seed / 'libs/juce/.git').is_dir():
                raise ValueError('Seed must contain independent Git directories, not worktree pointers')
            if revision(seed) != PINS['tone3000']['revision']:
                raise ValueError('Seed revision differs')
            shutil.copytree(seed, SOURCE, ignore=lambda folder, names: [name for name in names if name == '__pycache__' or (Path(folder) == seed and (name == 'build' or name.startswith('build-')))])
            owned_checkout(SOURCE)
            owned_checkout(SOURCE / 'libs/juce')
            # Only a newly created private build copy is reset. Never alter the seed.
            run('git', 'reset', '--hard', PINS['tone3000']['revision'], cwd=SOURCE)
            run('git', 'reset', '--hard', PINS['juce']['revision'], cwd=SOURCE / 'libs/juce')
        else:
            run('git', 'clone', '--no-checkout', PINS['tone3000']['url'], str(SOURCE))
            run('git', 'checkout', '--detach', PINS['tone3000']['revision'], cwd=SOURCE)
            run('git', 'submodule', 'update', '--init', '--recursive', cwd=SOURCE)
            run('git', 'clone', '--no-checkout', PINS['juce']['url'], str(SOURCE / 'libs/juce'))
            run('git', 'checkout', '--detach', PINS['juce']['revision'], cwd=SOURCE / 'libs/juce')
    for namespace in ('tone3000', 'juce'):
        repo = SOURCE if namespace == 'tone3000' else SOURCE / 'libs/juce'
        owned_checkout(repo)
        if revision(repo) != PINS[namespace]['revision']:
            raise ValueError(f'{namespace} revision differs')
    for module in PINS['submodules']:
        if revision(SOURCE / module['path']) != module['revision']:
            raise ValueError(f"Submodule revision differs: {module['path']}")
        # Only exact, reviewed patch paths may differ in a dependency. Their bytes are checked below.
        repo = SOURCE / module['path']
        allowed = {p['path'] for p in PINS['patches'] if REPOSITORIES[p['namespace']] == repo}
        changed = subprocess.check_output(['git', 'diff', '--name-only', 'HEAD', '--ignore-submodules=all'], cwd=repo, text=True).splitlines()
        if set(changed) - allowed:
            raise ValueError(f"Unreviewed submodule modifications: {module['path']}")
    for patch in PINS['patches']:
        repo = REPOSITORIES[patch['namespace']]
        owned_checkout(repo)
        path = repo / patch['path']
        artifact = HERE / 'patches' / patch['patch']
        if digest(artifact.read_bytes()) != patch['patch_sha256']:
            raise ValueError('Patch artifact differs')
        actual = digest(normalized(path))
        if actual == patch['after']:
            continue
        if actual != patch['before']:
            raise ValueError(f"Pinned patch input differs: {patch['path']}")
        # Patches use LF; exact input and output digests disallow fuzz/drift.
        path.write_bytes(normalized(path))
        run('git', 'apply', '--whitespace=nowarn', str(artifact), cwd=repo)
        if digest(normalized(path)) != patch['after']:
            raise ValueError('Patch output differs')
    for addon in PINS['addons']:
        data = (HERE / 'patches' / addon['file']).read_bytes()
        if digest(data) != addon['sha256']:
            raise ValueError('Addon artifact differs')
        target = SOURCE / addon['path']
        if not target.exists() or target.read_bytes() != data:
            target.write_bytes(data)
    # Refuse tracked changes outside the reviewed overlay.
    for namespace, repo in REPOSITORIES.items():
        changed = subprocess.check_output(['git', 'diff', '--name-only', 'HEAD', '--ignore-submodules=all'], cwd=repo, text=True).splitlines()
        allowed = {p['path'] for p in PINS['patches'] if p['namespace'] == namespace}
        if set(changed) - allowed:
            raise ValueError(f'Unreviewed {namespace} source modifications')
    model = PINS["qualification_model"]
    if digest((SOURCE / model["path"]).read_bytes()) != model["sha256"]:
        raise ValueError("Qualification model differs")
    return SOURCE


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--seed', type=Path, help='Optional already downloaded pinned checkout; copied, never changed')
    parser.add_argument('--prepare-only', action='store_true', help='Verify and patch owned source without compiling')
    args = parser.parse_args()
    system = platform.system()
    if system not in ('Darwin', 'Linux'):
        raise SystemExit('Native qualification supports macOS and Linux build hosts.')
    source = prepare(args.seed)
    if args.prepare_only:
        return
    build = Path(os.environ.get('OXIDAL_TONE3000_LIB_DIR', str(BASE / ('build-linux' if system == 'Linux' else 'build'))))
    if not build.is_absolute() or build.is_symlink() or build.resolve() != build:
        raise ValueError('Native build output must be an absolute path without symlinks')
    options = ['-DCMAKE_OSX_DEPLOYMENT_TARGET=11.0'] if system == 'Darwin' else []
    run('cmake', '-S', str(HERE), '-B', str(build),
        f'-DTONE3000_SOURCE={source}', '-DCMAKE_BUILD_TYPE=Release', *options)
    run('cmake', '--build', str(build), '--target', 'oxidal_tone3000', '-j', '4')
    library = build / ('liboxidal_tone3000.so' if system == 'Linux' else 'liboxidal_tone3000.dylib')
    (build / 'qualification-build.json').write_text(json.dumps({
        'host_os': system,
        'host_arch': platform.machine(),
        'source_revision': PINS['tone3000']['revision'],
        'juce_revision': PINS['juce']['revision'],
        'overlay_manifest_sha256': digest((HERE / 'sources.json').read_bytes()),
        'library_sha256': digest(library.read_bytes()),
        'live_audio_qualified': False,
    }, indent=2) + '\n')


if __name__ == '__main__':
    main()
