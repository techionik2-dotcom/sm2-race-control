import uuid
from re import fullmatch

from sqlalchemy import MetaData, create_engine, event
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker

from app.core.config import get_settings


settings = get_settings()
DB_SCHEMA = settings.database_schema
_engine = None
_session_local = None


class Base(DeclarativeBase):
    metadata = MetaData(schema=DB_SCHEMA)


class UUIDMixin:
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)


def get_engine():
    global _engine
    if _engine is None:
        _engine = create_engine(settings.database_url, pool_pre_ping=True)

        if fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", DB_SCHEMA):
            @event.listens_for(_engine, "connect")
            def _set_search_path(dbapi_connection, _connection_record):
                with dbapi_connection.cursor() as cursor:
                    cursor.execute(f"SET search_path TO {DB_SCHEMA}")
    return _engine


def get_session_local():
    global _session_local
    if _session_local is None:
        _session_local = sessionmaker(autocommit=False, autoflush=False, bind=get_engine())
    return _session_local


def get_db():
    db: Session = get_session_local()()
    try:
        yield db
    finally:
        db.close()
