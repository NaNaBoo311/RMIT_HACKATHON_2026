# A2: Mistral-7B LoRA tuning + seed ensembling (22/10, ~13:50)

Basis: read train.py (LoRA path, Trainer, truncation, pooling) and NEXT_PLAN.md. No web research was done. Gain estimates come from general experience with LLM-classification Kaggle solutions (LMSYS, LLM-detect-AI, Jigsaw-style) and are NOT measured on this task. Treat the numbers as priors.

## 1. Code audit of the LoRA path (train.py)

| Item | Verdict |
|---|---|
| Pad token | `pad_token = eos` when None (l.113). Safe: encode() builds `prefix + ids + suffix`. Mistral v0.3 adds BOS only, no EOS suffix, so the only pad-equal tokens are real padding. Last-token pooling in `MistralForSequenceClassification` takes the last non-pad token. In transformers >= 4.5x/5 this is computed via `(input_ids != pad).argmax`-style logic, which is correct for left and right padding. **No bug.** |
| Padding side | `DataCollatorWithPadding(tok)` uses the tokenizer default (Mistral v0.3 is left or right depending on the tokenizer config). Either works with the modern pooling. Do not touch it. |
| bf16 numerics | Base weights bf16, trainable LoRA and `score` upcast to fp32 (l.245), `Trainer bf16=True` autocast, loss computed on `logits.float()`. This is the correct recipe. |
| Divergence (v1, grad_norm ~260) | `max_grad_norm=1.0` is already set. The spike came from lr 1e-4 combined with a randomly initialised head (`score` std 0.02 on a 4096-dim last hidden state whose norm is large for Mistral, so initial logits are big). lr 5e-5 + warmup 0.1 fixed it. Cheap extra protection, if wanted: a lower lr for the head is NOT needed. The more useful protection is `--warmup-ratio 0.15`. |
| Instruction template | Not used. The text is fed raw, and the last-token hidden state then is the last token of the user's text. A suffix such as `"\n\nClassify the above prompt as BENIGN, JAILBREAK or PROMPT_INJECTION. Answer:"` gives the final token a consistent "decide now" context and is commonly worth +0.0 to +0.003 for decoder classifiers. It also guards against texts ending in an arbitrary token. It must be applied in encode() as extra suffix tokens, always kept (reserve `keep` accordingly). It is a code change plus an untested risk. Only worth it as a diversity variant in ONE run, not for the main line. Exact diff is in section 5. |
| Class weights | Default `sqrt` (l.40). mmBERT showed weights are noise (+-0.001). Keep the same for Mistral because v2 used it (consistency with the PL teacher). No reason to change. |
| Pseudo-label path | Averages `fold*/test_probs.npy` under a single run directory and asserts the same `test_ids`. It works with any number of folds present, so a 4-fold teacher also works. |
| Truncation | Head `keep-128` + tail 128 at max_len 512. Per the history, len 1024 and head/tail 256 were noise on mmBERT. Median text is 115-565 chars (~30-150 tokens), so 512 covers almost everything. Raising max_len has low expected value. |
| LoRA r and alpha | Hardcoded in main()'s cfg dict? No. `lora_r`, `lora_alpha`, `lora_dropout` are in DEFAULTS and merged via `{**DEFAULTS, **cfg}` (l.79), so adding CLI flags is trivial (section 5). |

No real bug found. The main correctness risk is only the unmeasured effect of the template.

## 2. What is most likely to beat v2 (ranked)

Ceiling context: v2 per-fold 0.970-0.981 (about 0.973). LB ~ OOF + 0.005. Remaining errors are likely label-boundary cases (JAILBREAK vs PROMPT_INJECTION), so hyperparameter tuning of a single run has low headroom (about +-0.002, below fold noise of +-0.005). Variance reduction and more data beat tuning.

1. **Pseudo-labeling (A1) with a stronger teacher**: +0.004 to +0.009 (mmBERT gave +0.0065 on 0.962-0.965 base; expect somewhat less on a stronger 0.973 base: ~ +0.003 to +0.006). Highest priority.
2. **Seed ensemble (A2 seed 2)**: Mistral LoRA runs with different seeds usually have uncorrelated errors on ambiguous items. Expected +0.002 to +0.004 for 2 seeds, +0.003 to +0.005 for 3 (mmBERT's 9 runs gave +0.006-0.007, but mmBERT is noisier per run, so expect less here). Diminishing returns after 3.
3. **Hyperparameter changes (low priority, choose at most one as a diversity variant)**:
   - Epochs 3 vs 2: with LoRA r16 at 5e-5 and 14k rows, the 2nd epoch typically brings most of the gain. A 3rd epoch gives +0.000 to +0.002 and costs +50% time. Skip, or use it only on a variant run if time remains.
   - r=32, alpha=64 (alpha/r = 2 unchanged) with lr 4e-5: roughly neutral, good diversity. Requires the flag diff.
   - NEFTune: for classification (non-generative) it is rarely useful and is not available in the Trainer for this custom path without args (`neftune_noise_alpha`, it works for embedding output). Skip.
   - Label smoothing 0.05: no evidence of help on mmBERT; skip (also would make PL teacher/student calibration differ).
   - max_len 768: skip.
   - Template suffix: a diversity variant only (see above).
   - Batch 8 x accum 2 = 16 effective, scheduler linear (default), clip 1.0, wd 0.01 are fine. Do not change.
4. **Full-fit (A3)**: +0.001 to +0.002 on LB (14k vs 11.2k train rows per model, i.e. +25% data). Cheap (~1 fold-equivalent per seed), no OOF to validate, so only blend with weight roughly equal to one fold model; smoke test first as the plan says.

Recommendation: the main line is seeds + PL on the unchanged v2 recipe. Use hyper/template changes only on the seed that is NOT the PL run, to buy diversity without risking the main line.

## 3. Seed ensembling and diversity

- Same recipe, different seed (changes head init, LoRA init, data order, and dropout): safe, +0.002 to +0.004 expected for 2 seeds.
- Varied recipe for run 2 (r=32/alpha=64, lr 4e-5; OR template suffix): more diverse errors, probably slightly better ensemble than a pure seed change, with a small risk that the variant itself is worse by 0.001-0.003. Only blend if its OOF >= 0.968. Because folds are fixed and shared (same `folds.csv`), OOF blending across runs is valid (nested OOF check as in NEXT_PLAN S3).
- PL students are correlated with their teacher (they learn its confident test labels), so a PL run plus its teacher adds less than two independent seeds. Still blend them, since the PL run is individually stronger.
- Never mix Mistral with mmBERT (single approved backbone).

## 4. Run schedule (A100-80GB, 5 folds in parallel per run, ~40 min wall, ~3.3 GPU-h each; PL runs have ~+35% data so ~55 min wall, ~4.5 GPU-h)

Assumption: Modal allows >= 10 concurrent A100-80GB. If the cap is 5, run sequentially and drop R3 (first thing to drop: the second PL run).

Recipe: `M="--model-name mistralai/Mistral-7B-Instruct-v0.3 --lora --folds 0,1,2,3,4 --lr 5e-5 --epochs 2 --batch-size 8 --grad-accum 2 --grad-ckpt --max-len 512 --warmup-ratio 0.1 --gpu A100-80GB"` (use `${=M}` in zsh).

| Time (VN) | Round | Command (all from core-ai/) | GPU-h |
|---|---|---|---|
| 13:50 | R1a: seed 2 (plain) | `uv run modal run --detach -m modal_app.train ${=M} --run-name mistral7b_lora_v3 --seed 2` | 3.3 |
| 13:50 | R1b: PL on v2 (use a 4-fold teacher now if fold 4 is still running, as the glob accepts it; otherwise wait) | `uv run modal run --detach -m modal_app.train ${=M} --run-name mistral_pl95 --seed 7 --pseudo-run mistral7b_lora_v2 --pseudo-threshold 0.95` | 4.5 |
| ~14:50 | R2: full-fit smoke (1 min) then two seeds | smoke: `... --lora --full-fit --max-train-samples 200 --epochs 1 --run-name mistral_full_smoke`; real: `uv run modal run --detach -m modal_app.train --model-name mistralai/Mistral-7B-Instruct-v0.3 --lora --full-fit --seeds 11,12 --lr 5e-5 --epochs 2 --batch-size 8 --grad-accum 2 --grad-ckpt --max-len 512 --warmup-ratio 0.1 --gpu A100-80GB --run-name mistral_full` | ~2.2 |
| ~14:50 | R2b: PL round 2, teacher = v2+v3 merged (see below) so it is stronger than v2 alone | `uv run modal run --detach -m modal_app.train ${=M} --run-name mistral_pl95_b --seed 21 --pseudo-run mistral_teacher_v2v3 --pseudo-threshold 0.95` | 4.5 |
| ~16:00 | Ensemble | `uv run python -m rmit_hack.ensemble outputs/mistral7b_lora_v2 outputs/mistral7b_lora_v3 outputs/mistral_pl95 outputs/mistral_pl95_b --name mistral_combo` then `blend_full` with `mistral_full` | 0 |
| 16:30 | Submit S3/S4 (latest by 17:30) | | |

Total about 14.5 GPU-h of the 30, leaving a spare ~15 GPU-h for one more variant (R3, 14:50 in parallel with R2, only if concurrency allows): a diversity run with r=32 (needs the flag) or the template suffix, `--seed 3 --run-name mistral7b_lora_v4r32`, 3.3 GPU-h.

Merged teacher for R2b (trick, no code change): the PL code globs `fold*/test_probs.npy` under ONE run dir and asserts identical `test_ids`, so after pulling v2 and v3, create `outputs/mistral_teacher_v2v3/` containing v2's `fold0..4` as-is and v3's folds renamed `fold5..fold9` (each with `test_probs.npy` and `test_ids.npy`), then `uv run modal volume put rmit-hack-vol outputs/mistral_teacher_v2v3 /outputs/mistral_teacher_v2v3`. Only do this if the pull+put takes < 10 min; otherwise use `mistral7b_lora_v2` as the teacher for both PL runs (the cost is small).

If wall time is short, the minimum set that preserves the expected value: R1a + R1b (done by ~14:50), then ensemble. Everything else is a bonus.

## 5. Optional code diffs (only if you want r/template variants; no edits were made)

Flags for LoRA rank (DEFAULTS already contain the keys, so only the CLI and cfg need them):

```diff
@@ def main(
     fgm_eps: float = 0.0,
     full_fit: bool = False,
     seeds: str = "",
+    lora_r: int = 16,
+    lora_alpha: int = 32,
 ):
@@ cfg = {
         "fgm_eps": fgm_eps,
+        "lora_r": lora_r,
+        "lora_alpha": lora_alpha,
     }
```

Usage: `... --lora-r 32 --lora-alpha 64 --lr 4e-5`. The existing run's saved cfg print will show the values.

Template suffix (variant only): a new flag `template: bool = False` plus cfg key, and in train_fold after computing `prefix, suffix` (l.123):

```diff
-    prefix, suffix = probe[:pos], probe[pos + len(plain) :]
+    prefix, suffix = probe[:pos], probe[pos + len(plain) :]
+    if cfg.get("template"):
+        suffix = suffix + tok(
+            "\n\nClassify the prompt above as BENIGN, JAILBREAK or PROMPT_INJECTION. Answer:",
+            add_special_tokens=False,
+        )["input_ids"]
```

`keep = max_len - len(prefix) - len(suffix)` (l.125) then automatically reserves the room, and the tail truncation still works. Smoke test with `--max-train-samples 200 --epochs 1` before a full launch. Not recommended for the main line.

## 6. Bottom line

1. Do not retune the recipe. v2 is near the noise floor; keep lr 5e-5, 2 epochs, len 512.
2. Launch now, in parallel: seed 2 (`mistral7b_lora_v3`) and PL-on-v2 (`mistral_pl95`).
3. Then full-fit (2 seeds, after a smoke test) and a second PL round with the v2+v3 teacher; blend all by nested OOF; submit by 17:30.
4. The only worthwhile code change is `--lora-r/--lora-alpha` flags for one diversity run, and only if concurrency leaves spare capacity.
