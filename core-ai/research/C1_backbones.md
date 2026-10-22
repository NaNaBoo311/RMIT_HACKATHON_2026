# C1 backbone comparison (pt/fr/it/en prompt-attack classification, macro-F1)

Sources: HF model cards fetched 2026-10-22 (jhu-clsp/mmBERT-base, mmBERT-small, protectai/deberta-v3-base-prompt-injection-v2,
patronus-studio/wolf-defender-prompt-injection, google/rembert, FacebookAI/xlm-roberta-large, ibm-granite/granite-3.3-2b-instruct,
mistralai/Mistral-7B-Instruct-v0.3). Items marked (est.) are my estimates from general experience, not measured or sourced.

## Comparison table

| Model (HF id) | Params | Max len | pt/fr/it | Notes |
|---|---|---|---|---|
| jhu-clsp/mmBERT-base | 307M (110M non-emb), 22 layers, vocab 256k (Gemma2 tok) | 8192 | yes (1800+ langs, 3T tokens) | ModernBERT arch; card suggests lr 2e-5..3e-5 for classification; bf16/fp16 ok, flash-attn/unpadding. Needs a transformers version with ModernBERT (>=4.48; card says only >=4.21, ignore). |
| jhu-clsp/mmBERT-small | 140M (42M non-emb), 22 layers, hidden 384 | 8192 | yes | Card: cls lr 3e-5. Fast, weaker than base. |
| patronus-studio/wolf-defender-prompt-injection | ~0.3B, fine-tuned from mmBERT-base | 2048 | "English and German primary, multilingual coverage" | Already a PI+jailbreak detector (binary), trained on 27+ datasets with adversarial augments (unicode/encoding), SupCon + FreeLB, hard negatives. Apache-2.0. Best init for the PI/jailbreak-vs-benign signal; head must be re-initialised for 3 classes (ignore_mismatched_sizes=True). Verify it loads with AutoModelForSequenceClassification (custom code? check config). |
| protectai/deberta-v3-base-prompt-injection-v2 | ~184-200M | 512 | NO: English only | Binary benign/injection, 22 datasets. Card says it does NOT detect jailbreaks or handle non-English. Archived. Tokenizer (128k spm, English-centric) is poor for pt/fr/it accents? (est.: deberta-v3 vocab is English-heavy, so French/Italian/Portuguese get fragmented). Low priority. DeBERTa-v3 is known to be flaky in fp16 (overflow); use bf16 (L4 supports bf16) or fp32. |
| xlm-roberta-base | 278M (mostly embeddings) | 512 | yes (100 langs, CC100) | Safe, robust baseline. lr 2e-5..3e-5. |
| xlm-roberta-large | 560M | 512 | yes | Strongest classic multilingual encoder here; known to occasionally diverge/collapse to one class: use lr 1e-5, warmup 10%, bf16, check epoch 1 loss. |
| google/rembert | ~575M total (input emb small, ~110 langs, vocab 250k); checkpoint has no output embeddings | 512 | yes (110 langs Wikipedia) | Slow/heavy for what it gives; fp16 instabilities reported (est.) -> bf16/fp32; batch 8 as noted by organisers. Usually near XLM-R-large quality at higher cost. |
| distilbert-base-multilingual-cased | 134M | 512 | yes (104 langs) | Fast but clearly weakest; only as ensemble filler. |
| ibm-granite/granite-3.3-2b-instruct | ~2.5B (card shows "3B"), decoder, Apache-2.0 | 128K | yes: en, de, es, fr, ja, pt, ar, cs, it, ko, nl, zh | LoRA seq-cls feasible on L4 in bf16 (see below). |
| mistralai/Mistral-7B-Instruct-v0.3 | 7B, vocab 32768 | 32K | not stated on card; in practice decent fr/it/pt (est.) | 4-bit QLoRA only on L4; slow. |

## Facts that matter for this task

- Task is 3-way (BENIGN / JAILBREAK / PROMPT_INJECTION), pt/fr/it/en, 7% minority class. protectai and wolf-defender are binary
  detectors; neither head is usable as-is. Value = initialisation only. protectai is English-only and explicitly not a jailbreak
  detector -> little transfer. wolf-defender is built on mmBERT-base (multilingual) so it is "mmBERT-base with PI/jailbreak
  knowledge"; plausible gain, but the risk is that its English/German bias skews pt/fr/it; compare against plain mmBERT-base on a CV fold.
- Median 294 chars (~80-100 tokens), max 18.5k chars (~5k tokens). max_len 256 covers most rows; 512 for safety; attacks hidden at
  the tail of long prompts (injection inside documents) may matter -> consider head+tail truncation (first 192 + last 192 tokens) instead of
  plain head truncation. mmBERT/wolf can take 1024 cheaply (RoPE, unpadding).
- Metric is macro-F1 with a 7% class: use class weights or just threshold/prior tuning on OOF probabilities after training.

## Training time estimates, 3 epochs, 14k samples, L4 (est.; dynamic padding, avg ~120 tokens, so max_len 256 vs 512 differs little)

| Model | bs / precision | ~time at max_len 256 | ~at 512 | Memory |
|---|---|---|---|---|
| distilmBERT | 32 bf16 | 3-4 min | 5 min | <6 GB |
| mmBERT-small | 32 bf16 | 4-6 min | 8 min | <8 GB |
| xlm-roberta-base | 32 bf16 | 8-10 min | 14 min | ~8 GB |
| mmBERT-base / wolf-defender | 32 bf16 | 10-15 min | 20 min | ~10 GB |
| deberta-v3-base | 16-32 bf16 | 15-20 min | 30 min | ~10 GB |
| xlm-roberta-large | 16 bf16 (accum 2) | 30-40 min | 60 min | ~16 GB |
| rembert | 8 bf16 (accum 4) | 45-60 min | 80+ min | ~18 GB |
| granite-3.3-2b LoRA r16 bf16 | 8, grad ckpt | 50-80 min | ~2 h | ~16-20 GB |
| Mistral-7B QLoRA 4-bit | 4-8, grad ckpt | 2.5-4 h | >5 h | ~14-20 GB |

L4 has bf16 but no fast fp64; HF `bf16=True`. Do NOT use fp16 for deberta/rembert/XLM-R-large. An A100 is ~2.5-3x faster than L4,
which makes granite/XLM-R-large cheap, and would put Mistral QLoRA at ~1-1.5 h; only worth it if Mistral is in the plan.

## LLM as sequence classifier (granite / Mistral)

- `AutoModelForSequenceClassification.from_pretrained(id, num_labels=3, torch_dtype=torch.bfloat16)` works for both (GraniteForSequenceClassification
  and MistralForSequenceClassification exist in transformers >= 4.45 / long ago). It pools the last non-pad token, so
  set `model.config.pad_token_id = tokenizer.pad_token_id` (Mistral has no pad token: `tokenizer.pad_token = tokenizer.eos_token` or unk; Granite has one),
  and keep padding_side consistent (right padding is OK because HF finds the last non-pad token by pad id; if pad==eos this can
  misfire -> prefer a distinct pad id or left padding).
- peft: `LoraConfig(task_type="SEQ_CLS", r=16, lora_alpha=32, lora_dropout=0.05, target_modules=["q_proj","k_proj","v_proj","o_proj","gate_proj","up_proj","down_proj"])`.
  `task_type=SEQ_CLS` makes the `score` head trainable (modules_to_save). lr 1e-4..2e-4 for LoRA, 1 or 2 epochs, cosine, warmup 3-5%.
- Mistral 7B: load with `BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_quant_type="nf4", bnb_4bit_compute_dtype=torch.bfloat16, bnb_4bit_use_double_quant=True)`,
  `prepare_model_for_kbit_training`, gradient checkpointing. Needs `bitsandbytes`, `peft`, `accelerate` added to the Modal image
  (the uv project may not have them). bf16 base alone (14.5 GB) technically fits the 24 GB L4 with LoRA, but 4-bit is safer for activations.
- Feasibility with ~7 h left and 6 submissions: Granite-2B LoRA is feasible (1-1.5 h for 2 epochs at max_len 256, one run). Mistral-7B is
  feasible only for a single 1-2 epoch run (~3 h on L4, ~1 h on A100); high risk, no time for iteration. The decoder LLMs typically add
  value in an ensemble because they are architecturally different and strong on multilingual semantic cases, but expect a few macro-F1 points at most
  over a well-tuned XLM-R-large/mmBERT on a task this pattern-driven (est.).

## Ranked shortlist

1. **jhu-clsp/mmBERT-base** (and, as a drop-in A/B, **patronus-studio/wolf-defender-prompt-injection**, same arch, so identical hyperparams).
   Modern multilingual encoder, explicitly includes pt/fr/it, 8k context handles long prompts, fast (~15 min/run) so allows
   seeds/folds. Wolf-defender gives PI/jailbreak-prior initialisation; train both and keep the better on validation.
   Hyperparams: lr 3e-5 (try 2e-5 if unstable), batch 32, max_len 512 (head+tail truncation; 1024 if long-tail matters), epochs 3-4,
   bf16, warmup 6-10%, wd 0.01, linear/cosine, eval each epoch on macro-F1, weighted CE or sqrt-inverse-frequency weights.
   Needs recent transformers (>=4.48) - check modal_app image pin.
2. **FacebookAI/xlm-roberta-large**. Most proven multilingual encoder for classification; 560M fits easily on L4.
   Hyperparams: lr 1e-5 (max 1.5e-5), batch 16 x accum 2 = 32, max_len 256-512, epochs 3, bf16 (not fp16), warmup 10%, wd 0.01,
   grad clip 1.0; abort and rerun with a different seed if loss stuck at ~class-prior after epoch 1. ~35 min on L4.
3. **ibm-granite/granite-3.3-2b-instruct** with LoRA sequence classification (diversity for the ensemble, covers pt/fr/it, Apache-2.0).
   Hyperparams: LoRA r16/alpha32/dropout 0.05 all linear, lr 1.5e-4, per-device batch 8 x accum 4, max_len 384, epochs 2, bf16, grad ckpt,
   cosine, warmup 5%. If there is an A100 budget and time, Mistral-7B-Instruct-v0.3 QLoRA is the stretch alternative (not recommended on L4).

Honorable mentions: xlm-roberta-base (cheap fallback / extra ensemble member), mmBERT-small (very fast sanity check).
Skip: protectai deberta (English-only, no jailbreak), distilmBERT, rembert (cost/benefit poor, fp16 issues).

Suggested plan: run mmBERT-base + wolf-defender with a stratified 5-fold or one holdout (about 15 min each), run XLM-R-large once,
then Granite LoRA; ensemble softmax averages; tune class-prior multipliers on OOF to maximise macro-F1; spend submissions on
(1) best single, (2) ensemble, (3) ensemble + threshold tuning, remaining as hedges.
