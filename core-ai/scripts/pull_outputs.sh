#!/usr/bin/env bash
# Download a whole Modal run dir to outputs/<run>. No arg = list runs.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ $# -eq 0 ]; then uv run modal volume ls rmit-hack-vol /outputs; exit 0; fi
RUN="$1"
mkdir -p outputs
uv run modal volume get --force rmit-hack-vol "/outputs/$RUN" outputs/
ls -R "outputs/$RUN" | head -40
