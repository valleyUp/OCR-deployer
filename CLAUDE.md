# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

本仓库是 GLM-OCR 的部署外壳，通过 Docker Compose 编排四个服务：

| 服务 | 端口 | 职责 |
|------|------|------|
| vllm | 8080 | 运行 GLM-OCR 大模型推理（GPU） |
| pipeline | 5002 | Layout 分析 + OCR 编排（Flask/WSGI） |
| backend | 8000 | FastAPI 任务管理、公式渲染、文件服务 |
| frontend | 3000 | WebUI（React/TypeScript，nginx 代理） |

上游源码在 `upstream/glm-ocr`（git submodule），本仓库通过 overlay 机制叠加定制功能，不直接修改上游代码。

## 常用命令

### 构建与部署

```bash
# 构建全部四个镜像（要求 upstream worktree 干净）
./scripts/build-images.sh

# 启动服务栈
./scripts/compose-stack.sh up

# 查看服务状态
./scripts/compose-stack.sh status

# 查看特定服务日志
./scripts/compose-stack.sh logs pipeline

# 停止服务
./scripts/compose-stack.sh down

# 诊断服务链路和设备配置
./scripts/diagnose-stack.sh
```

### 测试

后端 overlay 测试位于 `deploy/overlays/backend/tests/`，使用 pytest：

```bash
# 在 backend 容器内运行测试
docker exec -it glm-ocr-backend pytest /app/tests/

# 运行单个测试文件
docker exec -it glm-ocr-backend pytest /app/tests/test_formula_service.py

# 运行单个测试
docker exec -it glm-ocr-backend pytest /app/tests/test_formula_service.py::test_extracts_structured_formula_blocks
```

### 校验

```bash
# Shell 脚本语法检查
bash -n scripts/*.sh

# Compose 配置校验
docker compose --env-file deploy/.env.example -f deploy/docker-compose.yml config
```

## 架构要点

### Overlay 机制

构建上下文是仓库根目录，Dockerfile 复制上游源码后叠加本仓库 overlay：

- `deploy/images/backend/Dockerfile` → 复制上游 backend + `deploy/overlays/backend/app/`
- `deploy/images/pipeline/Dockerfile` → 复制上游 glmocr 包 + `deploy/overlays/pipeline/`
- `deploy/images/frontend/Dockerfile` → 复制上游 WebUI + `deploy/overlays/frontend/`

`build-images.sh` 会检查 `upstream/glm-ocr` 必须为 clean worktree，否则中止构建。如需适配上游变化，优先修改 overlay 而非上游。

### Backend API 核心路径

所有 API 前缀为 `/api/v1`，关键端点：

| 方法 | 路径 | 用途 |
|------|------|------|
| POST | `/tasks/upload` | 上传文件创建 OCR 任务 |
| GET | `/tasks/{task_id}` | 查询任务状态和结果 |
| GET | `/tasks/file?path=...` | 读取任务关联的文件 |
| DELETE | `/tasks/{task_id}` | 删除任务及文件 |
| GET | `/tasks/{task_id}/formulas` | 获取任务提取的公式列表 |
| POST | `/formulas/render` | 渲染单个公式 |
| GET | `/tasks/{task_id}/formulas/export` | 批量导出公式 |

任务处理模式：
- `pipeline`：完整文档 OCR，返回 Markdown、JSON、layout 结果
- `formula`：仅提取公式块，过滤非公式内容

### OCR 结果格式

Pipeline 返回的 layout 结果结构：

```json
[
  {
    "index": 0,
    "label": "text",
    "bbox_2d": [100, 200, 800, 350],
    "content": "文本内容"
  },
  {
    "label": "table",
    "bbox_2d": [150, 400, 850, 700],
    "content": "<td>...</td>"
  },
  {
    "label": "formula",
    "bbox_2d": [200, 750, 600, 850],
    "content": "\\[ E = mc^2 \\]"
  }
]
```

支持的 label 类型：`text`、`table`、`formula`、`equation`、`isolated_formula`、`inline_formula`、`formula_number`、`equation_number`、`image`。

### 任务数据持久化

- 任务文件存储在 `runtime/backend-data/{task_id}/` 目录下
- 数据库使用 SQLite：`runtime/backend-data/tasks.db`
- 每个任务有 owner_hash 隔离，通过 cookie 识别匿名所有者

### 公式渲染

公式渲染在 backend 容器内完成：
- LaTeX → MathML/UnicodeMath：使用 `mathjax-full@3.2.2`（Node.js）
- LaTeX → SVG/PNG：使用容器内 TeX Live 数学包
- 渲染器入口：`/opt/formula-renderer/render-formula.cjs`

### Frontend 技术栈

- React + TypeScript
- TanStack Router（路由结构在 `deploy/overlays/frontend/src/routes/`）
- Zustand 状态管理（`deploy/overlays/frontend/src/store/`）
- nginx 代理 `/api/` 到 backend:8000
- PDF.js 资源本地化在 `public/pdfjs/`

## 配置与环境变量

核心配置文件：`deploy/.env`（从 `.env.example` 复制）

关键变量：
- `MODEL_NAME`：vLLM 加载的模型名（默认 `zai-org/GLM-OCR`）
- `VLLM_GPU_DEVICES`：暴露给 vLLM 的 GPU（默认 `0`）
- `LAYOUT_DEVICE`：pipeline layout 模型设备（`cuda:0` 或 `cpu`）
- `HF_HUB_OFFLINE`：离线模式开关（内网部署设为 `1`）
- `WORKER_COUNT`：backend 并发 worker 数（默认 `5`）

## 开发约定

- 所有新增功能优先放在 `deploy/overlays/` 对应目录，避免污染上游
- Backend Python 代码使用 async/await，数据库访问用 SQLAlchemy async session
- 测试文件命名：`test_*.py`，与源文件同目录或 `tests/` 目录
- Shell 脚本使用 `set -euo pipefail`，变量用 `${VAR:-default}` 提供默认值
- 提交前确保 `git -C upstream/glm-ocr status --short` 输出为空
