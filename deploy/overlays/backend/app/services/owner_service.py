"""Anonymous owner session helpers."""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import secrets

from fastapi import Request, Response

from app.utils.config import settings


@dataclass(frozen=True)
class OwnerSession:
    token: str
    owner_hash: str
    owner_id: str
    is_new: bool


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _new_token() -> str:
    return secrets.token_urlsafe(32)


def owner_id_from_hash(owner_hash: str) -> str:
    return f"anon_{owner_hash[:16]}"


def build_owner_session(token: str, *, is_new: bool = False) -> OwnerSession:
    owner_hash = _hash_token(token)
    return OwnerSession(
        token=token,
        owner_hash=owner_hash,
        owner_id=owner_id_from_hash(owner_hash),
        is_new=is_new,
    )


def _set_owner_cookie(response: Response, session: OwnerSession) -> None:
    max_age = max(settings.OWNER_COOKIE_MAX_AGE_DAYS, 1) * 24 * 60 * 60
    response.set_cookie(
        key=settings.OWNER_COOKIE_NAME,
        value=session.token,
        max_age=max_age,
        httponly=True,
        secure=settings.OWNER_COOKIE_SECURE,
        samesite="lax",
        path="/",
    )


async def get_owner_session(request: Request, response: Response) -> OwnerSession:
    token = request.cookies.get(settings.OWNER_COOKIE_NAME)
    if token:
        return build_owner_session(token)

    session = build_owner_session(_new_token(), is_new=True)
    _set_owner_cookie(response, session)
    return session


def attach_owner_cookie(response: Response, session: OwnerSession) -> Response:
    if session.is_new:
        _set_owner_cookie(response, session)
    return response
