#!/bin/sh
set -eu
cd "$(dirname "$0")/../.."
shellcheck os/scripts/check.sh .githooks/*
shfmt -d os/scripts/check.sh .githooks/*
python3 -m unittest discover -s os/tests -v
python3 os/scripts/provision.py --check-manifest >/dev/null
