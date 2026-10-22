"""Blend test_probs from fold runs and full-fit seeds and write a submission.

  uv run python -m rmit_hack.blend_full --full outputs/mmbert_full --folds outputs/mmbert_base_v1 outputs/mmbert_s2 \
      --name mmbert_full_plus_folds [--avg geo|prob] [--bias 0,0,0] [--weights ...] [--force]
Default weights: each --folds RUN (its folds averaged first) 1.0, each full-fit seed 0.6.
--weights is a comma list in model order (full-fit seeds first, then fold runs; see printed list).
Averaging: geo (default) = weighted mean of log-probs then softmax; prob = mean of probs.
Biases are added to log-probs (B,J,PI), default 0.
Sanity gates per full-fit seed vs the fold-avg blend (A3): class dist within 1.5pt of
(0.62,0.31,0.07), argmax agreement >= 0.975 (warn < 0.985). Failing seeds are excluded unless --force.
"""

import argparse
from pathlib import Path

import numpy as np
import pandas as pd

from rmit_hack import config
from rmit_hack.ensemble import combine

LABELS = config.LABELS
PRIOR = np.array([0.62, 0.31, 0.07])
DIST_TOL, AGREE_MIN, AGREE_WARN = 0.015, 0.975, 0.985
FULL_W = 0.6


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
    ap.add_argument("--avg", choices=["prob", "geo"], default="geo")
    ap.add_argument("--weights", default="", help="per model: full seeds first, then fold runs")
    ap.add_argument("--force", action="store_true", help="keep full-fit seeds failing gates")
    a = ap.parse_args()

    test = pd.read_csv(config.RAW_DIR / config.TEST_FILE)
    sample = pd.read_csv(config.RAW_DIR / config.SAMPLE_SUB_FILE)
    tid = test["id"].to_numpy()
    full, folds = [], []  # (name, probs, default weight)
    for r in a.full:
        dirs = sorted(d for d in r.glob("full_s*") if (d / "test_probs.npy").exists())
        assert dirs, f"no full-fit outputs in {r}"
        full += [(f"{r.name}/{d.name}", _load(d, tid), FULL_W) for d in dirs]
    for r in a.folds:
        dirs = sorted(d for d in r.glob("fold*") if (d / "test_probs.npy").exists())
        assert dirs, f"no folds in {r}"
        pr = combine([_load(d, tid) for d in dirs], np.ones(len(dirs)), a.avg)
        folds.append((f"{r.name}[{len(dirs)}f]", pr, 1.0))
    models = full + folds
    assert models, "nothing to blend"
    if a.weights:
        ws = [float(x) for x in a.weights.split(",")]
        assert len(ws) == len(models), f"--weights needs {len(models)} values, got {len(ws)}"
        models = [(n, p, w) for (n, p, _), w in zip(models, ws)]
        full, folds = models[: len(full)], models[len(full) :]

    # sanity gates for full-fit seeds vs fold-avg blend
    if full and folds:
        ref = combine([p for _, p, _ in folds], [w for _, _, w in folds], a.avg).argmax(-1)
        kept = []
        for n, p, w in full:
            pr = p.argmax(-1)
            dist = np.bincount(pr, minlength=3) / len(pr)
            agree = float((pr == ref).mean())
            ok_dist = bool((np.abs(dist - PRIOR) <= DIST_TOL).all())
            ok_agree = agree >= AGREE_MIN
            msg = f"gate {n}: dist={dist.round(3).tolist()} agree={agree:.4f}"
            if agree < AGREE_WARN:
                msg += "  WARN agreement < 0.985"
            if not (ok_dist and ok_agree):
                why = ("class dist off" if not ok_dist else "") + (
                    " agreement < 0.975" if not ok_agree else ""
                )
                msg += f"  FAIL ({why.strip()})" + (" - kept (--force)" if a.force else " - EXCLUDED")
                if not a.force:
                    print(msg)
                    continue
            else:
                msg += "  PASS"
            print(msg)
            kept.append((n, p, w))
        models = kept + folds
    elif full:
        print("no --folds reference given: gates skipped")

    print("models:", [(n, w) for n, _, w in models], f"avg={a.avg}")
    p = combine([m for _, m, _ in models], [w for _, _, w in models], a.avg)
    bias = np.array([float(x) for x in a.bias.split(",")])
    assert bias.shape == (len(LABELS),)
    print(f"bias applied (B,J,PI): {bias.tolist()}")
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
