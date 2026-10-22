# A3 - full-fit + final blending / selection (22/10, local analysis on 6 mmBERT runs, OOF n=14000)

Scratch script: scratchpad/a3.py (uses ensemble.macro_f1 / tune_bias, folds.csv for nested).

## Measured (mmBERT)
Singles (raw / tuned / nested): base_v1 .9628/.9657/.9641; s2 .9619/.9632/.9611; s3 .9629/.9645/.9625;
s4 .9640/.9654/.9637; e5 .9652/.9662/.9644; pl95 .9715/.9720/.9709.
Nested - raw over all 63 run-subsets, prob-avg: mean -0.0003 (singles -0.0002, pairs -0.0007, quads -0.0009, all-6 +0.0010).
Half-shrunk biases: ~ -0.0002 mean. => tuned biases are noise-level; "tuned" in the log overstates by ~+0.001.
Combos (raw/tuned/nested):
- 4 seeds (base,s2,s3,s4): prob .9701/.9710/.9701 ; logp .9716/.9721/.9705 ; vote .9701
- all 6: prob .9721/.9739/.9731 ; logp .9738/.9747/.9730 ; vote .9720
- mean raw over all 2/3/4-subsets: prob .97084, logp(geometric mean) .97171, vote .97068  => logp +0.0009.
- rank averaging: not usable for 3-class argmax (per-class ranks break calibration; raw 0.69); after tuning ~= prob. Skip.
Test pred dist matches train (62/31/7) for every run; fold-avg vs all-run-mean agreement 99.0-99.35%;
a single fold model agrees with its fold-avg on only 98.2-98.6%, i.e. ~1.5% of test rows are "unstable" - that is the variance
that averaging/full-fit removes.

## Recommendations
1. Full-fit vs folds. Full-fit sees 100% vs 80% data (+25%); typical gain of a single model ~ +0.001-0.003 F1 at this size, but a
   5-fold average already gets a 5-model ensemble (+0.005-0.008 vs single fold), which dominates. So full-fit is an ADD-ON, never a
   replacement: expected LB gain of adding 1-2 full-fit seeds to 5-fold(s) ~ +0.001-0.002 (within noise of the 6000-row LB, 1 row = 0.00017).
   Risk: no eval -> silent divergence (Mistral v1 lr1e-4 fold collapsed to 0.58). Keep lr 5e-5, same epochs (steps +25%, fine with
   cosine/linear sched). Gate each full-fit before blending:
   (a) argmax class distribution within +-1.5pt of 62/31/7 (b) agreement with current best fold-avg blend >= 98.5% (healthy runs: 98.2-99.4%;
   reject < 97.5%) (c) mean max-prob not > 0.02 above fold models; (d) train loss in metrics/log similar to folds.
   Seeds: 2 seeds if budget (1 full-fit = ~1.25x one fold ~ 50 min A100); 1 is OK. Never full-fit-only submission.
   Weights in blend_full: currently each full-fit counts 1 and each --folds RUN counts 1 (folds averaged first). Recommended: weight each
   fold-run (5 models) ~1.0 and each full-fit seed ~0.5-0.7 (one model but best-data); with 2 fold-runs + 2 full seeds ->
   ~[1,1,.6,.6]. blend_full has no --weights flag; add one (small edit) or replicate by passing dirs. Also switch blend_full to
   geometric (log-prob) mean; change `p=np.mean(models)` to mean of log(p) then softmax.
2. Bias rule. Default: NO bias (raw). Apply tuned bias only if nested > raw + 0.001 (then use 0.5x shrink). In our data this fires only
   for the largest ensemble (all-6 prob: +0.0010 borderline) - i.e. basically never for logp. ensemble.py prints raw/tuned/nested; use
   `--no-bias` unless the rule fires. Note the S1 submission (4-seed prob, tuned bias [0,0,0.6]) was ~neutral either way.
3. Averaging: use geometric mean (log-prob avg, renormalise) for seeds/folds/full-fits: +0.0009 avg vs prob avg on OOF, consistent over
   subsets; larger effect expected for LoRA LLMs (overconfident softmax, so outliers dominate prob-avg less... either way logp is no worse).
   ensemble.py currently averages PROBS (fold test mean, then weighted run mean) - one-line change to log domain; OOF and test must use
   the same rule.
4. Submission selection (5 left, public LB ~ OOF+0.005, 6000 test rows => LB SE ~ 0.002, many top teams differ by less):
   S2 best Mistral fold-avg (raw, geo-mean) when ready; S3 + second Mistral run/pseudo-label combo; S4 final everything
   (all Mistral runs + full-fit, weights above) by 17:30; keep 1 slot for format failure/reserve. Don't chase public LB diffs < 0.002:
   choose by OOF (nested/raw) with LB as a sanity check. Final-2: (i) the largest Mistral blend (max OOF, lowest variance),
   (ii) a diversified hedge: best Mistral blend + full-fit variant OR the mmBERT combo (OOF .9738, LB-safe ~.979) only if Mistral blend is
   not clearly > mmBERT on both OOF (>= +0.003) and LB. Private is a different random split of the same distribution so correlation is
   high; the hedge matters only for risk of a bad full-fit. Pseudo-label OOF is optimistic (+0.001-0.003) - do not rank PL vs non-PL by OOF alone.
5. Smoke test of `--full-fit --lora` (do before the real run; ~10 min A100, ~$1):
   cd core-ai && uv run modal run -m modal_app.train --model-name mistralai/Mistral-7B-Instruct-v0.3 --lora --full-fit --seeds 1 \
     --lr 5e-5 --epochs 1 --batch-size 8 --grad-accum 2 --grad-ckpt --max-len 512 --gpu A100-80GB --max-train-samples 200 --run-name smoke_mistral_full
   Check: ./scripts/pull_outputs.sh smoke_mistral_full; outputs/smoke_mistral_full/full_s1/{test_probs.npy,test_ids.npy,metrics.json} exist,
   shape (6000,3), rows sum to 1, no NaN, then `python -m rmit_hack.blend_full --full outputs/smoke_mistral_full --name smoke_chk` runs.
   (Caveat: 200 samples gives meaningless preds; only plumbing is tested. Code path: full_fit -> eval_strategy="no", predict_probs on
   test only, saves test_probs/ids/metrics; LoRA-specific branches (infer_model, adapter merge) are shared with fold path, so risk is low.)
   Run real full-fit with --detach right after A1/A2 launch only if >=4 A100-h remain; skip if Mistral fold runs are late.
