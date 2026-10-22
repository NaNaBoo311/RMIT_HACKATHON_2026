from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


class Classification(BaseModel):
    label: str
    probs: dict[str, float]
    model: str


class Vote(BaseModel):
    user: str
    at: datetime
    comment: str | None = None


class Action(BaseModel):
    id: str
    created_at: datetime
    created_by: str
    source_text: str
    action_type: str
    payload: dict[str, Any]
    classification: Classification
    risk_score: float
    tier: Literal["auto", "single", "quorum"]
    required_approvals: int
    approvals: list[Vote] = Field(default_factory=list)
    rejections: list[Vote] = Field(default_factory=list)
    status: Literal["executed", "pending", "rejected"]
    execution_log: list[str] = Field(default_factory=list)


class ActionCreate(BaseModel):
    source_text: str
    action_type: str
    payload: dict[str, Any] = Field(default_factory=dict)


class VoteBody(BaseModel):
    comment: str | None = None
