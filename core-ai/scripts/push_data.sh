#!/usr/bin/env bash
# Upload data/raw (+ data/processed/folds.csv) to the Modal volume at /vol/data
set -euo pipefail
cd "$(dirname "$0")/.."
uv run modal volume create rmit-hack-vol 2>/dev/null || true
uv run modal volume put --force rmit-hack-vol data/raw/ /data/
if [ -f data/processed/folds.csv ]; then
  uv run modal volume put --force rmit-hack-vol data/processed/folds.csv /data/folds.csv
fi
uv run modal volume ls rmit-hack-vol /data
