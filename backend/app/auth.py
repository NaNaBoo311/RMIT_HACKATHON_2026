"""Auth: TideCloak/Keycloak-compatible JWT (AUTH_MODE=tide) or dev headers (AUTH_MODE=dev)."""
from dataclasses import dataclass, field

import jwt
from fastapi import Header, HTTPException

from .config import get_settings


@dataclass
class User:
    name: str
    roles: list[str] = field(default_factory=list)


_jwks_client: jwt.PyJWKClient | None = None


def _jwks() -> jwt.PyJWKClient:
    global _jwks_client
    if _jwks_client is None:
        s = get_settings()
        url = f"{s.tidecloak_url}/realms/{s.tidecloak_realm}/protocol/openid-connect/certs"
        _jwks_client = jwt.PyJWKClient(url)
    return _jwks_client


def extract_roles(claims: dict, client_id: str) -> list[str]:
    roles = list(claims.get("realm_access", {}).get("roles", []))
    roles += claims.get("resource_access", {}).get(client_id, {}).get("roles", [])
    return sorted(set(roles))


def verify_token(token: str) -> User:
    s = get_settings()
    try:
        key = _jwks().get_signing_key_from_jwt(token).key
        aud = s.tidecloak_audience or s.tidecloak_client_id
        claims = jwt.decode(
            token, key, algorithms=["RS256", "EdDSA", "ES256"],
            audience=aud, options={"verify_aud": bool(aud)},
            issuer=f"{s.tidecloak_url}/realms/{s.tidecloak_realm}",
        )
    except Exception as e:
        raise HTTPException(401, f"invalid token: {e}") from e
    name = claims.get("preferred_username") or claims.get("sub", "unknown")
    return User(name=name, roles=extract_roles(claims, s.tidecloak_client_id))


def current_user(
    authorization: str | None = Header(default=None),
    x_dev_user: str | None = Header(default=None),
    x_dev_roles: str | None = Header(default=None),
) -> User:
    s = get_settings()
    if s.auth_mode == "dev":
        if not x_dev_user:
            raise HTTPException(401, "dev mode: X-Dev-User header required")
        roles = [r.strip() for r in (x_dev_roles or "").split(",") if r.strip()]
        return User(name=x_dev_user, roles=roles)
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "missing bearer token")
    return verify_token(authorization.split(" ", 1)[1])
