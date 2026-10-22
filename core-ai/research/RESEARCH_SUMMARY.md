# Tổng hợp nghiên cứu Challenge 1 (Kaggle `rmit-hackathon-2026`)

Tài liệu này gom toàn bộ research cho Challenge 1 (multilingual prompt-attack classifier) để cả team nắm: dùng model nào, vì sao, và đã tìm ra gì. Khi có mâu thuẫn, **các số liệu "đã kiểm chứng" ở đây ghi đè lên các note gốc** (xem mục "Đính chính so với note gốc" ở cuối).

Nguồn note gốc (cùng thư mục `core-ai/research/`): [`C1_eda.md`](C1_eda.md), [`C1_backbones.md`](C1_backbones.md), [`C1_techniques.md`](C1_techniques.md), [`C1_domain.md`](C1_domain.md), [`B_multilingual_pi.md`](B_multilingual_pi.md). Bối cảnh Challenge 2 / ý tưởng: [`docs/research/`](../../docs/research/), [`docs/challenge2-brief.md`](../../docs/challenge2-brief.md).

---

## 1. Thông tin cuộc thi và luật

Nguồn: [`C1_domain.md`](C1_domain.md) §1, [`B_multilingual_pi.md`](B_multilingual_pi.md) §1.

- Cuộc thi Kaggle `rmit-hackathon-2026`. Metric: **macro-F1** trên 3 lớp `BENIGN` / `JAILBREAK` / `PROMPT_INJECTION`.
- **Chỉ có 6 lần submit tổng cộng** (không phải mỗi ngày). Phải chọn lọc, dùng CV cục bộ để quyết định.
- Deadline: **2026-10-22 11:00** (nhiều khả năng là UTC, tức 18:00 giờ Việt Nam). Hãy xác nhận lại trên trang Kaggle.
- Luật chọn model: *"You must build your solution on **one** of the following approved models ... no other pretrained backbone is allowed."*
- Danh sách backbone được phép:
  - `distilbert/distilbert-base-multilingual-cased`
  - `jhu-clsp/mmBERT-small`, `jhu-clsp/mmBERT-base`
  - `FacebookAI/xlm-roberta-base`, `FacebookAI/xlm-roberta-large`
  - `google/rembert` (batch 8)
  - `protectai/deberta-v3-base-prompt-injection-v2`
  - `patronus-studio/wolf-defender-prompt-injection`
  - `ibm-granite/granite-3.3-2b-instruct`
  - `mistralai/Mistral-7B-Instruct-v0.3`
- Trang luật cũng ghi: "Submit notebooks to get higher score".
- **Dữ liệu ngoài (external data):** luật không nói gì. Không dùng trừ khi được xác nhận trên Discord.
- **Hệ quả của luật "one model":**
  - `mdeberta-v3-base` **không** nằm trong danh sách (note `C1_eda.md` gợi ý nhầm, bỏ qua).
  - Trộn (blend) nhiều backbone khác nhau có thể vi phạm luật. Chỉ dùng **fold/seed averaging của MỘT backbone**.
  - Stacking với TF-IDF là vùng xám, không dùng cho bài nộp chính.

## 2. Dữ liệu

Nguồn: [`C1_eda.md`](C1_eda.md), [`C1_domain.md`](C1_domain.md) §2.

- `train.csv`: **14000** dòng, cột `id,text,language,label`. `test`: **6000** dòng.
- Nhãn: BENIGN **8680**, JAILBREAK **4340**, PROMPT_INJECTION **980** (tỉ lệ 62/31/7).
- Ngôn ngữ: pt / fr / it / en = 6300 / 3500 / 2800 / 1400. **Tỉ lệ nhãn 62/31/7 giống hệt nhau ở mọi ngôn ngữ**, nên ngôn ngữ không là tín hiệu.
- Độ dài (median ký tự): BENIGN **115**, JAILBREAK **565**, PROMPT_INJECTION **99**. JAILBREAK là các prompt roleplay dài; BENIGN và PI ngắn. Đuôi rất dài (tối đa ~18.5k ký tự), nên cần xử lý truncation.
- Không có exact duplicate giữa train và test (0). Các "template family" chia sẻ prefix 60 ký tự, vì vậy CV phải **StratifiedGroupKFold nhóm theo prefix 60 ký tự đã chuẩn hoá** để tránh leakage.
- Ghi chú chưa kiểm chứng: câu "~130 dòng BENIGN bắt đầu bằng 'ignore all previous instructions'" là **UNVERIFIED**. Thực tế chỉ có 7 dòng bắt đầu đúng cụm tiếng Anh đó (4 BENIGN, 3 PI).
- **Baseline đã kiểm chứng:** TF-IDF `char_wb(2-5)` + `word(1-2)` + LogisticRegression `class_weight=balanced`, StratifiedGroupKFold 5-fold, **macro-F1 = 0.922** (BENIGN 0.95, JAILBREAK 0.917, PI 0.90). **85% lỗi là nhầm BENIGN↔JAILBREAK trên prompt roleplay dài**, đây là chỗ cần cải thiện.

## 3. Chọn model

Nguồn: [`C1_backbones.md`](C1_backbones.md), [`B_multilingual_pi.md`](B_multilingual_pi.md) §4, §6.

Quyết định: **screen một shortlist trên Modal L4 (1 fold mỗi model, chạy song song)**, chọn người thắng theo OOF macro-F1, rồi chạy 5-fold cho model đó.

| Backbone | Trạng thái | Ghi chú |
|---|---|---|
| `FacebookAI/xlm-roberta-large` | **Ứng viên chính** | 560M, encoder đa ngữ đã được chứng minh. lr 1e-5, bf16, warmup 0.1, batch 16x2. Cẩn thận hiện tượng collapse về một lớp (kiểm tra loss sau epoch 1). ~35 phút/run trên L4 (ước tính). |
| `jhu-clsp/mmBERT-base` | Screen | ModernBERT đa ngữ, context 8k, nhanh (~15 phút/run). lr 2e-5..3e-5. Cần transformers >= 4.48. |
| `patronus-studio/wolf-defender-prompt-injection` | Screen | mmBERT-base đã fine-tune cho PI (binary), cần re-init head 3 lớp (`ignore_mismatched_sizes=True`). Rủi ro: thiên về en/de. |
| `ibm-granite/granite-3.3-2b-instruct` (LoRA) | Stretch | Decoder, LoRA seq-cls r16, ~1-1.5 giờ trên L4. Chỉ làm nếu còn thời gian. |
| `FacebookAI/xlm-roberta-base`, `mmBERT-small`, `distilbert-multilingual` | Dự phòng | Nhanh nhưng yếu hơn. |
| `google/rembert` | Bỏ qua | Chậm, nặng, thường chỉ ngang XLM-R-large. |
| `Mistral-7B-Instruct-v0.3` | Bỏ qua | QLoRA 4-bit, quá chậm/rủi ro trên L4. |
| `protectai/deberta-v3-base-prompt-injection-v2` | Bỏ qua | Chỉ tiếng Anh, không phát hiện jailbreak. |

**Model cuối cùng: TODO (điền sau khi screening xong).**

Lưu ý triển khai Challenge 2: service inference hiện dùng baseline TF-IDF (`core-ai/models/baseline.joblib`) và sẽ chuyển sang backbone đã fine-tune qua biến môi trường `CORE_AI_MODEL_DIR` khi train xong.

Bối cảnh các detector sẵn có (Prompt Guard, ProtectAI, Azure Prompt Shields, Lakera, ...) và bằng chứng ngôn ngữ ít tài nguyên bypass safety: xem [`B_multilingual_pi.md`](B_multilingual_pi.md) §3-§4; taxonomy JAILBREAK vs PROMPT_INJECTION: [`C1_domain.md`](C1_domain.md) §4.

## 4. Kỹ thuật huấn luyện

Nguồn: [`C1_techniques.md`](C1_techniques.md).

- **Truncation:** head+tail, `max_len` 512 (ví dụ nửa đầu + nửa cuối), vì payload injection có thể nằm ở cuối prompt dài.
- **Class imbalance:** class weight dạng **sqrt inverse frequency** (nhẹ hơn inverse thuần để không phá precision của lớp PI).
- **Hậu xử lý:** tune **per-class logit bias** trên OOF để tối đa macro-F1, kiểm tra bằng nested CV để tránh overfit bias.
- **Số epoch cố định**, không chọn best checkpoint theo từng fold (tránh optimistic bias và giữ các fold đồng nhất).
- **CV:** StratifiedGroupKFold 5-fold, group theo prefix 60 ký tự chuẩn hoá (xem mục 2).
- **Ensemble hợp lệ:** chỉ fold-averaging / seed-averaging của một backbone.
- **Không dùng:** translation augmentation (bỏ qua), external data (chưa được xác nhận), blend nhiều backbone.
- Ổn định XLM-R-large: lr thấp (1e-5), warmup 10%, bf16 (không dùng fp16), grad clip 1.0, chạy lại seed khác nếu loss kẹt ở prior.

### Lỗi đã biết (đang sửa)

Smoke run của pipeline k-fold cho thấy eval macro-F1 của trainer là **0.90** nhưng OOF đã lưu chỉ **0.33**: có bug căn chỉnh (alignment) giữa OOF/test probabilities. Đang được sửa. **Không tin kết quả ensemble cho đến khi sửa xong.**

## 5. Kế hoạch submit (6 lần)

- **S1:** backbone đơn tốt nhất, 5-fold, fold-averaged probs + per-class bias tune trên OOF.
- **S2:** tinh chỉnh seed/fold (thêm seed, điều chỉnh bias).
- **S3-S6:** dự trữ (không dùng hết nếu không cần; giữ cho trường hợp bug hoặc cải thiện rõ rệt).
- Nguyên tắc: quyết định bằng OOF macro-F1 cục bộ, không "dò" leaderboard.

## 6. Câu hỏi mở

1. Backbone nào thắng sau screening (XLM-R-large vs mmBERT-base vs wolf-defender)? **TODO.**
2. Bug OOF/test alignment đã sửa chưa, và OOF macro-F1 thực sự của pipeline là bao nhiêu?
3. Dữ liệu ngoài có được phép không? Hỏi trên Discord; nếu chưa rõ thì không dùng.
4. Deadline chính xác (11:00 UTC?) so với giờ Việt Nam; luật "Submit notebooks" có yêu cầu nộp notebook không?
5. Có cần giảm lỗi BENIGN↔JAILBREAK trên prompt roleplay dài bằng truncation/độ dài lớn hơn (mmBERT hỗ trợ tới 8k) không?
6. Stacking với TF-IDF có được coi là vi phạm "one model" không? (hiện: không dùng.)

---

## Đính chính so với note gốc

- `C1_eda.md`: median ký tự BENIGN/JAILBREAK/PI là 115/565/99 (không phải 230/590/120); đề xuất `mdeberta-v3-base` không hợp lệ; claim "~130 BENIGN bắt đầu bằng 'ignore all previous instructions'" chưa kiểm chứng.
- `C1_backbones.md`: các ước tính thời gian train là ước tính; ensemble nhiều backbone (mục "ensemble") không phù hợp luật "one model".
- Ý tưởng/nền tảng Challenge 2 và bằng chứng lỗ hổng bảo mật: [`docs/research/00_WINNING_IDEA_REPORT.md`](../../docs/research/00_WINNING_IDEA_REPORT.md), [`A_tide_facts.md`](../../docs/research/A_tide_facts.md), [`C_security_gaps.md`](../../docs/research/C_security_gaps.md), [`D_ideas.md`](../../docs/research/D_ideas.md).
