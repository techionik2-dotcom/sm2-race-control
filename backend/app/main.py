from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import app.models  # noqa: F401 - register SQLAlchemy models
from app.api.v1.api import api_router
from app.core.config import get_settings


settings = get_settings()

app = FastAPI(title=settings.app_name, version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_origin_regex=settings.cors_origin_regex,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup() -> None:
    # Schema management is handled through Alembic migrations.
    # Keeping startup free of auto-DDL avoids drift between local and production.
    return None


@app.get("/")
def root() -> dict[str, str]:
    return {
        "message": "SM Racing API is running",
        "stack": "FastAPI + PostgreSQL",
    }


app.include_router(api_router, prefix=settings.api_v1_prefix)
