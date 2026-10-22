# core-ai — Challenge 1 (Kaggle classifier) + inference service

Competition: https://www.kaggle.com/competitions/rmit-hackathon-2026

Thư mục này là package Python độc lập (`pyproject.toml`, `uv.lock` nằm ở đây). **Mọi lệnh bên dưới chạy từ `core-ai/`**: `cd core-ai`.

Quản lý môi trường bằng **uv**, train GPU trên **Modal** (profile `xaongoctan`).

## Cấu trúc

```
core-ai/
├── src/rmit_hack/        # code dùng chung (chạy cả local lẫn trên Modal)
│   ├── config.py         # đường dẫn (ROOT = core-ai/), tên cột, LABELS, N_FOLDS
│   ├── data.py           # load data, tự dò cột, tạo submission
│   ├── baseline.py       # baseline TF-IDF char n-gram + LogisticRegression (local, CPU)
│   ├── folds.py          # tạo data/processed/folds.csv (StratifiedGroupKFold, 5 fold)
│   ├── ensemble.py       # gộp OOF từ các run, tune bias theo lớp, ghi submission
│   ├── export_baseline.py# train baseline TF-IDF (char+word) trên full train -> models/baseline.joblib
│   └── serve.py          # FastAPI inference service cho Challenge 2 (port 8001)
├── modal_app/            # các entrypoint chạy trên Modal (chạy từ thư mục core-ai/)
│   ├── common.py         # App, Image (torch/transformers), Volume `rmit-hack-vol`
│   ├── smoke.py          # test GPU + volume
│   └── train.py          # k-fold fine-tune (full-FT hoặc LoRA), các fold chạy SONG SONG
├── scripts/              # download_data / push_data / pull_outputs / submit (.sh)
├── notebooks/            # EDA
├── research/             # ghi chú nghiên cứu C1
├── models/               # baseline.joblib (gitignored, tạo bằng export_baseline)
├── data/{raw,processed}/ # (gitignored)
├── outputs/              # kết quả kéo từ Modal (gitignored)
└── submissions/          # file csv để nộp (gitignored)
```

## Setup (một lần)

```bash
uv sync                                   # tạo .venv + cài deps
uv run modal profile current              # phải ra: xaongoctan
# Kaggle API: Kaggle -> Settings -> API -> Create New Token -> lưu vào ~/.kaggle/kaggle.json
chmod 600 ~/.kaggle/kaggle.json
```

Nếu máy khác chưa có token Modal:
`uv run modal token set --token-id <id> --token-secret <secret> --profile=xaongoctan && uv run modal profile activate xaongoctan`

## Workflow

```bash
./scripts/download_data.sh                # 1. lấy data (nhớ bấm "Join competition" trên Kaggle trước)
uv run python -m rmit_hack.baseline       # 2. baseline local nhanh -> submissions/baseline_*.csv
./scripts/push_data.sh                    # 3. đẩy data lên Modal
uv run modal run -m modal_app.smoke       #    (tuỳ chọn) kiểm tra GPU + thấy file data
uv run python -m rmit_hack.folds          #    tạo folds.csv (trước push_data)
uv run modal run -m modal_app.train       # 4. k-fold fine-tune xlm-roberta-base trên GPU L4 (các fold song song)
./scripts/pull_outputs.sh                 # 5. liệt kê các run
./scripts/pull_outputs.sh <run_name>      #    kéo cả thư mục run về outputs/<run_name>/fold*/
uv run python -m rmit_hack.ensemble outputs/<run_name> --name <sub>  # 6. gộp OOF -> submissions/<sub>.csv (xem Known issue!)
./scripts/submit.sh submissions/<sub>.csv "xlmr-base 3ep"            # 7. nộp
```

Đổi model / hyperparams:

```bash
uv run modal run -m modal_app.train --model-name microsoft/mdeberta-v3-base --epochs 4 --lr 3e-5 --run-name mdeberta_v1 --folds 0,1,2,3,4
uv run modal run -m modal_app.train --model-name xlm-roberta-large --batch-size 16 --lr 1e-5
uv run modal run --detach -m modal_app.train   # chạy nền, tắt terminal vẫn chạy
```

GPU đổi ở `GPU = "L4"` trong `core-ai/modal_app/train.py` (`T4` rẻ hơn, `A10G`, `A100`/`H100` cho model large).

## Lưu ý

- Sau khi xem data, nếu cột không được tự dò đúng thì set `TEXT_COL`, `LABEL_COL`, `ID_COL` trong `core-ai/src/rmit_hack/config.py`.
- Nếu có `sample_submission.csv` thì submission sẽ giữ đúng format của nó (điền cột cuối).
- Kiểm tra metric chính thức ở tab *Evaluation* trên Kaggle; code đang log `acc` và `macro_f1`.
- Không commit token/data: `.gitignore` ở root đã chặn data, outputs, `kaggle.json`, `.env`.
- Modal phải được chạy từ `core-ai/` (`cd core-ai && uv run modal run -m modal_app.train ...`) để `add_local_python_source("rmit_hack", "modal_app")` tìm đúng package.

## Known issue — OOF bị lệch nhãn (k-fold pipeline)

Trong pipeline k-fold, xác suất OOF được lưu (`fold*/oof.npy`, `oof.csv`) **không khớp thứ tự với nhãn**: ở smoke run, macro-F1 do trainer báo là **0.90** nhưng macro-F1 tính từ OOF đã lưu chỉ **0.33**. Vì `ensemble.py` đọc OOF này (để tune bias và đánh giá), **không tin kết quả của `ensemble.py` và các submission sinh từ nó cho tới khi lỗi được sửa**. Lỗi đang được xử lý riêng, chưa sửa trong thư mục này.

## Inference service (Challenge 2)

Backend của Challenge 2 gọi service này để phân loại prompt.

```bash
uv run python -m rmit_hack.export_baseline                 # tạo models/baseline.joblib (một lần)
uv run uvicorn rmit_hack.serve:app --port 8001             # chạy service
# dùng model HF fine-tuned thay cho baseline:
uv sync --extra hf                                         # cài torch + transformers (không có mặc định)
CORE_AI_MODEL_DIR=/path/to/hf_model_dir uv run uvicorn rmit_hack.serve:app --port 8001
```

- `GET /health` -> `{"status":"ok","model":"tfidf-baseline"}`
- `POST /classify` `{"text": "..."}` -> `{"label": "BENIGN|JAILBREAK|PROMPT_INJECTION", "probs": {...}, "model": "..."}`
- `POST /classify/batch` `{"texts": ["..."]}` -> `{"results": [ ... ]}`
- CORS cho `http://localhost:3000` và `http://localhost:8000`.
