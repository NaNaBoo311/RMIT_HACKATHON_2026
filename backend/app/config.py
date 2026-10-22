"""Settings + the single tier policy (change thresholds here only)."""
from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict

Tier = Literal["auto", "single", "quorum"]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    auth_mode: Literal["dev", "tide"] = "dev"
    core_ai_url: str = "http://localhost:8001"
    cors_origins: str = "http://localhost:3000"

    quorum_threshold: int = 2
    quorum_risk: float = 0.5
    single_risk: float = 0.2
    approver_role: str = "approver"

    tidecloak_url: str = "http://localhost:8080"
    tidecloak_realm: str = "quorumgate"
    tidecloak_client_id: str = "quorumgate-app"
    tidecloak_audience: str = ""


@lru_cache
def get_settings() -> Settings:
    return Settings()


def compute_tier(label: str, risk: float, s: Settings | None = None) -> tuple[Tier, int]:
    """Tier policy -> (tier, required_approvals)."""
    s = s or get_settings()
    if label != "BENIGN" and risk >= s.quorum_risk:
        return "quorum", s.quorum_threshold
    if risk >= s.single_risk:
        return "single", 1
    return "auto", 0
