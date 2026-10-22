"""Train char+word TF-IDF + LogisticRegression on full train and dump models/baseline.joblib.

Run: uv run python -m rmit_hack.export_baseline
"""

import joblib
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import FeatureUnion, make_pipeline

from rmit_hack import config
from rmit_hack.data import infer_columns, load

MODELS_DIR = config.ROOT / "models"
BASELINE_PATH = MODELS_DIR / "baseline.joblib"


def build_model():
    feats = FeatureUnion(
        [
            (
                "char",
                TfidfVectorizer(
                    analyzer="char_wb",
                    ngram_range=(2, 5),
                    min_df=2,
                    sublinear_tf=True,
                    max_features=300_000,
                ),
            ),
            (
                "word",
                TfidfVectorizer(
                    analyzer="word",
                    ngram_range=(1, 2),
                    min_df=2,
                    sublinear_tf=True,
                    max_features=200_000,
                ),
            ),
        ]
    )
    return make_pipeline(
        feats, LogisticRegression(max_iter=2000, C=4.0, class_weight="balanced")
    )


def main():
    train, _, _ = load()
    _, text_col, label_col = infer_columns(train)
    X, y = train[text_col].fillna("").astype(str), train[label_col]
    model = build_model().fit(X, y)
    assert list(model.classes_) == sorted(config.LABELS)
    MODELS_DIR.mkdir(exist_ok=True)
    joblib.dump(model, BASELINE_PATH)
    print(f"wrote {BASELINE_PATH} (classes={list(model.classes_)})")


if __name__ == "__main__":
    main()
