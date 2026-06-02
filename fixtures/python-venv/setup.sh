#!/usr/bin/env bash
# Create the .venv for the DevStack Python test fixture.
# Idempotent: re-running recreates a clean venv.
set -euo pipefail
cd "$(dirname "$0")"

rm -rf .venv
python3 -m venv .venv
echo "venv created at $(pwd)/.venv"
echo "interpreter: $(.venv/bin/python -c 'import sys; print(sys.executable)')"
