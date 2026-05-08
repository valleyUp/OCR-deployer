FROM python:3.12-slim

ARG PYPI_INDEX_URL=https://mirrors.tuna.tsinghua.edu.cn/pypi/web/simple

WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    HF_HOME=/root/.cache/huggingface \
    TRANSFORMERS_CACHE=/root/.cache/huggingface \
    HF_HUB_CACHE=/root/.cache/huggingface/hub

RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY upstream/glm-ocr/pyproject.toml upstream/glm-ocr/README.md ./
COPY upstream/glm-ocr/glmocr ./glmocr
COPY upstream/glm-ocr/resources ./resources
COPY deploy/overlays/pipeline/ ./

RUN pip config set global.index-url "${PYPI_INDEX_URL}" && \
    pip install --no-cache-dir -e ".[selfhosted,server]" gunicorn

RUN mkdir -p /root/.cache/huggingface

EXPOSE 5002

HEALTHCHECK --interval=30s --timeout=10s --start-period=90s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:5002/health')" || exit 1

CMD ["/bin/sh", "-lc", "if [ \"${PIPELINE_SERVER_MODE:-gunicorn}\" = \"flask\" ]; then exec python -m glmocr.server --config \"${GLMOCR_CONFIG_PATH:-/etc/glm-ocr/server.config.yaml}\"; else exec gunicorn --bind 0.0.0.0:${PIPELINE_SERVER_PORT:-5002} --workers ${PIPELINE_GUNICORN_WORKERS:-1} --threads ${PIPELINE_GUNICORN_THREADS:-8} --worker-class gthread --timeout ${PIPELINE_GUNICORN_TIMEOUT:-300} --graceful-timeout ${PIPELINE_GUNICORN_GRACEFUL_TIMEOUT:-60} --keep-alive ${PIPELINE_GUNICORN_KEEPALIVE:-10} --access-logfile - --error-logfile - glmocr.wsgi:app; fi"]
