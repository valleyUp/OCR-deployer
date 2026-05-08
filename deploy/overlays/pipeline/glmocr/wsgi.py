"""WSGI entrypoint for production serving with Gunicorn."""

import atexit
import multiprocessing
import os

from glmocr.config import load_config
from glmocr.server import create_app
from glmocr.utils.logging import configure_logging, get_logger

logger = get_logger(__name__)

try:
    multiprocessing.set_start_method("spawn", force=True)
except RuntimeError:
    pass

config_path = os.getenv("GLMOCR_CONFIG_PATH", "/etc/glm-ocr/server.config.yaml")
config = load_config(config_path)
configure_logging(level=os.getenv("GLMOCR_LOG_LEVEL") or config.logging.level)

app = create_app(config)
pipeline = app.config["pipeline"]
pipeline.start()


def _shutdown_pipeline() -> None:
    try:
        pipeline.stop()
    except Exception as exc:
        logger.warning("Pipeline stop failed during shutdown: %s", exc)


atexit.register(_shutdown_pipeline)
