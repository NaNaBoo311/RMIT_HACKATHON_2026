# A1 - Pseudo-labelling cho Mistral-7B LoRA (22/10, ~13:50)

Nguồn: code `modal_app/train.py` (dòng 164-183) + kiến thức công bố (Noisy Student, Xie 2020; FixMatch/self-training; các writeup Kaggle NLP như Feedback Prize, Jigsaw multilingual, LLM-classification: pseudo-label test/ngoài dữ liệu thường +0.2~1 pt, hiệu quả nhất khi teacher là ENSEMBLE mạnh hơn student). Không tra web trực tiếp; số liệu trích dẫn mang tính quy tắc ngón tay cái.

## 1. Code hiện tại làm gì
- `--pseudo-run R`: lấy `outputs/R/fold*/test_probs.npy`, **trung bình tất cả fold** -> `pp`; chọn dòng test có `max prob >= thr` (một ngưỡng chung); nhãn **cứng** = argmax; nối vào tập train của fold k (val fold k không bị đụng). Không có trọng số riêng cho dòng pseudo; class weight "sqrt" được tính lại trên tập đã nối (OK).
- Hỗ trợ sẵn cho Mistral (đường LoRA không liên quan tới nhánh này). Cần teacher `outputs/mistral7b_lora_v2/fold*/test_probs.npy` + `test_ids.npy` có trên volume mới (NEXT_PLAN bước 0b). Chưa test với Mistral nhưng logic độc lập với model.
- Chi phí: train mỗi fold 11 200 + ~5 600 = ~16 800 dòng (+50%) => ~60-65 phút/fold song song, **~5 GPU-h A100-80GB** (không phải 3.3).

## 2. Độ "lạc quan" của CV
Teacher fold-avg gồm 4 fold-model đã thấy nhãn val của student fold k. Nhãn val không vào pseudo rows, nhưng kiến thức đó được chưng cất qua nhãn test => OOF hơi cao (rò rỉ gián tiếp, thường nhỏ, ước 0.001-0.003; với mmBERT +0.009 có thể dính 1/3).
Cách làm trung thực: **teacher theo fold** - student fold k chỉ dùng `fold{k}/test_probs.npy` của teacher (model đó chưa thấy val k). Đổi code (3 dòng) trong khối `if cfg["pseudo_run"]`:
```python
pfolds = sorted(pdir.glob("fold*/test_probs.npy"))
if cfg.get("pseudo_per_fold"):           # thêm key vào DEFAULTS + tham số main/CLI (như pseudo_threshold)
    pfolds = [pdir / f"fold{fold}" / "test_probs.npy"]   # (full_fit: dùng cả 5)
```
Hạn chế: teacher đơn lẻ yếu hơn trung bình 5 fold (~0.975 vs ~0.98) -> ít dòng qua ngưỡng, nhãn nhiễu hơn, gain thật nhỏ hơn. Nhưng OOF khi đó là ước lượng đúng cho "quy trình fold k". Bài nộp cuối vẫn có thể dùng test preds của các student (mỗi student train với pseudo từ fold-avg hoặc per-fold, đều hợp lệ vì test không có nhãn).

Khuyến nghị thực dụng: **chạy per-fold (honest)** cho A1. Nếu GPU/thời gian chỉ cho 1 lần, per-fold cho số OOF đáng tin để quyết định nộp; fold-avg cho gain test thật cao hơn chút nhưng không đo được.

## 3. Quyết định tham số
- **Teacher**: chỉ Mistral v2 (cùng backbone). **Không** dùng mmBERT làm teacher/ensemble teacher: luật "build on ONE approved model, no other pretrained backbone" - dùng mmBERT sinh nhãn là đụng backbone thứ hai (rủi ro bị coi vi phạm, và mmBERT yếu hơn: ~0.971 vs Mistral ~0.975+) => rủi ro > lợi ích. (Self-distillation từ chính backbone đã nộp thì rõ ràng an toàn.)
- **Ngưỡng**: 0.95 cho BENIGN/JAILBREAK; PI (lớp hiếm ~7%, hay bị dưới-đại-diện) hạ xuống ~0.90. 0.99 thường bỏ quá nhiều dòng khó (đúng những dòng có ích); 0.9 chung tăng nhiễu. Teacher LoRA CE thường quá tự tin nên 0.95 có thể giữ ~94-96% test (~5 700). Nếu log in ra PI < ~4% số dòng pseudo (so với ~7% trong train) thì dùng ngưỡng theo lớp. Code đổi (tuỳ chọn, 4 dòng): `pseudo_class_thr="0.95,0.90,0.95"` (thứ tự BENIGN,JAILBREAK,PI -> chú ý thứ tự đúng với `config.LABELS` = BENIGN, JAILBREAK, PROMPT_INJECTION nên PI là phần tử thứ 3 = 0.90): 
  `thr = np.array(...)[pp.argmax(-1)]; sel = pp.max(-1) >= thr`. Đặt `PI=0.90` => chuỗi `0.95,0.95,0.90`.
- **Nhãn cứng vs mềm**: giữ cứng. Soft cần đổi loss sang KL/CE-soft + dataset trả vector (~25 dòng, dễ lỗi trong lúc gấp); lợi ích thực nghiệm nhỏ khi đã lọc theo ngưỡng.
- **Trọng số dòng pseudo (0.5)**: chưa hỗ trợ; muốn làm phải thêm cột trọng số qua collator và compute_loss (rủi ro `DataCollatorWithPadding`). Ngưỡng + 1 vòng đã đủ; **bỏ qua**.
- **Số vòng**: 1. Vòng 2 (teacher = student vòng 1) cần thêm ~5 GPU-h + 65 phút, không đủ ngân sách; lợi ích biên giảm mạnh, nguy cơ củng cố lỗi (confirmation bias).

## 4. Kỳ vọng và so sánh chi phí
- mmBERT: +0.009 vì student yếu (0.963) học từ teacher 5-fold. Với Mistral student đã 0.973-0.975 và teacher chỉ hơn khoảng 0.003-0.006, gain điển hình **+0.002 ~ +0.005** (bất định lớn; có thể 0). LB ~ OOF+0.005 => khoảng 0.98.
- So A2 (seed 2, 3.3 GPU-h, +0.003~0.006 khi ghép với v2): A2 rẻ hơn, ít rủi ro, ngang kỳ vọng. A1 đáng chạy vì các student (pseudo) và v2/v3 là các mô hình khác nhau => ghép thêm đa dạng. Tổng GPU: A1 5 + A2 3.3 = 8.3 h << 30 h; chỉ cần hạn mức song song (10 A100?). Nếu Modal giới hạn concurrency, ưu tiên A1 chạy ngay vì lâu nhất (65 phút), A2 ngay sau/song song.
- Mốc thời gian: bắt đầu trước ~14:15 -> xong ~15:30; còn dư cho blend và nộp trước 17:30.

## 5. Lệnh (trong `core-ai/`, teacher đã put lên volume)
```bash
M="--model-name mistralai/Mistral-7B-Instruct-v0.3 --lora --folds 0,1,2,3,4 --lr 5e-5 --epochs 2 --batch-size 8 --grad-accum 2 --grad-ckpt --max-len 512 --warmup-ratio 0.1 --gpu A100-80GB"
# (1) bản có sẵn, không sửa code (CV hơi lạc quan, fold-avg teacher):
uv run modal run --detach -m modal_app.train ${=M} --run-name mistral_pl95 --pseudo-run mistral7b_lora_v2 --pseudo-threshold 0.95
# (2) sau khi thêm pseudo_per_fold (honest CV) - chạy nếu code sửa kịp, hoặc thay cho (1):
uv run modal run --detach -m modal_app.train ${=M} --run-name mistral_pl95_pf --pseudo-run mistral7b_lora_v2 --pseudo-threshold 0.95 --pseudo-per-fold
# seed 2 song song
uv run modal run --detach -m modal_app.train ${=M} --run-name mistral7b_lora_v3 --seed 2
```
(Khi thêm tham số mới, phải thêm vào `DEFAULTS`, chữ ký `main(...)` và dict `cfg` ở ~dòng 543-574; CLI Modal tự thành `--pseudo-per-fold`.) Kiểm tra log mỗi fold: dòng `pseudo-labels ... added N/6000 {BENIGN:..,JAILBREAK:..,PROMPT_INJECTION:..}`.

## 6. Quyết định nộp
1. So OOF (macro-F1 14 000) của `mistral_pl95*` với v2: chỉ tin nếu per-fold honest; nếu dùng bản fold-avg thì trừ ~0.002 độ lạc quan trước khi so.
2. Ghép (`rmit_hack.ensemble`) v2 + v3 + pl: dùng nested OOF; PL student tương quan cao với v2 nên gain ghép nhỏ hơn cộng gộp.
3. Nộp pl/ghép chỉ khi nested OOF (đã trừ lạc quan) >= v2 hoặc combo v2+v3 + 0.002; còn lại nộp combo v2+v3 (sạch, không rò rỉ). Giữ 1 slot final = Mistral tốt nhất, 1 slot mmBERT combo an toàn (theo NEXT_PLAN).
4. Rủi ro luật: pseudo-label test không phải gán nhãn tay, cùng backbone, không dùng dữ liệu ngoài -> chấp nhận được; nên ghi chú trong notebook/README "self-training with own predictions on unlabeled test".
