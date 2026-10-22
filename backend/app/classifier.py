"""Client for core-ai (Challenge 1 classifier) with keyword fallback."""
import httpx

from .config import get_settings
from .models import Classification

_INJ = ["ignore previous", "ignore all previous", "disregard", "system prompt",
        "override instructions", "new instructions", "forward all", "exfiltrate"]
_JB = ["jailbreak", "dan mode", "do anything now", "no restrictions", "pretend you are",
       "developer mode", "without any rules", "bypass your"]


def heuristic(text: str) -> Classification:
    t = text.lower()
    inj = sum(k in t for k in _INJ)
    jb = sum(k in t for k in _JB)
    if inj == 0 and jb == 0:
        probs = {"BENIGN": 0.95, "JAILBREAK": 0.02, "PROMPT_INJECTION": 0.03}
        label = "BENIGN"
    elif inj >= jb:
        p = min(0.95, 0.7 + 0.1 * inj)
        probs = {"BENIGN": round(1 - p, 4), "JAILBREAK": 0.0, "PROMPT_INJECTION": p}
        label = "PROMPT_INJECTION"
    else:
        p = min(0.95, 0.7 + 0.1 * jb)
        probs = {"BENIGN": round(1 - p, 4), "JAILBREAK": p, "PROMPT_INJECTION": 0.0}
        label = "JAILBREAK"
    return Classification(label=label, probs=probs, model="fallback-heuristic")


def classify(text: str) -> Classification:
    try:
        r = httpx.post(f"{get_settings().core_ai_url}/classify", json={"text": text}, timeout=5.0)
        r.raise_for_status()
        return Classification(**r.json())
    except Exception:
        return heuristic(text)


def core_ai_up() -> bool:
    try:
        base = get_settings().core_ai_url
        r = httpx.get(f"{base}/health", timeout=1.5)
        return r.status_code < 500
    except Exception:
        return False
