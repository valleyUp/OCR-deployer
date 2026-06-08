from pathlib import Path

import aiofiles
from fastapi import HTTPException, UploadFile, status

from app.utils.config import settings
from app.utils.logger import logger


class FileUploadHandler:
    """Validate and persist uploaded files with a backend-side size limit."""

    DOCUMENT_EXTENSIONS = {".pdf", ".doc", ".docx"}
    IMAGE_EXTENSIONS = {
        ".jpg",
        ".jpeg",
        ".png",
        ".bmp",
        ".gif",
        ".tiff",
        ".tif",
        ".webp",
    }

    DOCUMENT_MIME_TYPES = {
        "application/pdf",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    }

    def valid(self, file: UploadFile) -> bool:
        """Return whether the upload looks like a supported document or image."""
        filename = (file.filename or "").strip()
        suffix = Path(filename).suffix.lower()
        content_type = (file.content_type or "").lower()

        if suffix in self.DOCUMENT_EXTENSIONS or suffix in self.IMAGE_EXTENSIONS:
            return True

        if content_type in self.DOCUMENT_MIME_TYPES or content_type.startswith("image/"):
            return True

        return False

    def max_size_bytes(self) -> int:
        return max(1, int(settings.MAX_UPLOAD_MB)) * 1024 * 1024

    async def save_to_path(
        self,
        file: UploadFile,
        filename: str | None = None,
        upload_dir: str | Path | None = None,
    ) -> str:
        """Validate and save an upload, rejecting files over MAX_UPLOAD_MB."""
        if not self.valid(file):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Only PDF, Word, or common image files are supported",
            )

        max_bytes = self.max_size_bytes()
        declared_size = getattr(file, "size", None)
        if isinstance(declared_size, int) and declared_size > max_bytes:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=f"Upload exceeds {settings.MAX_UPLOAD_MB} MB limit",
            )

        safe_name = Path(filename or file.filename or "upload").name
        base_dir = Path(upload_dir) if upload_dir else Path(settings.OUTPUT_DIR)
        dest_path = base_dir / safe_name
        dest_path.parent.mkdir(parents=True, exist_ok=True)

        total = 0
        await file.seek(0)
        try:
            async with aiofiles.open(dest_path, "wb") as target:
                while True:
                    chunk = await file.read(1024 * 1024)
                    if not chunk:
                        break
                    total += len(chunk)
                    if total > max_bytes:
                        raise HTTPException(
                            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                            detail=f"Upload exceeds {settings.MAX_UPLOAD_MB} MB limit",
                        )
                    await target.write(chunk)
        except HTTPException:
            try:
                dest_path.unlink(missing_ok=True)
            except OSError as exc:
                logger.warning("Failed to remove rejected upload %s: %s", dest_path, exc)
            raise

        logger.info("Saved upload to: %s", dest_path)
        return str(dest_path)


file_upload_handler = FileUploadHandler()
