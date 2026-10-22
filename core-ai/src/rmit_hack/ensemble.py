"""Assemble OOF from fold outputs, tune per-class log-prob biases, write a submission.

  uv run python -m rmit_hack.ensemble outputs/runA [outputs/runB ...] --name xyz [--weights 1,0.5]
Folds that are missing are skipped: OOF metrics use only the available rows.
"""

import argparse
import itertools
from pathlib import Path

import numpy as np
import pandas as pd

from rmit_hack import config

LABELS = config.LABELS
K = len(LABELS)


def macro_f1(y, pred, k=K):
    cm = np.bincount(y * k + pred, minlength=k * k).reshape(k, k)
    tp = np.diag(cm).astype(float)
    denom = cm.sum(0) + cm.sum(1)
    return float(np.mean(np.where(denom > 0, 2 * tp / np.maximum(denom, 1), 0.0)))


def tune_bias(logp, y, lo=-3.0, hi=3.0, step=0.1):
    grid = np.round(np.arange(lo, hi + 1e-9, step), 3)
    best, best_b = -1.0, np.zeros(K)
    for b1, b2 in itertools.product(grid, grid):
        b = np.array([0.0, b1, b2])
        f = macro_f1(y, (logp + b).argmax(-1))
        # tie-break towards smaller bias magnitude
        if f > best + 1e-12 or (
            abs(f - best) <= 1e-12 and np.abs(b).sum() < np.abs(best_b).sum()
        ):
            best, best_b = f, b
    return best, best_b


def load_run(run_dir: Path, ids: np.ndarray, test_ids: np.ndarray):
    """Return oof [N,3] (nan where missing), test mean [T,3], available folds."""
    id2pos = {i: p for p, i in enumerate(ids)}
    oof = np.full((len(ids), K), np.nan)
    tests, folds = [], []
    for fd in sorted(run_dir.glob("fold*")):
        if not ((fd / "oof.csv").exists() and (fd / "test_probs.npy").exists()):
            continue
        df = pd.read_csv(fd / "oof.csv")
        pos = df["id"].map(id2pos).to_numpy()
        oof[pos] = df[[f"p_{lab}" for lab in LABELS]].to_numpy()
        tp = np.load(fd / "test_probs.npy")
        assert tp.shape == (len(test_ids), K), f"{fd}: bad test_probs shape {tp.shape}"
        if (fd / "test_ids.npy").exists():
            saved = np.load(fd / "test_ids.npy", allow_pickle=True)
            assert (saved == test_ids).all(), f"{fd}: test_ids order != test.csv"
        else:
            print(f"WARNING {fd}: no test_ids.npy; assuming test.csv order")
        assert df["id"].is_unique and not np.isnan(oof[pos]).any()
        tests.append(tp)
        folds.append(int(fd.name.removeprefix("fold")))
    if not tests:
        raise SystemExit(f"no complete folds in {run_dir}")
    return oof, np.mean(tests, 0), folds


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("runs", nargs="+", type=Path)
    ap.add_argument("--name", required=True)
    ap.add_argument("--weights", default="", help="comma-separated per-run weights")
    ap.add_argument("--no-bias", action="store_true", help="skip applying tuned biases")
    a = ap.parse_args()

    train = pd.read_csv(config.RAW_DIR / config.TRAIN_FILE)
    test = pd.read_csv(config.RAW_DIR / config.TEST_FILE)
    sample = pd.read_csv(config.RAW_DIR / config.SAMPLE_SUB_FILE)
    folds_df = pd.read_csv(config.PROCESSED_DIR / config.FOLDS_FILE)
    fold_of = train[["id"]].merge(folds_df, on="id", how="left")["fold"].to_numpy()
    y = train["label"].map({lab: i for i, lab in enumerate(LABELS)}).to_numpy()
    ids = train["id"].to_numpy()

    w = (
        np.array([float(x) for x in a.weights.split(",")])
        if a.weights
        else np.ones(len(a.runs))
    )
    assert len(w) == len(a.runs)
    w = w / w.sum()

    oofs, tests = [], []
    for r in a.runs:
        o, t, fl = load_run(r, ids, test["id"].to_numpy())
        have = ~np.isnan(o[:, 0])
        print(
            f"{r}: folds {fl}  OOF macro-F1 (n={have.sum()}) = {macro_f1(y[have], o[have].argmax(-1)):.4f}"
        )
        oofs.append(o)
        tests.append(t)

    # combine over runs on rows available in all runs (weighted mean of probs)
    have = np.all([~np.isnan(o[:, 0]) for o in oofs], axis=0)
    oof = sum(wi * o for wi, o in zip(w, oofs))
    test_p = sum(wi * t for wi, t in zip(w, tests))
    yh, ph = y[have], np.log(np.clip(oof[have], 1e-9, 1))
    fh = fold_of[have]
    print(f"\nEnsemble rows with OOF: {have.sum()}/{len(y)}")
    raw = macro_f1(yh, ph.argmax(-1))
    print(f"raw OOF macro-F1: {raw:.4f}")

    tuned, bias = tune_bias(ph, yh)
    print(
        f"tuned OOF macro-F1: {tuned:.4f}  biases (B,J,PI) = {bias.round(2).tolist()}"
    )

    avail = sorted(set(fh.tolist()))
    if len(avail) >= 2:
        pred = np.zeros(len(yh), dtype=int)
        for f in avail:
            m = fh == f
            _, b = tune_bias(ph[~m], yh[~m])
            pred[m] = (ph[m] + b).argmax(-1)
        print(
            f"nested bias estimate (tune on other folds, apply to held-out): {macro_f1(yh, pred):.4f}"
        )
    else:
        print("nested estimate skipped (need >=2 folds)")

    # per-class / per-language report on tuned OOF
    pt = (ph + bias).argmax(-1)
    for c, lab in enumerate(LABELS):
        yt, pp = yh == c, pt == c
        tp = (yt & pp).sum()
        print(f"  F1 {lab}: {2 * tp / max(yt.sum() + pp.sum(), 1):.4f}")
    lang = train["language"].to_numpy()[have]
    print(
        "  per-language macro-F1 (tuned): "
        + " ".join(
            f"{lg}={macro_f1(yh[lang == lg], pt[lang == lg]):.4f}"
            for lg in sorted(set(lang))
        )
    )

    b_apply = np.zeros(K) if a.no_bias else bias
    logit_te = np.log(np.clip(test_p, 1e-9, 1)) + b_apply
    labels_te = [LABELS[i] for i in logit_te.argmax(-1)]
    sub = sample.copy()
    # test order == test.csv order; sample_submission may be ordered differently -> map by id
    mapping = dict(zip(test["id"], labels_te))
    sub[sub.columns[-1]] = sub[sub.columns[0]].map(mapping)
    assert sub[sub.columns[-1]].notna().all()
    config.SUBMISSIONS_DIR.mkdir(exist_ok=True)
    out = config.SUBMISSIONS_DIR / f"{a.name}.csv"
    sub.to_csv(out, index=False)
    print(
        f"\ntest pred dist: {sub[sub.columns[-1]].value_counts(normalize=True).round(3).to_dict()}"
    )
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
