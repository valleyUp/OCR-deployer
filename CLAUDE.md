# CLAUDE.md

本文件为 AI Agent 与开发者提供仓库操作指南。`AGENTS.md` 为本文件的软链接，内容一致。

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

### Backend 与 Pipeline：职责区分

两者处于不同层次，**不要混用**：

| 维度 | Backend（`:8000`） | Pipeline（`:5002`） |
|------|-------------------|---------------------|
| **定位** | 面向用户/Agent 的**任务编排层** | 面向 Backend 的**推理执行层** |
| **典型调用方** | WebUI、curl、Python Agent、第三方集成 | 仅 Backend 内部（`LayoutAndOCRClient`） |
| **输入** | 原始文档（PDF / Word / 图片） | 单页渲染图（base64 data URL） |
| **输出** | 任务状态、合并后的 Markdown / layout JSON、公式列表、文件下载 | 单页的 layout blocks + 单页 Markdown |
| **状态** | 有状态：SQLite 任务库 + `runtime/backend-data/` 文件 | 无状态：同步请求-响应，不保存历史 |
| **认证** | 匿名 owner cookie（`ocr_owner_token`）隔离任务 | 无认证（依赖内网/Compose 网络隔离） |
| **适合场景** | 上传整份文档、批量提交多任务、轮询进度、查历史、公式导出 | 调试单页 OCR、验证 layout 模型、开发 pipeline overlay |

**Agent 选型原则：**

- **常规集成（推荐）**：只调 Backend `/api/v1/*`。Backend 负责 PDF 分页、任务队列、结果合并与持久化，内部再按页调用 Pipeline。
- **直接调 Pipeline**：仅用于开发调试或绕过任务系统的单页实验；需自行处理分页/合并，且无法使用 Backend 的任务管理与 owner 隔离。

整体调用链：

```
Agent / WebUI
    ↓  POST /api/v1/tasks/upload（原始文件 + cookie）
Backend（任务编排：分页、队列、合并、存储）
    ↓  POST /glmocr/parse（每页一次，容器内 HTTP）
Pipeline（layout 检测 + OCR 区域编排）
    ↓  OpenAI-compatible API
vLLM（GLM-OCR 大模型推理）
```

### 匿名 Owner 会话（Cookie 认证）

Backend 用 cookie 做**匿名设备级**任务隔离，没有用户名/密码，也**不支持** `Authorization` 请求头。

| 项目 | 说明 |
|------|------|
| Cookie 名称 | `ocr_owner_token`（环境变量 `OWNER_COOKIE_NAME`） |
| 是否需手动构造 | **不需要自己生成 token**；首次无 cookie 请求时，服务端自动生成并通过 `Set-Cookie` 下发 |
| 是否需持久化 | **必须持久化**；后续所有请求（上传、轮询、列表、删除）都要带上**同一份** cookie |
| 丢失 cookie 的后果 | 即使知道 `task_id`，查询也会返回 **404 Task not found**（任务绑定的是 token 的 SHA-256 哈希，非 task_id 本身） |
| 有效期 | 默认 365 天（`OWNER_COOKIE_MAX_AGE_DAYS`）；`HttpOnly`、`SameSite=Lax` |

**多任务场景**：同一 Agent 会话应复用同一 cookie 文件/客户端实例。每次请求若不带 cookie，服务端会签发**新 owner**，之前提交的任务对当前身份不可见。

推荐流程：

```bash
COOKIE_JAR=/tmp/ocr.cookies

# 1. 引导会话（可选但建议；上传接口也会在首次响应中 Set-Cookie）
curl -c "$COOKIE_JAR" -b "$COOKIE_JAR" http://127.0.0.1:8000/api/v1/session
# {"owner_id":"anon_<hash前缀>"}

# 2. 后续所有请求都带 -b "$COOKIE_JAR"（上传时同时 -c 以更新 cookie）
curl -c "$COOKIE_JAR" -b "$COOKIE_JAR" \
  -F "file=@a.pdf" -F "processing_mode=pipeline" \
  http://127.0.0.1:8000/api/v1/tasks/upload

curl -c "$COOKIE_JAR" -b "$COOKIE_JAR" \
  -F "file=@b.pdf" -F "processing_mode=formula" \
  http://127.0.0.1:8000/api/v1/tasks/upload

# 3. 列出当前 owner 的全部任务
curl -b "$COOKIE_JAR" http://127.0.0.1:8000/api/v1/tasks/

# 4. 轮询任一已提交任务（须同一 cookie）
curl -b "$COOKIE_JAR" "http://127.0.0.1:8000/api/v1/tasks/${TASK_ID}"
```

```python
"""多任务 + cookie 持久化示例。"""
import time
from pathlib import Path
import httpx

BASE = "http://127.0.0.1:8000/api/v1"
COOKIE_NAME = "ocr_owner_token"
TOKEN_FILE = Path(".ocr_owner_token")  # Agent 应持久化到磁盘，跨进程/重启复用

saved = TOKEN_FILE.read_text().strip() if TOKEN_FILE.exists() else None
initial_cookies = {COOKIE_NAME: saved} if saved else None

with httpx.Client(base_url=BASE, timeout=30.0, cookies=initial_cookies) as client:
    if not saved:
        client.get("/session")  # 服务端 Set-Cookie
        TOKEN_FILE.write_text(client.cookies.get(COOKIE_NAME, ""))

    task_ids = []
    for pdf in ("doc_a.pdf", "doc_b.pdf"):
        with open(pdf, "rb") as f:
            resp = client.post(
                "/tasks/upload",
                files={"file": (pdf, f, "application/pdf")},
                data={"processing_mode": "pipeline"},
            )
        resp.raise_for_status()
        task_ids.append(resp.json()["data"]["task_id"])

    # 列出本 owner 的全部任务（换 cookie 则列表为空或不含此前任务）
    listing = client.get("/tasks/").json()["data"]["tasks"]

    for task_id in task_ids:
        while True:
            data = client.get(f"/tasks/{task_id}").json()["data"]
            if data["status"] in ("completed", "failed"):
                break
            time.sleep(2)
```

实现见 [`deploy/overlays/backend/app/services/owner_service.py`](deploy/overlays/backend/app/services/owner_service.py)；隔离行为有测试覆盖：[`test_task_owner_isolation.py`](deploy/overlays/backend/tests/test_task_owner_isolation.py)。

### Backend 对外 API（Agent 入口）

所有 API 前缀为 `/api/v1`，基址 `http://127.0.0.1:8000/api/v1`（经 frontend/nginx 时为 `http://127.0.0.1:3000/api/v1`）。**除 `GET /config` 与 `POST /formulas/render` 外，任务相关接口均受 cookie 约束。**

关键端点：

| 方法 | 路径 | 需 cookie | 用途 |
|------|------|-----------|------|
| GET | `/session` | 签发/复用 | 获取 `owner_id`，引导匿名会话 |
| GET | `/config` | 否 | 读取运行时配置（上传上限、并发等） |
| POST | `/tasks/upload` | 是 | 上传文件创建 OCR 任务 |
| GET | `/tasks/` | 是 | 列出当前 owner 的任务 |
| GET | `/tasks/{task_id}` | 是 | 查询任务状态和结果 |
| GET | `/tasks/file?path=...` | 是 | 读取任务关联的文件 |
| DELETE | `/tasks/{task_id}` | 是 | 删除任务及文件 |
| GET | `/tasks/{task_id}/formulas` | 是 | 获取任务提取的公式列表 |
| POST | `/formulas/render` | 否 | 渲染单个公式 |
| GET | `/tasks/{task_id}/formulas/export` | 是 | 批量导出公式 |

任务处理模式（`processing_mode` 表单字段）：
- `pipeline`：完整文档 OCR，返回 Markdown、JSON、layout 结果
- `formula`：仅提取公式块，过滤非公式内容

#### 示例：单任务上传并轮询

```bash
# 1. 上传 PDF，完整文档 OCR
curl -c /tmp/ocr.cookies -b /tmp/ocr.cookies \
  -F "file=@document.pdf" \
  -F "processing_mode=pipeline" \
  -F "output_format=markdown" \
  http://127.0.0.1:8000/api/v1/tasks/upload

# 响应示例（201）：
# {"success":true,"data":{"task_id":"...","document_id":"...","status":"pending"},...}

# 2. 轮询任务状态（status: pending → processing → completed）
TASK_ID="<从上一步获取>"
curl -b /tmp/ocr.cookies "http://127.0.0.1:8000/api/v1/tasks/${TASK_ID}"

# 3. completed 后响应 data 含 full_markdown、layout、formulas 等字段
```

```bash
# 公式识别模式
curl -c /tmp/ocr.cookies -b /tmp/ocr.cookies \
  -F "file=@paper.pdf" \
  -F "processing_mode=formula" \
  http://127.0.0.1:8000/api/v1/tasks/upload

# 获取公式列表
curl -b /tmp/ocr.cookies "http://127.0.0.1:8000/api/v1/tasks/${TASK_ID}/formulas"

# 渲染单个公式为 PNG
curl -X POST http://127.0.0.1:8000/api/v1/formulas/render \
  -H "Content-Type: application/json" \
  -d '{"latex":"E = mc^2","format":"png"}' \
  --output formula.png
```

```python
"""单任务示例：同一 Client 实例自动保持 cookie（进程内有效）。"""
import time
import httpx

BASE = "http://127.0.0.1:8000/api/v1"

with httpx.Client(base_url=BASE, timeout=30.0) as client:
    client.get("/session")  # 先拿 cookie；跨进程/重启须按上文持久化 token

    with open("document.pdf", "rb") as f:
        resp = client.post(
            "/tasks/upload",
            files={"file": ("document.pdf", f, "application/pdf")},
            data={"processing_mode": "pipeline", "output_format": "markdown"},
        )
    resp.raise_for_status()
    task_id = resp.json()["data"]["task_id"]

    for _ in range(120):
        data = client.get(f"/tasks/{task_id}").json()["data"]
        if data["status"] == "completed":
            print(data.get("full_markdown", "")[:500])
            break
        if data["status"] == "failed":
            raise RuntimeError(data.get("error_message"))
        time.sleep(2)
```

#### 示例：读取运行时配置

```bash
curl http://127.0.0.1:8000/api/v1/config
# {"max_upload_mb":100,"worker_count":5,"max_concurrent_tasks":5,
#  "layout_page_parallelism":1,"task_timeout":3600}
```

### Backend 内部调用 Pipeline（开发者参考）

> **本节描述 Backend 与 Pipeline 之间的内部 HTTP 契约，不是 Agent 的常规入口。** Agent 应通过上一节的 Backend API 提交任务；仅在调试 layout/OCR 或开发 overlay 时才需直接访问 Pipeline。

Backend worker 在处理任务时，将每页渲染图 POST 给 Pipeline；Pipeline 完成 layout 检测与区域 OCR 编排后，再调用 vLLM。Backend **不直接调用 vLLM**。

关键源码：

- 客户端：[`deploy/overlays/backend/app/core/ocr_client.py`](deploy/overlays/backend/app/core/ocr_client.py)（`LayoutAndOCRClient`）
- 分页编排：[`deploy/overlays/backend/app/core/steps/layout_ocr.py`](deploy/overlays/backend/app/core/steps/layout_ocr.py)
- Pipeline HTTP 入口：[`deploy/overlays/pipeline/glmocr/server.py`](deploy/overlays/pipeline/glmocr/server.py)
- Pipeline 自托管配置：[`deploy/glm-ocr/server.config.yaml`](deploy/glm-ocr/server.config.yaml)

#### Pipeline HTTP 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/glmocr/parse` | 主解析接口（backend 唯一调用点） |
| `GET` | `/health` | 健康检查，返回 `{"status":"ok"}` |

默认 URL（容器间）：`http://pipeline:5002/glmocr/parse`，由环境变量 `LAYOUT_OCR_URL` 配置。

#### 请求契约

**Content-Type:** `application/json`

```json
{
  "images": ["data:image/png;base64,<base64-encoded-page>"],
  "processing_mode": "pipeline",
  "prompt": "<optional>"
}
```

| 字段 | 必填 | 说明 |
|------|------|------|
| `images` | 是 | 页图 URL 列表；backend 将本地渲染页编码为 `data:` URL。也支持 `http(s):` / `file:`（pipeline overlay 兼容上游 `file` 单图字段） |
| `processing_mode` | 否 | `"pipeline"`（默认）或 `"formula"` |
| `prompt` | 否 | 自定义 OCR 提示词；`formula` 模式未指定时使用 `FORMULA_MODE_PROMPT` |

**调用约束（修改或集成时必须遵守）：**

1. **一页一请求**：`layout_ocr.py` 对每页调用 `process_single_image()`，禁止将整份 PDF 原始文件直接 POST 给 pipeline
2. **输入为渲染页图**：PDF/Word 先经 `pdf_to_image` 步骤转为 PNG/JPEG
3. **无 HTTP 客户端重试**：`LayoutAndOCRClient` 单次请求，失败抛 `ServiceRequestError` / `ServiceResponseError`；任务级重试由 backend worker 负责（默认最多 3 次）
4. **超时层级**：client **120s**（硬编码）< Gunicorn **300s**（`PIPELINE_GUNICORN_TIMEOUT`）< 任务锁 **3600s**（`TASK_TIMEOUT`）
5. **并发**：`LAYOUT_PAGE_PARALLELISM`（默认 1）限流单任务内多页并行；pipeline 侧 Gunicorn 默认 `workers=1, threads=8`，且 overlay 用 `threading.Lock` 串行化 `pipeline.process()`
6. **TLS**：client 使用 `verify=False`（内网部署假设）
7. **自定义 URL**：upload 的 `custom_url` 仅在 `ALLOW_CUSTOM_OCR_URLS=true` 时可用；须为 http(s) 且不得指向私网/本机（除非配置 `CUSTOM_OCR_ALLOWED_HOSTS` 白名单）

#### 响应契约

成功 `200`：

```json
{
  "json_result": [
    [
      {"index": 0, "label": "text", "bbox_2d": [100, 200, 800, 350], "content": "文本内容"},
      {"index": 1, "label": "formula", "bbox_2d": [200, 750, 600, 850], "content": "\\[ E = mc^2 \\]"}
    ]
  ],
  "markdown_result": "# 标题\n\n文本内容...",
  "layout_details": "<同 json_result>",
  "md_results": "<同 markdown_result>"
}
```

- `json_result` 类型为 `List[List[Block]]`；单页调用时 backend 取 `results[0]`
- `image` 块 `content` 可为 `null`；backend 会按 `bbox_2d` 裁剪落盘

错误响应：

| 状态 | body 示例 | 场景 |
|------|-----------|------|
| 400 | `{"error":"No images provided"}` | 缺少图片 |
| 400 | `{"error":"Invalid JSON payload"}` | JSON 非法 |
| 500 | `{"error":"Parse error: ..."}` | pipeline 内部异常 |

Backend 只解析响应中的 `json_result` 字段；缺失时抛 `ServiceResponseError`。

#### 示例：直接调用 Pipeline（仅调试 / 开发）

```bash
# 健康检查
curl http://127.0.0.1:5002/health

# 单页图片 OCR（与 backend 发送格式一致）
python3 - <<'PY'
import base64, json, httpx, sys
img_path = sys.argv[1] if len(sys.argv) > 1 else "page.png"
with open(img_path, "rb") as f:
    b64 = base64.b64encode(f.read()).decode()
payload = {
    "images": [f"data:image/png;base64,{b64}"],
    "processing_mode": "pipeline",
}
resp = httpx.post(
    "http://127.0.0.1:5002/glmocr/parse",
    json=payload,
    timeout=120.0,
)
print(resp.status_code)
data = resp.json()
blocks = data.get("json_result", [[]])[0]
print(f"blocks: {len(blocks)}")
print(json.dumps(blocks[:2], ensure_ascii=False, indent=2))
PY
```

```python
"""与 backend LayoutAndOCRClient 等价的 pipeline 调用示例。"""
import base64
from pathlib import Path
import httpx

PIPELINE_URL = "http://127.0.0.1:5002/glmocr/parse"

def encode_page(path: str) -> str:
    data = Path(path).read_bytes()
    mime = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg"}.get(
        Path(path).suffix.lower(), "image/png"
    )
    return f"data:{mime};base64,{base64.b64encode(data).decode()}"

async def parse_page(image_path: str, processing_mode: str = "pipeline") -> list[dict]:
    payload = {
        "images": [encode_page(image_path)],
        "processing_mode": processing_mode,
    }
    async with httpx.AsyncClient(timeout=120.0, verify=False) as client:
        resp = await client.post(PIPELINE_URL, json=payload)
        resp.raise_for_status()
        result = resp.json()
        return result["json_result"][0]
```

#### processing_mode 行为差异

| 模式 | Pipeline overlay | Backend 后处理 |
|------|------------------|----------------|
| `pipeline` | 默认 layout 映射 | 保留全部块 |
| `formula` | 剥离 `inline_formula` label；注入 formula task prompt | `should_keep_formula_mode_block()` 过滤非公式块 |

两种模式均走同一 `PipelineFlow`（`deploy/overlays/backend/app/core/flows/__init__.py`）。

#### Pipeline 相关环境变量

| 变量 | 默认 | 作用 |
|------|------|------|
| `LAYOUT_OCR_URL` | `http://pipeline:5002/glmocr/parse` | backend → pipeline 地址 |
| `LAYOUT_PAGE_PARALLELISM` | `1` | 单任务内分页并行度 |
| `ALLOW_CUSTOM_OCR_URLS` | `false` | 是否允许 upload 指定 `custom_url` |
| `CUSTOM_OCR_ALLOWED_HOSTS` | `""` | `custom_url` host 白名单（逗号分隔） |
| `LAYOUT_DEVICE` / `LAYOUT_GPU_DEVICES` | `cuda:0` / `0` | pipeline layout 模型设备 |
| `PIPELINE_GUNICORN_TIMEOUT` | `300` | pipeline worker 超时（秒） |

#### 修改 pipeline 集成时的检查清单

- 改请求字段 → 同时更新 `ocr_client.py` 载荷构造 **和** `pipeline/glmocr/server.py` 解析逻辑
- 改超时 → 保持 client(120s) ≤ gunicorn(300s) 层级关系，或同步上调
- 改并行 → 评估 `LAYOUT_PAGE_PARALLELISM` 与 pipeline `Lock` 瓶颈
- 新增 `processing_mode` → 更新 `SUPPORTED_PROCESSING_MODES`、`server.py` overlay、merge/filter 逻辑
- 补充测试 → `deploy/overlays/backend/tests/test_*.py`

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
- 每个任务绑定 `owner_hash`（cookie token 的 SHA-256）；查询/删除须携带签发该任务时的同一 cookie（见上文「匿名 Owner 会话」）

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
- `LAYOUT_OCR_URL`：backend 调用 pipeline 的地址（默认 `http://pipeline:5002/glmocr/parse`）
- `LAYOUT_PAGE_PARALLELISM`：单任务内分页并行度（默认 `1`）
- `HF_HUB_OFFLINE`：离线模式开关（内网部署设为 `1`）
- `WORKER_COUNT`：backend 并发 worker 数（默认 `5`）
- `MAX_UPLOAD_MB`：单文件上传上限（默认 `100`）

## 开发约定

- 所有新增功能优先放在 `deploy/overlays/` 对应目录，避免污染上游
- Backend Python 代码使用 async/await，数据库访问用 SQLAlchemy async session
- 测试文件命名：`test_*.py`，与源文件同目录或 `tests/` 目录
- Shell 脚本使用 `set -euo pipefail`，变量用 `${VAR:-default}` 提供默认值
- 提交前确保 `git -C upstream/glm-ocr status --short` 输出为空
