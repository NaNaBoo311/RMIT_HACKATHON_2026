# Kaggle C1 notebook deliverable

Contents
- `dataset/` and `rmit-c1-mistral-final-preds.zip`: saved test_probs/test_ids (4 fold runs x 5 folds, 5 full-fit seeds), OOF csvs, folds.csv.
- `notebook/RMIT_SGS_HCMUT_NeuroX_C1.ipynb` + `kernel-metadata.json`: recomputes OOF 0.9821 and rebuilds the final submission (sha256 125781c7...3b18 asserted). CPU, internet OFF.

## 1. Set your username
Replace `<KAGGLE_USERNAME>` in `dataset/dataset-metadata.json` and `notebook/kernel-metadata.json` (3 places):
    sed -i '' 's/<KAGGLE_USERNAME>/YOURNAME/g' kaggle/dataset/dataset-metadata.json kaggle/notebook/kernel-metadata.json

## 2. CLI route (needs ~/.kaggle/kaggle.json)
    cd core-ai
    uv run kaggle datasets create -p kaggle/dataset --dir-mode zip
    # wait until the dataset shows "ready", then:
    uv run kaggle kernels push -p kaggle/notebook
    uv run kaggle kernels status YOURNAME/RMIT_SGS_HCMUT_NeuroX_C1
(Use `kaggle` from a venv that has the package, e.g. `uvx kaggle ...`, if `uv run kaggle` is not found.)

## 3. Manual UI route
1. kaggle.com -> Datasets -> New Dataset -> upload `rmit-c1-mistral-final-preds.zip` contents (or drag the `dataset/` folder); title `rmit-c1-mistral-final-preds`.
2. Code -> New Notebook -> File -> Import Notebook -> `RMIT_SGS_HCMUT_NeuroX_C1.ipynb`.
3. Add Input: the competition (rmit-hackathon-2026) and your dataset. Settings: Accelerator None, Internet Off.
4. Run All; check the printed sha256 equals 125781c7d933dd24a0907cf17f65321c5efb3b85ec5027be2d151d1baa603b18. Save Version (Save & Run All), then submit/link the notebook per competition rules.
Note: the notebook auto-discovers paths (glob), so the dataset folder name does not matter.
