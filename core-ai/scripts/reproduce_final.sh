#!/usr/bin/env bash
# Reproduce the FINAL Kaggle C1 submission.
#
# Single backbone: mistralai/Mistral-7B-Instruct-v0.3 (LoRA sequence classification).
# Geometric mean (mean of log-probs, then argmax; NO bias/threshold tuning) of
#   * 5-fold runs (FOLD_RUNS; each run's folds averaged first, weight 1.0), and
#   * full-fit models (FULL_RUNS; one model per seed, weight 0.6 each), which must pass
#     sanity gates vs the fold-avg blend (class dist within 1.5pt of 62/31/7, argmax agreement >= 0.975).
# Outputs:
#   submissions/FINAL_mistral_full.csv  folds + full-fit blend (the final)
#   submissions/FINAL_mistral.csv       folds-only blend of FALLBACK_RUNS (4 runs; sha256 53ad2466...e406)
#
#   ./scripts/reproduce_final.sh               # full pipeline: data -> train on Modal -> pull -> blend
#   ./scripts/reproduce_final.sh --blend-only  # only blend what is already in outputs/ (FAILS if anything expected is missing)
#
# Overrides (space-separated run names), e.g. to blend whatever finished:
#   FOLD_RUNS="mistral7b_lora_v2 mistral7b_lora_v3" FULL_RUNS="mistral_full" ./scripts/reproduce_final.sh --blend-only
#   FULL_RUNS=""  -> folds only (blend_full with no full-fit models)
# Requires: uv, Kaggle token (full mode), Modal profile with A100-80GB access (full mode).
set -euo pipefail
cd "$(dirname "$0")/.."

# ---- the ONE place that defines the final run lists (order = blend order) ----
DEFAULT_FOLD_RUNS="mistral7b_lora_v2 mistral7b_lora_v3 mistral7b_lora_v4 mistral_pl95"  # mistral_pl95_s2 excluded: fold 0 diverged (0.64)
DEFAULT_FULL_RUNS="mistral_full_pl mistral_full"
FALLBACK_RUNS="mistral7b_lora_v2 mistral7b_lora_v3 mistral7b_lora_v4 mistral_pl95"
FOLD_RUNS="${FOLD_RUNS-$DEFAULT_FOLD_RUNS}"
FULL_RUNS="${FULL_RUNS-$DEFAULT_FULL_RUNS}"
NAME="${NAME:-FINAL_mistral_full}"
FALLBACK_NAME="${FALLBACK_NAME:-FINAL_mistral}"

full_seeds() { # expected seeds per full-fit run (space-separated); empty = any (>=1) full_s*
  case "$1" in
    mistral_full_pl) echo "21 22 23" ;;
    mistral_full)    echo "31 32" ;;
    *)               echo "" ;;
  esac
}

BASE=(--model-name mistralai/Mistral-7B-Instruct-v0.3 --lora --folds 0,1,2,3,4
      --lr 5e-5 --epochs 2 --batch-size 8 --grad-accum 2 --grad-ckpt
      --max-len 512 --warmup-ratio 0.1 --gpu A100-80GB)
# full-fit recipe = BASE minus the fold list (--full-fit replaces --folds)
FULL_BASE=(--model-name mistralai/Mistral-7B-Instruct-v0.3 --lora
      --lr 5e-5 --epochs 2 --batch-size 8 --grad-accum 2 --grad-ckpt
      --max-len 512 --warmup-ratio 0.1 --gpu A100-80GB)
TEACHER=mistral7b_lora_v2

train() { # train <run_name> [extra args...]
  local run="$1"; shift
  uv run modal run -m modal_app.train "${BASE[@]}" --run-name "$run" "$@"
}

check_folds() { # fail loudly if any run lacks any of the 5 folds
  local bad=0 r f x
  for r in "$@"; do
    for f in 0 1 2 3 4; do
      for x in oof.csv test_probs.npy test_ids.npy; do
        if [ ! -s "outputs/$r/fold$f/$x" ]; then
          echo "ERROR: missing outputs/$r/fold$f/$x" >&2; bad=1
        fi
      done
    done
  done
  [ "$bad" -eq 0 ] || { echo "Incomplete fold runs; refusing to blend (no silent skipping)." >&2; exit 1; }
}

check_full() { # fail loudly if any expected full-fit seed lacks its files
  local bad=0 r s x seeds
  for r in "$@"; do
    seeds="$(full_seeds "$r")"
    if [ -z "$seeds" ]; then
      ls -d outputs/"$r"/full_s* >/dev/null 2>&1 || { echo "ERROR: no outputs/$r/full_s*" >&2; bad=1; }
      continue
    fi
    for s in $seeds; do
      for x in test_probs.npy test_ids.npy metrics.json; do
        if [ ! -s "outputs/$r/full_s$s/$x" ]; then
          echo "ERROR: missing outputs/$r/full_s$s/$x" >&2; bad=1
        fi
      done
    done
  done
  [ "$bad" -eq 0 ] || { echo "Incomplete full-fit runs; refusing to blend (no silent skipping)." >&2; exit 1; }
}

blend() {
  local r paths=() fpaths=()
  # fallback: folds-only 4-run blend (ensemble.py) -> FINAL_mistral.csv
  check_folds $FALLBACK_RUNS
  for r in $FALLBACK_RUNS; do paths+=("outputs/$r"); done
  uv run python -m rmit_hack.ensemble "${paths[@]}" --avg geo --no-bias --name "$FALLBACK_NAME"
  echo "sha256: $(shasum -a 256 "submissions/$FALLBACK_NAME.csv")"

  # final: folds + full-fit (blend_full, gates on) -> FINAL_mistral_full.csv
  check_folds $FOLD_RUNS
  [ -z "$FULL_RUNS" ] || check_full $FULL_RUNS
  paths=()
  for r in $FOLD_RUNS; do paths+=("outputs/$r"); done
  for r in $FULL_RUNS; do fpaths+=("outputs/$r"); done
  uv run python -m rmit_hack.blend_full --folds "${paths[@]}" \
    ${fpaths[@]+--full "${fpaths[@]}"} --avg geo --name "$NAME"
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

# ---- (2) remaining 5-fold runs, in parallel (distinct run names are safe to run concurrently) ----
pids=()
train mistral7b_lora_v3 --seed 2 & pids+=($!)
train mistral7b_lora_v4 --seed 3 & pids+=($!)
train mistral_pl95    --seed 7  --pseudo-run "$TEACHER" --pseudo-threshold 0.95 & pids+=($!)
train mistral_pl95_s2 --seed 11 --pseudo-run "$TEACHER" --pseudo-threshold 0.95 & pids+=($!)

# ---- (2b) full-fit models (train on all labelled data; no folds). Same base recipe. ----
train_full() { # train_full <run_name> <seeds> [extra args...]
  local run="$1" seeds="$2"; shift 2
  uv run modal run -m modal_app.train "${FULL_BASE[@]}" --full-fit --seeds "$seeds" --run-name "$run" "$@"
}
train_full mistral_full_pl 21,22,23 --pseudo-run "$TEACHER" --pseudo-threshold 0.95 & pids+=($!)
train_full mistral_full    31,32 & pids+=($!)
for p in "${pids[@]}"; do wait "$p"; done

# ---- (3) pull outputs ----
for r in $FOLD_RUNS $FULL_RUNS; do ./scripts/pull_outputs.sh "$r" >/dev/null; done

# ---- (4) blend ----
blend
