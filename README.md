# OCR Deployer

`OCR Deployer` 是面向 `GLM-OCR` 的外层部署仓库。上游源码放在
`upstream/glm-ocr` submodule 中，本仓库通过 Dockerfile、Compose、backend
overlay、frontend overlay 和运行脚本提供产品化部署外壳。

当前状态：

- 正常构建不修改 `upstream/glm-ocr`。
- 四个服务统一由 `deploy/docker-compose.yml` 编排：`vllm`、`pipeline`、`backend`、`frontend`。
- 本仓库 overlay 增强了 backend 公式 API、frontend 公式工作台、同源 nginx 代理和离线 PDF.js 资源。
- 支持普通 OCR 与公式识别两种上传模式；公式识别结果会自动进入“公式” Tab。
- 支持单公式复制/渲染和批量 zip 导出，格式包含 LaTeX、MathML、UnicodeMath、PNG。

## 目录结构

```text
.
├── deploy/
│   ├── docker-compose.yml             # vllm + pipeline + backend + frontend
│   ├── .env.example                   # compose 环境变量样例
│   ├── glm-ocr/server.config.yaml     # pipeline 自托管配置
│   ├── images/                        # pipeline/backend/frontend Dockerfile
│   ├── overlays/                      # 本仓库 overlay
│   │   ├── backend/                   # FastAPI 扩展、公式服务、公式渲染器、测试
│   │   ├── frontend/                  # WebUI 替换文件、nginx、离线 PDF.js 配置
│   │   └── pipeline/                  # WSGI 入口
│   └── vllm/Dockerfile                # vLLM 镜像
├── patches/glm-ocr/                   # 兼容 patch queue，正常 series 仅注释
├── runtime/
│   ├── huggingface/                   # HuggingFace 模型缓存
│   └── backend-data/                  # backend 数据库与任务数据
├── scripts/
│   ├── build-images.sh                # 构建四个镜像
│   ├── compose-stack.sh               # Docker Compose 入口
│   ├── diagnose-stack.sh              # 服务链路与设备配置诊断
│   ├── save-images.sh                 # 导出四镜像 tar 包
│   └── patch-queue-*.sh               # 历史补丁队列工具
└── upstream/glm-ocr/                  # 上游 submodule
```

## 快速启动

Docker CLI 路径：

```bash
git submodule update --init upstream/glm-ocr
cp deploy/.env.example deploy/.env
./scripts/build-images.sh
./scripts/compose-stack.sh up
```

访问地址默认是：

```text
frontend: http://127.0.0.1:3000
backend:  http://127.0.0.1:8000
pipeline: http://127.0.0.1:5002
vllm:     http://127.0.0.1:8080
```

常用命令：

```bash
./scripts/compose-stack.sh status
./scripts/compose-stack.sh logs pipeline
./scripts/compose-stack.sh down
./scripts/diagnose-stack.sh           # 可选传入测试图片路径
```

如果使用 Podman Compose，当前 compose 文件可以直接校验和启动；但
`scripts/*.sh` 仍按 Docker CLI 编写：

```bash
podman compose --env-file deploy/.env.example -f deploy/docker-compose.yml config
podman compose --env-file deploy/.env -f deploy/docker-compose.yml up -d
```

## Overlay 架构

构建上下文是仓库根目录，Dockerfile 会把上游源码作为输入再叠加本仓库 overlay：

- `deploy/images/pipeline/Dockerfile` 复制上游 `glmocr` 包，并加入 `deploy/overlays/pipeline/glmocr/wsgi.py`。
- `deploy/images/backend/Dockerfile` 复制上游 backend，并覆盖 `deploy/overlays/backend/app`、安装公式渲染器。
- `deploy/images/frontend/Dockerfile` 复制上游 WebUI，并覆盖 `deploy/overlays/frontend`。

`scripts/build-images.sh` 构建前会检查上游 worktree：

```bash
git -C upstream/glm-ocr status --short
```

输出必须为空，否则构建会中止。这用于保证正常部署路径不会把修改写进
`upstream/glm-ocr`。

## 运行配置

核心配置在 `deploy/.env`，初始值来自 `deploy/.env.example`。

### 模型缓存与离线开关

`HF_CACHE_DIR` 默认是 `../runtime/huggingface`，会挂载到 `vllm` 和
`pipeline` 容器内的 `/root/.cache/huggingface`。内网运行前需要提前准备
GLM-OCR 与 layout 模型缓存，并设置：

```bash
HF_HUB_OFFLINE=1
TRANSFORMERS_OFFLINE=1
```

### vLLM / GLM-OCR 推理设备

GLM-OCR 大模型由 `vllm` 服务运行，当前 compose 暴露这些参数：

```bash
MODEL_NAME=zai-org/GLM-OCR
SERVED_MODEL_NAME=glm-ocr
VLLM_DEVICE=cuda
VLLM_GPU_DEVICES=0
VLLM_TENSOR_PARALLEL_SIZE=1
VLLM_GPU_MEMORY_UTILIZATION=0.9
```

单 GPU CUDA 默认配置不需要修改。多 GPU 示例：

```bash
VLLM_DEVICE=cuda
VLLM_GPU_DEVICES=0,1
VLLM_TENSOR_PARALLEL_SIZE=2
```

CPU 示例：

```bash
VLLM_DEVICE=cpu
VLLM_GPU_DEVICES=none
```

注意：默认 `deploy/vllm/Dockerfile` 基于 `vllm/vllm-openai:latest-ubuntu2404`，
主要面向 CUDA；`VLLM_DEVICE=cpu` 还要求实际镜像支持 vLLM CPU 后端。

如需传入更多 vLLM 固定参数，可在 `deploy/docker-compose.yml` 的
`vllm.command` 中追加，或用 compose override 文件维护本地差异。

### layout 识别设备

layout 模型由 `pipeline` 服务运行。设备选择以 `LAYOUT_DEVICE` 为唯一生效入口：

```bash
LAYOUT_DEVICE=cuda:0
LAYOUT_GPU_DEVICES=0
```

- `LAYOUT_DEVICE=cpu` 强制 layout 走 CPU。
- `LAYOUT_DEVICE=cuda:0` 表示容器内第 0 张可见 GPU。
- `LAYOUT_GPU_DEVICES` 只控制暴露哪张宿主机物理 GPU 给 pipeline 容器。
- 如果要把宿主机 GPU 1 给 layout，用 `LAYOUT_GPU_DEVICES=1` 且仍保持 `LAYOUT_DEVICE=cuda:0`。
- layout 走 CPU 时建议同时设置 `LAYOUT_GPU_DEVICES=none`。

`scripts/diagnose-stack.sh` 会检查 `vllm` 的 `CUDA_VISIBLE_DEVICES`、
`--device`、`--tensor-parallel-size`，以及 `pipeline` 的
`GLMOCR_LAYOUT_DEVICE` 和 `CUDA_VISIBLE_DEVICES`。

### pipeline 服务

pipeline 默认用 `gunicorn` WSGI 方式运行：

```bash
PIPELINE_SERVER_MODE=gunicorn
PIPELINE_GUNICORN_WORKERS=1
PIPELINE_GUNICORN_THREADS=8
PIPELINE_GUNICORN_TIMEOUT=300
```

需要回退到上游 Flask 启动方式时可设置：

```bash
PIPELINE_SERVER_MODE=flask
```

本部署栈在 `deploy/glm-ocr/server.config.yaml` 和环境变量中固定自托管模式：

```bash
GLMOCR_MODE=selfhosted
GLMOCR_OCR_API_HOST=vllm
GLMOCR_OCR_API_PORT=8000
GLMOCR_OCR_MODEL=glm-ocr
```

## 公式 WebUI 与 API

WebUI 上传区支持两种处理模式：

- `文档 OCR`：提交 `processing_mode=pipeline`，保留完整 Markdown、JSON、layout 结果，同时从结构化结果中提取公式列表。
- `公式识别`：提交 `processing_mode=formula`，拖拽上传、文件选择和粘贴图片都会沿用当前选择；任务完成后结果区自动切换到“公式” Tab。

公式识别模式复用现有 pipeline，不新增第五个服务。backend 在 OCR 阶段和结果合并阶段都会过滤非公式块：

- 保留 `formula`、`equation`、`isolated_formula`、`inline_formula` 等公式内容块。
- 丢弃 `formula_number`、`equation_number` 以及普通文本、表格、图片等非公式块。
- 如果上游没有返回 layout label，只接受纯公式内容，避免把包含行内公式的正文段落当成公式任务结果。

结果数据会包含结构化公式字段：

```json
{
  "layout_type": "formula",
  "formula_id": "formula-p0001-b7",
  "formula": { "latex": "E = mc^2" }
}
```

结果区包含 `Markdown / JSON / 公式` 三个 Tab。公式 Tab 支持：

- 公式列表、页码、区域定位、LaTeX 源码和 KaTeX 预览。
- 与 PDF/图片预览中的公式 block 双向高亮。
- 搜索公式 ID 或 LaTeX 内容。
- 复制 LaTeX、MathML、UnicodeMath。
- 批量导出 zip。

后端接口：

```text
GET  /api/v1/tasks/{task_id}/formulas
POST /api/v1/formulas/render
GET  /api/v1/tasks/{task_id}/formulas/export?formats=latex,mathml,unicodemath,png
```

`POST /api/v1/formulas/render` 请求体示例：

```json
{ "latex": "E = mc^2", "format": "png" }
```

支持格式：

- `latex` / `tex`
- `mathml` / `mml`
- `unicodemath` / `unicode` / `um`
- `png`

批量导出返回 zip，包含每个公式的目标格式文件和 `manifest.json`。单个坏公式不会导致整个 zip 失败，会写入对应的 `*.error.txt` 并在
`manifest.json` 中记录错误。

## 离线与内网部署

运行期不依赖公网 CDN：

- PDF.js worker、cmaps、standard fonts 在 frontend 镜像构建阶段复制到 `public/pdfjs`，运行期由 nginx 的 `/pdfjs/` 本地路径提供。
- WebUI 的 API 请求走同源 `/api/`，由 nginx 代理到 `backend:8000`。
- 公式渲染在 backend 容器内完成，`mathjax-full@3.2.2` 固定在 `deploy/overlays/backend/formula-renderer/package-lock.json`，PNG 通过本地 `rsvg-convert` 栅格化。

构建期仍需要可访问的 apt、PyPI、npm、镜像仓库或内部镜像源。相关入口：

```bash
PYPI_INDEX_URL=https://mirrors.tuna.tsinghua.edu.cn/pypi/web/simple
NPM_REGISTRY_URL=https://registry.npmmirror.com
```

内网只运行镜像时，需要同时准备：

- 四个已导入的镜像 tag，与 `deploy/.env` 中 `*_IMAGE` 一致。
- `deploy/docker-compose.yml` 与同版本 `deploy/.env`。
- 已缓存的 HuggingFace 模型目录。
- `runtime/backend-data` 可写数据目录。

## 镜像构建与迁移

构建四个镜像：

```bash
./scripts/build-images.sh
```

导出镜像包：

```bash
./scripts/save-images.sh
./scripts/save-images.sh ./runtime/glm-ocr-4images.tar
```

导入并启动：

```bash
docker load -i ./glm-ocr-4images.tar
./scripts/compose-stack.sh up
```

Podman 环境可使用：

```bash
podman load -i ./glm-ocr-4images.tar
podman compose --env-file deploy/.env -f deploy/docker-compose.yml up -d
```

## 校验命令

轻量静态检查：

```bash
bash -n scripts/*.sh
git diff --check
git -C upstream/glm-ocr status --short
```

Compose 配置检查：

```bash
docker compose --env-file deploy/.env.example -f deploy/docker-compose.yml config
podman compose --env-file deploy/.env.example -f deploy/docker-compose.yml config
```

服务启动后检查：

```bash
./scripts/diagnose-stack.sh
./scripts/diagnose-stack.sh /path/to/test-image.png
```

公式服务的核心逻辑覆盖在：

```text
deploy/overlays/backend/tests/test_formula_service.py
deploy/overlays/frontend/src/routes/_ocr/-FileUpload.test.tsx
deploy/overlays/frontend/src/routes/_ocr/-OCRResults.test.tsx
```

## Patch Queue 兼容流程

`patches/glm-ocr/series` 当前只作为历史兼容机制保留。正常
`build-images.sh` 和 `compose-stack.sh up` 都不会应用补丁。

临时验证旧补丁：

```bash
./scripts/patch-queue-check.sh
./scripts/compose-stack.sh check-patches
```

确实需要把补丁应用到 submodule 时：

```bash
./scripts/patch-queue-apply.sh
```

更新补丁文件：

```bash
./scripts/patch-queue-refresh.sh 0001-add-dockerfile-pipeline.patch Dockerfile.pipeline
```

## 上游同步

```bash
./scripts/compose-stack.sh pull-submodule
git -C upstream/glm-ocr status --short
```

同步后如果上游默认行为变化，优先在 `deploy/overlays/` 或
`deploy/glm-ocr/server.config.yaml` 中适配，避免把部署定制直接写入
`upstream/glm-ocr`。
