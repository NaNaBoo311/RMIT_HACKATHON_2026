# RMIT Hackathon 2026 — Kaggle challenge

Competition: https://www.kaggle.com/competitions/rmit-hackathon-2026

Quản lý môi trường bằng **uv**, train GPU trên **Modal** (profile `xaongoctan`).

## Cấu trúc

```
.
├── src/rmit_hack/        # code dùng chung (chạy cả local lẫn trên Modal)
│   ├── config.py         # đường dẫn, tên cột (TEXT_COL / LABEL_COL / ID_COL)
│   ├── data.py           # load data, tự dò cột, tạo submission
│   └── baseline.py       # baseline TF-IDF char n-gram + LogisticRegression (local, CPU)
├── modal_app/            # các entrypoint chạy trên Modal
│   ├── common.py         # App, Image (torch/transformers), Volume `rmit-hack-vol`
│   ├── smoke.py          # test GPU + volume
│   └── train.py          # fine-tune transformer đa ngôn ngữ + predict test
├── scripts/
│   ├── download_data.sh  # tải data từ Kaggle -> data/raw
│   ├── push_data.sh      # đẩy data/raw lên Modal volume (/vol/data)
│   ├── pull_outputs.sh   # kéo kết quả 1 run về outputs/ + submissions/
│   └── submit.sh         # nộp file lên Kaggle
├── notebooks/            # EDA
├── data/{raw,processed}/ # (gitignored)
├── submissions/          # file csv để nộp (gitignored)
└── research/             # ghi chú nghiên cứu
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
uv run modal run -m modal_app.train       # 4. fine-tune xlm-roberta-base trên GPU L4
./scripts/pull_outputs.sh                 # 5. liệt kê các run
./scripts/pull_outputs.sh <run_name>      #    kéo submission về submissions/<run_name>.csv
./scripts/submit.sh submissions/<run_name>.csv "xlmr-base 3ep"   # 6. nộp
```

Đổi model / hyperparams:

```bash
uv run modal run -m modal_app.train --model-name microsoft/mdeberta-v3-base --epochs 4 --lr 3e-5
uv run modal run -m modal_app.train --model-name xlm-roberta-large --batch-size 16 --lr 1e-5
uv run modal run --detach -m modal_app.train   # chạy nền, tắt terminal vẫn chạy
```

GPU đổi ở `GPU = "L4"` trong `modal_app/train.py` (`T4` rẻ hơn, `A10G`, `A100`/`H100` cho model large).

## Lưu ý

- Sau khi xem data, nếu cột không được tự dò đúng thì set `TEXT_COL`, `LABEL_COL`, `ID_COL` trong `src/rmit_hack/config.py`.
- Nếu có `sample_submission.csv` thì submission sẽ giữ đúng format của nó (điền cột cuối).
- Kiểm tra metric chính thức ở tab *Evaluation* trên Kaggle; code đang log `acc` và `macro_f1`.
- Không commit token/data: `.gitignore` đã chặn `data/`, `outputs/`, `kaggle.json`, `.env`.
