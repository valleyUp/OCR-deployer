# OCR Deployer

面向 `GLM-OCR` 的外层部署仓库，目标是：
- 上游仓库以 `git submodule` 管理，便于同步；
- 四个服务统一在一个 `docker compose` 文件中编排；
- 本地定制通过 overlay 维护，正常构建不修改 `upstream/glm-ocr`；
- 适配离线迁移：仅需打包并导入 4 个镜像。

## 目录结构

```text
.
├── .gitmodules
├── deploy/
│   ├── docker-compose.yml             # 统一编排（vllm + pipeline + backend + frontend）
│   ├── .env.example                   # compose 环境变量样例
│   ├── images/                        # 本仓库自定义镜像 Dockerfile
│   ├── overlays/                      # pipeline/backend/frontend 覆盖文件
│   ├── glm-ocr/
│   │   └── server.config.yaml         # pipeline 服务配置
│   └── vllm/
│       └── Dockerfile                 # vLLM 镜像构建
├── patches/
│   └── glm-ocr/                       # 兼容 patch queue，正常 series 为空
├── runtime/
│   ├── huggingface/                   # 统一 HF 缓存目录（宿主机）
│   └── backend-data/                  # backend 数据目录
├── scripts/
│   ├── compose-stack.sh               # compose 统一入口
│   ├── build-images.sh                # 分开构建四个镜像
│   ├── save-images.sh                 # 导出四镜像 tar 包
│   ├── diagnose-stack.sh              # 四容器链路诊断
│   ├── patch-queue-apply.sh           # 应用 patch queue
│   ├── patch-queue-check.sh           # 在临时目录验证 patch queue
│   ├── patch-queue-refresh.sh         # 刷新 patch
│   └── status.sh                      # 查看根仓+submodule状态
└── upstream/
    └── glm-ocr/                       # 上游 submodule
```

## 统一 HuggingFace 缓存路径

统一使用环境变量 `HF_CACHE_DIR`，默认：`../runtime/huggingface`（相对 `deploy/docker-compose.yml`）。

- vLLM 容器挂载到：`/root/.cache/huggingface`
- pipeline 容器挂载到：`/root/.cache/huggingface`
- 两个容器内统一设置：
  - `HF_HOME=/root/.cache/huggingface`
  - `TRANSFORMERS_CACHE=/root/.cache/huggingface`
  - `HF_HUB_CACHE=/root/.cache/huggingface/hub`

## Overlay 架构

正常部署路径以 `upstream/glm-ocr` 为只读源码输入，从仓库根目录构建：

- `deploy/images/pipeline/Dockerfile` 复制上游 `glmocr` 包，再叠加 `deploy/overlays/pipeline` 中的 WSGI 入口。
- `deploy/images/backend/Dockerfile` 复制上游 backend，再叠加 `deploy/overlays/backend` 中的 API、公式服务和渲染脚本。
- `deploy/images/frontend/Dockerfile` 复制上游 WebUI，再叠加 `deploy/overlays/frontend` 中的页面、同源 nginx 代理和离线 PDF.js 资源配置。

`scripts/build-images.sh` 会在构建前检查：

```bash
git -C upstream/glm-ocr status --short
```

输出必须为空。这样可以确认本仓库构建不会把补丁写入 submodule。

## 一体化 compose（四服务）

单文件：`deploy/docker-compose.yml`

包含服务：
- `vllm`（GLM-OCR 推理）
- `pipeline`（`deploy/images/pipeline` + `deploy/overlays/pipeline`）
- `backend`（`deploy/images/backend` + `deploy/overlays/backend`）
- `frontend`（`deploy/images/frontend` + `deploy/overlays/frontend`）

启动：

```bash
./scripts/compose-stack.sh up
```

常用：

```bash
./scripts/compose-stack.sh status
./scripts/compose-stack.sh logs pipeline
./scripts/compose-stack.sh down
./scripts/diagnose-stack.sh           # 可选: 传入测试图片路径
```

### 生产建议（pipeline 使用 WSGI）

- pipeline 容器默认以 `gunicorn`（WSGI）启动，可用 `PIPELINE_SERVER_MODE=flask` 回退。
- 新版上游默认 MaaS 云模式，本部署栈在 `deploy/glm-ocr/server.config.yaml` 与 `GLMOCR_MODE=selfhosted` 中显式固定为自托管模式。
- layout 默认启用，且默认走 GPU。
- layout 绑定 GPU 只需改一个变量：`PIPELINE_LAYOUT_GPU_DEVICE`（在 `deploy/.env`）。
- 默认参数可在 `deploy/.env` 调整：
  - `PIPELINE_GUNICORN_WORKERS=1`
  - `PIPELINE_GUNICORN_THREADS=8`
  - `PIPELINE_GUNICORN_TIMEOUT=300`
- OCR 推理服务（vLLM）默认 `VLLM_GPU_MEMORY_UTILIZATION=0.9`。

## 公式 WebUI 与 API

WebUI 上传区提供两种模式：

- `文档 OCR`：提交 `processing_mode=pipeline`，保留完整 OCR 结果。
- `公式识别`：提交 `processing_mode=formula`，复用现有 pipeline，并在 backend 结果合并阶段保留公式块和稳定 `formula_id`。

结果区包含 `Markdown / JSON / 公式` 三个 Tab。公式 Tab 显示公式页码、区域定位、LaTeX 源码、KaTeX 预览和导出按钮，并与 PDF/图片预览高亮联动。

新增后端接口：

```text
GET  /api/v1/tasks/{task_id}/formulas
POST /api/v1/formulas/render          # { "latex": "...", "format": "latex|mathml|png" }
GET  /api/v1/tasks/{task_id}/formulas/export?formats=latex,mathml,png
```

backend 镜像固定安装 `mathjax-full@3.2.2`，MathML 由 MathJax 生成，PNG 通过 MathJax SVG 与 `rsvg-convert` 栅格化；构建时可用 `NPM_REGISTRY_URL` 指定 npm 镜像源。

## 镜像构建与离线迁移

### 1) 分开构建四个镜像

```bash
./scripts/build-images.sh
```

### 2) 导出为一个 tar 包

```bash
./scripts/save-images.sh
# 或指定输出路径
./scripts/save-images.sh ./runtime/glm-ocr-4images.tar
```

### 3) 在内网服务器导入并启动

```bash
docker load -i ./glm-ocr-4images.tar
# 准备好同版本 deploy/docker-compose.yml 与 deploy/.env
./scripts/compose-stack.sh up
```

> 内网部署时，确保 `deploy/.env` 中镜像 tag 与 `docker load` 导入后的 tag 一致。

## Patch Queue 兼容流程

`patches/glm-ocr/series` 现在默认仅保留注释。patch queue 只作为历史兼容机制存在，正常 `build-images.sh` 和 `compose-stack.sh up` 都不会应用补丁。

如果确实需要临时验证旧补丁：

```bash
./scripts/patch-queue-apply.sh
```

同步或更新 upstream 后，先在临时目录验证补丁队列：

```bash
./scripts/patch-queue-check.sh
# 或
./scripts/compose-stack.sh check-patches
```

更新补丁文件：

```bash
./scripts/patch-queue-refresh.sh 0001-add-dockerfile-pipeline.patch Dockerfile.pipeline
```

## 上游同步

```bash
./scripts/compose-stack.sh pull-submodule
```

同步完成后建议确认上游仍然干净：

```bash
git -C upstream/glm-ocr status --short
```
