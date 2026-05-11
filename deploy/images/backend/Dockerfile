FROM python:3.12-slim

ARG PYPI_INDEX_URL=https://mirrors.tuna.tsinghua.edu.cn/pypi/web/simple
ARG NPM_REGISTRY_URL=https://registry.npmmirror.com

WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    DISPLAY=:99 \
    HOME=/tmp \
    FORMULA_RENDERER_SCRIPT=/opt/formula-renderer/render-formula.cjs

RUN sed -i 's/deb.debian.org/mirrors.tuna.tsinghua.edu.cn/g' /etc/apt/sources.list.d/debian.sources && \
    apt-get update && apt-get install -y --no-install-recommends \
    poppler-utils \
    libgomp1 \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    libgl1 \
    libreoffice-writer \
    libreoffice-calc \
    libreoffice-impress \
    libreoffice-core \
    fonts-dejavu \
    fonts-liberation \
    fonts-noto-cjk \
    fonts-wqy-zenhei \
    nodejs \
    npm \
    texlive-latex-base \
    texlive-latex-recommended \
    texlive-latex-extra \
    texlive-fonts-recommended \
    texlive-science \
    texlive-luatex \
    dvisvgm \
    latexmk \
    ghostscript \
    librsvg2-bin \
    && rm -rf /var/lib/apt/lists/* \
    && libreoffice --version \
    && libreoffice --headless --version

COPY upstream/glm-ocr/apps/backend/pyproject.toml ./
COPY upstream/glm-ocr/apps/backend/app ./app
COPY deploy/overlays/backend/app ./app
COPY deploy/overlays/backend/formula-renderer /opt/formula-renderer

RUN touch README.md && \
    npm --prefix /opt/formula-renderer ci --omit=dev --registry="${NPM_REGISTRY_URL}" && \
    pip config set global.index-url "${PYPI_INDEX_URL}" && \
    pip install --no-cache-dir uv && \
    PIP_INDEX_URL="${PYPI_INDEX_URL}" uv pip install --system -e .

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD python -c "import requests; requests.get('http://localhost:8000/health')" || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
