#!/usr/bin/env bash
# Reproduce the FINAL Kaggle C1 submission (submissions/FINAL_mistral.csv).
#
# Single backbone: mistralai/Mistral-7B-Instruct-v0.3 (LoRA sequence classification).
# Final = geometric mean (mean of log-probs, then argmax; NO bias/threshold tuning)
# of the 5-fold test predictions of the runs listed in RUNS below.
#
#   ./scripts/reproduce_final.sh               # full pipeline: data -> train on Modal -> pull -> blend
#   ./scripts/reproduce_final.sh --blend-only  # only blend what is already in outputs/ (fails if a run is incomplete)
#
# Override the run list (space-separated run names) with:  RUNS="a b c" ./scripts/reproduce_final.sh --blend-only
# Requires: uv, Kaggle token (full mode), Modal profile with A100-80GB access (full mode).
set -euo pipefail
cd "$(dirname "$0")/.."

# ---- the ONE place that defines the final run list (order = blend order) ----
DEFAULT_RUNS="mistral7b_lora_v2 mistral7b_lora_v3 mistral7b_lora_v4 mistral_pl95 mistral_pl95_s2"
RUNS="${RUNS:-$DEFAULT_RUNS}"
NAME="${NAME:-FINAL_mistral}"

BASE=(--model-name mistralai/Mistral-7B-Instruct-v0.3 --lora --folds 0,1,2,3,4
      --lr 5e-5 --epochs 2 --batch-size 8 --grad-accum 2 --grad-ckpt
      --max-len 512 --warmup-ratio 0.1 --gpu A100-80GB)
TEACHER=mistral7b_lora_v2

train() { # train <run_name> [extra args...]
  local run="$1"; shift
  uv run modal run -m modal_app.train "${BASE[@]}" --run-name "$run" "$@"
}

check_runs() { # fail loudly if any run lacks any of the 5 folds
  local bad=0 r f
  for r in $RUNS; do
    for f in 0 1 2 3 4; do
      for x in oof.csv test_probs.npy test_ids.npy; do
        if [ ! -s "outputs/$r/fold$f/$x" ]; then
          echo "ERROR: missing outputs/$r/fold$f/$x" >&2; bad=1
        fi
      done
    done
  done
  [ "$bad" -eq 0 ] || { echo "Incomplete runs; refusing to blend (no silent skipping)." >&2; exit 1; }
}

blend() {
  check_runs
  local paths=() r
  for r in $RUNS; do paths+=("outputs/$r"); done
  uv run python -m rmit_hack.ensemble "${paths[@]}" --avg geo --no-bias --name "$NAME"
  echo "sha256: $(shasum -a 256 "submissions/$NAME.csv")"
}

if [ "${1:-}" = "--blend-only" ]; then blend; exit 0; fi
[ $# -eq 0 ] || { echo "usage: $0 [--blend-only]" >&2; exit 2; }

# ---- (0) data, folds, push to Modal ----
./scripts/download_data.sh
uv run python -m rmit_hack.folds
./scripts/push_data.sh

# ---- (1) teacher (seed 42, default); blocks until done. Also pseudo-label teacher. ----
train "$TEACHER" --seed 42

# ---- (2) remaining runs, in parallel (distinct run names are safe to run concurrently) ----
pids=()
train mistral7b_lora_v3 --seed 2 & pids+=($!)
train mistral7b_lora_v4 --seed 3 & pids+=($!)
train mistral_pl95    --seed 7  --pseudo-run "$TEACHER" --pseudo-threshold 0.95 & pids+=($!)
train mistral_pl95_s2 --seed 11 --pseudo-run "$TEACHER" --pseudo-threshold 0.95 & pids+=($!)
for p in "${pids[@]}"; do wait "$p"; done

# ---- (3) pull outputs ----
for r in $RUNS; do ./scripts/pull_outputs.sh "$r" >/dev/null; done

# ---- (4) blend ----
blend
