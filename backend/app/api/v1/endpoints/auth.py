from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, oauth2_scheme
from app.core.database import get_db
from app.core.security import create_access_token
from app.core.security import decode_access_token
from app.core.enums import UserApprovalStatus, UserRole
from app.models.revoked_token import RevokedToken
from app.models.user import User
from sqlalchemy import select

from app.schemas.auth import Token, UserLogin, UserRead, UserSignup
from app.services.auth_service import authenticate_user, create_user


router = APIRouter()


def _issue_login_token(db: Session, user: User) -> Token:
    user.last_login_at = datetime.now(timezone.utc)
    db.add(user)
    db.commit()
    db.refresh(user)

    token = create_access_token(
        subject=str(user.id),
        additional_claims={"email": user.email, "role": user.role.value},
    )
    return Token(access_token=token)


@router.post("/register", response_model=UserRead, status_code=status.HTTP_201_CREATED)
def register_user(user_in: UserSignup, db: Session = Depends(get_db)) -> User:
    try:
        return create_user(
            db,
            user_in,
            role=UserRole.DRIVER,
            is_active=False,
            approval_status=UserApprovalStatus.PENDING,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))


@router.post("/login", response_model=Token)
def login(
    user_in: UserLogin,
    db: Session = Depends(get_db),
) -> Token:
    user = authenticate_user(db, user_in.email, user_in.password, allow_inactive=True)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )

    if user.approval_status == UserApprovalStatus.PENDING:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your account is pending owner approval. Please wait for an owner to approve your request.",
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This account is inactive. Please contact an owner to restore access.",
        )

    return _issue_login_token(db, user)


@router.post("/admin-login", response_model=Token)
def admin_login(
    user_in: UserLogin,
    db: Session = Depends(get_db),
) -> Token:
    user = authenticate_user(db, user_in.email, user_in.password, allow_inactive=True)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )

    if user.approval_status == UserApprovalStatus.PENDING:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This account is pending owner approval and cannot access the owner portal yet.",
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This account is inactive. Please contact an owner to restore access.",
        )

    if user.role != UserRole.OWNER:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Owner portal access requires an owner account",
        )

    return _issue_login_token(db, user)


@router.get("/me", response_model=UserRead)
def read_me(current_user: User = Depends(get_current_user)) -> User:
    return current_user


@router.post("/logout")
def logout(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, str]:
    claims = decode_access_token(token)
    token_jti = claims.get("jti")
    current_user.last_logout_at = datetime.now(timezone.utc)
    db.add(current_user)
    if token_jti:
        existing = db.scalar(select(RevokedToken).where(RevokedToken.jti == token_jti))
        if existing is None:
            expires_at = claims.get("exp")
            revoked = RevokedToken(
                jti=token_jti,
                expires_at=datetime.fromtimestamp(expires_at, tz=timezone.utc)
                if expires_at is not None
                else datetime.now(timezone.utc),
            )
            db.add(revoked)

    db.commit()

    return {"message": "Logged out successfully"}
