"""Approval / quorum logic. This is the ONLY module that decides when an action may execute.

# TIDE: replace this in-memory approval count with cryptographic quorum enforcement.
# To be wired using the TideCloak SDK/MCP (Tide change-request / policy signing, role-based
# access): instead of counting `approvals` here, create a Tide change-request for the action,
# have `required_approvals` role-holders sign it, and only call `execute()` once the
# threshold-signed request verifies. No Tide API is invoked in this prototype.
"""
from datetime import UTC, datetime

from fastapi import HTTPException

from .auth import User
from .config import get_settings
from .models import Action, Vote


def execute(a: Action) -> None:
    """Mocked side effect."""
    a.status = "executed"
    a.execution_log.append(
        f"[mock] {datetime.now(UTC).isoformat()} executed {a.action_type} {a.payload}"
    )


def _check_can_vote(a: Action, user: User) -> None:
    s = get_settings()
    if s.approver_role not in user.roles:
        raise HTTPException(403, f"role '{s.approver_role}' required")
    if a.status != "pending":
        raise HTTPException(409, f"action is already {a.status}")
    if user.name == a.created_by:
        raise HTTPException(403, "creator cannot review their own action")
    if any(v.user == user.name for v in a.approvals + a.rejections):
        raise HTTPException(409, "user has already voted on this action")


def approve(a: Action, user: User, comment: str | None) -> Action:
    _check_can_vote(a, user)
    a.approvals.append(Vote(user=user.name, at=datetime.now(UTC), comment=comment))
    if len(a.approvals) >= a.required_approvals:
        execute(a)
    return a


def reject(a: Action, user: User, comment: str | None) -> Action:
    _check_can_vote(a, user)
    a.rejections.append(Vote(user=user.name, at=datetime.now(UTC), comment=comment))
    a.status = "rejected"  # any single approver can veto (fail-safe)
    return a
