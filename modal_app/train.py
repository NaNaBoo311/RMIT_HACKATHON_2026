"""Fine-tune a multilingual transformer on Modal GPU, then predict test.

Run:
  uv run modal run -m modal_app.train                                  # defaults
  uv run modal run -m modal_app.train --model-name microsoft/mdeberta-v3-base --epochs 4
Detached (keeps running if you close the terminal):
  uv run modal run --detach -m modal_app.train
Outputs land in the volume at /vol/outputs/<run_name>/ (pull with scripts/pull_outputs.sh).
"""

from modal_app.common import VOLUMES, app, image, volume
from rmit_hack import config

GPU = "L4"  # change to "T4" (cheaper), "A10G", "A100", "H100"


@app.function(image=image, gpu=GPU, volumes=VOLUMES, timeout=60 * 60 * 4)
def train(
    model_name: str = "xlm-roberta-base",
    epochs: int = 3,
    lr: float = 2e-5,
    batch_size: int = 32,
    max_len: int = 256,
    val_frac: float = 0.1,
    run_name: str = "",
):
    import json
    from datetime import datetime

    import numpy as np
    import torch
    from sklearn.metrics import accuracy_score, f1_score
    from sklearn.model_selection import train_test_split
    from transformers import (
        AutoModelForSequenceClassification,
        AutoTokenizer,
        DataCollatorWithPadding,
        Trainer,
        TrainingArguments,
    )

    from rmit_hack.data import infer_columns, load, make_submission

    run_name = run_name or f"{model_name.split('/')[-1]}_{datetime.now():%Y%m%d_%H%M}"
    out_dir = config.MODAL_OUTPUT_DIR / run_name
    out_dir.mkdir(parents=True, exist_ok=True)

    train_df, test_df, sample = load(config.MODAL_DATA_DIR)
    id_col, text_col, label_col = infer_columns(train_df)
    print(
        f"id={id_col} text={text_col} label={label_col} | train={len(train_df)} test={len(test_df)}"
    )

    labels = sorted(train_df[label_col].unique().tolist())
    label2id = {lab: i for i, lab in enumerate(labels)}
    y = train_df[label_col].map(label2id).to_numpy()
    texts = train_df[text_col].fillna("").astype(str).tolist()

    tr_idx, va_idx = train_test_split(
        np.arange(len(texts)), test_size=val_frac, stratify=y, random_state=config.SEED
    )

    tok = AutoTokenizer.from_pretrained(model_name)

    class DS(torch.utils.data.Dataset):
        def __init__(self, txts, ys=None):
            self.enc = tok(txts, truncation=True, max_length=max_len)
            self.ys = ys

        def __len__(self):
            return len(self.enc["input_ids"])

        def __getitem__(self, i):
            item = {k: v[i] for k, v in self.enc.items()}
            if self.ys is not None:
                item["labels"] = int(self.ys[i])
            return item

    ds_tr = DS([texts[i] for i in tr_idx], y[tr_idx])
    ds_va = DS([texts[i] for i in va_idx], y[va_idx])
    ds_te = DS(test_df[text_col].fillna("").astype(str).tolist())

    model = AutoModelForSequenceClassification.from_pretrained(
        model_name,
        num_labels=len(labels),
        id2label={i: str(lab) for lab, i in label2id.items()},
        label2id={str(lab): i for lab, i in label2id.items()},
    )

    def metrics(p):
        pred = p.predictions.argmax(-1)
        return {
            "acc": accuracy_score(p.label_ids, pred),
            "macro_f1": f1_score(p.label_ids, pred, average="macro"),
        }

    args = TrainingArguments(
        output_dir=str(out_dir / "ckpt"),
        num_train_epochs=epochs,
        learning_rate=lr,
        per_device_train_batch_size=batch_size,
        per_device_eval_batch_size=batch_size * 2,
        warmup_ratio=0.06,
        weight_decay=0.01,
        eval_strategy="epoch",
        save_strategy="epoch",
        save_total_limit=1,
        load_best_model_at_end=True,
        metric_for_best_model="macro_f1",
        bf16=torch.cuda.is_bf16_supported(),
        fp16=not torch.cuda.is_bf16_supported(),
        logging_steps=50,
        report_to=[],
        seed=config.SEED,
    )
    trainer = Trainer(
        model=model,
        args=args,
        train_dataset=ds_tr,
        eval_dataset=ds_va,
        data_collator=DataCollatorWithPadding(tok),
        compute_metrics=metrics,
    )
    trainer.train()
    val = trainer.evaluate()
    print("val:", val)

    logits = trainer.predict(ds_te).predictions
    np.save(out_dir / "test_logits.npy", logits)
    preds = [labels[i] for i in logits.argmax(-1)]
    make_submission(preds, test_df, sample, id_col, label_col).to_csv(
        out_dir / "submission.csv", index=False
    )

    trainer.save_model(str(out_dir / "model"))
    tok.save_pretrained(str(out_dir / "model"))
    (out_dir / "meta.json").write_text(
        json.dumps(
            {"model_name": model_name, "labels": [str(x) for x in labels], "val": val},
            indent=2,
        )
    )
    volume.commit()
    print(f"done -> {out_dir}")
    return run_name


@app.local_entrypoint()
def main(
    model_name: str = "xlm-roberta-base",
    epochs: int = 3,
    lr: float = 2e-5,
    batch_size: int = 32,
    max_len: int = 256,
    run_name: str = "",
):
    name = train.remote(
        model_name=model_name,
        epochs=epochs,
        lr=lr,
        batch_size=batch_size,
        max_len=max_len,
        run_name=run_name,
    )
    print(f"Run finished: {name}\nPull it: ./scripts/pull_outputs.sh {name}")
