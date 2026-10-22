"""Create data/processed/folds.csv (id, fold). Run: uv run python -m rmit_hack.folds"""

import re

import pandas as pd
from sklearn.model_selection import StratifiedGroupKFold

from rmit_hack import config


def group_key(text: str) -> str:
    return re.sub(r"\s+", " ", str(text).lower()).strip()[:60]


def make_folds(train: pd.DataFrame, n_splits: int = config.N_FOLDS) -> pd.DataFrame:
    groups = train["text"].fillna("").map(group_key)
    sgkf = StratifiedGroupKFold(n_splits=n_splits, shuffle=True, random_state=42)
    fold = pd.Series(-1, index=train.index)
    for k, (_, va) in enumerate(sgkf.split(train, train["label"], groups)):
        fold.iloc[va] = k
    return pd.DataFrame({"id": train["id"], "fold": fold.to_numpy()})


def main():
    train = pd.read_csv(config.RAW_DIR / config.TRAIN_FILE)
    df = make_folds(train)
    config.PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    out = config.PROCESSED_DIR / config.FOLDS_FILE
    df.to_csv(out, index=False)
    m = df.merge(train[["id", "label", "language"]], on="id")
    print(pd.crosstab(m["fold"], m["label"]))
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
