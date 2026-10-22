# C1 x C2 idea candidates (classifier signal -> TideCloak authority/custody)

## Verified facts (tide.org/unlocked, docs.tide.org)
- Challenge 2 judging: "does TideCloak fundamentally change what the app can credibly accomplish? If it would work identically with standard login + backend permissions, judges expect more." So every idea needs a "remove TideCloak -> what breaks" answer.
- The unlocked page fetch showed only the Challenge 2 text (no Challenge 1 detail) and said submissions closed. Check the deadline with the team before investing.
- docs.tide.org confirms: BYOiD auth, quorum-enforced governance, role-based access, threshold key custody, E2E encryption, React/Next/JS/C# SDKs, Docker. The Forseti contract and change-request (admin approval) details were not re-verified in the docs I fetched. The tide-pack MCP notes that custom Forseti contract deployment is NOT self-service (Tide team deploys it), so prefer built-in quorum change requests plus roles for the demo and treat Forseti as a stretch.
- Division of labour used throughout: the classifier only DETECTS (risk score + attack type + language). TideCloak decides who may act (roles, quorum approvals) and who holds keys (identity-bound encryption). TideCloak never stops an injection itself. The app wiring is what turns a score into an escalation.
- Common honest caveat: the classifier has false negatives. The design goal is therefore blast-radius limiting: even a missed attack cannot exercise authority or read keys the agent never held.

---

## 1. QuorumGate for Agents
- Pitch: An AI agent runs with a low-privilege Tide identity; when the classifier flags its input context as risky, any high-impact tool call (payment, export, deploy) needs a threshold quorum of humans.
- Problem/users: Enterprises/finance teams deploying tool-using agents. One injected email can trigger a wire or data export, and today a single service account or admin can approve.
- How: Agent ingests content -> C1 scores it. Low risk: agent acts within its role. Medium: single human approves. High/unknown language: action becomes a TideCloak change request needing e.g. 2-of-3 approvers. Approvals are cryptographically bound to the exact action payload.
- C1 role: Per-input risk score + attack category sets the approval tier.
- TideCloak role: Agent identity with minimal roles; quorum approval enforced by the Tide network; the agent's elevated token/capability only exists after quorum.
- Why both: Classifier without TideCloak = a warning someone can ignore or a server flag an attacker flips. TideCloak without classifier = approvals for everything (fatigue) or nothing.
- Remove TideCloak -> breaks: The "approval" is a DB row/ backend check; a compromised backend or lone admin can mint it. No cryptographic proof that N humans approved this exact action.
- Novelty/competitors: Agent guardrail products (Lakera, Prompt Security, Invariant) flag/block; human-in-the-loop in LangGraph is single-approver and server-trusted. Risk-adaptive quorum is the differentiator.
- Weakness: Requires the demo to show a convincing real action; easiest to look like "approval workflow with extra steps" unless the cryptographic binding is shown.

## 2. Tainted-Context Vault (risk-gated decryption)
- Pitch: Sensitive data is E2E-encrypted per identity; an agent session whose context the classifier has flagged cannot get decryption of the sensitive tags without human/quorum release.
- Problem/users: Teams giving agents access to HR, legal, customer data. Injected agents target exfiltration; server-held keys mean the agent (and ops) can read everything.
- How: Docs tagged (e.g. `pii`, `legal`) encrypted client-side using TideCloak identity-bound encryption. Agent requests decrypt for a task. Session "taint" = max C1 risk across ingested content. Tainted sessions are routed to decrypt-with-approval; clean sessions get only the tags their role allows.
- C1 role: Session taint level (multilingual docs, web pages, emails).
- TideCloak role: Key custody (no server holds keys), tag/role-scoped decrypt rights, quorum for elevated release.
- Why both: Classifier decides when the risk is high; TideCloak makes "no decrypt" real rather than a policy an infra admin can bypass.
- Remove TideCloak -> breaks: Keys sit in a KMS/server the injected agent's runtime (or an insider) can call; the gate is advisory.
- Novelty: Confidential-computing/KMS vendors gate by role, not by live injection risk; no one ties decrypt to taint tracking.
- Weakness: Taint is coarse (one flagged doc taints the whole session); UX of re-requesting decrypt may annoy; depends on SDK tag-level control being as granular as assumed.

## 3. Remittance Concierge (multilingual bank/fintech assistant)
- Pitch: A Vietnamese/Tagalog/Arabic-speaking customer-service LLM for migrant remittances where socially-engineered or jailbreak prompts escalate account actions to bank officers' quorum.
- Problem/users: Migrant workers and small fintechs; multilingual attacks slip past English-centric guardrails; support-desk staff and LLM ops can see customer data.
- How: Customer chats; C1 classifies each turn (any language). Safe: assistant may do read-only. Account-changing or beneficiary-change requests with risk>threshold require 2-of-3 officer approval. Customer PII/transcripts are encrypted to the customer's Tide identity; staff see only after customer consent or quorum.
- C1 role: Multilingual attack detection on live chat, strongest where English tooling fails.
- TideCloak role: Customer-bound encryption; officer quorum for risky beneficiary/limit changes; no single admin can alter limits.
- Why both: Multilingual detection is the stated Challenge 1 strength; high-stakes sector needs non-bypassable authorization.
- Remove TideCloak -> breaks: Back-office staff/DBA can read transcripts and force a beneficiary change alone; no customer-bound privacy.
- Novelty: Banks use fraud engines + single-agent approval; threshold-signed approvals and customer-held keys are unusual.
- Weakness: Overlap with idea 1 (finance flavor); needs a credible fake bank backend.

## 4. Guardrail Constitution Council (school AI tutor)
- Pitch: In a school, the AI tutor's guardrails and system prompt can only be changed by a teacher + parent-rep + IT quorum, and student attack telemetry is protected from any single admin.
- Problem/users: Schools/ed-tech, students (minors), parents. A single admin (or hacked admin) can weaken the tutor's rules or browse children's chats; students jailbreak tutors in many languages.
- How: C1 runs on student prompts (multilingual). Detected attacks are logged to an encrypted audit trail. Weakening a guardrail, changing the system prompt, or lowering the C1 threshold is a change request needing quorum. Per-student logs are only decryptable by the student's guardian (or quorum).
- C1 role: Detects student jailbreaks; its threshold is itself a governed parameter.
- TideCloak role: Quorum governance of the safety config, identity-bound encryption of minors' chats.
- Why both: Detector is only trustworthy if nobody alone can turn it down; TideCloak provides that.
- Remove TideCloak -> breaks: One admin edits the config silently or reads a child's logs.
- Novelty: Ed-tech AI platforms (Khanmigo etc.) have admin consoles with single-admin control; quorum-governed safety config is new.
- Weakness: Classifier role is more "telemetry" than "decision changing who authorizes actions"; weaker link than 1/2.

## 5. Referral Letter Firewall (clinical AI scribe)
- Pitch: Incoming multilingual referral letters/PDFs are screened for hidden injections before an AI scribe can read them; any release of a summary outside the clinic needs patient + clinician approval.
- Problem/users: Clinics, hospitals, patients. Documents from outside are untrusted input to a scribe that has access to patient records; the scribe is a high-value exfiltration target.
- How: Intake -> C1 on extracted text (any language) -> clean docs go to the scribe in a sandbox with the patient's records decrypted only for that patient's session; flagged docs go to a clinician quarantine queue. Outbound sharing (to insurer, other provider) is a change request needing patient identity signature + clinician.
- C1 role: Scores inbound document text for embedded instructions.
- TideCloak role: Patient-identity-bound record encryption, scoped decrypt for the scribe, dual approval for disclosure.
- Why both: Classifier protects the AI's inputs; TideCloak limits what a fooled scribe could ever reach or send.
- Remove TideCloak -> breaks: One backend credential gives the scribe (or an attacker) all patients' records; disclosure isn't patient-authorized.
- Novelty: Health-AI vendors stress HIPAA access controls, not patient-held keys with injection-aware release.
- Weakness: Healthcare realism and compliance claims; hard to prove in 2 minutes.

## 6. Attack Commons (private multilingual threat-intel exchange)
- Pitch: Organizations contribute anonymized multilingual prompt-attack samples to a shared corpus that only a reviewer quorum can unseal, so the attack data helps everyone without being a leaked weapon or deanonymizing contributors.
- Problem/users: Security teams, AI vendors, researchers. Sharing attack payloads and incident context is risky (they reveal internals and are weaponizable) so people don't share.
- How: Contributor submits a sample; C1 labels category/language and a risk class to triage. Samples encrypted client-side; the aggregate can be queried for classifier retraining by an approved role; raw payloads of high-severity class are decryptable only by a reviewer quorum. Contributors authenticate via BYOiD without revealing their org.
- C1 role: Labels/triages samples and measures coverage across languages; the corpus improves the classifier itself.
- TideCloak role: Anonymous-but-authenticated contributors, encryption with threshold custody, quorum unseal.
- Why both: Classifier turns raw submissions into a structured, severity-ranked dataset; TideCloak is what makes people willing to submit.
- Remove TideCloak -> breaks: A central operator (and any breach) holds all raw payloads and contributor identities.
- Novelty: ISACs/CTI platforms (MISP) exist but rely on a trusted central host; no prompt-attack-specific one.
- Weakness: Cold-start network effect; the "app" is more platform than end-user product.

## 7. Tool-Poisoning Gatekeeper (MCP / agent tool registry governance)
- Pitch: Adding or changing an agent tool/MCP server needs a quorum, and the classifier pre-screens tool descriptions in any language for poisoned instructions to set how many approvers are needed.
- Problem/users: Platform and DevSecOps teams. Tool descriptions and updates ("rug pulls") are an injection vector; a single maintainer can approve a malicious tool.
- How: Proposed tool/manifest -> C1 scans descriptions/schemas/returned samples -> risk tier. Low: one approver; high or changed since last approval: 2-of-3 including a security role. Approved manifest hash is what the agent identity is permitted to call.
- C1 role: Scans tool metadata and sample outputs; re-scans on change.
- TideCloak role: Quorum-approved, tamper-evident tool allowlist; agent roles bound to it; no one admin can widen the agent's powers.
- Why both: Detection without enforced approval is a warning; approval without detection is rubber stamping.
- Remove TideCloak -> breaks: Registry admin (or compromised CI) edits the allowlist alone.
- Novelty: MCP security scanners (Invariant, Snyk-style) detect; they don't make approval threshold-enforced.
- Weakness: Developer-tool audience, less emotive demo; overlaps with idea 1's mechanism.

## 8. Citizen Casework Assistant (government benefits, multilingual)
- Pitch: An AI assistant helps caseworkers process applications in many languages; uploaded documents are screened, and flagged cases and any access to citizens' files need quorum break-glass.
- Problem/users: Agencies, caseworkers, citizens. Applications are adversarial input (people try to instruct the AI to approve); officials browsing files is a known insider problem.
- How: Upload -> C1 scan. Clean: AI drafts a recommendation only; flagged: caseworker queue, AI disabled for that file. Citizen files are encrypted to the citizen's identity; caseworker access is role-scoped; broad searches or bulk exports require a supervisor quorum with a tamper-evident log.
- C1 role: Screens documents for embedded AI instructions and tags language.
- TideCloak role: Citizen-identity encryption, role-scoped access, quorum for break-glass and for final approvals above a threshold.
- Why both: Government needs both safe automation and insider-proof access.
- Remove TideCloak -> breaks: Any DB admin or caseworker can read or alter files; "approved" decisions can be forged by one insider.
- Novelty: Gov-tech case systems use RBAC and audit logs; cryptographic quorum for access plus injection-aware routing is new.
- Weakness: Broad, process-heavy; hard to show a crisp 2-minute moment.

## 9. Source Shield (journalist tip inbox)
- Pitch: Anonymous multilingual tips and leaked documents are screened for AI-targeting payloads before an AI triages them, and a source's identity can only be unsealed by an editorial quorum.
- Problem/users: Newsrooms, investigative journalists, sources. Leaks arrive in many languages, may carry hidden injections aimed at newsroom AI tools, and source protection depends on not trusting one editor/IT admin.
- How: Tip submitted with source key; C1 scans text in any language; clean docs summarized/translated by AI; flagged docs shown raw to a human only. Source identity/contact encrypted; unsealing requires e.g. 2 senior editors (and logged).
- C1 role: Gate between hostile documents and the newsroom's AI translation/summarization.
- TideCloak role: Source anonymity via identity-bound encryption, threshold unseal of identity.
- Why both: AI triage is only usable if its inputs are screened; source protection must survive a compromised server or coerced admin.
- Remove TideCloak -> breaks: A subpoena or breach of one server/admin reveals sources.
- Novelty: SecureDrop is the incumbent for submission; it has no AI triage layer nor threshold unseal.
- Weakness: C1 role is a pre-filter (less "changes who authorizes"); audience small.

## 10. Guardian Circle (personal AI assistant with family co-signers)
- Pitch: A personal AI assistant (for an older relative or anyone) can only send money, share files, or change settings with a co-sign from 2 trusted "guardians" when the classifier flags the messages it just read.
- Problem/users: Consumers, especially elderly and non-English speakers; assistants that read email/chat can be hijacked by scam messages with embedded instructions.
- How: Assistant reads inbox/messages; C1 scores each (multi-language). High risk: any outbound money/data action is held and sent as a request to guardian devices; threshold approval (e.g. 2-of-3) releases it. Personal documents are encrypted to the user's identity; guardians cannot read them, they only approve actions.
- C1 role: Per-message attack score that triggers the co-sign requirement.
- TideCloak role: Social quorum with no central company holding keys or able to override; user-held encryption.
- Why both: Classifier chooses when to involve family; TideCloak makes the co-sign real and private.
- Remove TideCloak -> breaks: The app vendor holds the keys and can approve or read; approvals are server flags.
- Novelty: Bank scam alerts and "trusted contact" features are advisory/single-contact; threshold co-sign for AI actions is new.
- Weakness: Scam detection is broader than prompt-attack classification, so the fit is partial (must be framed as injection against the assistant, not general fraud).

---

## Top 3 (my ranking)

1. **QuorumGate for Agents (#1), with the vault from #2 as the second beat.** It is the cleanest embodiment of "risk signal changes WHO must authorize." The demo is vivid: inject a multilingual payload via an email, watch the agent's wire request flip from auto to 2-of-3 approval, and show the quorum approving the exact payload. Failure without TideCloak is easy to explain (a compromised backend forges approval). Add one slide on key custody: the agent never held the keys to the sensitive tag (#2) so a missed attack still cannot read it. Build effort is moderate and fits any sector skin.
2. **Remittance Concierge (#3).** It showcases Challenge 1's differentiator (multilingual, beyond English guardrails) in a sympathetic, concrete setting, and TideCloak is load-bearing twice: customer-bound encryption and officer quorum. It is #1 with a story that judges remember, and could be the skin for the same engine.
3. **Attack Commons (#6).** The most different from the crowd and the only one where the classifier output becomes a shared asset; TideCloak's anonymity + threshold unseal solves the real reason people don't share attack data. Riskier (cold start, platform feel) but high originality if the field is full of agent-approval demos.

Honorable mention: #4 (quorum-governed safety config) as a feature inside any of the above, since it answers "who can turn off the detector?"
