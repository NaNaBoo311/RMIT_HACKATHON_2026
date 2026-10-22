"""Inference service for Challenge 2 (backend calls this).

  cd core-ai && uv run uvicorn rmit_hack.serve:app --port 8001

Model: env CORE_AI_MODEL_DIR (HF sequence-classification dir; needs `uv sync --group hf`)
else TF-IDF baseline at models/baseline.joblib (`uv run python -m rmit_hack.export_baseline`).
"""

import os
from pathlib import Path

import numpy as np
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from rmit_hack import config

LABELS = config.LABELS
BASELINE_PATH = config.ROOT / "models" / "baseline.joblib"


class Predictor:
    def __init__(self):
        model_dir = os.environ.get("CORE_AI_MODEL_DIR")
        self.hf = None
        self.sk = None
        if model_dir and Path(model_dir).exists():
            self._load_hf(model_dir)
            self.name = f"hf:{Path(model_dir).name}"
        else:
            import joblib

            if not BASELINE_PATH.exists():
                raise RuntimeError(
                    f"{BASELINE_PATH} missing: run `uv run python -m rmit_hack.export_baseline`"
                )
            self.sk = joblib.load(BASELINE_PATH)
            self.name = "tfidf-baseline"

    def _load_hf(self, model_dir: str):
        import torch
        from transformers import AutoModelForSequenceClassification, AutoTokenizer

        self.torch = torch
        self.device = "mps" if torch.backends.mps.is_available() else "cpu"
        self.tok = AutoTokenizer.from_pretrained(model_dir)
        self.hf = AutoModelForSequenceClassification.from_pretrained(model_dir).to(
            self.device
        ).eval()
        id2label = {int(k): v for k, v in self.hf.config.id2label.items()}
        if set(id2label.values()) >= set(LABELS):
            self.order = [LABELS.index(id2label[i]) for i in range(len(id2label))]
        else:  # generic LABEL_0.. names: assume config.LABELS order
            self.order = list(range(len(LABELS)))

    def probs(self, texts: list[str]) -> np.ndarray:
        """Return [N,3] probs in config.LABELS order."""
        if self.sk is not None:
            p = self.sk.predict_proba(texts)
            cls = list(self.sk.classes_)
            return p[:, [cls.index(lab) for lab in LABELS]]
        out = []
        with self.torch.no_grad():
            for i in range(0, len(texts), 16):
                enc = self.tok(
                    texts[i : i + 16],
                    truncation=True,
                    max_length=512,
                    padding=True,
                    return_tensors="pt",
                ).to(self.device)
                pr = self.hf(**enc).logits.softmax(-1).cpu().numpy()
                aligned = np.zeros((len(pr), len(LABELS)))
                for src, dst in enumerate(self.order):
                    aligned[:, dst] = pr[:, src]
                out.append(aligned)
        return np.concatenate(out)


class ClassifyIn(BaseModel):
    text: str


class BatchIn(BaseModel):
    texts: list[str]


app = FastAPI(title="core-ai prompt-attack classifier")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:8000"],
    allow_methods=["*"],
    allow_headers=["*"],
)
_pred: Predictor | None = None


def predictor() -> Predictor:
    global _pred
    if _pred is None:
        _pred = Predictor()
    return _pred


def _format(p: np.ndarray, model: str) -> list[dict]:
    return [
        {
            "label": LABELS[int(row.argmax())],
            "probs": {lab: float(v) for lab, v in zip(LABELS, row)},
            "model": model,
        }
        for row in p
    ]


@app.get("/health")
def health():
    return {"status": "ok", "model": predictor().name}


@app.post("/classify")
def classify(body: ClassifyIn):
    pr = predictor()
    return _format(pr.probs([body.text]), pr.name)[0]


@app.post("/classify/batch")
def classify_batch(body: BatchIn):
    pr = predictor()
    if not body.texts:
        return {"results": []}
    return {"results": _format(pr.probs(body.texts), pr.name)}
