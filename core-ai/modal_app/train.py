"""K-fold fine-tuning on Modal GPUs (encoders full-FT, decoder LLMs via LoRA).

Each fold runs in its own container, all requested folds IN PARALLEL:
  uv run modal run -m modal_app.train --model-name jhu-clsp/mmBERT-base \
      --run-name mmbert_base_v1 --folds 0,1,2,3,4 --lr 5e-5 --epochs 3 --batch-size 16 --max-len 512
  # LoRA decoder:
  uv run modal run -m modal_app.train --model-name ibm-granite/granite-3.3-2b-instruct \
      --run-name granite_lora --lora --lr 1e-4 --batch-size 8 --grad-accum 2 --grad-ckpt
  # Different GPU for this launch only:
  uv run modal run -m modal_app.train ... --gpu A100
Detached (keep running after closing the terminal; the local summary table is then
NOT printed - results still land in the volume; check Modal dashboard, then
`./scripts/pull_outputs.sh <run>` and `uv run python -m rmit_hack.ensemble outputs/<run> --name x`):
  uv run modal run --detach -m modal_app.train ...

Per fold, in /vol/outputs/<run_name>/fold<k>/:
  oof.npy [n_val,3] softmax probs, oof.csv (id + probs), test_probs.npy [6000,3],
  metrics.json. Label order: BENIGN, JAILBREAK, PROMPT_INJECTION. Last epoch is used.
"""

from modal_app.common import VOLUMES, app, image, volume
from rmit_hack import config

GPU = "L4"  # default; override per launch with --gpu

DEFAULTS = {
    "model_name": "xlm-roberta-base",
    "max_len": 512,
    "head_tokens": None,  # default: max_len - 128 head tokens, rest tail
    "lr": None,  # default 2e-5 (full FT) / 1e-4 (LoRA)
    "epochs": 3,
    "batch_size": 16,
    "grad_accum": 1,
    "warmup_ratio": 0.1,
    "weight_decay": 0.01,
    "class_weights": "sqrt",  # none | sqrt | balanced
    "label_smoothing": 0.0,
    "llrd": None,
    "seed": 42,
    "gradient_checkpointing": False,
    "group_by_length": True,
    "lora": False,
    "load_4bit": False,
    "lora_r": 16,
    "lora_alpha": 32,
    "lora_dropout": 0.05,
    "save_model": False,
    "max_train_samples": None,
}


@app.function(image=image, gpu=GPU, volumes=VOLUMES, timeout=60 * 60 * 4)
def train_fold(cfg: dict, fold: int):
    import json
    import re
    import time

    import numpy as np
    import pandas as pd
    import torch
    from sklearn.metrics import f1_score
    from transformers import (
        AutoModelForSequenceClassification,
        AutoTokenizer,
        DataCollatorWithPadding,
        Trainer,
        TrainerCallback,
        TrainingArguments,
        set_seed,
    )

    cfg = {**DEFAULTS, **cfg}
    if cfg["lr"] is None:
        cfg["lr"] = 1e-4 if cfg["lora"] else 2e-5
    run_name = cfg["run_name"]
    labels = config.LABELS
    label2id = {lab: i for i, lab in enumerate(labels)}
    out_dir = config.MODAL_OUTPUT_DIR / run_name / f"fold{fold}"
    out_dir.mkdir(parents=True, exist_ok=True)
    set_seed(cfg["seed"])
    print(f"[fold {fold}] cfg={cfg}")

    # ---- data
    data_dir = config.MODAL_DATA_DIR
    train_df = pd.read_csv(data_dir / config.TRAIN_FILE)
    test_df = pd.read_csv(data_dir / config.TEST_FILE)
    folds_df = pd.read_csv(data_dir / config.FOLDS_FILE)
    train_df = train_df.merge(folds_df, on="id", how="left")
    assert train_df["fold"].notna().all()
    train_df["text"] = train_df["text"].fillna("").astype(str)
    test_df["text"] = test_df["text"].fillna("").astype(str)
    y_all = train_df["label"].map(label2id).to_numpy()
    tr_idx = np.where(train_df["fold"].to_numpy() != fold)[0]
    va_idx = np.where(train_df["fold"].to_numpy() == fold)[0]
    if cfg["max_train_samples"]:
        rng = np.random.RandomState(0)
        tr_idx = rng.permutation(tr_idx)[: int(cfg["max_train_samples"])]

    # ---- tokenizer + head/tail truncation at token level
    tok = AutoTokenizer.from_pretrained(cfg["model_name"])
    if tok.pad_token is None:
        tok.pad_token = tok.eos_token
    # special-token template (prefix/suffix), derived empirically (works across tokenizer backends)
    probe = tok("hello world", add_special_tokens=True)["input_ids"]
    plain = tok("hello world", add_special_tokens=False)["input_ids"]
    pos = next(
        i
        for i in range(len(probe) - len(plain) + 1)
        if probe[i : i + len(plain)] == plain
    )
    prefix, suffix = probe[:pos], probe[pos + len(plain) :]
    print(f"special tokens: prefix={prefix} suffix={suffix}")
    keep = cfg["max_len"] - len(prefix) - len(suffix)
    head_n = cfg["head_tokens"]
    head_n = min(keep, head_n if head_n else max(keep - 128, keep // 2))

    def encode(texts):
        all_ids = tok(texts, add_special_tokens=False, truncation=False)["input_ids"]
        out = []
        for ids in all_ids:
            if len(ids) > keep:
                ids = ids[:head_n] + ids[len(ids) - (keep - head_n) :]
            out.append(prefix + ids + suffix)
        return out

    class DS(torch.utils.data.Dataset):
        def __init__(self, texts, ys=None, sort=False):
            self.ids = encode(texts)
            self.ys = ys
            n = len(self.ids)
            # `order` sorts by length (fast inference); inverse restores original order
            self.order = (
                np.argsort([len(x) for x in self.ids], kind="stable")
                if sort
                else np.arange(n)
            )
            self.inv = np.argsort(self.order)

        def __len__(self):
            return len(self.ids)

        def __getitem__(self, i):
            j = int(self.order[i])
            item = {"input_ids": self.ids[j], "attention_mask": [1] * len(self.ids[j])}
            if self.ys is not None:
                item["labels"] = int(self.ys[j])
            return item

    t0 = time.time()
    ds_tr = DS(train_df["text"].iloc[tr_idx].tolist(), y_all[tr_idx])
    ds_va = DS(train_df["text"].iloc[va_idx].tolist(), y_all[va_idx], sort=True)
    ds_te = DS(test_df["text"].tolist(), sort=True)
    print(
        f"[fold {fold}] tokenized in {time.time() - t0:.0f}s; train={len(ds_tr)} val={len(ds_va)}"
    )

    # ---- model
    bf16 = torch.cuda.is_bf16_supported()
    kw = {
        "num_labels": len(labels),
        "id2label": dict(enumerate(labels)),
        "label2id": label2id,
        "ignore_mismatched_sizes": True,
    }
    if cfg["lora"]:
        kw["dtype"] = torch.bfloat16
        if cfg["load_4bit"]:
            from transformers import BitsAndBytesConfig

            kw["quantization_config"] = BitsAndBytesConfig(
                load_in_4bit=True,
                bnb_4bit_quant_type="nf4",
                bnb_4bit_compute_dtype=torch.bfloat16,
                bnb_4bit_use_double_quant=True,
            )
            kw["device_map"] = {"": 0}
    try:
        model = AutoModelForSequenceClassification.from_pretrained(
            cfg["model_name"], **kw
        )
    except TypeError:  # older transformers: torch_dtype
        if "dtype" in kw:
            kw["torch_dtype"] = kw.pop("dtype")
        model = AutoModelForSequenceClassification.from_pretrained(
            cfg["model_name"], **kw
        )
    model.config.pad_token_id = tok.pad_token_id

    if cfg["lora"]:
        from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training

        if cfg["load_4bit"]:
            model = prepare_model_for_kbit_training(
                model, use_gradient_checkpointing=cfg["gradient_checkpointing"]
            )
        elif cfg["gradient_checkpointing"]:
            model.enable_input_require_grads()
        lcfg = LoraConfig(
            task_type="SEQ_CLS",
            r=cfg["lora_r"],
            lora_alpha=cfg["lora_alpha"],
            lora_dropout=cfg["lora_dropout"],
            target_modules="all-linear",
            modules_to_save=["score"],
        )
        model = get_peft_model(model, lcfg)
        for p in model.parameters():  # fp32 master weights for trainable params
            if p.requires_grad:
                p.data = p.data.float()
        model.print_trainable_parameters()
        assert any(
            "score" in n and p.requires_grad for n, p in model.named_parameters()
        ), "classification head not trainable"

    # ---- loss weights
    counts = np.bincount(y_all[tr_idx], minlength=len(labels)).astype(float)
    cw_mode = cfg["class_weights"]
    if cw_mode == "sqrt":
        cw = (counts.max() / counts) ** 0.5
    elif cw_mode == "balanced":
        cw = counts.sum() / (len(labels) * counts)
    else:
        cw = np.ones(len(labels))
    cw_t = torch.tensor(cw, dtype=torch.float)
    print(f"[fold {fold}] class counts={counts} weights={cw}")

    class WTrainer(Trainer):
        def compute_loss(self, model, inputs, return_outputs=False, **kw):
            labels_ = inputs.pop("labels")
            out = model(**inputs)
            loss = torch.nn.functional.cross_entropy(
                out.logits.float(),
                labels_,
                weight=cw_t.to(out.logits.device),
                label_smoothing=cfg["label_smoothing"],
            )
            return (loss, out) if return_outputs else loss

        def create_optimizer(self):
            if self.optimizer is not None:
                return self.optimizer
            if not cfg["llrd"] or cfg["lora"]:
                return super().create_optimizer()
            groups = llrd_groups(
                self.model, cfg["lr"], cfg["llrd"], cfg["weight_decay"]
            )
            if groups is None:
                print("[llrd] layer pattern not found -> falling back to plain AdamW")
                return super().create_optimizer()
            self.optimizer = torch.optim.AdamW(
                groups, lr=cfg["lr"], betas=(0.9, 0.98), eps=1e-6
            )
            return self.optimizer

    def llrd_groups(model, lr, decay, wd):
        layer_re = re.compile(r"(?:layers?|blocks|h)\.(\d+)\.")
        idxs = {}
        for n, _ in model.named_parameters():
            m = layer_re.search(n)
            if m:
                idxs[n] = int(m.group(1))
        if not idxs:
            return None
        nl = max(idxs.values()) + 1
        buckets = {}
        for n, p in model.named_parameters():
            if not p.requires_grad:
                continue
            if n in idxs:
                depth = nl - idxs[n]  # layer nl-1 -> decay^1
            elif "embed" in n.lower():
                depth = nl + 1
            else:
                depth = 0  # head / final norm / pooler: full lr
            no_wd = p.ndim == 1 or "bias" in n or "norm" in n.lower()
            buckets.setdefault((depth, no_wd), []).append(p)
        return [
            {
                "params": ps,
                "lr": lr * decay**depth,
                "weight_decay": 0.0 if no_wd else wd,
            }
            for (depth, no_wd), ps in buckets.items()
        ]

    def macro_f1(p):
        return {
            "macro_f1": f1_score(p.label_ids, p.predictions.argmax(-1), average="macro")
        }

    class EpochTimer(TrainerCallback):
        def __init__(self):
            self.t = time.time()
            self.times = []

        def on_epoch_end(self, args, state, control, **kw):
            now = time.time()
            self.times.append(now - self.t)
            self.t = now

    timer = EpochTimer()
    # transformers v5 folded warmup_ratio into warmup_steps (float < 1 == ratio)
    import dataclasses

    fields = {f.name for f in dataclasses.fields(TrainingArguments)}
    warmup_kw = (
        {"warmup_ratio": cfg["warmup_ratio"]}
        if "warmup_ratio" in fields
        else {"warmup_steps": cfg["warmup_ratio"]}
    )
    args = TrainingArguments(
        output_dir=f"/tmp/ckpt_{run_name}_{fold}",
        num_train_epochs=cfg["epochs"],
        learning_rate=cfg["lr"],
        per_device_train_batch_size=cfg["batch_size"],
        per_device_eval_batch_size=cfg["batch_size"] * 2,
        gradient_accumulation_steps=cfg["grad_accum"],
        **warmup_kw,
        weight_decay=cfg["weight_decay"],
        eval_strategy="epoch",
        save_strategy="no",
        bf16=bf16,
        fp16=not bf16,
        max_grad_norm=1.0,
        logging_steps=50,
        report_to=[],
        seed=cfg["seed"],
        group_by_length=cfg["group_by_length"],
        gradient_checkpointing=cfg["gradient_checkpointing"],
        gradient_checkpointing_kwargs={"use_reentrant": False}
        if cfg["gradient_checkpointing"]
        else None,
        remove_unused_columns=False,
        dataloader_num_workers=2,
    )
    trainer = WTrainer(
        model=model,
        args=args,
        train_dataset=ds_tr,
        eval_dataset=ds_va,
        data_collator=DataCollatorWithPadding(tok),
        compute_metrics=macro_f1,
        callbacks=[timer],
    )
    t0 = time.time()
    trainer.train()
    train_secs = time.time() - t0

    # ---- final predictions from the LAST epoch
    def softmax_np(x):
        x = x - x.max(-1, keepdims=True)
        e = np.exp(x)
        return e / e.sum(-1, keepdims=True)

    va_probs = softmax_np(trainer.predict(ds_va).predictions.astype(np.float64))[
        ds_va.inv
    ]
    te_probs = softmax_np(trainer.predict(ds_te).predictions.astype(np.float64))[
        ds_te.inv
    ]
    assert te_probs.shape == (len(test_df), 3)

    yv = y_all[va_idx]
    pred = va_probs.argmax(-1)
    lang = train_df["language"].iloc[va_idx].to_numpy()
    metrics = {
        "fold": fold,
        "macro_f1": float(f1_score(yv, pred, average="macro")),
        "per_class_f1": dict(
            zip(labels, map(float, f1_score(yv, pred, average=None, labels=[0, 1, 2])))
        ),
        "per_language_macro_f1": {
            str(lg): float(f1_score(yv[lang == lg], pred[lang == lg], average="macro"))
            for lg in np.unique(lang)
        },
        "epoch_eval": [
            {k: v for k, v in h.items() if k in ("epoch", "eval_macro_f1", "eval_loss")}
            for h in trainer.state.log_history
            if "eval_macro_f1" in h
        ],
        "train_seconds": train_secs,
        "epoch_seconds": timer.times,
        "n_train": len(ds_tr),
        "n_val": len(ds_va),
        "cfg": cfg,
    }
    np.save(out_dir / "oof.npy", va_probs)
    np.save(out_dir / "test_probs.npy", te_probs)
    oof_df = pd.DataFrame(va_probs, columns=[f"p_{lab}" for lab in labels])
    oof_df.insert(0, "id", train_df["id"].iloc[va_idx].to_numpy())
    oof_df.to_csv(out_dir / "oof.csv", index=False)
    (out_dir / "metrics.json").write_text(json.dumps(metrics, indent=2))
    if cfg["save_model"]:
        trainer.save_model(str(out_dir / "model"))
        tok.save_pretrained(str(out_dir / "model"))
    volume.commit()
    print(f"[fold {fold}] macro-F1={metrics['macro_f1']:.4f} -> {out_dir}")
    return metrics


@app.local_entrypoint()
def main(
    model_name: str = "xlm-roberta-base",
    run_name: str = "",
    folds: str = "0,1,2,3,4",
    gpu: str = "",
    lr: float = 0.0,
    epochs: int = 3,
    batch_size: int = 16,
    grad_accum: int = 1,
    max_len: int = 512,
    head_tokens: int = 0,
    warmup_ratio: float = 0.1,
    weight_decay: float = 0.01,
    class_weights: str = "sqrt",
    label_smoothing: float = 0.0,
    llrd: float = 0.0,
    seed: int = 42,
    grad_ckpt: bool = False,
    lora: bool = False,
    load_4bit: bool = False,
    save_model: bool = False,
    max_train_samples: int = 0,
):
    from datetime import datetime

    run_name = run_name or f"{model_name.split('/')[-1]}_{datetime.now():%m%d_%H%M}"
    cfg = {
        "run_name": run_name,
        "model_name": model_name,
        "max_len": max_len,
        "head_tokens": head_tokens or None,
        "lr": lr or None,
        "epochs": epochs,
        "batch_size": batch_size,
        "grad_accum": grad_accum,
        "warmup_ratio": warmup_ratio,
        "weight_decay": weight_decay,
        "class_weights": class_weights,
        "label_smoothing": label_smoothing,
        "llrd": llrd or None,
        "seed": seed,
        "gradient_checkpointing": grad_ckpt,
        "lora": lora,
        "load_4bit": load_4bit,
        "save_model": save_model,
        "max_train_samples": max_train_samples or None,
    }
    fold_list = [int(f) for f in folds.split(",")]
    fn = train_fold.with_options(gpu=gpu) if gpu and gpu != GPU else train_fold
    print(f"run={run_name} folds={fold_list} gpu={gpu or GPU}\ncfg={cfg}")
    results = list(fn.starmap([(cfg, f) for f in fold_list], return_exceptions=True))

    print(f"\n=== {run_name} ===")
    print(
        f"{'fold':>4} {'macroF1':>8} {'BENIGN':>7} {'JB':>7} {'PI':>7}  per-language / sec per epoch"
    )
    ok = []
    for f, r in zip(fold_list, results):
        if isinstance(r, BaseException):
            print(f"{f:>4} FAILED: {r!r}")
            continue
        ok.append(r)
        pc = r["per_class_f1"]
        langs = " ".join(f"{k}={v:.3f}" for k, v in r["per_language_macro_f1"].items())
        ep = ",".join(f"{s:.0f}" for s in r["epoch_seconds"])
        print(
            f"{f:>4} {r['macro_f1']:>8.4f} {pc['BENIGN']:>7.3f} {pc['JAILBREAK']:>7.3f} "
            f"{pc['PROMPT_INJECTION']:>7.3f}  {langs} | {ep}s"
        )
    if ok:
        m = [r["macro_f1"] for r in ok]
        print(f"mean macro-F1 over {len(m)} folds: {sum(m) / len(m):.4f}")
    print(f"Pull: ./scripts/pull_outputs.sh {run_name}")
