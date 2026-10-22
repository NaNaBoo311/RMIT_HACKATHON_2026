#!/usr/bin/env bash
# Submit a CSV to Kaggle: ./scripts/submit.sh submissions/xxx.csv "message"
set -euo pipefail
uv run kaggle competitions submit -c rmit-hackathon-2026 -f "$1" -m "${2:-$(basename "$1")}"
