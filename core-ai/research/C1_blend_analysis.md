# C1 blend analysis (local, nested CV on folds.csv)

Scripts: scratchpad/{bl.py,a1.py,a2.py,final_blend.py}. Baseline = 0.5*log(Mistral v2) + 0.5*mean-log(9 mmBERT): OOF 0.9816 (nested weight search 0.9813).

## 1. Errors of the current blend (212 / 14000)
- Confusion (true->pred): BEN->JB 85, BEN->PI 10, JB->BEN 81, JB->PI 1, PI->BEN 32, PI->JB 3.
- Language: pt 153 errors (2.4%), it 26 (0.9%), fr 22 (0.6%), en 11 (0.8%). pt BEN<->JB = 146 of 212.
- Length: <100 chars 0.4%, 100-300 0.9%, 300-700 2.1%, 700-2000 2.9%, >2000 2.0%.
- Confidence: 55 errors at conf>0.999 (13329 rows, 0.4%), 30 in .99-.999, 127 below .99 (error rate 21-72%).
- Shared: Mistral alone wrong 276, mmBERT-9 alone wrong 351, both 108; blend wrong 212 = 107 where both wrong + 105 where exactly one wrong; 0 where both right. So blending fixes 169/276 and 244/351 single-model errors but ~half of the remaining errors are shared (label noise / unlearnable pt role-play).

## 2. Blend weights (nested = pick weights on 4 folds, score the 5th)
Groups: mis, mm9 (mean of 9), pl95, wolf (mean e4+v1b, alone 0.968), xlmr (mean of 4, alone 0.958).
Mistral weight vs mm9: 0.3 .9802, 0.4 .9814, 0.5 .9816, 0.6 .9808, 0.7 .9806. Plateau 0.4-0.6, 0.5 chosen in 4/5 folds.
| groups | nested | in-sample best |
|---|---|---|
| mis+mm9 | 0.9813 | 0.9816 |
| mis+pl95 | 0.9816 | 0.9821 |
| mis+mm9+pl95 | 0.9817 | 0.9824 |
| mis+mm9+wolf | 0.9814 | 0.9824 |
| mis+mm9+pl95+wolf | 0.9817 | 0.9826 |
| mis+mm9+xlmr | 0.9811 | 0.9816 (xlmr weight 0) |
| all 5 | 0.9809 | 0.9827 |
Equal-weight 3-4 group blends are worse (0.980-0.9808). Per-language Mistral weight (nested): 0.9812 (no gain).
mmbert_dapt (4/5 folds, 11200 rows): adding as 10th mmBERT 0.98037 -> 0.98051 (noise); alone 0.968 vs 0.9709 for mm9 on same rows. Not useful.
Verdict: extra backbones (wolf/xlmr) and pl95 give <= +0.0004 nested, inside fold noise (+-0.005 per fold). Not worth the rule risk.

## 3. Stacking (nested, features = group log-probs [+ one-hot language + log length])
LR on mis+mm9: 0.9814-0.9817 (C .01-1); with language/length 0.9811-0.9813; HistGB 0.981 / 0.9803.
LR on 5 groups: 0.9813-0.9821 (best C=0.01); HGB 0.9821; with lang/len 0.9816-0.9821.
Best stack +0.0005 over geo-blend at 5 groups; zero gain with 2 groups. Language/length features do not help. Not recommended.

## 4. Class bias on blend (nested, grid +-2, step .25)
0.9814 vs 0.9816 raw: no gain (rule: keep only if >= +0.001). Rejected.

## 5. Recipe
Keep the plain geo-blend. Nothing tested beats it honestly by >= 0.001. Remaining errors are mostly shared/unlearnable.
`submissions/BLEND_best_now.csv` = baseline recipe: honest OOF 0.9816 fixed recipe / 0.9813 nested weight search; labels B/JB/PI = 62.18/30.92/6.90%;
agreement with XBACKBONE_mistral_mmbert9_50.csv = 100% (identical).
Adding new Mistral runs (v3, pl95, v4): average them inside the Mistral group (mean-log), keep 0.5/0.5 (re-check weight with --tune-nested; averaged Mistral should be stronger so 0.5-0.6 is fine):
`uv run python <scratchpad>/final_blend.py --name X --group 0.5:mistral7b_lora_v2,<new runs> --group 0.5:<9 mmbert runs> --ref submissions/XBACKBONE_mistral_mmbert9_50.csv --tune-nested`
(script rejects runs with missing folds; writes core-ai/submissions/X.csv, checks ids/labels.) Caveat: test preds are fold-averaged while OOF is single-model, so test is a bit better than OOF suggests (consistent with LB ~ OOF + 0.004-0.008).
