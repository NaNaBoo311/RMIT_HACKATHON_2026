# AIgree app

The Next.js app for AIgree. Project overview, setup and known limitations are in the
[root README](../README.md); TideCloak setup is in [docs/TIDECLOAK_SETUP.md](../docs/TIDECLOAK_SETUP.md)
and the walkthrough in [docs/WALKTHROUGH.md](../docs/WALKTHROUGH.md).

```bash
cp .env.example .env        # first block only: bootstrap values for npm run init
npm install
npm run init                # TideCloak in Docker + realm + staff and patient accounts (needs docker, curl, jq)
npm run dev                 # http://localhost:3000
```

With the local TideCloak stand-in (`tide-local/`, `TIDE_MODE=local` and `NEXT_PUBLIC_TIDE_MODE=local` in `.env.local`):

```bash
npm run dev:local           # stand-in on :8090 + next dev
npm run tide:check          # network refusal checks (stand-in running)
npm run flows:check         # visit flows through the API (stand-in and app running)
```

Started from the Tide agent pack's `nextjs-e2ee-vault` template (provider, DPoP page, JWT + DPoP
verification). Records are encrypted with the ORK's built-in `RelationshipAttestation:1` contract;
see `src/lib/tide/`.
