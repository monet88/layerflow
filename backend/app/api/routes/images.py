from typing import Literal, Optional
import logging
from fastapi import APIRouter, Depends, File, Form, Request, UploadFile, HTTPException, status
from pydantic import BaseModel, Field
from app.api.deps import verify_app_api_key, get_user_id
from app.core.config import settings
from app.core.errors import AppError, raise_http_from_app_error
from app.core.rate_limit import limiter
from app.services.image_edit_service import ImageEditService

logger = logging.getLogger(__name__)

router = APIRouter()
image_service = ImageEditService()


class ImageGenerationRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=4000)
    model: Literal["gpt-image-2"] = "gpt-image-2"
    n: int = Field(1, ge=1, le=1)
    size: Literal["1024x1024", "1536x1536", "2048x2048"] = "1024x1024"


async def _read_upload_with_budget(upload: UploadFile, max_bytes: int) -> bytes:
    """Read an upload file in chunks, aborting immediately when budget exceeded.

    Prevents DoS via large uploads that would fill /tmp before a post-read
    size check fires. Starlette spools to disk after 1MB — this limits how
    much disk is consumed.
    """
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await upload.read(64 * 1024)  # 64KB chunks
        if not chunk:
            break
        total += len(chunk)
        if total > max_bytes:
            raise HTTPException(
                status_code=413,
                detail=f"File exceeds maximum allowed size of {max_bytes // (1024 * 1024)}MB.",
            )
        chunks.append(chunk)
    return b"".join(chunks)

@router.post("/v1/images/generations", dependencies=[Depends(verify_app_api_key)])
@limiter.limit(settings.RATE_LIMIT_IMAGES)
async def generate_image_endpoint(
    request: Request,
    payload: ImageGenerationRequest,
    user_id: str = Depends(get_user_id),
):
    _ = request
    try:
        return await image_service.generate_image(
            prompt=payload.prompt,
            user_id=user_id,
            model=payload.model,
            n=payload.n,
            size=payload.size,
        )
    except AppError as exc:
        raise_http_from_app_error(exc)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        )
    except NotImplementedError as exc:
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail=str(exc),
        )
    except Exception as exc:
        logger.exception("Image generation failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Image generation failed. Please try again later.",
        )


@router.post("/v1/images/edits", dependencies=[Depends(verify_app_api_key)])
@limiter.limit(settings.RATE_LIMIT_IMAGES)
async def edit_image_endpoint(
    request: Request,
    image: UploadFile = File(...),
    mask: Optional[UploadFile] = File(None),
    prompt: str = Form(...),
    model: str = Form("gpt-image-2"),
    n: int = Form(1),
    size: str = Form("1024x1024"),
    user_id: str = Depends(get_user_id),
):
    """OpenAI-compatible image edits endpoint.

    Accepts multipart/form-data containing image, optional mask, prompt, and parameters.
    """
    _ = request
    max_bytes = settings.MAX_UPLOAD_MB * 1024 * 1024

    try:
        # Streaming read with budget — reject before buffering entire payload (A4 fix)
        try:
            image_bytes = await _read_upload_with_budget(image, max_bytes)
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Failed to read image file",
            )

        mask_bytes = None
        if mask is not None:
            try:
                mask_bytes = await _read_upload_with_budget(mask, max_bytes)
            except HTTPException:
                raise
            except Exception:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Failed to read mask file",
                )

        try:
            result = await image_service.edit_image(
                image_bytes=image_bytes,
                mask_bytes=mask_bytes,
                prompt=prompt,
                user_id=user_id,
                model=model,
                n=n,
                size=size,
            )
            return result
        except AppError as exc:
            raise_http_from_app_error(exc)
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=str(exc),
            )
        except NotImplementedError as exc:
            raise HTTPException(
                status_code=status.HTTP_501_NOT_IMPLEMENTED,
                detail=str(exc),
            )
        except Exception as exc:
            logger.exception("Image generation failed: %s", exc)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Image generation failed. Please try again later.",
            )
    finally:
        try:
            await image.close()
        except Exception:
            pass
        if mask is not None:
            try:
                await mask.close()
            except Exception:
                pass
