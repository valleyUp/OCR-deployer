FROM vllm/vllm-openai:nightly

RUN apt update && apt install -y git
RUN uv pip install --system git+https://github.com/huggingface/transformers.git
