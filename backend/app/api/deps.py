from uuid import UUID

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.enums import UserRole
from app.core.security import decode_access_token
from app.models.revoked_token import RevokedToken
from app.models.user import User
from app.services.auth_service import ensure_canonical_owner_access


oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")


def get_current_user(
    db: Session = Depends(get_db),
    token: str = Depends(oauth2_scheme),
) -> User:
    try:
        payload = decode_access_token(token)
        token_jti = payload.get("jti")
        if not token_jti:
            raise ValueError("Missing token identifier")
        revoked = db.scalar(select(RevokedToken).where(RevokedToken.jti == token_jti))
        if revoked is not None:
            raise ValueError("Token revoked")
        user_id = payload.get("sub")
        if not user_id:
            raise ValueError("Missing subject")
        current_user = db.get(User, UUID(user_id))
        if current_user is None:
            raise ValueError("User not found")
        current_user = ensure_canonical_owner_access(db, current_user)
        if not current_user.is_active:
            raise ValueError("User is inactive")
        return current_user
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
        )


def require_roles(*roles: UserRole):
    def dependency(current_user: User = Depends(get_current_user)) -> User:
        if current_user.role not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied",
            )
        return current_user

    return dependency
