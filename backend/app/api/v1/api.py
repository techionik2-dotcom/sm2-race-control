from fastapi import APIRouter

from app.api.v1.endpoints.admin_submissions import router as admin_submissions_router
from app.api.v1.endpoints.auth import router as auth_router
from app.api.v1.endpoints.drivers import router as drivers_router
from app.api.v1.endpoints.events import router as events_router
from app.api.v1.endpoints.chatbot import router as chatbot_router
from app.api.v1.endpoints.health import router as health_router
from app.api.v1.endpoints.run_groups import router as run_groups_router
from app.api.v1.endpoints.submissions import router as submissions_router
from app.api.v1.endpoints.voice_input import router as voice_input_router
from app.api.v1.endpoints.voice_sessions import router as voice_sessions_router
from app.api.v1.endpoints.tracks import router as tracks_router
from app.api.v1.endpoints.users import router as users_router
from app.api.v1.endpoints.vehicles import router as vehicles_router


api_router = APIRouter()
api_router.include_router(health_router)
api_router.include_router(auth_router, prefix="/auth", tags=["auth"])
api_router.include_router(admin_submissions_router, tags=["admin-submissions"])
api_router.include_router(chatbot_router, tags=["chatbot"])
api_router.include_router(events_router, prefix="/events", tags=["events"])
api_router.include_router(run_groups_router, prefix="/run-groups", tags=["run-groups"])
api_router.include_router(tracks_router, prefix="/tracks", tags=["tracks"])
api_router.include_router(drivers_router, prefix="/drivers", tags=["drivers"])
api_router.include_router(vehicles_router, prefix="/vehicles", tags=["vehicles"])
api_router.include_router(submissions_router, prefix="/submissions", tags=["submissions"])
api_router.include_router(voice_input_router, tags=["voice-input"])
api_router.include_router(voice_sessions_router, prefix="/submissions", tags=["submissions"])
api_router.include_router(users_router, prefix="/users", tags=["users"])
