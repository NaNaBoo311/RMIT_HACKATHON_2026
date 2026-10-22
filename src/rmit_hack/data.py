"""Loading data and building submissions. Works locally and inside Modal."""

from pathlib import Path

import pandas as pd

from rmit_hack import config

_TEXT_CANDIDATES = [
    "text",
    "prompt",
    "content",
    "input",
    "sentence",
    "query",
    "message",
]
_LABEL_CANDIDATES = ["label", "target", "class", "is_attack", "attack", "category", "y"]
_ID_CANDIDATES = ["id", "ID", "Id", "row_id", "sample_id"]


def _pick(cols: list[str], override: str | None, candidates: list[str]) -> str | None:
    if override:
        return override
    lower = {c.lower(): c for c in cols}
    for cand in candidates:
        if cand.lower() in lower:
            return lower[cand.lower()]
    return None


def infer_columns(train: pd.DataFrame) -> tuple[str | None, str, str]:
    """Return (id_col, text_col, label_col), using config overrides when set."""
    cols = list(train.columns)
    id_col = _pick(cols, config.ID_COL, _ID_CANDIDATES)
    text_col = _pick(cols, config.TEXT_COL, _TEXT_CANDIDATES)
    label_col = _pick(cols, config.LABEL_COL, _LABEL_CANDIDATES)
    if text_col is None:
        # Fall back to the string column with the longest average length.
        obj = train.select_dtypes("object")
        text_col = obj.apply(lambda s: s.astype(str).str.len().mean()).idxmax()
    if label_col is None:
        raise ValueError(
            f"Cannot detect label column in {cols}; set LABEL_COL in config.py"
        )
    return id_col, text_col, label_col


def load(
    data_dir: Path = config.RAW_DIR,
) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame | None]:
    train = pd.read_csv(data_dir / config.TRAIN_FILE)
    test = pd.read_csv(data_dir / config.TEST_FILE)
    sample_path = data_dir / config.SAMPLE_SUB_FILE
    sample = pd.read_csv(sample_path) if sample_path.exists() else None
    return train, test, sample


def make_submission(
    preds,
    test: pd.DataFrame,
    sample: pd.DataFrame | None,
    id_col: str | None,
    label_col: str,
) -> pd.DataFrame:
    """Fill sample_submission if present (keeps Kaggle's exact format), else build id + label."""
    if sample is not None:
        sub = sample.copy()
        sub[sub.columns[-1]] = preds
        return sub
    ids = test[id_col] if id_col and id_col in test else range(len(test))
    return pd.DataFrame({id_col or "id": ids, label_col: preds})
