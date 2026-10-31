#!/usr/bin/env python3
"""Offline, package-scoped LV2 smoke reports. See docs/lv2.md; never installs packages."""
import argparse
import json
import os
import signal
from pathlib import Path
import subprocess
import tempfile

PACKAGES = {
    'guitarix': 'guitarix-lv2',
    'dragonfly': 'dragonfly-reverb-lv2',
    'calf': 'calf-plugins',
    'invada': 'invada-studio-plugins-lv2',
    'x42': 'x42-plugins',
    'mda': 'mda-lv2',
    'swh': 'swh-lv2',
    'fomp': 'fomp',
}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--worker', type=Path, required=True)
    parser.add_argument('--pack', choices=PACKAGES, action='append')
    parser.add_argument('--sample-rate', type=int, default=48000)
    parser.add_argument('--frames', type=int, default=48)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    worker = args.worker.resolve(strict=True)
    if not 8000 <= args.sample_rate <= 192000 or not 1 <= args.frames <= 2048:
        parser.error('Invalid rate or frame count')
    args.output.mkdir(parents=True, exist_ok=True)
    summary = []
    for pack in args.pack or PACKAGES:
        package = PACKAGES[pack]
        version = subprocess.run(['dpkg-query', '-W', '-f=${db:Status-Status} ${Version}', package], capture_output=True, text=True)
        if version.returncode or not version.stdout.startswith('installed '):
            summary.append({'pack': pack, 'package': package, 'status': 'not_installed'})
            continue
        listing = subprocess.run(['dpkg-query', '-L', package], capture_output=True, text=True, check=True)
        bundles = set()
        for line in listing.stdout.splitlines():
            p = Path(line)
            for candidate in [p, *p.parents]:
                if candidate.suffix == '.lv2' and candidate.is_dir():
                    bundles.add(candidate)
                    break
        with tempfile.TemporaryDirectory(prefix='oxidal-pack-') as directory:
            for i, bundle in enumerate(sorted(bundles)):
                Path(directory, f'{i}-{bundle.name}').symlink_to(bundle, target_is_directory=True)
            # Scope by Debian ownership, rather than guessing pack names from URI prefixes.
            env = dict(os.environ, LV2_PATH=directory)
            process = subprocess.Popen([str(worker), '--pack', pack, '--sample-rate', str(args.sample_rate), '--frames', str(args.frames)], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=env, start_new_session=True)
            try:
                stdout, stderr = process.communicate(timeout=1800)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                stdout, stderr = process.communicate()
                report = {'pack': pack, 'package': package, 'status': 'timed_out', 'stderr': stderr[-4096:]}
            else:
                if process.returncode:
                    report = {'pack': pack, 'package': package, 'status': 'discovery_failed', 'exit_code': process.returncode, 'stderr': stderr[-4096:]}
                else:
                    try:
                        report = json.loads(stdout)
                        if not isinstance(report, dict) or report.get('pack') != pack or not isinstance(report.get('counts'), dict):
                            raise ValueError('Unexpected report shape')
                    except ValueError as error:
                        report = {'pack': pack, 'package': package, 'status': 'invalid_report', 'reason': str(error)}
            report.update(package=package, package_version=version.stdout.removeprefix('installed '), bundles=[str(p) for p in sorted(bundles)])
            (args.output / f'{pack}.json').write_text(json.dumps(report, indent=2) + '\n')
            summary.append({k: report[k] for k in ['pack', 'package', 'package_version', 'counts', 'status', 'exit_code'] if k in report})
    (args.output / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n')
    print(json.dumps(summary, indent=2))


if __name__ == '__main__':
    main()
