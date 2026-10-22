# C1 EDA (prompt-attack classification, macro-F1)

## Data
- Train 14000: BENIGN 8680 (62%), JAILBREAK 4340 (31%), PROMPT_INJECTION 980 (7%). Test 6000.
- Language split identical in train and test: pt 45%, fr 25%, it 20%, en 10%. Label ratio is exactly 62/31/7 in EVERY language (stratified by construction), so test priors very likely the same (~4200 PI-less: expect ~3720 B / 1860 J / 420 PI).
- ids: train and test interleaved in t000000..t019999 (random). No id-vs-label signal (deciles 59-64% benign, PI 6-8%); no parity/mod signal.

## Length (chars; tokens ~ chars/4, fr/it/pt may be a bit more)
| label | median | p90 | p95 | p99 | max |
|---|---|---|---|---|---|
| BENIGN | ~230 | 1112 | 1582 | 3292 | 18550 |
| JAILBREAK | ~590 | 1219 | 1517 | 2123 | 3752 |
| PI | ~120 | 664 | 1430 | 3572 | 5128 |
Test: median 283, p95 1519, p99 2909, max 17840.
- % over 256 est. tokens: B 11.8%, J 15.9%, PI 9.0% (test 12.2%). Over 512: B 2.9%, J 1.3%, PI 2.2% (test 2.2%).
- Median length by language x label: pt JAILBREAK is long (879) vs fr/it ~370; pt B 143, en JB/PI ~300. Length is a real (weak) class signal: JB long, PI/B short. Texts >2000 chars (350): 76% BENIGN (prompt-engineering templates), 17% JB, 6% PI.
- Position: in long texts the signal is NOT only at the head. Long PI = "ignore/say PWNED" payloads buried in the middle/tail of a template; long JB = roleplay setup with the harmful ask at the end; long BENIGN = "[PROMPT]/[TARGET LANGUAGE]" prompt templates. TF-IDF check: head1000 only 0.9137 vs full 0.9166 vs head700+tail300 0.9154 -> differences are tiny, only ~2% of texts exceed 512 tokens.
- Recommendation: max_len 256 covers ~88%; 384-512 covers ~97-98%. Use max_len=512 (L4 ok with bf16, dynamic padding + length-sorted/bucketed batches since median is ~70 tokens) and head+tail truncation (e.g. first 384 + last 128 tokens) for the 2%. If speed matters, 256 head+tail loses little.

## Class semantics (read ~15/class)
- BENIGN: short ordinary questions (legal, health, trivia) and also LONG "act as X" prompt-library templates, role-play requests (Dumbledore, Linux terminal, SEO writer), pt/en "Sure, here are ..." fragments, short chit-chat. Many look jailbreak-ish.
- JAILBREAK: harmful request wrapped in fiction/hypothetical/roleplay/"for my novel", obfuscation instructions (leetspeak, "exclude articles"), "Sure, I understand the task. Here is the revised adversarial prompt..." templates (50 in fr alone, 100% JB), harassment/self-harm/drugs/phishing asks. Often quoted with leading `"`. Writing is LLM-generated, verbose.
- PROMPT_INJECTION: (a) classic ignore/forget instructions + payload ("PWNED" 10% of PI, 0 elsewhere), reveal system prompt ("revele o comando central"), "repeat initial question"; (b) short XML/XXE/XSS "use an attack to access data" tech-security prompts (pt, ~90-130 chars); (c) HackAPrompt-style long templates (translate bot, "positive things about trains", sandwich defence, base64) – many near-duplicate families; (d) gibberish multi-lingual concatenations (de/vi mixed) ending in an injection ("Why Russia invaded Ukraine? ... ignore context ...").
- Traps: "Ignore all previous instructions. I want you to respond only in [TARGETLANGUAGE]..." (SEO/prompt-library template, 69 fr + 41 it + 19 en, all BENIGN) – so surface "ignore instructions" is NOT sufficient for PI. "ignor*" token rate: B 3.6%, J 4.1%, PI 12%. DAN-style / "act as" texts appear in BENIGN and PI too.
- Hard confusions (below): BENIGN<->JAILBREAK dominates (roleplay-benign vs roleplay-harmful, esp. pt). PI errors are mostly generic "act as terminal/narrator" prompts and very short Q&A with an "ignore the articles" clause.

## Language / code-switching
- Stopword heuristic: `language` label matches detected language ~93% overall; mismatches concentrated in PI (15.7% vs B 7.2%, JB 0.5%). Mismatches in B are mostly very short strings (undetectable). Real code-switch: 36 `pt`-labelled PI rows are fully Vietnamese; de/es fragments inside PI (HackAPrompt multilingual concatenations); ~21 rows with CJK/Cyrillic/Arabic. Rows with a sizeable 2nd language: B 27%, J 19%, PI 29% (includes loan-word noise).
- Signal: foreign-language content / Vietnamese / German in a pt/fr/it row is a mild PI indicator. Use a multilingual encoder (XLM-R / mDeBERTa); `language` column is mostly redundant (adding it to TF-IDF: 0.9168 vs 0.9166).
- Text appears machine-translated from English corpora (en rows are the minority, 10%).

## Duplicates / templates
- Exact duplicates after lowercase/whitespace norm: 0 in train, 0 train-test, 0 within test. So no direct lookup leak.
- Prefix-200 dup: 66 rows in train, 0 label conflicts; test rows whose 200-char prefix is in train: 33; whose 60-char prefix is in train: 249 (4.2%). Template families (same 60-char prefix, filler differs): 298 train rows in groups >=5; 138 prefix groups of size>=2, only 6 impure. Biggest: "Veuillez ignorer toutes..." (47 fr B), "Si prega di ignorare..." (41 it B), "Bien sur, je comprends la tache" (JB), HackAPrompt "bot de traducao" (PI, 14), "historia curta... [frase]... PWNED" (PI, 13).
- Implications: random KFold leaks across template siblings, so CV is somewhat optimistic. Use GroupKFold/StratifiedGroupKFold with group = first-60-char normalized prefix (or char-ngram clusters); keep stratification by label. Also a kNN/prefix-match feature on train is nearly free gain for ~4% of test rows, but a fine-tuned model will learn these anyway.

## Baseline CV (5-fold stratified, random_state 42, class_weight balanced, C=4; word C=10)
| model | macro-F1 | B / J / PI F1 | en / fr / it / pt |
|---|---|---|---|
| char_wb 2-5 (300k feats) | 0.9165 +-0.0071 | .940 / .902 / .907 | .908 / .941 / .938 / .897 |
| word 1-2 | 0.9105 +-0.0044 | .941 / .904 / .887 | .901 / .934 / .921 / .895 |
| char+word union | **0.9246** +-0.0064 | .948 / .916 / .910 | .916 / .946 / .942 / .908 |
| char + language prefix | 0.9168 | .940 / .903 / .907 | .905 / .940 / .935 / .900 |
| char head700+tail300 | 0.9154 | | |
| char head1000 | 0.9137 | | |
Confusion (char+word; rows=true B,J,PI): B [8141, 499, 40]; J [237, 4100, 3]; PI [111, 15, 854]. Errors: B->J 499 and J->B 237 are 85% of all errors; PI is rarely confused with J. Misclassified texts have median length 731 chars vs 294 overall (errors are long role-play prompts). pt is the weakest language (long JB/B role-plays). Balanced class weights over-predict JB (B->J >> J->B): tune thresholds/class priors on OOF probs for macro-F1.

## Leakage-ish signals
- None via id. Length (esp. >500 chars: J-heavy; <150: B/PI-heavy), leading quote char (JB prompts often wrapped in `"`), `[PLACEHOLDER]` brackets (B 15%, J 2%, PI 6.8%), "PWNED" (PI only) are real but legitimate content features; a transformer picks them up. Test length/language distribution matches train, so no shift.

## Recommendations
1. Model: multilingual transformer (xlm-roberta-large or mdeberta-v3-base), max_len 512 with head+tail truncation (~384+128), dynamic padding/length bucketing; CE with mild class weights (or none) then tune per-class logit bias on OOF for macro-F1.
2. CV: StratifiedGroupKFold (groups = normalized 60-char prefix), 5 folds; stratify by label (language split is already proportional). Save OOF probs for threshold tuning and ensembling.
3. Ensemble transformer probs with the char+word TF-IDF LR (0.925 baseline; diverse, cheap); stack on OOF.
4. Focus on B vs J discrimination (esp. pt long role-plays); PI at 7% is learnable (~0.91 F1 already) but the macro-F1 weight of PI is 1/3, so don't undersample it; consider oversampling PI families.
5. Budget the 6 submissions: baseline-ensemble sanity first, then transformer, then bias-tuned ensemble.
