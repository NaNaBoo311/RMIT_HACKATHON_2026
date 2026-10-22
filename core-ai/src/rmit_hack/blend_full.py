"""Average test_probs from full-fit and/or fold runs and write a submission.

  uv run python -m rmit_hack.blend_full --full outputs/mmbert_full --folds outputs/mmbert_base_v1 outputs/mmbert_s2 \
      --name mmbert_full_plus_folds [--bias 0,0,0]
Weights: every full-fit model (outputs/<run>/full_s*/) counts 1; every --folds run counts 1
(its folds are averaged first). Biases are added to log-probs (B,J,PI).
"""

import argparse
from pathlib import Path

import numpy as np
import pandas as pd

from rmit_hack import config

LABELS = config.LABELS


def _load(p: Path, test_ids):
    tp = np.load(p / "test_probs.npy")
    assert tp.shape == (len(test_ids), len(LABELS)), f"{p}: bad shape {tp.shape}"
    saved = np.load(p / "test_ids.npy", allow_pickle=True)
    assert (saved == test_ids).all(), f"{p}: test_ids order != test.csv"
    return tp


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--full", nargs="*", default=[], type=Path, help="full-fit run dirs")
    ap.add_argument("--folds", nargs="*", default=[], type=Path, help="fold run dirs")
    ap.add_argument("--name", required=True)
    ap.add_argument("--bias", default="0,0,0")
    a = ap.parse_args()

    test = pd.read_csv(config.RAW_DIR / config.TEST_FILE)
    sample = pd.read_csv(config.RAW_DIR / config.SAMPLE_SUB_FILE)
    tid = test["id"].to_numpy()
    models = []
    for r in a.full:
        dirs = sorted(d for d in r.glob("full_s*") if (d / "test_probs.npy").exists())
        assert dirs, f"no full-fit outputs in {r}"
        models += [(f"{r.name}/{d.name}", _load(d, tid)) for d in dirs]
    for r in a.folds:
        dirs = sorted(d for d in r.glob("fold*") if (d / "test_probs.npy").exists())
        assert dirs, f"no folds in {r}"
        models.append((f"{r.name}[{len(dirs)}f]", np.mean([_load(d, tid) for d in dirs], 0)))
    assert models, "nothing to blend"
    print("models:", [n for n, _ in models])
    p = np.mean([m for _, m in models], 0)
    bias = np.array([float(x) for x in a.bias.split(",")])
    assert bias.shape == (len(LABELS),)
    pred = (np.log(np.clip(p, 1e-9, 1)) + bias).argmax(-1)

    mapping = dict(zip(tid, [LABELS[i] for i in pred]))
    sub = sample.copy()
    sub[sub.columns[-1]] = sub[sub.columns[0]].map(mapping)
    assert len(sub) == 6000 == len(test)
    assert sub[sub.columns[-1]].isin(LABELS).all()
    assert set(sub[sub.columns[0]]) == set(tid)
    config.SUBMISSIONS_DIR.mkdir(exist_ok=True)
    out = config.SUBMISSIONS_DIR / f"{a.name}.csv"
    sub.to_csv(out, index=False)
    print(sub[sub.columns[-1]].value_counts(normalize=True).round(3).to_dict())
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
