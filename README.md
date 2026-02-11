# finicialSolver

面向 `GLM-OCR` 的外层部署仓库，目标是：
- 上游仓库以 `git submodule` 管理，便于同步；
- 四个服务统一在一个 `docker compose` 文件中编排；
- 本地定制通过 `patch queue` 维护，避免长期污染上游；
- 适配离线迁移：仅需打包并导入 4 个镜像。

## 目录结构

```text
.
├── .gitmodules
├── deploy/
│   ├── docker-compose.yml             # 统一编排（vllm + pipeline + backend + frontend）
│   ├── .env.example                   # compose 环境变量样例
│   ├── glm-ocr/
│   │   └── server.config.yaml         # pipeline 服务配置
│   └── vllm/
│       └── Dockerfile                 # vLLM 镜像构建
├── patches/
│   └── glm-ocr/                       # 本地 patch queue
├── runtime/
│   ├── huggingface/                   # 统一 HF 缓存目录（宿主机）
│   └── backend-data/                  # backend 数据目录
├── scripts/
│   ├── compose-stack.sh               # compose 统一入口
│   ├── build-images.sh                # 分开构建四个镜像
│   ├── save-images.sh                 # 导出四镜像 tar 包
│   ├── diagnose-stack.sh              # 四容器链路诊断
│   ├── patch-queue-apply.sh           # 应用 patch queue
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

## 一体化 compose（四服务）

单文件：`deploy/docker-compose.yml`

包含服务：
- `vllm`（GLM-OCR 推理）
- `pipeline`（`upstream/glm-ocr/Dockerfile.pipeline`）
- `backend`（`upstream/glm-ocr/apps/backend`）
- `frontend`（`upstream/glm-ocr/apps/frontend`）

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
- layout 默认启用，且默认走 GPU。
- layout 绑定 GPU 只需改一个变量：`PIPELINE_LAYOUT_GPU_DEVICE`（在 `deploy/.env`）。
- 默认参数可在 `deploy/.env` 调整：
  - `PIPELINE_GUNICORN_WORKERS=1`
  - `PIPELINE_GUNICORN_THREADS=8`
  - `PIPELINE_GUNICORN_TIMEOUT=300`
- OCR 推理服务（vLLM）默认 `VLLM_GPU_MEMORY_UTILIZATION=0.9`。

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

## Patch Queue 流程

当前 `patches/glm-ocr/series` 中维护对 submodule 的补丁顺序，默认包含：
- `0001-add-dockerfile-pipeline.patch`（补充 `Dockerfile.pipeline` 与 WSGI 入口）
- `0002-backend-use-layout-ocr-url-env.patch`（backend 通过 env 访问 pipeline）
- `0003-backend-handle-missing-page-size.patch`（backend 布局解析容错）

应用补丁：

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
```
