"""Validate notebooks/RMIT_C1_mmbert.ipynb on a Modal T4, simulating Kaggle paths.

  uv run modal run modal_app/nbtest.py --mode debug
  uv run modal run modal_app/nbtest.py --mode full
"""
import modal

app = modal.App("rmit-nbtest")
MODEL_DIR = "/kaggle/input/mmbert-base/transformers/default/1"


def _download():
    from huggingface_hub import snapshot_download
    snapshot_download("jhu-clsp/mmBERT-base", local_dir=MODEL_DIR)


image = (
    modal.Image.debian_slim(python_version="3.12")
    .uv_pip_install("torch==2.8.0", "transformers>=4.56,<5", "accelerate>=1.10",
                    "sentencepiece", "protobuf", "pandas", "scikit-learn", "huggingface_hub")
    .env({"TOKENIZERS_PARALLELISM": "false"})
    .run_function(_download)
    .add_local_dir("data/raw", "/kaggle/input/rmit-hackathon-2026", copy=True)
    .add_local_file("notebooks/RMIT_C1_mmbert.ipynb", "/root/nb.ipynb")
)


@app.function(image=image, gpu="T4", timeout=3 * 3600)
def run(mode: str = "debug"):
    import json, os, time
    import pandas as pd
    os.makedirs("/kaggle/working", exist_ok=True)
    os.chdir("/kaggle/working")
    nb = json.load(open("/root/nb.ipynb"))
    cells = [c for c in nb["cells"] if c["cell_type"] == "code"]
    if mode == "debug":
        over = "DEBUG_ROWS = 300; EPOCHS = 1; RUN_FOLDS = [0, 1]"
    else:
        over = "DEBUG_ROWS = 0; EPOCHS = 1; RUN_FOLDS = [0]"
    ns = {"__name__": "__main__"}
    t0 = time.time()
    for i, c in enumerate(cells):
        print(f"\n===== code cell {i} =====", flush=True)
        exec(compile("".join(c["source"]), f"cell{i}", "exec"), ns)
        if i == 0:
            exec(over, ns)
            print("OVERRIDES:", over)
    print(f"\nTOTAL {time.time() - t0:.0f}s")
    sub = pd.read_csv("/kaggle/working/submission.csv")
    ss = pd.read_csv("/kaggle/input/rmit-hackathon-2026/sample_submission.csv")
    print("SUB shape", sub.shape, list(sub.columns), "labels", sorted(sub.label.dropna().unique()),
          "nan", int(sub.label.isna().sum()))
    if mode != "debug":
        print("IDS MATCH SAMPLE:", sub.id.tolist() == ss.id.tolist(), "ROWS==6000:", len(sub) == 6000)


@app.local_entrypoint()
def main(mode: str = "debug"):
    run.remote(mode)
