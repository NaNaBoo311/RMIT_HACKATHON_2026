# Tide UNLOCKED — Báo cáo chọn ý tưởng

> Tổng hợp & review từ 4 subagent (A: Tide facts · B: Multilingual PI · C: Security gaps · D: Brainstorm). Báo cáo gốc nằm cùng thư mục.
> Ngày: 22/10/2026.

## ⚠️ Cảnh báo deadline

- **Việt Nam: thứ Năm 22/10/2026, 18:00 (giờ VN)** — Melbourne: 23/10 10:00 AEDT. Nguồn: `tide.org/unlocked/config.js`.
- Banner trang ghi "Submissions have closed" (có thể do countdown client-side) → **xác nhận ngay trên Discord**: https://discord.gg/XBMd9ny2q5
- Bài nộp bắt buộc có **prototype chạy được có TideCloak**, README "Project overview" ≤300 từ, **video demo 2 phút .mp4 (<100MB) trong repo**, repo public, nộp qua Google Form https://forms.gle/HRHYjnqB86j1LFS97.

---

## 1. Challenge Understanding

### Đề bài chính thức (trích nguyên văn)
> "Build a prototype using TideCloak where **no single administrator, organisation or AI can unilaterally override the rules** protecting people's data and decisions. Show how that changes what your app makes possible."

Câu hỏi gợi ý trên trang: *"AI could do more for us, but how much access should it have?"*, *"Communities could govern shared resources, but who gets the final say?"*

### Rubric CHÍNH THỨC (dùng thay rubric tự đề xuất trong prompt)
| Trọng số | Tiêu chí | Ý nghĩa |
|---:|---|---|
| 25% | Vision & originality | Ý tưởng mới, tham vọng |
| 20% | Trust constraint insight | Chỉ rõ trust/privacy/custody/authority đang chặn điều gì hôm nay |
| 20% | Value & impact | Giá trị cụ thể cho người/tổ chức/xã hội |
| 20% | Why TideCloak matters | TideCloak thay đổi *thực chất* điều app làm được |
| 15% | Prototype & storytelling | Prototype chạy + kể chuyện rõ |

### Hai câu "gác cổng" quan trọng nhất
1. *"If your app would work exactly the same with ordinary login and backend permissions, develop the idea further."*
2. FAQ: *"Don't make the project mainly a login demo, **a security tool** or a generic access-control dashboard. Show what becomes newly possible for the people using it."*

→ **Hệ quả lớn nhất cho chiến lược:** ghép "prompt-injection detector + IAM" rất dễ bị xem là *a security tool*. Ý tưởng thắng phải được kể như **một khả năng mới cho người dùng cuối**, còn classifier và TideCloak là thứ làm khả năng đó trở nên đáng tin.

### Phân định đúng vai trò (không phóng đại)
| Thành phần | Làm được | KHÔNG làm được |
|---|---|---|
| Classifier (C1) | Phát hiện/phân loại prompt attack đa ngôn ngữ, cho risk score + loại tấn công + ngôn ngữ | Không bao giờ bắt 100%; tự nó không ngăn được hành động. Bằng chứng: EchoLeak (CVE-2025-32711) vượt qua classifier của Microsoft. SEALGuard: guardrail giảm 9–18% hiệu quả với ngôn ngữ Đông Nam Á |
| TideCloak (C2) | Khoá không bao giờ nằm trọn ở đâu (threshold, ORK network); thay đổi role/user/client cần **quorum admin** (IGA change requests); **E2EE gắn với danh tính/role** (giải mã cần mạng ORK, revoke chặn lần giải mã kế tiếp); JWT ký threshold; DPoP | Không phát hiện prompt injection; không làm AI "đáng tin"; không thu hồi dữ liệu đã xem; không có login headless/CLI; **custom Forseti contract không tự deploy được** (Tide team deploy) |
| Kết hợp | Classifier quyết định **khi nào** cần thêm thẩm quyền; TideCloak đảm bảo thẩm quyền đó **không thể bị một người/server/AI giả mạo hoặc vượt qua**, và dữ liệu nhạy cảm không nằm trong tầm với của agent bị inject | — |

### Khoảng trống thị trường (từ agent C)
- Phát hiện là chưa đủ: EchoLeak, GitHub MCP "toxic agent flow", Replit agent xoá DB production.
- Một gốc tin cậy duy nhất là điểm sập duy nhất: Storm-0558, Okta 2023, Snowflake 2024.
- Human-in-the-loop yếu: người dùng approve khoảng 93–97% prompt (số liệu thứ cấp).
- Quorum vẫn có thể bị lừa nếu người ký không thấy đúng thứ mình ký: vụ Bybit ~1,5 tỷ USD.
- Thị trường chia đôi: detection (Lakera → Check Point, Protect AI → Palo Alto) và identity tập trung (Entra Agent ID, Okta). Chưa ai kết hợp thẩm quyền phi tập trung với tín hiệu rủi ro *(nhận định của agent, chưa có nguồn)*.

### Ràng buộc kỹ thuật ảnh hưởng tới việc chọn ý tưởng
- Đường an toàn để demo trong vài giờ: **IGA quorum trên thay đổi role + E2EE theo tag + JWT verify server-side**.
- Tránh phụ thuộc custom Forseti hoặc threshold-signing contract.
- Agent/AI không login headless được → thiết kế "AI đề xuất, con người (trên browser) phê duyệt/giải mã" là tự nhiên.

---

## 2. Five Ideas

### Ý tưởng 1 — **Hiến Chương AI Lớp Học** (*Classroom AI Charter*)
**Problem & Users.** Trường học và phụ huynh muốn cho học sinh dùng AI tutor, nhưng bị kẹt giữa hai lựa chọn tồi:
- (a) vendor hoặc admin trường đọc được mọi đoạn chat của trẻ, tức là giám sát;
- (b) không ai thấy gì, tức là trẻ tự do jailbreak AI.

Thêm vào đó, **một admin hay vendor có thể âm thầm nới lỏng luật an toàn**. Học sinh Việt Nam hay code-switch Việt–Anh, mà guardrail tiếng Anh thì lọt.

**Solution.** Mỗi lớp có một "hiến chương" gồm luật cho AI tutor và ngưỡng của classifier. Hiến chương:
- chỉ thay đổi được khi có **quorum giáo viên + đại diện phụ huynh + IT trường**;
- chat của học sinh **E2EE mặc định**: vendor, admin và giáo viên đều không đọc được;
- chỉ những lượt chat bị classifier gắn cờ (jailbreak hoặc manipulation nguy hiểm) mới được mã hoá thêm cho role giáo viên. Nghĩa là **riêng tư mặc định, giám sát theo ngoại lệ**.

**C1 × C2.**
- C1 phát hiện jailbreak đa ngôn ngữ và **quyết định lượt chat nào được mở cho giáo viên**.
- C2: IGA quorum bảo vệ role "charter-editor" và các role quyết định mức guardrail. E2EE tag giữ chat riêng tư, giáo viên chỉ giải mã được những lượt bị gắn cờ.
- **Bỏ TideCloak:** admin hoặc vendor đọc được toàn bộ chat của trẻ và tự sửa luật một mình. Lời hứa "không ai một mình đổi được luật" chỉ còn là chính sách giấy.

**Innovation.** Hiện chưa có sản phẩm "AI governance do nhiều bên cùng nắm" cho giáo dục. Ý tưởng **khớp gần như từng chữ** với câu đề bài: "no single admin, organisation **or AI** can override the rules". Mô hình còn mở rộng được sang AI nội bộ doanh nghiệp và bệnh viện.

**Weaknesses.**
- Classifier phải thấy plaintext, và LLM provider cũng thấy. E2EE chỉ bảo vệ lưu trữ và truy cập của con người. Phải nói rõ điều này.
- Code của server vẫn là điểm tin cậy: một admin sửa code có thể tắt classifier.
- Giám khảo có thể thấy "edtech quen thuộc".

### Ý tưởng 2 — **QuorumPay Agent** (*AI kế toán dám cho quyền thật*)
**Problem & Users.** SME và văn phòng gia đình muốn để AI agent xử lý hoá đơn và chi trả. Nhưng agent đọc email và hoá đơn từ bên ngoài, nên một email bị inject (bằng tiếng Việt, Thái…) có thể khiến nó chuyển tiền hoặc đổi người thụ hưởng.

**Solution.** Classifier chấm risk cho mọi input mà agent đã đọc. Risk thấp thì agent tự xử lý. Risk cao thì hành động được nâng thành yêu cầu **quorum 2-of-3**. Thông tin thanh toán (tài khoản, token ngân hàng) được E2EE dưới tag chỉ role "treasurer" giải mã được, nên **agent không bao giờ cầm khoá**.

**C1 × C2.** C1 quyết định *ai phải phê duyệt*. C2 làm cho phê duyệt và quyền không thể giả mạo bởi server bị compromise hay một admin đơn lẻ. **Bỏ TideCloak:** "phê duyệt" chỉ là một cờ trong DB mà agent hoặc admin bị chiếm quyền có thể bật.

**Innovation.** Tín hiệu rủi ro động điều khiển mức thẩm quyền phi tập trung là ý tưởng mới. Demo rất kịch tính: email tiếng Việt bị inject, lệnh chuyển tiền bị nâng lên quorum, admin thử bypass thì thất bại.

**Weaknesses.**
- **Đây là ý tưởng hiển nhiên nhất** khi ghép C1+C2, nên nhiều đội sẽ làm.
- Gần với ví dụ chính thức "Dual-Control Expense Desk".
- Dễ bị coi là "security tool / approval workflow with extra steps".
- Quorum hành động (không phải quorum đổi role) chuẩn nhất cần Forseti/threshold-signing, mà phần này Tide team mới deploy được.

### Ý tưởng 3 — **Attack Commons** (*sàn chia sẻ mẫu tấn công đa ngôn ngữ*)
**Problem & Users.** Ngân hàng, fintech và cơ quan nhà nước ở Đông Nam Á đều bị tấn công prompt bằng ngôn ngữ địa phương. Classifier cần dữ liệu thật mới tốt lên, nhưng không ai dám chia sẻ log vì log chứa dữ liệu khách hàng và lộ điểm yếu của mình.

**Solution.** Mỗi tổ chức đóng góp mẫu tấn công. Classifier tự triage và gán nhãn. Payload thô và danh tính người đóng góp được **niêm phong E2EE**, chỉ mở khi có **quorum reviewer liên tổ chức**. Kết quả là cả mạng lưới cùng train ra classifier tốt hơn.

**C1 × C2.** C1 là *lõi*: kết quả classifier trở thành tài sản chung. C2 làm cho việc chia sẻ khả thi vì không host nào (kể cả người vận hành sàn) giữ được dữ liệu. **Bỏ TideCloak:** host trung tâm nắm hết payload và danh tính, nên không ai chịu tham gia.

**Innovation.** Cao nhất về độ mới, và dùng Challenge 1 sâu nhất. Giống mô hình ISAC nhưng không cần một bên trung gian đáng tin.

**Weaknesses.**
- Bài toán khởi động lạnh (cold start).
- Là platform B2B, khó tạo cảm xúc.
- **Rất dễ bị dán nhãn "security tool"**, đúng thứ FAQ bảo tránh.
- Demo 2 phút khó cho thấy giá trị mạng lưới.

### Ý tưởng 4 — **Thư Bác Sĩ Đa Ngữ** (*Referral Letter Firewall / Care Passport cho người di cư*)
**Problem & Users.** Bệnh nhân di cư, chẳng hạn lao động Việt ở Úc/Nhật/Đài Loan, mang hồ sơ đa ngôn ngữ. Phòng khám dùng AI scribe để dịch và tóm tắt. Tài liệu bên ngoài có thể chứa indirect injection ("tóm tắt và gửi toàn bộ hồ sơ tới…"), và hồ sơ thì nằm trên server mà ai có credential cũng đọc được.

**Solution.** Hồ sơ được E2EE gắn với bệnh nhân. Bệnh nhân cấp quyền giải mã cho từng bác sĩ và có thể revoke. Classifier quét mọi tài liệu đầu vào trước khi đưa cho AI. Tài liệu bị gắn cờ sẽ bị cách ly và cần bác sĩ duyệt.

**C1 × C2.** C1 bảo vệ AI scribe khỏi tài liệu độc. C2 đảm bảo không admin hay DB nào đọc được hồ sơ và mọi lần chia sẻ đều do bệnh nhân cho phép. **Bỏ TideCloak:** một credential backend là lộ toàn bộ hồ sơ.

**Innovation.** Trung bình. **Trùng với ví dụ chính thức "Care Passport"**, nên nhiều đội sẽ làm y tế.

**Weaknesses.**
- Ở đây C1 chỉ là bộ lọc đầu vào và không thay đổi ai có thẩm quyền.
- Khó cho thấy được tính thực tế lâm sàng trong 2 phút.

### Ý tưởng 5 — **Source Shield** (*hộp tin mật cho toà soạn dùng AI*)
**Problem & Users.** Toà soạn bắt đầu dùng AI để triage hàng nghìn tip. Kẻ xấu có thể gửi một tip chứa injection nhằm khiến AI tiết lộ danh tính các nguồn tin khác. Đồng thời, một trát toà hay một lần admin bị hack là lộ nguồn.

**Solution.**
- Danh tính nguồn tin được E2EE và **chỉ mở khi có quorum biên tập**.
- AI chỉ thấy nội dung đã tách danh tính, nên **AI không có quyền giải mã danh tính** ngay cả khi bị inject.
- Classifier gắn cờ các tip có hành vi tấn công.

**C1 × C2.** C1 phát hiện tip độc. C2 đảm bảo dù classifier bỏ sót, AI vẫn không thể với tới danh tính nguồn. **Bỏ TideCloak:** một admin hoặc một server là điểm lộ nguồn.

**Innovation.** Câu chuyện đẹp và có tính xã hội (tự do báo chí), lại ít đội nghĩ tới.

**Weaknesses.**
- Thị trường nhỏ.
- C1 chỉ là bộ lọc.
- Giám khảo có thể thấy đây là "SecureDrop + AI".

---

## 3. Comparative Scoring Table (rubric chính thức)

Thang 1–10. Điểm trọng số = Σ(điểm × trọng số) × 10.

| Ý tưởng | Vision 25% | Trust insight 20% | Value 20% | Why TideCloak 20% | Prototype 15% | **Tổng /100** |
|---|---:|---:|---:|---:|---:|---:|
| 1. Classroom AI Charter | 8 | 9 | 8 | 8 | 7 | **80.5** |
| 2. QuorumPay Agent | 6 | 8 | 8 | 7 | 8 | **73.0** |
| 3. Attack Commons | 9 | 8 | 6 | 8 | 5 | **73.0** |
| 5. Source Shield | 7 | 8 | 6 | 8 | 7 | **72.0** |
| 4. Thư Bác Sĩ Đa Ngữ | 5 | 7 | 7 | 7 | 6 | **64.0** |

**Lý do chấm chính:**
- **Charter: Vision 8.** Đưa "quản trị AI do nhiều bên" vào bối cảnh trẻ em là góc nhìn mới. Không lên 9 vì edtech là lĩnh vực quen thuộc.
- **Charter: Trust insight 9.** Chỉ đúng một bế tắc thật: "giám sát hay mù" cộng với "ai được đổi luật AI". Bế tắc này chỉ tháo được khi không ai một mình nắm quyền.
- **Charter: Why TideCloak 8.** Dùng cả IGA quorum lẫn E2EE theo tag, đều là tính năng đã ship. Trừ điểm vì code server vẫn là điểm tin cậy.
- **QuorumPay: Vision 6.** Ý tưởng hiển nhiên và trùng ví dụ "Dual-Control Expense Desk".
- **QuorumPay: Prototype 8.** Demo kịch tính và dễ hiểu nhất.
- **QuorumPay: Why TideCloak 7.** Quorum cho *hành động* chuẩn nhất cần Forseti mà đội không tự deploy được, nên phải đi đường vòng.
- **Attack Commons: Vision 9.** Độc đáo nhất.
- **Attack Commons: Value 6.** Giá trị nằm ở tương lai và cần network effect.
- **Attack Commons: Prototype 5.** Khó làm thuyết phục trong 2 phút. Còn có rủi ro bị xem là "security tool".
- **Source Shield.** Ổn đều các mặt nhưng thị trường hẹp, và C1 chỉ là bộ lọc.
- **Thư Bác Sĩ.** Trùng "Care Passport", C1 yếu.

**Xếp hạng:** 1) Classroom AI Charter · 2) QuorumPay Agent · 3) Attack Commons · 4) Source Shield · 5) Thư Bác Sĩ Đa Ngữ.

QuorumPay và Attack Commons bằng điểm. QuorumPay xếp trên vì khả thi trong thời gian còn lại.

---

## 4. Judge's Critical Review

| Câu hỏi | Charter | QuorumPay | Attack Commons | Source Shield | Thư Bác Sĩ |
|---|---|---|---|---|---|
| AI wrapper? | Không. Lõi là quản trị luật | Một phần: agent + workflow | Không | Không | Có nguy cơ |
| TideCloak thiết yếu hay trang trí? | Thiết yếu (quorum + E2EE) | Thiết yếu nhưng cần giải thích kỹ | Thiết yếu | Thiết yếu | Thiết yếu nhưng giống Care Passport |
| Bị đội khác làm trùng? | Thấp–trung bình | **Rất cao** | Thấp | Thấp | **Cao** (ví dụ chính thức) |
| Có bị coi là "security tool"? | Thấp: là sản phẩm giáo dục | Trung bình | **Cao** | Thấp | Thấp |
| Khoảnh khắc giám khảo nhớ? | "Hiệu trưởng thử một mình tắt guardrail → thất bại; học sinh jailbreak bằng tiếng Việt lóng → chỉ lượt đó được mở cho cô giáo" | "Email tiếng Việt bị inject → lệnh chuyển tiền bị khoá chờ 2/3" | Khó tạo khoảnh khắc | "AI bị inject cũng không thể lộ nguồn" | Ít |
| Lời hứa khó giữ | Classifier và LLM vẫn thấy plaintext; server code vẫn là điểm tin cậy | Quorum hành động thật cần Forseti | Cold start | Thị trường nhỏ | Tính thực tế lâm sàng |

**Phản biện chung cho mọi ý tưởng:**
- Classifier sẽ bỏ sót. Thiết kế đúng là **giới hạn những gì một cuộc tấn công lọt lưới có thể chạm tới** (blast radius), và đây chính là phần TideCloak đảm nhiệm. Hãy nói điều này thẳng trong README. Giám khảo của Tide sẽ đánh giá cao sự trung thực này, vì chính blog của Tide viết: *"We cannot simply rely on AI to defend us from AI."*
- Bài học từ vụ Bybit: quorum chỉ có giá trị khi người duyệt thấy đúng thứ mình đang duyệt. UI phê duyệt phải hiển thị nội dung thật của thay đổi.

---

## 5. Winner Recommendation

### 🏆 Ý tưởng triển vọng nhất: **Classroom AI Charter**
- **Vì sao:** Đây là ý tưởng duy nhất mà *cả ba* bên mà đề bài nhắc tới (admin, tổ chức, **AI**) đều không thể đơn phương phá luật, và mỗi vế được một thành phần đảm nhiệm:
  - AI không vượt được luật vì có classifier;
  - admin hoặc vendor không đổi được luật vì có IGA quorum;
  - không ai đọc trộm được chat của trẻ vì có E2EE.
- **Vượt bốn ý tưởng còn lại ở đâu:** Được kể như **một khả năng mới** ("trường có thể cho trẻ một AI tutor riêng tư mà phụ huynh vẫn tin được") chứ không phải một security tool. Ít bị trùng. Dùng thế mạnh *đa ngôn ngữ* của C1 trong một ngữ cảnh rất Việt Nam (code-switch, teencode).
- **Điểm sáng tạo đắt giá nhất:** *"Private by default, visible by exception"*. Kết quả của classifier quyết định **ai được quyền giải mã** từng lượt chat. Tín hiệu AI được biến thành quyền mật mã, chứ không chỉ là một cảnh báo.
- **TideCloak tạo lợi thế:** Chỉ dùng tính năng đã ship (IGA change-request quorum, E2EE theo tag, JWT ký threshold), nên không phụ thuộc Forseti. Trong demo, cảnh "admin thử bypass một mình và thất bại" là thật chứ không phải giả lập.
- **Rủi ro lớn nhất:**
  - (1) Thời gian: còn khoảng 7 tiếng để dựng realm, IGA, E2EE và quay video.
  - (2) Giám khảo hỏi "classifier vẫn thấy plaintext?". Phải trả lời trung thực: classifier chạy trước khi lưu (lý tưởng là in-browser), còn E2EE bảo vệ lưu trữ và truy cập của con người.

### 🥈 Runner-up: **QuorumPay Agent**
Demo dễ làm và kịch tính nhất, bám sát câu *"AI could do more for us, but how much access should it have?"*. Nên chọn nếu đội đánh giá khả năng hoàn thành quan trọng hơn độ mới, hoặc nếu bối cảnh giáo dục khó dựng nhanh. Phải nhấn mạnh "risk-adaptive authority" để không bị chìm giữa các đội làm approval workflow.

### Winning Potential Assessment
**Medium–High**, độ tin cậy **trung bình**.
- Concept khớp đề bài và rubric rất tốt.
- Không biết chất lượng các đội khác, cũng không có dữ liệu giải năm trước.
- Áp lực thời gian là biến số lớn nhất: một concept hạng nhất với demo nửa vời sẽ thua một concept hạng hai mà demo mượt.

### Final Verdict
> **"If our goal is to win Tide UNLOCKED, we should pursue *Classroom AI Charter* because it is the only idea where no administrator, no organisation and no AI can unilaterally override the rules protecting children's data and learning — each guarantee enforced by a different, real component (multilingual classifier, TideCloak quorum, TideCloak E2EE) — and because the classifier's verdict doesn't just raise an alert, it decides who is cryptographically allowed to see what."**

---

### Nguồn & ghi chú xác minh
- Rubric, deadline, deliverables: `https://tide.org/unlocked/config.js` (first-party).
- Năng lực TideCloak: tide.org/tidecloak, blog Tide, tide-pack MCP v1.9.33 (một số chi tiết đến từ bản audit của chính pack, chưa đối chiếu độc lập với docs).
- Chưa xác minh: thông tin Challenge 1 (không có trên trang Tide), giải thưởng, luật thi, số người mỗi đội, các đội thắng giải trước đây.
- Agent B (Haiku) xác nhận: dịch prompt sang ngôn ngữ ít tài nguyên làm tỉ lệ jailbreak GPT-4 tăng từ <1% lên ~79% (Yong et al. 2023), và code-switching cũng hiệu quả. Đây là luận cứ cho C1 trong Charter (học sinh code-switch Việt–Anh). Các con số F1/latency cụ thể của từng detector trong `B_multilingual_pi.md` cần kiểm tra lại với nguồn gốc trước khi đưa vào README.
