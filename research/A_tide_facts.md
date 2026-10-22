# Tide UNLOCKED: facts report (researched 2026-10-22)

## 0. Key caveat
The official page https://tide.org/unlocked/ is JS-rendered. Judging criteria, ideas and FAQ were extracted from its own data file https://tide.org/unlocked/config.js (and app.js), which the page loads. That is first-party source text. The page itself says "Submissions have closed" (see deadlines; the page's countdown is client-side, so this may just reflect the local clock).

## 1. Competition facts
Source for all of section 1: https://tide.org/unlocked/ + https://tide.org/unlocked/config.js
- Name: "UNLOCKED | Challenge 2 of the RMIT hackathon". Footer: "UNLOCKED is Tide's challenge for the RMIT hackathon: Challenge 2." Industry challenge.
- Challenge 1 (Multilingual Prompt-Attack Classification): NOT on this page. UNVERIFIED anywhere; a web search found nothing on it. The page only describes Challenge 2.
- Headline: "What would you build if trust stopped being the bottleneck? Build a small working prototype with TideCloak integrated that shows one compelling possibility. No cybersecurity or cryptography experience needed."
- Mission (verbatim): "Choose a possibility held back by that trade-off. Build a prototype using TideCloak where no single administrator, organisation or AI can unilaterally override the rules protecting people's data and decisions. Show how that changes what your app makes possible." / "Bring a working prototype with TideCloak integrated. Demonstrate one new possibility and explain why removing unilateral control makes it possible."
- Framing examples on page: "Hospitals could discover more together, but who controls the shared records? AI could do more for us, but how much access should it have? Communities could govern shared resources, but who gets the final say?"
- Four steps: (1) choose a possibility, (2) connect coding agent to Tide's MCP server, (3) build with TideCloak "using synthetic data and mocked systems", (4) demo and submit. Plan B: TideCloak Quickstart template (https://docs.tide.org/get-started/Tidecloak%20Quickstart), works with any model or no AI.
- Build: "Small, but working, with TideCloak integrated. Focus on one convincing demonstration... A finished product isn't expected." Synthetic/mocked data is explicitly allowed and expected for sensitive domains. AI coding tools are "the intended workflow".

### Deliverables (both in a public GitHub repo; link submitted via Google Form https://forms.gle/HRHYjnqB86j1LFS97)
1. Public GitHub repo with code (TideCloak integrated) and the demo video.
2. README starting with a "Project overview", 300 words or fewer, answering five prompts that match the judging criteria (template copy button on page). Setup instructions go in a separate section.
3. Two-minute demo video, .mp4 inside the repo, under 100 MB. Suggested structure: (1) The possibility, (2) The constraint (what trust problem holds it back today), (3) The prototype (show it working, and TideCloak's role), (4) What changes (what's now possible for users).

### Judging criteria and weights (from config.js "criteria", with README prompts verbatim)
| Weight | Criterion | Description | README prompt |
|---|---|---|---|
| 25% | Vision & originality | "A fresh, ambitious answer to the challenge." | "What new product, service, experience or way of working are you proposing? What makes your idea distinctive?" |
| 20% | Trust constraint insight | "Show exactly what trust, privacy, custody or authority prevents today." | "What is difficult, risky or impossible today because trust, privacy or security gets in the way? Explain what becomes possible when that constraint is removed." |
| 20% | Value & impact | "Create meaningful value for people, organisations or society." | "Who would benefit, and how would their lives or work improve? Give a concrete example of why this matters." |
| 20% | Why TideCloak matters | "Show how TideCloak materially changes what your product can credibly do." | "How does your application use TideCloak, and how does that integration help enable your idea? Connect the technology to the possibility you are demonstrating." |
| 15% | Prototype & storytelling | "Make the idea understandable and show it working." | "What does your prototype demonstrate today? Describe the key interaction judges should look for." |
- "Judges read your README project overview alongside your demo."
- Gating statement: "If your app would work exactly the same with ordinary login and backend permissions, develop the idea further. TideCloak should change what it can credibly do."
- FAQ "What should we avoid?": "Don't make the project mainly a login demo, a security tool or a generic access-control dashboard. Show what becomes newly possible for the people using it."
- FAQ: examples are "inspiration, not tracks. Original ideas from domains nobody else has considered are welcome."

### Deadlines (config.js + FAQ)
- Melbourne: Fri 23 Oct 2026, 10:00 am AEDT (2026-10-23T10:00+11:00)
- Vietnam: Thu 22 Oct 2026, 6:00 pm local (+07:00)
- Malaysia: Thu 22 Oct 2026, 6:00 pm local (+08:00)
- Today is 2026-10-22; the Melbourne deadline is still about to come, Vietnam/Malaysia is 6 pm today local. Check your own time zone. The page text "Submissions have closed" is the static fallback shown when the countdown hits zero or JS computes it that way; treat the config deadlines as authoritative and confirm with organisers/Discord.

### Prizes: NOT FOUND. No prize information appears on the page, config.js or FAQ. UNVERIFIED.
### Rules/terms page, team size limits, eligibility: NOT FOUND (no such link on the page). UNVERIFIED.

### Help and resources
- Discord (#support): https://discord.gg/XBMd9ny2q5 ; Hackbot (AI assistant on page, "can make mistakes"; page and organisers are source of truth).
- MCP info: https://tide.org/agent-plugins ; walkthrough video (Claude Code in VS Code): https://youtu.be/z0o-B3258Cg ; launch video https://youtu.be/gHlev6-kB3I
- Reading: https://tide.org/blog/emergent-authority-beyond-cybersecurity , https://tide.org/blog/cyber-immunity-emergent-authority-ai-era , https://tide.org/tidecloak , https://docs.tide.org/
- Optional README badge/link: tide.org/tidecloak UTM link and badge (readmeBadge in config.js).

### What Tide says it wants to see (12 official example ideas, config.js "inspirationIdeas")
Care Passport (health records, per-clinician decrypt, revoke future access); Research Consent Vault; Rental Application Passport; Blind Portfolio Review (stage-gated decryption of identity fields); Unreleased (creative work, per-asset access); Supplier Evidence Exchange (B2B, quorum governance); Matter Room (legal; admin can neither read nor rewrite roles); Dual-Control Expense Desk (approver role protected by quorum); Guild Treasury (gaming, quorum on role changes); Coalition Intel Exchange (synthetic, release rules AUS/NZ); CreatorVault (entitlement-gated decryption); Community Ballot (voting, one ballot per member, quorum to open count, audit trail).
Recurring pattern in every "demo moment": (a) a single admin/operator account cannot read data or silently change roles; (b) access is scoped per recipient; (c) revoking access blocks the NEXT decryption request; (d) a quorum of approvers is needed for sensitive changes; (e) a deliberate "attempted bypass fails" beat. Page footnote: "Use synthetic data. Any revocation stops future authorised access; it cannot recall material a recipient has already viewed or copied."
Past Tide hackathon winners/showcases: none found in web search (results were unrelated: NATO "TIDE Hackathon", a different organisation). UNVERIFIED for Tide Foundation. Tide reference apps in the pack (see section 4) are the best proxy for showcased projects.

## 2. What TideCloak is (and key capabilities)
Sources: https://tide.org/tidecloak ; https://tide.org/blog/emergent-authority-beyond-cybersecurity ; Tide agent pack (tide-pack MCP, `tide_canon concepts`, `tide_gaps`), which cites whitepaper/vendor confirmations. Pack-derived claims are marked [pack].
- Keycloak-based, Keycloak-compatible IAM: "adds a plug-and-play provable-immunity layer"; "locks identities, data and access rights with keys no one—not admins, your cloud, vendors (even us)—can ever hold." Features listed: SSO, OIDC/OAuth 2.0, federation, RBAC/ABAC/UBAC/CBAC, audit logs, Kubernetes-ready; client libs for React, Next.js, JS, C#. (tide.org/tidecloak)
- Emergent Authority: "Power can be exercised without somebody possessing the power." "When identity, policy, context and intent line up, those nodes collectively perform the permitted action." (blog)
- Ineffable cryptography / never-whole-key [pack]: keys generated via distributed key generation across ORK nodes using nested Shamir sharing; each ORK holds a shard; threshold T must cooperate. Mainnet 20 ORKs, T=14 (whitepaper per pack); threshold is deployment-configurable (test T=3/N=5). Secure while <30% of ORKs compromised.
- Threshold password auth ("BYOiD") [pack]: PRISM threshold OPRF; no password hashes stored; not federated login. Requires browser (SWE iframe); no headless/CLI flow (GAP-064).
- Threshold JWT signing (VVK) [pack]: tokens signed by ORK threshold, each ORK verifies claims before partial signing. Server-side verification: verify JWT locally against embedded JWKS (`jwk` in tidecloak.json adapter, present only when IGA enabled); do NOT use remote JWKS. Check iss, azp, exp, iat, then roles server-side. Access token lifespan 600s default.
- IGA / quorum-governed change requests [pack]: with IGA on, 18 specific admin actions (create user, grant/revoke role, group membership, create client, etc.) become change requests needing a quorum of admins, `max(1, floor(N*0.7))`, sealed by threshold signature; API `/iga/change-requests/...` (authorize, commit, deny). A 2xx on an admin call means ACCEPTED not APPLIED: must drain change requests then verify. Change requests expire after 1 month. Roles take up to ~120s to appear in a new token (doken refresh). "Tide mode" = cryptographic; "Tideless" mode (`iga.attestor=simple`) = username attestation, NO crypto. Practical caveat for demos: need at least multiple admins to show quorum.
- Threshold E2EE [pack]: SDK `doEncrypt`/`doDecrypt` with tags; roles `_tide_<tag>.selfencrypt/selfdecrypt` (self) or `.encrypt/.decrypt` (policy-based, shared); decryption needs live ORK participation; plaintext only on user's device; no offline decryption; per-call fresh key; payload effectively up to ~28 MB. Revocation = next decrypt refused (cannot recall already-viewed data).
- Forseti policy engine [pack]: C# contracts executed in sandbox on every ORK (Roslyn, IL vetting, gas metering 50k, process isolation); majority must approve. Built-ins ship in ORK: GenericResource/RealmAccessThresholdRole (N-of-M role approvals), SimpleTagBasedDecryption, RelationshipAttestation:1 (user/group/role may encrypt/decrypt one record; runtime-tested 2026-10-16, GAP-078). Custom Forseti contract deployment is NOT self-service: "experimental, test-network only, and done by the Tide team (info@tide.org, or Discord)". Known gaps: GAP-067 (untyped Policy constructor), GAP-070/072 (custom model id pitfalls; custom EXPLICIT multi-approver contracts have unverified model-id shape), GAP-073 ([PolicyParam] only verified for string/int). Custom policies fail only after an approval is spent.
- DPoP [pack]: standard Keycloak DPoP (RFC 9449), ES256 default, EdDSA supported; needs `tide_dpop_auth.html` relay page (stale copies break popup fallback, GAP-068); DPoP not gated by Tide licensing. Server verify: access token vs local JWKS, proof vs embedded jwk, binding via cnf.jkt (library `oauth2-dpop` used in an exemplar).
- SWE (Secure Web Enclave) [pack]: browser iframe, SRI-verified, "untrusted dealer"; CSP needs `frame-src 'self' *`; post-auth handler path `/auth/redirect`; `silent-check-sso.html` required.
- Production vs experimental (assessment from [pack]; Tide does not publish a formal label): login/JWT signing/IGA/self-E2EE/DPoP/built-in contracts are the supported SDK paths; custom Forseti deployment = experimental and Tide-team-gated; server-side delegation (asgard-tide) = unshipped (GAP-058/60/61); hosted Skycloak requires TideCloak version >= 0.14.17 (GAP-066); setup order is licence (`setUpTideRealm`) -> IGA (`toggle-iga`) -> E2EE. Setup also needs the user's agreement to Tide T&Cs (https://tide.org/legal) and an email for licence (per pack instructions).
- Hosting: local Docker or hosted Skycloak; realm can't be moved later [pack].

## 3. What TideCloak does NOT do
- Not an AI/prompt-attack detector: no prompt-injection or content classification capability is described anywhere; it is authN/authZ/key management/E2EE/governance. (Absence of evidence; stated here as inference. Relevant to Challenge 1, which is a separate classification task.)
- Tide blog on AI: "We cannot simply rely on AI to defend us from AI"; Emergent Authority does NOT make AI systems inherently trustworthy, eliminate trust entirely, solve all security problems, or remove need for policies and governance (https://tide.org/blog/emergent-authority-beyond-cybersecurity , https://tide.org/blog/cyber-immunity-emergent-authority-ai-era).
- Revocation cannot recall data a recipient already viewed/copied (unlocked page ideas footnote).
- No offline E2EE decryption; no headless/CLI/service-account auth flow; no Go/Python/REST ORK signing SDK (browser JS SDK only) [pack GAP-063/064].
- Custom Forseti contracts cannot be self-deployed by hackathon teams [pack]; use built-ins (RelationshipAttestation etc.) or IGA/role quorum.
- Not documented in pack: DR/recovery runbook, Keycloak migration guide, key-healing limits (GAP-014/023/019).
- The organisers explicitly discourage: login demos, "security tools", "generic access-control dashboards" (FAQ).

## 4. Reference scenarios available in Tide pack (proxy for "apps Tide likes to see")
Source: tide-pack `tide_list_scenarios`: attestation; attested-provenance-registry; encrypted-communication; git-pr-signing-service; iga-admin-governance; organisation-password-manager; policy-governed-signing; relationship-attestation. Those marked threshold-signing need Tide-team contract deployment. Also referenced in pack: Tidewarden (password manager), KeyleSSH (PAM, open source), Ratidefy (multi-tenant SaaS, ratidefy.com), music-license, tidewater, agent-quorum learnings. Tide also publicises Raziel MCP for AI-agent integration and KeyleSSH (https://tide.org/tidecloak , blog).

## 5. UNVERIFIED / not found
- Challenge 1 details; prizes; rules/T&C for hackathon; team size; past Tide hackathon winners; whether the stated deadlines have been extended; the Hackbot's answers (not queried); contents of docs.tide.org (not fetched). Pack claims depend on the pack's own audit (version v1.9.33) and were not independently verified against tide.org docs.
