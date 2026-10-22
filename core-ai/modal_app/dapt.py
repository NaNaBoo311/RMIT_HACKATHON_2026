"""Domain-adaptive MLM pretraining (no labels) on train+test texts.

  uv run modal run -m modal_app.dapt            # -> /vol/models/mmbert_dapt
Then: uv run modal run -m modal_app.train --model-name /vol/models/mmbert_dapt ...
"""

from modal_app.common import VOLUMES, app, image, volume
from rmit_hack import config


@app.function(image=image, gpu="A100", volumes=VOLUMES, timeout=60 * 60 * 6)
def dapt(
    base: str = "jhu-clsp/mmBERT-base",
    out: str = "/vol/models/mmbert_dapt",
    epochs: float = 2,
    max_len: int = 512,
    lr: float = 5e-5,
    batch_size: int = 16,
    mlm_prob: float = 0.15,
    max_samples: int = 0,
):
    import pandas as pd
    import torch
    from transformers import (
        AutoModelForMaskedLM,
        AutoTokenizer,
        DataCollatorForLanguageModeling,
        Trainer,
        TrainingArguments,
        set_seed,
    )

    set_seed(42)
    d = config.MODAL_DATA_DIR
    texts = []
    for f in (config.TRAIN_FILE, config.TEST_FILE):
        texts += pd.read_csv(d / f)["text"].fillna("").astype(str).tolist()
    if max_samples:
        texts = texts[:max_samples]
    print(f"{len(texts)} texts")
    tok = AutoTokenizer.from_pretrained(base)
    enc = tok(texts, truncation=True, max_length=max_len)["input_ids"]

    class DS(torch.utils.data.Dataset):
        def __len__(self):
            return len(enc)

        def __getitem__(self, i):
            return {"input_ids": enc[i]}

    model = AutoModelForMaskedLM.from_pretrained(base)
    args = TrainingArguments(
        output_dir="/tmp/dapt",
        num_train_epochs=epochs,
        learning_rate=lr,
        per_device_train_batch_size=batch_size,
        warmup_ratio=0.06,
        weight_decay=0.01,
        bf16=True,
        save_strategy="no",
        logging_steps=50,
        report_to=[],
        group_by_length=True,
        remove_unused_columns=False,
        dataloader_num_workers=2,
    )
    coll = DataCollatorForLanguageModeling(tok, mlm=True, mlm_probability=mlm_prob)
    tr = Trainer(model=model, args=args, train_dataset=DS(), data_collator=coll)
    tr.train()
    tr.save_model(out)
    tok.save_pretrained(out)
    volume.commit()
    print("saved", out)


@app.local_entrypoint()
def main(
    base: str = "jhu-clsp/mmBERT-base",
    out: str = "/vol/models/mmbert_dapt",
    epochs: float = 2,
    max_len: int = 512,
    lr: float = 5e-5,
    batch_size: int = 16,
    max_samples: int = 0,
):
    dapt.remote(base, out, epochs, max_len, lr, batch_size, 0.15, max_samples)
