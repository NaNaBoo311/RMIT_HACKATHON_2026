from contextlib import asynccontextmanager
from datetime import UTC, datetime

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from . import classifier, quorum, store
from .auth import User, current_user
from .config import compute_tier, get_settings
from .models import Action, ActionCreate, VoteBody


@asynccontextmanager
async def lifespan(_: FastAPI):
    store.seed()
    yield


app = FastAPI(title="QuorumGate for Agents", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in get_settings().cors_origins.split(",")],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health():
    return {"status": "ok", "core_ai": "up" if classifier.core_ai_up() else "down"}


@app.get("/api/me")
def me(user: User = Depends(current_user)):
    return {"user": user.name, "roles": user.roles}


@app.post("/api/actions", response_model=Action)
def create_action(body: ActionCreate, user: User = Depends(current_user)):
    cls = classifier.classify(body.source_text)
    risk = round(1 - cls.probs.get("BENIGN", 0.0), 4)
    tier, req = compute_tier(cls.label, risk)
    a = Action(
        id=store.next_id(), created_at=datetime.now(UTC), created_by=user.name,
        source_text=body.source_text, action_type=body.action_type, payload=body.payload,
        classification=cls, risk_score=risk, tier=tier, required_approvals=req,
        status="pending",
    )
    if req == 0:
        quorum.execute(a)
    return store.put(a)


@app.get("/api/actions", response_model=list[Action])
def list_actions(_: User = Depends(current_user)):
    return store.list_all()


def _get(action_id: str) -> Action:
    a = store.get(action_id)
    if not a:
        raise HTTPException(404, "action not found")
    return a


@app.get("/api/actions/{action_id}", response_model=Action)
def get_action(action_id: str, _: User = Depends(current_user)):
    return _get(action_id)


@app.post("/api/actions/{action_id}/approve", response_model=Action)
def approve(action_id: str, body: VoteBody | None = None, user: User = Depends(current_user)):
    with store.lock():
        return quorum.approve(_get(action_id), user, body.comment if body else None)


@app.post("/api/actions/{action_id}/reject", response_model=Action)
def reject(action_id: str, body: VoteBody | None = None, user: User = Depends(current_user)):
    with store.lock():
        return quorum.reject(_get(action_id), user, body.comment if body else None)
