# Challenge 1 provenance: the final Kaggle result was trained on Modal

Final submission: `core-ai/submissions/FINAL_mistral_full.csv`, sha256 `125781c7d933dd24a0907cf17f65321c5efb3b85ec5027be2d151d1baa603b18`, public LB **0.98974** (Kaggle ref 57519710, 2026-10-22 09:53 UTC).

## Summary

- All model training ran on **Modal** (A100-80GB), in 3 team workspaces (`xaongoctan`, `mq120121`, `lengocanh2803`). Nothing was trained on Kaggle; the Kaggle notebook only loads saved predictions and re-runs the blend.
- Single approved backbone in the final: `mistralai/Mistral-7B-Instruct-v0.3`, LoRA (r=16, alpha=32), sequence classification.
- No external data, no hand labels, no threshold/bias tuning. Pseudo-labels come from our own Mistral v2 model on the unlabeled competition test text (conf >= 0.95).
- Blend = geometric mean of 4 fold runs (5 folds each) + 5 full-fit seeds (weight 0.6), argmax.
- Local launch logs contain the Modal app URLs below (`/tmp/*.log` on the launching machine); Modal app pages and billing are the independent evidence.

## Timeline (2026-10-22, UTC+7 unless noted)

| Time | Event (commit) |
|---|---|
| 09:53 | first commit `96aca95` |
| 10:43 | uv project + Modal pipeline `25353f7` |
| 11:26-11:31 | restructure, OOF alignment fix `4e4fbb0`, `476d812` |
| 12:09 | mmBERT notebook/harness `b314a8c` (experiments) |
| 13:29 | pseudo-label, full-fit, FGM etc. `7e86f10` |
| 14:51 | Mistral-only reproducible blend `1af24d1` |
| 15:12 | Mistral-only OOF 0.9821 recorded `78ced81` |
| 16:51 | 4 fold runs + 5 gated full-fit seeds, FINAL_mistral_full.csv `06e65ba` |
| 16:57 | Kaggle notebook + dataset metadata `0aeafd8` |
| 16:53 (09:53 UTC) | FINAL submitted to Kaggle (0.98974) |

Kaggle times are UTC (local = UTC+7). The Modal runs happened between the commits above.

## Training runs (Modal)

Common recipe: Mistral-7B-Instruct-v0.3, LoRA r=16/alpha=32/dropout 0.05, lr 5e-5 (v1: 1e-4), 2 epochs (v1: 1), batch 8 x grad-accum 2, max_len 512 (v1: 384), warmup 0.1, wd 0.01, class weights sqrt, grad checkpointing, 5-fold StratifiedGroupKFold, GPU A100-80GB (from launch logs, `gpu=A100-80GB`). `save_model=false`.

| Run | Account / workspace | Modal app ID | URL | Seed | Pseudo-label | Status |
|---|---|---|---|---|---|---|
| mistral7b_lora_v1 | xaongoctan | ap-EWesvAY4DOth8ETTWynVwG | https://modal.com/apps/xaongoctan/main/ap-EWesvAY4DOth8ETTWynVwG | 42 | none | Excluded: fold2 diverged (F1 0.579), early config |
| mistral7b_lora_v2 | xaongoctan | ap-fj8sOQJvZzNlbjxFU2Hxuy | https://modal.com/apps/xaongoctan/main/ap-fj8sOQJvZzNlbjxFU2Hxuy | 42 | none (field pseudo_threshold 0.95 unused) | **Used**; also the pseudo-label teacher |
| mistral7b_lora_v3 | mq120121 | ap-MEX9WW2QQibcnUQLTZJvEw | https://modal.com/apps/mq120121/main/ap-MEX9WW2QQibcnUQLTZJvEw | 2 | none | **Used** |
| mistral_pl95 | mq120121 | ap-3C4QJbX9FHNCS6v4WnE9Ob | https://modal.com/apps/mq120121/main/ap-3C4QJbX9FHNCS6v4WnE9Ob | 7 | teacher v2, thr 0.95 (n_train 16918) | **Used** |
| mistral7b_lora_v4 | mq120121 | ap-eYdT7ydtCkd79nlTNtLucn | https://modal.com/apps/mq120121/main/ap-eYdT7ydtCkd79nlTNtLucn | 3 | none | **Used** |
| smoke (mfull) | mq120121 | ap-Q514Y00HartzYJiyrfCHzI | https://modal.com/apps/mq120121/main/ap-Q514Y00HartzYJiyrfCHzI | - | - | Smoke test only |
| mistral_pl95_s2 | lengocanh2803 | ap-drn2cPvEEkgDtI2SpYUpGU | https://modal.com/apps/lengocanh2803/main/ap-drn2cPvEEkgDtI2SpYUpGU | 11 | teacher v2, thr 0.95 | Excluded: fold0 diverged (F1 0.641) |
| mistral_full_pl | lengocanh2803 | ap-fwtwL134XiuGYtraOBkVHR | https://modal.com/apps/lengocanh2803/main/ap-fwtwL134XiuGYtraOBkVHR | 21, 22, 23 | teacher v2, thr 0.95 (n_train 19718) | **Used** (full-fit, passed gates) |
| mistral_full | lengocanh2803 | ap-dkmMcQITZeujZAMfSbxEE0 | https://modal.com/apps/lengocanh2803/main/ap-dkmMcQITZeujZAMfSbxEE0 | 31, 32 | none (n_train 14000) | **Used** (full-fit, passed gates) |

mmBERT-base, XLM-R-large, wolf-defender and RemBERT runs were also launched on `xaongoctan` as experiments only (app IDs not captured here; see that workspace's app list). None is in the final blend.

### Per-fold results (train_seconds from `outputs/<run>/<fold>/metrics.json`; macro-F1 on held-out fold)

| Run | Fold / seed | F1 | train s | epoch s | test_probs.npy sha256[:16] |
|---|---|---|---|---|---|
| v1 (excl.) | 0 | 0.9659 | 924 | 884 | a3a5c6c8762094bc |
| v1 (excl.) | 1 | 0.9546 | 891 | 850 | 034cf7132d9ad13e |
| v1 (excl.) | 2 | 0.5793 | 887 | 848 | 06ce999461a7392d |
| v1 (excl.) | 3 | 0.9612 | 924 | 887 | 81ee9cc6fcc7bfd9 |
| v1 (excl.) | 4 | 0.9711 | 846 | 807 | 363ff20ef368ede1 |
| v2 | 0 | 0.9699 | 1882 | 901, 942 | 75b31a9ffa07bacf |
| v2 | 1 | 0.9700 | 2107 | 1006, 1059 | 36f469d7b1a89b51 |
| v2 | 2 | 0.9812 | 1721 | 815, 862 | ff073cdf3f81ca24 |
| v2 | 3 | 0.9719 | 1515 | 723, 754 | 3471e23984982ad9 |
| v2 | 4 | 0.9787 | 1528 | 728, 762 | 274023e7fb643476 |
| v3 | 0 | 0.9669 | 1745 | 829, 871 | e661513d5860e8fa |
| v3 | 1 | 0.9666 | 1728 | 817, 865 | 209625073d835fd9 |
| v3 | 2 | 0.9773 | 1734 | 823, 865 | 408212d97753d8bb |
| v3 | 3 | 0.9762 | 1853 | 887, 923 | 2f32ea40d81d2857 |
| v3 | 4 | 0.9732 | 2099 | 1007, 1048 | 780b7bfc09677705 |
| v4 | 0 | 0.9718 | 1939 | 923, 970 | 7fbeda90ef693104 |
| v4 | 1 | 0.9757 | 1974 | 934, 994 | b1f820ecc2eb5227 |
| v4 | 2 | 0.9724 | 1753 | 844, 873 | 12f8d74d4a103f47 |
| v4 | 3 | 0.9794 | 1733 | 824, 865 | eb52cf7088ac9164 |
| v4 | 4 | 0.9822 | 2193 | 1049, 1102 | e3adfd6903f1e494 |
| pl95 | 0 | 0.9787 | 2843 | 1365, 1430 | acf478747fbcae0d |
| pl95 | 1 | 0.9750 | 2755 | 1337, 1376 | 95a8a3d917336b38 |
| pl95 | 2 | 0.9832 | 2259 | 1092, 1127 | 8d66ef600e1e3b83 |
| pl95 | 3 | 0.9803 | 2630 | 1271, 1316 | 124adc9f24186511 |
| pl95 | 4 | 0.9795 | 2608 | 1264, 1301 | 5c60068b59fab671 |
| pl95_s2 (excl.) | 0 | 0.6406 | 2511 | 1204, 1263 | c0c530d218ebfe9d |
| pl95_s2 (excl.) | 1 | 0.9763 | 2915 | 1401, 1464 | c91a5a35aee76f4b |
| pl95_s2 (excl.) | 2 | 0.9829 | 2652 | 1282, 1327 | 2edef244662462ee |
| pl95_s2 (excl.) | 3 | 0.9836 | 2598 | 1262, 1293 | 96c75e4f94f76862 |
| pl95_s2 (excl.) | 4 | 0.9847 | 3195 | 1566, 1585 | 38c515506eb1d106 |
| full_pl | s21 | n/a (no holdout) | 3128 | 1561, 1570 | 3e9361efa65fc626 |
| full_pl | s22 | n/a | 2955 | 1490, 1469 | d88fa49681f0244c |
| full_pl | s23 | n/a | 2937 | 1480, 1462 | dc459a3e3d596c13 |
| full | s31 | n/a | 2105 | 1058, 1051 | 21ed48382fb69991 |
| full | s32 | n/a | 1789 | 895, 898 | 91005c7c66caf257 |


## Modal billing (`modal billing summary`, per profile, read-only)

| Workspace | Metered cost (USD) | Ephemeral Apps (GPU) | Network egress | Billed |
|---|---|---|---|---|
| xaongoctan | 27.62 | 27.59 | 0.02 | $0.00 (covered by credits) |
| mq120121 | 29.26 | 29.11 | 0.14 | $0.00 (covered by credits) |
| lengocanh2803 | 22.31 | 22.16 | 0.15 | $0.00 (covered by credits) |

Total metered about $79.19 across the 3 workspaces. Note xaongoctan also includes the experiment runs (mmBERT/XLM-R etc.).

## Kaggle submissions (`kaggle competitions submissions rmit-hackathon-2026`, UTC)

| Date | File | Public | Source |
|---|---|---|---|
| 2026-10-22 04:51 | rembert_raw.csv | 0.97416 | submitted by teammate (not in our submissions/ folder) |
| 06:38 | mistral7b_lora_v2_raw.csv | 0.98232 | ours (`submissions/mistral7b_lora_v2_raw.csv`) |
| 06:49 | mistral-7b_raw.csv | 0.98044 | submitted by teammate |
| 06:53 | XBACKBONE_mistral_mmbert9_50.csv | 0.98589 | ours; Mistral + mmBERT geo blend (both approved models), OOF 0.9816; not the final |
| 07:13 | mistral-7bmistral-7b_e3_raw.csv | 0.98338 | submitted by teammate |
| 09:53 | **FINAL_mistral_full.csv** | **0.98974** | ours, final (commit 06e65ba) |

6 submissions in total, matching the competition limit.

## Final submission and verification

Recipe: fold runs v2, v3, v4, pl95 (weight 1.0 each, fold-averaged) + full-fit full_pl s21-23 and full s31-32 (weight 0.6 each, each passed class-distribution and agreement gates), geometric mean, argmax, no thresholds. Code: `core-ai/src/rmit_hack/blend_full.py`.

Verify the blend (bit-exact, from saved outputs):

```bash
cd core-ai
./scripts/reproduce_final.sh --blend-only
shasum -a 256 submissions/FINAL_mistral_full.csv   # expect 125781c7...603b18
```

Kaggle: notebook `core-ai/kaggle/notebook/RMIT_SGS_HCMUT_NeuroX_C1.ipynb` with the dataset in `core-ai/kaggle/dataset` (zip `core-ai/kaggle/rmit-c1-mistral-final-preds.zip`: saved test_probs + folds) reruns the blend and checks the sha256.

Full retrain: `./scripts/reproduce_final.sh` (downloads data, builds folds, trains the 4 fold runs and 2 full-fit runs on Modal A100-80GB, pulls outputs, blends). Run list is `DEFAULT_FOLD_RUNS` / `DEFAULT_FULL_RUNS` in that script; flags are in `core-ai/README.md` (Final submission section). Per-run seeds and config are in `outputs/<run>/*/metrics.json` (key `cfg`).

## Honest limitations

- LoRA adapter weights were not saved (`save_model=false`); only test probabilities, OOF and metrics. Verification is therefore by re-running the training script (statistically equivalent result), plus a bit-exact blend from saved probs.
- GPU training is not bit-exact across reruns; seeds, recipe and data splits are fixed.
- `outputs/` and `submissions/` are gitignored; the saved probs are in the Kaggle dataset zip. `/tmp/*.log` launch logs are local to the launching machine.
- `mistral_pl95_s2` is still listed in the README `blend_full` command; it is excluded from the final (fold0 diverged), as is `v1`. The recipe above (4 fold runs + 5 full-fit) is what the final file contains per commit message `06e65ba`.
- External data: none. Pseudo-labels: our own Mistral v2 predictions on unlabeled competition test text.
- Only the approved backbone is in the final. An earlier submission (XBACKBONE, 0.98589) blended Mistral and mmBERT (both approved models); the final is Mistral-only.
- Some team members submitted files manually (marked above); we have not independently verified their provenance.

## Recommended extra evidence

Screenshots of the Modal Apps list and Billing page for all 3 workspaces (`xaongoctan`, `mq120121`, `lengocanh2803`), showing the app IDs above, A100-80GB usage and cost.

## Screenshots

Modal dashboard screenshots (Apps list, stopped `rmit-hack-2026` runs) are in [`docs/evidence/`](evidence/).

## Public verification on Kaggle

- Kaggle notebook: https://www.kaggle.com/code/nostidus/rmit-sgs-hcmut-neurox-c1 (version 1, CPU, internet off). It loads the saved per-model predictions from the dataset below, prints OOF 0.9821 and writes `submission.csv` with sha256 `125781c7d933dd24a0907cf17f65321c5efb3b85ec5027be2d151d1baa603b18`. That hash is identical to the final Kaggle submission (verified from the kernel output on 2026-10-22 ~17:15 UTC+7).
- Kaggle dataset: https://www.kaggle.com/datasets/nostidus/rmit-c1-mistral-final-preds (per-fold/per-seed `test_probs.npy`, `test_ids.npy`, `oof.csv`, `folds.csv`).
