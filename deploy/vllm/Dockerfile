FROM vllm/vllm-openai:cu130-nightly

ARG PYPI_INDEX_URL=https://mirrors.tuna.tsinghua.edu.cn/pypi/web/simple

RUN apt update && apt install -y git
RUN pip config set global.index-url "${PYPI_INDEX_URL}" && \
    PIP_INDEX_URL="${PYPI_INDEX_URL}" uv pip install --system git+https://github.com/huggingface/transformers.git
