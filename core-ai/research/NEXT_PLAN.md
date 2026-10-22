# Kế hoạch C1: giữ những gì promising (cập nhật 22/10 13:30)

Hạn chót: **18:00 hôm nay (giờ VN)** cho cả C1 (Kaggle) lẫn C2 (Tide form + video).
Đã nộp: **1/6** (`mmbert_seeds_combo.csv` → public LB **0.97643**, OOF 0.9710). Còn **5 lượt**.
Quy luật quan sát: **LB ≈ OOF + 0.005**. Leaderboard top: 0.989 / 0.986 / 0.978.

## 1. Kết quả đã kiểm chứng (OOF macro-F1, 14 000 dòng, StratifiedGroupKFold 5)

| Hướng | 1 run | Ghép nhiều run | Kết luận |
|---|---|---|---|
| **Mistral-7B-Instruct-v0.3 LoRA** (lr 5e-5, 2 ep, len 512) | ~0.973 (4/5 fold: .970 .972 .981 + 1 fold đang chạy) | chưa có | **GIỮ – hướng chính** |
| mmBERT-base + **pseudo-label** (`--pseudo-run mmbert_base_v1 --pseudo-threshold 0.95`) | **0.9715** | – | **GIỮ** (CV hơi lạc quan) |
| mmBERT-base + **DAPT** (MLM trên text train+test) | ~0.968 (4/5 fold) | – | GIỮ (thiếu fold 4) |
| mmBERT-base + FGM | fold 0: 0.969 (base 0.961) | – | Có thể (mới 1 fold) |
| mmBERT-base (recipe gốc) | 0.962–0.965 | 9 run: **0.9712** (nested 0.9708) | Dự phòng chắc chắn |
| wolf-defender | 0.962–0.965 | 2 run: 0.968 | Bỏ (không trộn được với mmBERT) |
| xlm-roberta-large | 0.930–0.948 (seed rất nhiễu) | 4 run: 0.955 | **BỎ** |
| mmBERT-small, len 1024, head/tail 256, class weights, label smoothing | ≤ noise (±0.001) | – | **BỎ** (chỉ dùng như seed khác) |
| granite-3.3-2b | lỗi (không có SeqCls head trong transformers 4.x) | – | **BỎ** |
| Mistral lr 1e-4 (v1) | 1 fold phân kỳ (0.58) | – | **BỎ** – luôn dùng lr 5e-5 |

Luật: chỉ được build trên **một** backbone ⇒ chỉ ghép các run **cùng backbone** (seed/fold/pseudo-label), không trộn Mistral với mmBERT.

## 2. Thứ tự chạy trên tài khoản Modal mới

Ưu tiên theo "điểm kỳ vọng / GPU-giờ". Mỗi run Mistral 5-fold = 5 × A100-80GB × ~40 phút.

| # | Run | Kỳ vọng | Chi phí |
|---|---|---|---|
| A1 | **Mistral + pseudo-label** từ teacher `mistral7b_lora_v2` | +0.005 ~ +0.009 (như mmBERT) | 1 run Mistral |
| A2 | **Mistral seed 2** (`mistral7b_lora_v3`) → ghép với v2 | +0.003 ~ +0.006 (ghép seed) | 1 run Mistral |
| A3 | Mistral full-fit (100% data), 1–2 seed, blend với fold models | +0.002 trên LB | ~0.5 run/seed (chưa test với `--lora` → smoke trước) |
| B1 | mmBERT pseudo-label + DAPT (dự phòng rẻ, L4) | backup ~0.972 | rẻ |

Nếu credit ít: chỉ chạy **A1**, rồi A2 nếu còn.

## 3. Lệnh (chạy trong `core-ai/`)

```bash
# 0) Đổi tài khoản Modal
uv run modal token set --token-id <ID> --token-secret <SECRET> --profile=<new>
uv run modal profile activate <new>
./scripts/push_data.sh                       # train/test/sample + folds.csv -> volume mới

# 0b) Teacher cho pseudo-label phải có trên volume mới
uv run modal volume put rmit-hack-vol outputs/mistral7b_lora_v2 /outputs/mistral7b_lora_v2

# Recipe Mistral chung
M="--model-name mistralai/Mistral-7B-Instruct-v0.3 --lora --folds 0,1,2,3,4 --lr 5e-5 --epochs 2 --batch-size 8 --grad-accum 2 --grad-ckpt --max-len 512 --warmup-ratio 0.1 --gpu A100-80GB"

# A1) Mistral + pseudo-label
uv run modal run --detach -m modal_app.train $M --run-name mistral_pl95 --pseudo-run mistral7b_lora_v2 --pseudo-threshold 0.95
# A2) Mistral seed 2
uv run modal run --detach -m modal_app.train $M --run-name mistral7b_lora_v3 --seed 2
# A3) Mistral full-fit (smoke trước với --max-train-samples 200 --epochs 1)
uv run modal run --detach -m modal_app.train --model-name mistralai/Mistral-7B-Instruct-v0.3 --lora --full-fit --seeds 42 --lr 5e-5 --epochs 2 --batch-size 8 --grad-accum 2 --grad-ckpt --max-len 512 --gpu A100-80GB --run-name mistral_full

# Kéo kết quả + ghép
./scripts/pull_outputs.sh <run>
uv run python -m rmit_hack.ensemble outputs/mistral7b_lora_v2 outputs/mistral7b_lora_v3 --name mistral_combo
uv run python -m rmit_hack.blend_full --full outputs/mistral_full --folds outputs/mistral7b_lora_v2 --name mistral_full_blend
```

Lưu ý zsh: biến `$M` không tự tách từ trong zsh → dùng `${=M}` hoặc gõ thẳng flag.

## 4. Kế hoạch nộp (5 lượt còn lại)

1. **S2 – ngay khi Mistral v2 xong**: `submissions/mistral7b_lora_v2.csv` (nếu OOF ≥ 0.972).
2. **S3**: Mistral tốt nhất sau A1/A2 (chọn theo *nested* OOF, chỉ nộp nếu hơn S2 ≥ +0.002).
3. **S4**: bản cuối (ghép tất cả run Mistral + full-fit) — nộp trước **17:30**.
4. **S5–S6**: dự phòng (lỗi format / so sánh).
5. Trên Kaggle chọn **2 bài final**: 1 Mistral tốt nhất + 1 mmBERT combo (an toàn).

## 5. Notebook Kaggle

`notebooks/RMIT_C1_mmbert.ipynb` (mmBERT 5-fold, đã test trên Modal T4: ~55–75 phút). Mistral 7B quá nặng cho T4 trong thời gian còn lại → giữ notebook mmBERT. Đổi tên theo `<university>_<campus>_<team>_C1`, sửa `kernel-metadata.json`, push **trước 16:30**:
`uv run kaggle kernels push -p notebooks`

## 6. Đừng quên C2 (cũng 18:00)

Video demo 2 phút (.mp4 trong repo), repo **public**, nộp Google Form https://forms.gle/HRHYjnqB86j1LFS97.
