"""OCR-deployer overlay for the GLM-OCR Flask service."""

from __future__ import annotations

import multiprocessing
import os
import sys
import threading
import time
import traceback
import uuid
from typing import TYPE_CHECKING, Any

from flask import Flask, jsonify, request

from glmocr._upstream_server import create_app as _create_upstream_app
from glmocr.config import load_config
from glmocr.utils.logging import configure_logging, get_logger

if TYPE_CHECKING:
    from glmocr.config import GlmOcrConfig

logger = get_logger(__name__)

os.environ["http_proxy"] = ""
os.environ["https_proxy"] = ""

INLINE_FORMULA_LABELS = {"inline_formula"}
FORMULA_MODE_PROMPT = (
    "Extract only display or block mathematical equations that occupy their own "
    "line or a standalone formula region. Return LaTeX for those display "
    "equations only. Do not extract inline mathematical symbols or formulas "
    "embedded inside prose paragraphs. Ignore standalone formula numbers unless "
    "they are attached to a display equation."
)


def _build_response(json_result: Any, markdown_result: str) -> dict[str, Any]:
    return {
        "json_result": json_result,
        "markdown_result": markdown_result,
        "layout_details": json_result,
        "md_results": markdown_result,
        "data_info": {"pages": []},
        "usage": {},
        "model": "glm-ocr",
        "id": f"chatcmpl-{uuid.uuid4().hex[:29]}",
        "created": int(time.time()),
    }


def _normalize_label(label: Any) -> str:
    return str(label or "").strip().lower().replace("-", "_")


def _without_inline_formula_labels(label_task_mapping: Any) -> Any:
    if not isinstance(label_task_mapping, dict):
        return label_task_mapping

    filtered: dict[str, Any] = {}
    for task_type, labels in label_task_mapping.items():
        if isinstance(labels, (list, tuple, set)):
            filtered[task_type] = [
                label
                for label in labels
                if _normalize_label(label) not in INLINE_FORMULA_LABELS
            ]
        else:
            filtered[task_type] = labels
    return filtered


def _extract_images(payload: dict[str, Any]) -> list[str]:
    images = payload.get("images", [])
    if isinstance(images, str):
        images = [images]

    if not images and "file" in payload:
        file_value = payload["file"]
        if isinstance(file_value, str) and file_value:
            images = [file_value]
    return images


def _build_pipeline_request(images: list[str]) -> dict[str, Any]:
    messages = [{"role": "user", "content": []}]
    for image_url in images:
        messages[0]["content"].append(
            {"type": "image_url", "image_url": {"url": image_url}}
        )
    return {"messages": messages}


def _run_pipeline_with_mode_options(
    pipeline: Any,
    request_data: dict[str, Any],
    *,
    processing_mode: str,
    prompt: str | None,
) -> list[Any]:
    parse_lock = getattr(pipeline, "_ocr_deployer_parse_lock", None)
    if parse_lock is None:
        parse_lock = threading.Lock()
        setattr(pipeline, "_ocr_deployer_parse_lock", parse_lock)

    with parse_lock:
        original_label_task_mapping = None
        original_task_prompt_mapping = None
        if processing_mode == "formula":
            original_label_task_mapping = pipeline.layout_detector.label_task_mapping
            original_task_prompt_mapping = pipeline.page_loader.task_prompt_mapping
            pipeline.layout_detector.label_task_mapping = _without_inline_formula_labels(
                original_label_task_mapping
            )
            task_prompts = dict(original_task_prompt_mapping or {})
            task_prompts["formula"] = prompt or FORMULA_MODE_PROMPT
            pipeline.page_loader.task_prompt_mapping = task_prompts

        try:
            return list(
                pipeline.process(
                    request_data,
                    save_layout_visualization=False,
                )
            )
        finally:
            if processing_mode == "formula":
                pipeline.layout_detector.label_task_mapping = original_label_task_mapping
                pipeline.page_loader.task_prompt_mapping = original_task_prompt_mapping


def _install_parse_override(app: Flask) -> None:
    pipeline = app.config["pipeline"]

    def parse():
        if not request.is_json:
            return (
                jsonify(
                    {"error": "Invalid Content-Type. Expected 'application/json'."}
                ),
                400,
            )

        data = request.get_json(silent=True)
        if not isinstance(data, dict):
            return jsonify({"error": "Invalid JSON payload"}), 400

        images = _extract_images(data)
        if not images:
            return jsonify({"error": "No images provided"}), 400

        processing_mode = str(data.get("processing_mode") or "pipeline")
        prompt = data.get("prompt")
        if prompt is not None:
            prompt = str(prompt)

        try:
            results = _run_pipeline_with_mode_options(
                pipeline,
                _build_pipeline_request(images),
                processing_mode=processing_mode,
                prompt=prompt,
            )
            if not results:
                return jsonify(_build_response(None, "")), 200
            if len(results) == 1:
                result = results[0]
                return (
                    jsonify(
                        _build_response(
                            result.json_result,
                            result.markdown_result or "",
                        )
                    ),
                    200,
                )

            json_result = [result.json_result for result in results]
            markdown_result = "\n\n---\n\n".join(
                result.markdown_result or "" for result in results
            )
            return jsonify(_build_response(json_result, markdown_result)), 200

        except Exception as exc:
            logger.error("Parse error: %s", exc)
            logger.debug(traceback.format_exc())
            return jsonify({"error": f"Parse error: {str(exc)}"}), 500

    app.view_functions["parse"] = parse


def create_app(config: "GlmOcrConfig") -> Flask:
    app = _create_upstream_app(config)
    _install_parse_override(app)
    return app


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(description="GlmOcr Server")
    parser.add_argument("--config", type=str, default=None, help="Config file path")
    parser.add_argument(
        "--log-level",
        type=str,
        default=None,
        choices=["DEBUG", "INFO", "WARNING", "ERROR"],
        help="Log level",
    )
    args = parser.parse_args()

    multiprocessing.set_start_method("spawn", force=True)
    app = None

    try:
        config = load_config(args.config)
        log_level = args.log_level or config.logging.level
        configure_logging(level=log_level)

        app = create_app(config)
        pipeline = app.config["pipeline"]
        pipeline.start()

        server_config = config.server
        logger.info("")
        logger.info("=" * 60)
        logger.info(
            "GlmOcr Server starting on %s:%d...",
            server_config.host,
            server_config.port,
        )
        logger.info("API endpoint: /glmocr/parse")
        logger.info("=" * 60)
        logger.info("")

        app.run(
            debug=server_config.debug,
            host=server_config.host,
            port=server_config.port,
        )

    except KeyboardInterrupt:
        logger.info("Shutting down...")
    except Exception as exc:
        logger.error("Error: %s", exc)
        logger.debug(traceback.format_exc())
        sys.exit(1)
    finally:
        if app is not None and "pipeline" in app.config:
            app.config["pipeline"].stop()


if __name__ == "__main__":
    main()
