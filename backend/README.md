# QuorumGate for Agents - Backend

FastAPI service: AI agent đề xuất action -> classifier (core-ai, Challenge 1) chấm rủi ro ->
`auto` chạy ngay / `single` cần 1 người duyệt / `quorum` cần N người (mặc định 2) giữ role `approver`.

## Chạy

```bash
cd backend
cp .env.example .env        # AUTH_MODE=dev mặc định
uv sync
uv run uvicorn app.main:app --port 8000 --reload
uv run pytest && uv run ruff check .
```

Dev mode: gửi header `X-Dev-User: alice` và `X-Dev-Roles: approver,user`.
Nếu core-ai (`CORE_AI_URL`, :8001) không chạy, backend dùng heuristic từ khóa (`model: "fallback-heuristic"`).

## API (prefix `/api`)

| Method | Path | Mô tả |
|---|---|---|
| GET | /health | `{status, core_ai: up/down}` (không cần auth) |
| GET | /me | `{user, roles}` |
| POST | /actions | `{source_text, action_type, payload}` -> Action |
| GET | /actions | danh sách Action |
| GET | /actions/{id} | một Action |
| POST | /actions/{id}/approve | `{comment?}` -> Action |
| POST | /actions/{id}/reject | `{comment?}` -> Action (một approver có thể veto) |

Action: `id, created_at, created_by, source_text, action_type, payload, classification{label,probs,model},
risk_score (=1-P(BENIGN)), tier, required_approvals, approvals[], rejections[], status, execution_log[]`.

## Tier policy (`app/config.py::compute_tier`)

- `quorum`: label != BENIGN và risk >= 0.5 -> cần `QUORUM_THRESHOLD` (2) approvals
- `single`: risk >= 0.2 -> 1 approval
- `auto`: còn lại -> thực thi ngay

Quy tắc: approver phải có role `APPROVER_ROLE`; người tạo không tự duyệt; không duyệt 2 lần.
Thực thi là mock (ghi vào `execution_log`).

## Auth

`AUTH_MODE=tide`: Bearer JWT từ TideCloak, verify bằng JWKS
`{TIDECLOAK_URL}/realms/{TIDECLOAK_REALM}/protocol/openid-connect/certs`; roles lấy từ
`realm_access.roles` và `resource_access.<client>.roles`. (Chưa test với realm thật.)

## TIDE: nơi cắm tính năng threshold/quorum của Tide

`app/quorum.py` là seam duy nhất. Hiện tại quorum = đếm approvals trong bộ nhớ (một admin/process
có thể sửa được). Để thay bằng cryptographic quorum: **to be wired using the TideCloak SDK/MCP** -
tạo Tide change-request / policy-signing cho action, để `required_approvals` người giữ role ký,
và chỉ gọi `execute()` khi request đã đủ ngưỡng chữ ký và verify thành công. Role-based access
(`auth.py`) cũng nên lấy từ role TideCloak thật. Prototype này không gọi API Tide nào.
