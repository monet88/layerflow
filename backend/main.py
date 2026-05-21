from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi.errors import RateLimitExceeded
from app.core.config import settings
from app.core.logging import setup_logging
from app.core.rate_limit import limiter, rate_limit_exceeded_handler
from app.db.sqlite import init_db
from app.api.routes import health, models, auth, images

# Setup logging with redact capability
setup_logging(settings.LOG_LEVEL)

# Initialize database schema
init_db()

app = FastAPI(
    title="InpaintKit Backend",
    version="0.1.0",
    description="Backend MVP for ChatGPT reverse proxy image editing service",
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, rate_limit_exceeded_handler)

# CORS middleware setup
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.ALLOWED_ORIGINS.split(",") if o.strip()],
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS", "DELETE"],
    allow_headers=["Authorization", "Content-Type", "X-User-Id"],
    max_age=86400,
)

# Register endpoints
app.include_router(health.router)
app.include_router(models.router)
app.include_router(auth.router)
app.include_router(images.router)
