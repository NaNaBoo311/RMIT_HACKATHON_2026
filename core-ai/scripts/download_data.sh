#!/usr/bin/env bash
# Download competition data into data/raw. Requires ~/.kaggle/kaggle.json
# (Kaggle -> Settings -> API -> Create New Token) and accepting the competition rules.
set -euo pipefail
cd "$(dirname "$0")/.."
uv run kaggle competitions download -c rmit-hackathon-2026 -p data/raw
unzip -o data/raw/*.zip -d data/raw && rm -f data/raw/*.zip
ls -lh data/raw
