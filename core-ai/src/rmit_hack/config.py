"""Shared paths and column names. Edit the column names once you have seen the Kaggle data."""

from pathlib import Path

COMPETITION = "rmit-hackathon-2026"

# Column names: None means auto-detect in data.py (see infer_columns).
ID_COL: str | None = "id"
TEXT_COL: str | None = "text"
LABEL_COL: str | None = "label"

TRAIN_FILE = "train.csv"
TEST_FILE = "test.csv"
SAMPLE_SUB_FILE = "sample_submission.csv"

SEED = 42

# Local paths
ROOT = Path(__file__).resolve().parents[2]
RAW_DIR = ROOT / "data" / "raw"
PROCESSED_DIR = ROOT / "data" / "processed"
SUBMISSIONS_DIR = ROOT / "submissions"

# Modal paths (Volume mounted at /vol)
MODAL_VOLUME = "rmit-hack-vol"
MODAL_MOUNT = Path("/vol")
MODAL_DATA_DIR = MODAL_MOUNT / "data"
MODAL_OUTPUT_DIR = MODAL_MOUNT / "outputs"

# Fixed label order used everywhere (probs columns, ensembles, submissions)
LABELS = ["BENIGN", "JAILBREAK", "PROMPT_INJECTION"]
FOLDS_FILE = "folds.csv"
N_FOLDS = 5
