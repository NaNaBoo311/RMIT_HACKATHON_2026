#!/usr/bin/env bash
# Download a Modal run (submission.csv, logits, meta) to outputs/<run>. No arg = list runs.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ $# -eq 0 ]; then uv run modal volume ls rmit-hack-vol /outputs; exit 0; fi
RUN="$1"
mkdir -p outputs/"$RUN" submissions
for f in submission.csv test_logits.npy meta.json; do
  uv run modal volume get --force rmit-hack-vol "/outputs/$RUN/$f" "outputs/$RUN/$f"
done
cp outputs/"$RUN"/submission.csv submissions/"$RUN".csv
echo "-> submissions/$RUN.csv"
