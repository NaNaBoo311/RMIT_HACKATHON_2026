# C1 (3-class prompt-attack, macro-F1) - technique recommendations

Written from domain knowledge and prior published results (no live web lookup, so verify any citation before quoting it). Gains marked "typical" are rules of thumb from Kaggle NLP competitions, not measured on this data. Current `modal_app/train.py`: single 90/10 split, plain CE, argmax, max_len 256 head-truncation, best-epoch by macro-F1 on the 10% holdout. That holdout has only about 98 PROMPT_INJECTION (PI) examples (7% of 1400), so macro-F1 is very noisy (+-2-4 points).

Rough L4 cost (bf16, len 256, 14k texts): xlm-roberta-base about 1.5-2.5 min/epoch. xlm-roberta-large about 6-9 min/epoch. 5-fold x 3 epochs large is about 2-2.5 h. 5-fold base is about 30 min. Test inference is cheap.

## Priority list (gain per hour)

| # | Item | Effort | Typical gain | Notes |
|---|------|--------|--------------|-------|
| 1 | Stratified k-fold + save OOF/test logits | 45 min | Enables everything else; better model selection | Replaces the noisy 10% holdout |
| 2 | Post-hoc per-class logit bias tuning on OOF | 20 min | +0.5-3 pts macro-F1, largest when PI recall is low | Free, no retraining |
| 3 | Mild class weights (sqrt inverse freq) in CE | 15 min | +0.5-2 pts on minority F1, before bias tuning | Do not stack heavy weights with bias tuning |
| 4 | Head+tail truncation, max_len 384-512 | 20 min | +0-2 pts if long texts are class-informative | Check with the length-vs-label EDA first |
| 5 | Fold averaging (5 folds -> 1 test prediction) | 0 extra | +0.5-1.5 pts over single model | Comes with k-fold |
| 6 | 2nd backbone (mmBERT-base / protectai deberta-v3 prompt-injection-v2 / rembert) + blend | 1-2 h GPU | +0.5-1.5 pts | Diversity beats a 2nd seed |
| 7 | TF-IDF char n-gram + LR as blend member | 30 min CPU | +0-1 pt; sometimes more if attacks have lexical templates | Cheap sanity baseline too |
| 8 | XLM-R-large with stable recipe | 2.5 h GPU | +1-3 pts over base on hard multilingual semantic tasks | Only if base OOF is not already near-saturated |
| 9 | Translation / back-translation augmentation | 3+ h | Low and risky in 7 h | Skip (see section 6) |

## 1. Class imbalance for macro-F1

Class mix is 62/31/7. Macro-F1 weights PI as much as the 62% class.

- Weighted CE vs focal vs oversampling. All three mainly shift the decision boundary toward the minority class. Because we will tune per-class logit biases on OOF afterwards (which corrects prior shift directly), the choice of training loss matters less than usually thought. Published comparisons (e.g. Johnson and Khoshgoftaar 2019 on deep-learning imbalance; focal loss, Lin et al. 2017) show gains from reweighting are modest on moderate imbalance such as 14:1; focal loss was designed for extreme imbalance (1:1000) in dense detection.
- Recommendation: plain CE with mild weights `w_c = (n_max/n_c)^0.5` (about 1.0, 1.4, 3.0), optionally label_smoothing 0.05. Then bias-tune on OOF. Avoid full inverse-frequency (about 1:2:9) with large models: it destabilises XLM-R-large and harms calibration of the majority class.
- Oversampling PI to about 2x (via `WeightedRandomSampler` or by duplicating rows in the training fold only) is equivalent to weights but also costs epoch time. Use weights, not oversampling. Never duplicate before the fold split (leakage).
- Focal loss (gamma=2) is fine as an optional diversity member for a second run, not the default.

### Post-hoc threshold / logit-bias tuning
Take OOF logits for all 14k train rows (each from a model that did not see that row). Convert to log-probabilities and search additive biases `b` (one per class, fix the majority at 0) maximising macro-F1 of `argmax(logp + b)`. With 3 classes, a 2-D grid is trivial: b1, b2 in [-2, 3] step 0.1 (about 2500 evaluations on 14k rows, under 10 s). Refine with coordinate ascent. To avoid overfitting to OOF noise: use a coarse grid, prefer the centre of the plateau of near-best scores (smooth the F1 surface, e.g. average over a 3x3 neighbourhood), and check that the bias is stable across folds (tune on 4 folds' OOF, evaluate on the 5th). Typical gain: +0.5-3 pts macro-F1 when an ordinary CE model under-predicts the minority; about +0 when already balanced. Apply the same biases to the fold-averaged test logits (average logits or probs from the same fold models; OOF of single models vs a 5-model average are slightly differently calibrated, but the shift is small).

## 2. Long-text handling

- Median is about 294 chars (about 80-100 tokens), so 256 tokens covers most rows. The tail up to 18.5k chars matters because attackers often put the injected instruction at the end of a long benign-looking document (indirect prompt injection), which head truncation misses entirely. Check first: bucket rows by token length, compute label distribution and OOF error rate per bucket. If PI/JAILBREAK is over-represented in long rows or errors concentrate there, invest in long-text handling.
- Cheapest robust option: head+tail truncation. Keep first ~128-192 tokens and last ~192-256 tokens (Sun et al. 2019, "How to Fine-Tune BERT for Text Classification": head 128 + tail 382 was best on IMDB/Sogou, +0.5-1 pt over head-only). Implementation: tokenize without truncation, slice ids, re-add special tokens (`tok.build_inputs_with_special_tokens`).
- Max_len: 384 is a good compromise on L4 (cost about 1.6x of 256 due to padding; use `group_by_length=True` to cut padding waste). 512 is XLM-R's hard limit. Only the long minority of rows pay the cost if you sort by length. Go to 512 for base models; use 384 for large.
- Sliding window / chunk + pooling: split into 256-token windows with stride 128 (cap at e.g. 6 chunks, choosing first, last and evenly spaced ones), run the model on each chunk, then max-pool (or mean of top-2) the logits per doc at inference. For training, label each chunk with the doc label (noisy: a JAILBREAK doc may have benign chunks). Better: train on head+tail, use chunking only at inference for rows > 512 tokens (a few percent), with max-pool over per-class probabilities of non-benign classes. This is moderate implementation effort (1 h) and only worth it if the length-bucket EDA shows high error on long rows. Priority below head+tail.

## 3. Validation strategy with 6 submissions

- 5-fold `StratifiedKFold(n_splits=5, shuffle=True, random_state=SEED)` on a combined stratum `label x language` (language via a quick detector like `langdetect`/`fasttext lid` or a heuristic; code-switched rows get their dominant language). Add a length-bucket to the stratum only if it does not create strata with fewer than 5 rows.
- Duplicates/near-duplicates: dedupe by normalised text (lowercase, strip) and use `StratifiedGroupKFold` with the normalised text (or a template hash) as the group, otherwise OOF is optimistic. Check for train-test duplicates as well (exact matches could be copied directly from train labels).
- Metrics: OOF macro-F1 over all 14k rows (not per-fold average) plus per-class F1 and per-language F1. Differences under about 0.5 pt are noise; bootstrap the OOF set (1000 resamples) to get a CI, or compare candidate models on the same OOF with a paired bootstrap.
- Epoch selection: with k-fold, avoid per-fold `load_best_model_at_end` on the validation fold (it leaks OOF optimism, a small bias). Use a fixed epoch count (3 for large, 3-4 for base) chosen from the first fold or two, and keep the last checkpoint; or accept the mild bias but note OOF is then slightly optimistic when comparing against LB.
- Submission plan (6 slots), see section 7. Rule: submit only things whose OOF differs meaningfully; use the leaderboard (public part) as a check on CV-LB correlation, not as the optimiser. If public LB and OOF disagree by more than about 2 pts, trust OOF as long as the OOF protocol had no leakage; the public LB set is only a fraction of the 6000 test rows.
- Final pick: the best blended OOF with bias tuning, not the best public LB score.

## 4. Ensembling

- Fold averaging: free, typical +0.5-1.5 pts over one model, and reduces variance on the rare class.
- Multiple backbones: the best diversity source; xlm-roberta-large + mmBERT-base (modern ModernBERT-style multilingual encoder, 8k context, handles long text natively) + protectai deberta-v3-base-prompt-injection-v2 (English-centric tokenizer but pretrained for exactly this task; check how it does on pt/fr/it, it may be weak there but strong on en and on the PI class) typically gives +1-2 pts over the best single one. Note mmBERT with 8k context could replace chunking: try max_len 1024-2048 on a subset of long rows only.
- Blend method: average probabilities (or logits) with weights chosen on OOF (non-negative, e.g. `scipy.optimize.minimize` on OOF log-loss, or a simple grid of 3-4 weights), or logistic regression stacking on concatenated OOF logits (5-fold CV inside). Simple weighted average is safer with 14k rows. Bias-tune after blending, not before.
- TF-IDF char(2-5)-gram + LR: 3-10 minutes on CPU, with 5-fold OOF. Alone it is likely clearly below the transformers, but as a blend member (weight 0.1-0.25) it adds +0-1 pt, mostly because prompt-attack data often has template/lexical artefacts. It also tells you if the data is easy: if TF-IDF already scores about the same as XLM-R-base, spend less on big models and more on bias tuning.
- Expected total: k-fold fold-avg + 2-3 backbones + TF-IDF + bias tuning: about +2-4 pts macro-F1 over a single-split base model.

## 5. XLM-R-large stability

Known failure: XLM-R-large (and similar large models) sometimes collapses to the majority class (loss stuck near the prior, macro-F1 about 0.25) at lr 2e-5 or higher, particularly with fp16, short warmup, small data, or imbalanced labels (Mosbach et al. 2021, "On the stability of fine-tuning BERT"; Zhang et al. 2021 "Revisiting few-sample BERT fine-tuning"). Recipe:

- lr 8e-6 to 1.2e-5 for large (start with 1e-5), batch size 16 effective 32 (`per_device_train_batch_size=16, gradient_accumulation_steps=2`), warmup_ratio 0.1, linear or cosine decay, weight_decay 0.01, `max_grad_norm=1.0`, AdamW eps 1e-6, betas (0.9, 0.98) (the RoBERTa convention).
- bf16 (not fp16) on L4; fp16 plus XLM-R-large is a known source of NaN/collapse. `torch.cuda.is_bf16_supported()` is true on L4, so current code already picks bf16.
- Epochs: 3 (4 at most). More epochs with large mostly overfits at this data size. Eval every half epoch or each epoch.
- Layer-wise LR decay (LLRD) 0.9 with head lr about 5e-5-1e-4: helps stability and gives about +0.3-1 pt in many Kaggle writeups (e.g. Feedback Prize, CommonLit). Implementation: build param groups per layer with lr = base_lr * decay^(num_layers - layer_idx) and pass `optimizers=(AdamW(groups), None)` to Trainer, or override `create_optimizer` in a Trainer subclass.
- Re-initialise the top 1-2 encoder layers + pooler/classifier (Zhang et al. 2021) is optional; helps stability on small data.
- Detect collapse early: after the first epoch, if eval macro-F1 is below 0.5 or training loss is about equal to the prior entropy (about 0.9 for 62/31/7), abort and restart with a different seed and lr x0.7. Add this check in a `TrainerCallback`, or just check fold-0 first (about 20 min) before launching the others.
- R-Drop (KL between two dropout passes, alpha 1-4): about +0.3-1 pt in some tasks but doubles the forward cost and is another failure surface. Skip given the time budget. Cheaper regularisers: multi-sample dropout head or just hidden_dropout 0.1 (default).
- Safer fallback if large still collapses: mdeberta-v3-base (if allowed) or xlm-roberta-base with 3-4 epochs at 3e-5; base rarely collapses.

## 6. Multilingual augmentation

Not worth it in 7 h with 14k labelled rows already in 4 languages. Reasons: translating 14k texts (some very long) with an MT model on the same L4 costs 1-3 h for little diversity; translation can destroy the attack artefacts (exact injection phrases, special tokens, role markers) that define the classes, causing label noise; evidence for translation-train gains is strongest when a language has very few labels, which is not the case here. Cheaper alternatives with some value: (a) light, free augmentation: random head/tail crops of long texts during training; (b) pseudo-labelling confident test predictions (6000 rows) in a second-round fold training, typical +0.3-1 pt but with leakage risk if done wrongly (use only test, never validation folds); consider only if time remains after step 5 of the plan.

## 7. Code-level changes to modal_app/train.py

Restructure into `train_fold(fold, ...)` called in a loop (or `.map` over folds for parallel containers; Modal L4 containers are independent, so folds can run in parallel for wall-clock speed, cost is the same).

```python
from sklearn.model_selection import StratifiedKFold

# stratum = label x language (compute lang in rmit_hack.data or here)
strat = y.astype(str) + "_" + lang  # lang: np.array of 'pt','fr','it','en'
skf = StratifiedKFold(n_splits=5, shuffle=True, random_state=config.SEED)
folds = list(skf.split(np.zeros(len(y)), strat))
tr_idx, va_idx = folds[fold]
```

Head+tail tokenisation inside `DS`:

```python
def enc_ht(txt, max_len=384, head=160):
    ids = tok(txt, add_special_tokens=False, truncation=False)["input_ids"]
    keep = max_len - tok.num_special_tokens_to_add(False)
    if len(ids) > keep:
        ids = ids[:head] + ids[-(keep - head) :]
    return tok.build_inputs_with_special_tokens(ids)  # then attention_mask = [1]*len
```
(Tokenising 18k-char texts without truncation is fine; do it once up front and cache. Add `group_by_length=True` to TrainingArguments to cut padding.)

Weighted loss via Trainer subclass:

```python
class WTrainer(Trainer):
    def __init__(self, *a, class_weights=None, **k):
        super().__init__(*a, **k)
        self.cw = class_weights

    def compute_loss(self, model, inputs, return_outputs=False, **kw):
        labels = inputs.pop("labels")
        out = model(**inputs)
        loss = torch.nn.functional.cross_entropy(
            out.logits.float(),
            labels,
            weight=self.cw.to(out.logits.device),
            label_smoothing=0.05,
        )
        return (loss, out) if return_outputs else loss


counts = np.bincount(y[tr_idx])
cw = torch.tensor((counts.max() / counts) ** 0.5, dtype=torch.float)
```
(`**kw` absorbs `num_items_in_batch` in newer transformers versions.)

Save OOF + test logits per fold (the key artefacts), and the fixed-epoch last model, not the best:

```python
va_logits = trainer.predict(ds_va).predictions
te_logits = trainer.predict(ds_te).predictions
np.save(out_dir / f"oof_fold{fold}.npy", va_logits)
np.save(out_dir / f"va_idx_fold{fold}.npy", va_idx)
np.save(out_dir / f"test_fold{fold}.npy", te_logits)
# don't save full model checkpoints for every fold (large = 2 GB each): save_strategy="no", skip trainer.save_model
```
Set `save_strategy="no"`, `load_best_model_at_end=False`, `eval_strategy="epoch"` (keep for monitoring only). Add a collapse guard callback aborting if epoch-1 eval macro_f1 < 0.5.

Bias-tuning function (run locally on assembled OOF, e.g. in `scripts/blend.py`):

```python
import numpy as np, itertools
from scipy.special import log_softmax
from sklearn.metrics import f1_score


def tune_bias(logits, y, grid=np.arange(-2.0, 3.01, 0.1), majority=0):
    lp = log_softmax(logits, -1)
    others = [c for c in range(lp.shape[1]) if c != majority]
    best = (-1, None)
    for b in itertools.product(grid, repeat=len(others)):
        bias = np.zeros(lp.shape[1])
        bias[others] = b
        f = f1_score(y, (lp + bias).argmax(-1), average="macro")
        if f > best[0]:
            best = (f, bias.copy())
    return best  # (oof_macro_f1, bias)


# 51*51=2601 f1 evals on 14k rows is about 10-20 s; use a faster confusion-matrix F1 if needed.
```
Check robustness: tune on folds {0-3} OOF, score on fold 4 (and rotate). Final test prediction: `argmax(log_softmax(mean(test_fold_k, 0)) + bias)` then `make_submission`. Also write a `blend.py` that loads `oof_*.npy` per run, reassembles OOF in original order using the saved `va_idx`, fits blend weights, tunes bias, writes submission.

Add CLI args: `--fold` (or `--folds 0,1,2,3,4`), `--head-tail`, `--class-weight-power 0.5`, `--llrd 0.9`, `--seed`. Also add `--max-len 384`.

## 8. Concrete plan (about 7 h, L4)

Hour 0-0.75: EDA (language detection, length-vs-label, duplicates, train/test overlap, per-language class mix). Implement k-fold + OOF/test logit saving + weighted CE + head+tail. Run TF-IDF+LR OOF on CPU in parallel as a floor.
Hour 0.75-1.5: Run `xlm-roberta-base`, 5-fold, len 384 head+tail, lr 3e-5, 3 epochs, weights p=0.5 (about 30-40 min, can run folds in parallel containers). Compute OOF macro-F1, per-class and per-language F1, tune bias. SUBMISSION 1: fold-avg base + bias.
Hour 1.5-4.5: XLM-R-large 5-fold (lr 1e-5, bs 16x2, warmup 0.1, bf16, LLRD 0.9, len 384, 3 epochs, about 2-2.5 h). Run fold 0 first as a collapse check (about 25 min); if it collapses, drop lr to 7e-6 or seed change. While it runs, locally build blend.py. SUBMISSION 2: large alone, fold-avg + bias.
Hour 4.5-6: second backbone from {mmBERT-base, protectai deberta-v3-base-prompt-injection-v2, rembert}, 5-fold (base size, about 40-60 min). Pick mmBERT first (long context, multilingual). SUBMISSION 3: blend large + base + second + TF-IDF with OOF-fit weights, bias-tuned. This is the main candidate.
Hour 6-6.75: Optionally pseudo-label or one more seed of large for the strongest model if GPU time remains; otherwise re-tune blend. SUBMISSION 4: refined blend. 
Keep 2 slots in reserve (5 and 6) for fixing mistakes (format errors, a bad bias) and the final choice. Final: the submission with the best bias-tuned blended OOF macro-F1 (use LB only to detect broken submissions or leakage). Never spend a submission on a sub-0.5-pt OOF variation.

If PI F1 stays poor in OOF: check confusion between PI and JAILBREAK first (likely the main error mode), then consider a larger bias on PI and the protectai model as a member since it is pre-trained for that class.
