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
uv run python -m rmit_hack.ensemble outputs/<run_name> --name <sub>  # 6. gộp OOF -> submissions/<sub>.csv
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

## Đã sửa: OOF bị lệch nhãn (k-fold pipeline)

Nguyên nhân: `group_by_length=True` làm `trainer.predict()` trả về dự đoán theo thứ tự ngẫu nhiên, nên OOF/test probs lưu ra bị lệch (trainer eval 0.90 nhưng OOF 0.33). Giờ OOF/test được dự đoán bằng vòng lặp tuần tự riêng, có assertion kiểm tra OOF macro-F1 khớp trainer eval (±0.01) và `test_ids.npy` khớp thứ tự `test.csv`. Smoke run sau khi sửa: OOF = eval = 0.9016 / 0.9064. Run cũ (trước khi sửa) không dùng được.

## Final submission (C1) — reproducibility

**VI.** Bài nộp cuối của Challenge 1 dùng **đúng một backbone**: `mistralai/Mistral-7B-Instruct-v0.3` (nằm trong danh sách model được phép), fine-tune bằng LoRA (sequence classification). Không dùng dữ liệu ngoài, không gán nhãn tay, không tune threshold/bias.

**EN.** The final C1 submission uses a **single backbone**: `mistralai/Mistral-7B-Instruct-v0.3` (on the approved model list), fine-tuned with LoRA for sequence classification. No external data, no hand labels, no threshold/bias tuning.

**Recipe / Công thức (chung cho mọi run):** LoRA r=16, alpha=32, dropout=0.05; lr 5e-5; 2 epochs; batch 8 x grad-accum 2; max_len 512; warmup 0.1; weight decay 0.01; class weights `sqrt`; gradient checkpointing; 5-fold StratifiedGroupKFold (`rmit_hack.folds`); GPU Modal `A100-80GB`. Cờ train: `--model-name mistralai/Mistral-7B-Instruct-v0.3 --lora --folds 0,1,2,3,4 --lr 5e-5 --epochs 2 --batch-size 8 --grad-accum 2 --grad-ckpt --max-len 512 --warmup-ratio 0.1 --gpu A100-80GB`.

| Run | Seed | Pseudo-label | OOF macro-F1 (5-fold) |
|---|---|---|---|
| `mistral7b_lora_v2` (teacher) | 42 | no | 0.9744 |
| `mistral7b_lora_v3` | 2 | no | 0.9721 |
| `mistral7b_lora_v4` | 3 | no | 0.9763 |
| `mistral_pl95` | 7 | teacher v2, thr 0.95 | 0.9793 |
| `mistral_pl95_s2` | 11 | teacher v2, thr 0.95 | 0.9186: **excluded** (fold 0 diverged to 0.64; folds 1-4 were 0.976-0.985) |

Full-fit models (train on all labelled rows, no folds / no OOF; flags: base recipe above with `--full-fit` instead of `--folds`):

| Run | Seeds | Pseudo-label |
|---|---|---|
| `mistral_full_pl` | 21, 22, 23 | teacher v2, thr 0.95 |
| `mistral_full` | 31, 32 | no |

Fold-only fallback (v2+v3+v4+pl95): OOF macro-F1 **0.9821** (raw argmax, no thresholds); `submissions/FINAL_mistral.csv` sha256 `53ad2466e6b6baf25dc04b5dc6d130f058bed80a1b60e876184220afa833e406`. Blend of v2+v3+pl95: 0.9815.

**Final = `submissions/FINAL_mistral_full.csv`**: sha256 `125781c7d933dd24a0907cf17f65321c5efb3b85ec5027be2d151d1baa603b18` = fold runs v2+v3+v4+pl95 (weight 1.0 each; fold-only OOF 0.9821) + 5 full-fit seeds (full_pl s21-23, full s31-32; weight 0.6 each; all passed the gates, agreement 98.8-99.2%), geo-mean, no thresholds. Full-fit models have no OOF, so the final's OOF score is not directly measurable; the OOF above is for the fold-only part.

**Pseudo-label / Gán nhãn giả.** Teacher = chính model Mistral `mistral7b_lora_v2` của chúng tôi, dự đoán trên text của tập test chưa có nhãn; chỉ giữ các mẫu có `max prob >= 0.95` và thêm vào tập train của mỗi fold / full-fit (trọng số 1.0). Không có nhãn tay, không có dữ liệu ngoài. / The teacher is our own Mistral v2 run predicting on the unlabeled test text; only samples with max prob >= 0.95 are added to the training set. No hand labels, no external data. (Validation fold rows are never pseudo-labeled from labels; OOF is computed on held-out train rows.)

**Blend.** Trung bình nhân (geometric mean = mean of log-probs, rồi argmax), **không** bias, không threshold. Thành phần / components: (1) 5 run x 5 fold (mỗi run lấy trung bình các fold trước), trọng số 1.0 mỗi run; (2) 5 model full-fit (mỗi seed một model), trọng số 0.6 mỗi model. Mỗi model full-fit phải qua cổng kiểm tra so với blend fold: phân bố lớp trong ±1.5 điểm so với 62/31/7 và độ đồng thuận argmax >= 0.975 (< 0.985 chỉ cảnh báo); model không qua sẽ bị loại. / Each full-fit model must pass sanity gates vs the fold-avg blend (class distribution within 1.5pt of 62/31/7, argmax agreement >= 0.975, warning below 0.985); failing models are excluded.

```bash
uv run python -m rmit_hack.blend_full \
    --folds outputs/mistral7b_lora_v2 outputs/mistral7b_lora_v3 outputs/mistral7b_lora_v4 outputs/mistral_pl95 \
    --full outputs/mistral_full_pl outputs/mistral_full --avg geo --name FINAL_mistral_full
# fallback (folds only, 4 runs):
uv run python -m rmit_hack.ensemble outputs/mistral7b_lora_v2 outputs/mistral7b_lora_v3 outputs/mistral7b_lora_v4 \
    outputs/mistral_pl95 --avg geo --no-bias --name FINAL_mistral
```

Blend là deterministic (đã kiểm: chạy 2 lần cho cùng sha256; `blend_full` chỉ-fold tái tạo đúng byte `FINAL_mistral.csv`).

**Provenance / Nguồn gốc:** Modal app IDs, billing, Kaggle history: [`../docs/C1_PROVENANCE.md`](../docs/C1_PROVENANCE.md).

**Reproduce / Cách tái tạo** (từ `core-ai/`):

```bash
./scripts/reproduce_final.sh               # full: download data -> folds -> train 5 fold runs + 2 full-fit runs on Modal -> pull -> blend
./scripts/reproduce_final.sh --blend-only  # chỉ blend outputs/ có sẵn; FAIL nếu thiếu file nào
FOLD_RUNS="mistral7b_lora_v2 mistral7b_lora_v3 mistral7b_lora_v4 mistral_pl95" FULL_RUNS="" ./scripts/reproduce_final.sh --blend-only   # override
```

Danh sách run nằm ở một chỗ: `DEFAULT_FOLD_RUNS` / `DEFAULT_FULL_RUNS` trong `scripts/reproduce_final.sh`. Output: `submissions/FINAL_mistral_full.csv` (final) và `submissions/FINAL_mistral.csv` (fallback). Chạy full cần Modal (profile `xaongoctan`) với GPU **A100-80GB** (~30-50 phút/fold) và Kaggle token. Seed + cfg đầy đủ của từng run lưu trong `outputs/<run>/{fold*,full_s*}/metrics.json` (key `cfg`). Training trên GPU không bit-exact giữa các lần chạy; tính tái tạo được đảm bảo ở bước blend từ các output đã lưu và ở công thức/seed cố định. / GPU training is not bit-exact across reruns; exact reproducibility is guaranteed for the blend step given the saved outputs, and for recipe + seeds.

**Git commit to cite:** the commit that adds this line (code that produced every final run is in `1af24d1` and later).

**Experiments only, NOT part of the final / Chỉ là thử nghiệm, không thuộc bài nộp cuối:** mmBERT-base, XLM-R-large, wolf-defender and mixed-backbone blends (`submissions/mmbert_*`, `xlmr_*`, `BLEND_*`, `XBACKBONE_*`) were exploratory; none of them is used in `FINAL_mistral.csv`.

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
