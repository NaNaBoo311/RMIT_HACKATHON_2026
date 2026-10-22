# AIgree: video script (docs/demo.mp4)

**Length:** 1:56. **Resolution:** 1280×800, 30 fps, no audio. Screen recording of the app, made with Playwright.

**Production notes:**
- Waiting periods (signing, the assistant thinking) are fast-forwarded.
- The rest plays at about 1.6× speed.
- Use this file to write subtitles and a voice-over. The timestamps match the video.

## What the video shows (one sentence)

A doctor can read a patient's records, and ask an AI assistant about them, only after the patient consents and the hospital co-signs in TideCloak. The assistant only ever sees what was unlocked. Access ends when the visit ends.

## People on screen

| Name | Role |
|---|---|
| Dr Lê Minh | Doctor (Ophthalmology, Endocrinology) |
| Nguyễn Thị Lan | Patient |
| An Khang Hospital | Hospital account: co-signs access, cannot read records |

## Scene by scene

| Time | What is on screen | Suggested subtitle / narration |
|---|---|---|
| 0:00–0:07 | Sign-in page. Dr Lê Minh signs in. | "Meet AIgree: medical records that nobody can read without the patient's consent, not even the hospital." |
| 0:07–0:11 | "My visits". Dr Minh types Lan's CCCD (ID number) and finds her. The ID is shown masked, and Ophthalmology is selected. | "Dr Minh needs Lan's records for an eye appointment. He finds her by ID number, which the system only ever shows masked." |
| 0:11–0:19 | He books the visit. "Waiting for the patient to approve." | "Booking a visit is only a request. Nothing is unlocked yet." |
| 0:19–0:29 | The visit page: status "waiting for patient", and every record compartment is locked. | "Right now the doctor sees only locked records. Every record is encrypted in the browser, and the server stores nothing but ciphertext." |
| 0:29–0:32 | Lan signs in. Her request reads "Dr Lê Minh (Ophthalmology) requests your Eye records and Essentials", and she clicks Approve. | "Lan sees exactly who is asking, for which records, and for how long. She approves." |
| 0:32–0:39 | The hospital account signs in and opens its co-sign queue. | "Her consent alone is not enough, and neither is the server: the hospital must co-sign." |
| 0:39–0:44 | The hospital clicks "Co-sign", then approves in the Tide enclave dialog. The message reads "Signed … grants". | "The hospital approves in TideCloak's enclave. It signs an access policy naming one doctor, one compartment and an expiry. The hospital itself holds no decryption role and still cannot read anything." |
| 0:44–0:51 | Dr Minh is back. Eye and Essentials records decrypt in his browser, with a watermark of his name and the time. Endocrine stays locked. The assistant panel appears. | "Now the records decrypt, in the doctor's browser only, and only the compartments Lan approved. Endocrine stays locked." |
| 0:51–1:03 | **Assistant, question 1:** "Is it safe to prescribe amoxicillin? Also summarise her eye findings." It warns about the penicillin allergy and summarises the eye exams, with numbered citations [1] [2] [3] that match record badges. | "The AI assistant answers only from the records the doctor can see, and cites each one. It catches the penicillin allergy. Assistive only, not a diagnosis." |
| 1:03–1:12 | **Assistant, question 2:** "How well controlled is her diabetes?" The assistant says the HbA1c data is in the Endocrine compartment, which is locked. A banner reads "This question may need Endocrinology records" with the button **Request access from patient**. | "The assistant cannot reach locked data, even with a prompt. It says so and offers to ask the patient." |
| 1:12–1:24 | Dr Minh clicks "Request access from patient", and it shows "request pending". Lan signs in and approves the extra Endocrine request. | "One click sends a request to Lan, and she approves Endocrine for this visit only." |
| 1:24–1:45 | The hospital co-signs the new Endocrine grant in the Tide enclave. Dr Minh returns, and the Endocrine records ("Type 2 diabetes review – HbA1c 7.8%", "Metformin dose adjustment") now decrypt. | "The hospital co-signs again, and the Endocrine records open." |
| 1:45–1:52 | **Assistant, question 3:** "How well controlled is her diabetes?" It answers that HbA1c 7.8% is above target, metformin was increased, and there is mild retinopathy, with citations [1]–[4]. | "Asked again, the assistant now answers fully, with every claim traced to a record." |
| 1:52–1:56 | Dr Minh clicks **End visit**. In "Grants for this visit", Eye, Essentials and Endocrine all turn **revoked**. | "When the visit ends, every grant is revoked. Access followed the visit, not the job title." |

## Key messages to land in the voice-over

1. Every record is encrypted in the browser, and the server and database hold only ciphertext.
2. Access needs two parties: the patient consents and the hospital co-signs in TideCloak. Neither the server nor the hospital can grant or read on its own.
3. Access is scoped to one doctor, one compartment and one visit, and is revoked when the visit ends.
4. The AI assistant has exactly the doctor's access. It cannot see locked compartments, it cites its sources, and it is assistive only.

## Suggested closing line

"AIgree: agree first, then AI reads."
