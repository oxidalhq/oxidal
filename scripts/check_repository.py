"""Check the indexed product tree and reachable history for private workspace material.

This focused boundary/credential check supplements human review; it is not a
comprehensive secret scanner. Diagnostics identify paths, never matched values.
"""
from pathlib import PurePosixPath
import re
import subprocess
import sys


def git(*args):
    return subprocess.run(['git', *args], check=True, stdout=subprocess.PIPE).stdout


def private_path(path):
    parts = PurePosixPath(path).parts
    if not parts:
        return False
    forbidden = {'.afx', '.afx.yaml', '.agents', '.claude', 'reference',
                 'worktree', 'node_modules', 'target', '.local', '.tools',
                 '.gitmodules', 'work'}
    if parts[0] in forbidden:
        return True
    if len(parts) > 1 and parts[0] == 'docs' and parts[1] in {
            'specs', 'research', 'logs', 'comparisons', 'blueprint'}:
        return True
    return any(p == '.env' or (p.startswith('.env.') and p != '.env.example')
               or p.endswith(('.pem', '.key', '.bundle')) for p in parts)


PATTERNS = [
    re.compile(rb'/(?:Users|home)/[A-Za-z0-9_.-]+/'),
    re.compile(rb'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----'),
    re.compile(rb'\bgh[pousr]_[A-Za-z0-9]{30,}\b'),
    re.compile(rb'\bgithub_pat_[A-Za-z0-9_]{30,}\b'),
    re.compile(rb'\bAKIA[A-Z0-9]{16}\b'),
    re.compile(rb'\bxox[baprs]-[A-Za-z0-9-]{20,}\b'),
    re.compile(rb'@see\s+docs[/]specs[/]'),
    re.compile(rb'^afx:\s*true\s*$', re.M),
]


def main():
    errors = set()
    blobs = {}
    # Scan the actual index: unstaged edits must not hide staged private data.
    for record in git('ls-files', '--stage', '-z').split(b'\0'):
        if not record:
            continue
        meta, path = record.split(b'\t', 1)
        mode, oid, stage = meta.split()
        name = path.decode('utf-8')
        if mode == b'160000' or stage != b'0' or private_path(name):
            errors.add(f'Forbidden indexed path or entry: {name}')
        if mode != b'160000':
            blobs.setdefault(oid.decode(), name)
    # Private material in old commits remains a leak even after deleting it.
    commits = git('rev-list', '--all').decode().splitlines()
    for commit in commits:
        for record in git('ls-tree', '-r', '-z', commit).split(b'\0'):
            if not record:
                continue
            meta, path = record.split(b'\t', 1)
            mode, kind, oid = meta.split()
            name = path.decode('utf-8')
            if kind != b'blob' or private_path(name):
                errors.add(f'Forbidden history path or entry: {name}')
            if kind == b'blob':
                blobs.setdefault(oid.decode(), name)
        metadata = git('show', '-s', '--format=%B%n%an%n%ae%n%cn%n%ce', commit)
        if any(pattern.search(metadata) for pattern in PATTERNS):
            errors.add(f'Private data pattern in commit metadata: {commit[:12]}')
    for oid, name in blobs.items():
        content = git('cat-file', 'blob', oid)
        if any(pattern.search(content) for pattern in PATTERNS):
            errors.add(f'Private data pattern in blob: {name}')
    if errors:
        print('\n'.join(sorted(errors)), file=sys.stderr)
        return 1
    print(f'Repository boundary passed: {len(blobs)} unique blobs, {len(commits)} commits.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
