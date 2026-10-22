# Challenge 2: Tide "UNLOCKED" (RMIT hackathon 2026)

Build a small, working prototype with **TideCloak** integrated. One convincing demonstration of something newly possible, not a finished product.

Sources: https://tide.org/unlocked/#challenge ; text loaded from https://tide.org/unlocked/config.js (fetched 2026-10-22). Detailed notes: `research/A_tide_facts.md`.

## Deadlines (config.js `submission.deadlineCities`)
- Melbourne: 10:00 am AEDT, Fri 23 Oct 2026 (2026-10-23T10:00+11:00)
- Vietnam: 6:00 pm local, Thu 22 Oct 2026 (2026-10-22T18:00+07:00)
- Malaysia: 6:00 pm local, Thu 22 Oct 2026 (2026-10-22T18:00+08:00)
- NOTE: today is 2026-10-22, so the Vietnam/Malaysia cut-off is same-day. Confirm with the team.

## Deliverables (FAQ "What do we submit, and when?")
- Submit via Google Form: https://forms.gle/HRHYjnqB86j1LFS97
- Link to a **public GitHub repo** containing the code and a **two-minute demo video as an .mp4**.
- README must **start with a "Project overview"** answering the five judging prompts below.
- Optional README extras: badge https://tide.org/badges/built-with-tidecloak.svg and link https://tide.org/tidecloak?utm_source=github&utm_medium=readme&utm_campaign=unlocked

## Judging criteria (weight, README prompt)
1. **Vision & originality (25)**: What new product, service, experience or way of working are you proposing? What makes it distinctive?
2. **Trust constraint insight (20)**: What is difficult, risky or impossible today because trust, privacy or security gets in the way? What becomes possible when removed?
3. **Value & impact (20)**: Who benefits and how? Concrete example of why it matters.
4. **Why TideCloak matters (20)**: How does the app use TideCloak, and how does that enable the idea?
5. **Prototype & storytelling (15)**: What does the prototype demonstrate today? Key interaction judges should look for.

## FAQ points that matter
- No crypto experience needed; AI coding agents are the intended workflow (Tide MCP; walkthrough uses Claude Code in VS Code).
- MCP optional; fallback is the TideCloak Quickstart template.
- Synthetic/mocked data is fine (and expected for health/finance/government); mock external systems.
- Prototype: small but working, TideCloak integrated. Example ideas are inspiration, not tracks.
- **Avoid**: a project that is mainly a login demo, a security tool, or a generic access-control dashboard. Show what becomes newly possible.
- Help: Tide Discord https://discord.gg/XBMd9ny2q5 ; Hackbot (tide.org/api/chat).

## Links
- Launch video: https://youtu.be/gHlev6-kB3I
- MCP walkthrough: https://youtu.be/z0o-B3258Cg
- TideCloak overview: https://tide.org/tidecloak ; docs: https://docs.tide.org/
- Emergent Authority: https://tide.org/blog/emergent-authority-beyond-cybersecurity ; https://tide.org/blog/cyber-immunity-emergent-authority-ai-era
- Inspiration ideas in config.js: Care Passport, Research Consent Vault, Rental Application Passport, Blind Portfolio Review, Unreleased, Supplier Evidence Exchange, Matter Room, Dual-Control Expense Desk, Guild Treasury, Coalition Intel Exchange, CreatorVault, Community Ballot.

## Layout
- `research/`: Tide facts, security gaps, idea candidates, winning-idea report
- `app/`: prototype (placeholder)

## Status / next steps
- [ ] Confirm deadline with team (Vietnam/Malaysia 6 pm today)
- [ ] Pick idea (see `research/00_WINNING_IDEA_REPORT.md`, `research/D_ideas.md`); answer "remove TideCloak, what breaks?"
- [ ] Scaffold app in `app/` (tide-pack MCP / TideCloak Quickstart); ask user for licence email + agree T&C before realm setup
- [ ] Record 2-minute .mp4 demo
- [ ] Write README Project overview (5 prompts), push public repo, submit form
