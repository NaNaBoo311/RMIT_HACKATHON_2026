"""Fast local baseline: char n-gram TF-IDF + logistic regression (language-agnostic).

Run: uv run python -m rmit_hack.baseline
"""

from datetime import datetime

from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, classification_report, f1_score
from sklearn.model_selection import train_test_split
from sklearn.pipeline import make_pipeline

from rmit_hack import config
from rmit_hack.data import infer_columns, load, make_submission


def build_model():
    return make_pipeline(
        TfidfVectorizer(
            analyzer="char_wb",
            ngram_range=(2, 5),
            min_df=2,
            sublinear_tf=True,
            max_features=300_000,
        ),
        LogisticRegression(max_iter=2000, C=4.0, class_weight="balanced"),
    )


def main():
    train, test, sample = load()
    id_col, text_col, label_col = infer_columns(train)
    print(
        f"id={id_col} text={text_col} label={label_col} | train={len(train)} test={len(test)}"
    )
    print(train[label_col].value_counts())

    X, y = train[text_col].fillna("").astype(str), train[label_col]
    X_tr, X_va, y_tr, y_va = train_test_split(
        X, y, test_size=0.15, stratify=y, random_state=config.SEED
    )

    model = build_model().fit(X_tr, y_tr)
    va_pred = model.predict(X_va)
    print(
        f"val acc={accuracy_score(y_va, va_pred):.4f} macro-F1={f1_score(y_va, va_pred, average='macro'):.4f}"
    )
    print(classification_report(y_va, va_pred))

    model = build_model().fit(X, y)
    preds = model.predict(test[text_col].fillna("").astype(str))
    sub = make_submission(preds, test, sample, id_col, label_col)
    config.SUBMISSIONS_DIR.mkdir(exist_ok=True)
    out = config.SUBMISSIONS_DIR / f"baseline_{datetime.now():%Y%m%d_%H%M}.csv"
    sub.to_csv(out, index=False)
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
