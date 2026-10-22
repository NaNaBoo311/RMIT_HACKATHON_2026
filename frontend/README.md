# QuorumGate for Agents - Frontend

Next.js (App Router) + TypeScript + Tailwind. Giao dien demo cho Challenge 2 (Tide UNLOCKED).

## Chay

```bash
cp .env.example .env.local
npm install
npm run dev     # http://localhost:3000
```

Backend mac dinh: `http://localhost:8000` (`NEXT_PUBLIC_API_URL`). Neu backend tat, UI hien thi "backend offline" thay vi loi.

## Trang
- `/` Agent console: nhap noi dung (email/tai lieu), chon action, 3 preset (invoice lanh tinh, prompt injection, jailbreak) -> hien verdict, thanh xac suat, tier, status.
- `/approvals` Hang cho duyet: tien do `1 / 2`, Approve/Reject, giai thich khi bi chan (khong duyet action cua chinh minh, da duyet roi).
- Header: dev user switcher (alice/bob/carol) de demo quorum 2-of-3 khong can realm.

## Auth (`src/lib/auth.ts`)
- `NEXT_PUBLIC_AUTH_MODE=dev`: gui `X-Dev-User`, `X-Dev-Roles`.
- `NEXT_PUBLIC_AUTH_MODE=tide`: nhanh `// TIDE:` trong `getAuthHeaders()` la TODO - tich hop TideCloak SDK login va tra ve `Authorization: Bearer <token>` (theo TideCloak Next.js quickstart / Tide MCP). Chua co SDK nao duoc them vao.

## Cau truc
`src/lib/api.ts` (client + type `Action`), `src/lib/auth.ts`, `src/components/`, `src/app/`.
