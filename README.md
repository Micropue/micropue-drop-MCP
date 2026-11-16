# DROP MCP Server

把本地静态站点发布到 [DROP](https://drop.micropue.com.cn) 的 MCP 服务器。它通过 MCP 工具完成：

1. 检查 DROP API Key 和账号信息。
2. 查询已有项目。
3. 按 slug 自动创建项目，或原子替换已有项目的内容快照。
4. 返回可访问的公开地址。

服务使用 MCP `stdio` 传输，适合 Codex、Claude Desktop、Cursor 等支持 MCP 的客户端。

## 工作机制

MCP 服务器本质上是一个由宿主启动的进程：

- 客户端通过 stdin 发送 JSON-RPC 消息，通过 stdout 接收响应。
- 服务器声明名称、版本和能力，并注册工具及其 JSON Schema 输入参数。
- 模型先读取 `tools/list`，再按工具 schema 生成 `tools/call` 参数。
- 本服务器校验参数和本地目录，调用 DROP REST API，最后把文本和结构化结果返回客户端。
- `stdout` 只用于 MCP 协议；诊断日志只能写入 `stderr`，否则会破坏协议。

## 已提供的工具

| 工具 | 作用 | 是否读写 |
| --- | --- | --- |
| `drop_whoami` | 检查 Key 是否可用，返回账号、Key scopes 和限制 | 只读 |
| `drop_list_projects` | 按名称/slug 搜索项目，支持分页和排序 | 只读 |
| `drop_get_project` | 按 `projectId` 或 `slug` 获取项目及文件 | 只读 |
| `drop_publish_site` | 创建或部署静态站点，返回公开 URL | 写入 |

建议发布前先调用一次 `drop_whoami`，确认 Key 具备：

- `projects:read`
- `projects:write`
- `deployments:write`

## 环境要求

- Node.js 20 或更高版本
- 一个可用的 DROP API Key

## 安装

包已发布为 `@micropue/drop-mcp` 时，不需要全局安装。在 MCP 客户端中通过 `npx` 启动：

```json
{
  "mcpServers": {
    "drop": {
      "command": "npx",
      "args": ["-y", "@micropue/drop-mcp"],
      "env": {
        "DROP_API_KEY": "your-api-key",
        "DROP_ALLOWED_ROOTS": "/path/to/sites"
      }
    }
  }
}
```

也可以在本地开发目录中执行 `npm install` 后使用 `npm run build`。构建入口为 `dist/index.js`。

## 本地开发

```bash
cd "/Users/micropue/Desktop/MICROPUE服务中心/drop-MCP"
npm install
npm run build
```

不构建时可以直接运行 `npm run dev`。发布 npm 包前会通过 `prepack` 自动重新构建 `dist/`。

## 配置

| 环境变量 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `DROP_API_KEY` | 是 | 无 | DROP Personal API Key |
| `DROP_API_BASE` | 否 | `https://drop.micropue.com.cn/v1` | DROP API Base URL |
| `DROP_REQUEST_TIMEOUT_MS` | 否 | `20000` | 请求超时，1000–120000 毫秒 |
| `DROP_ALLOWED_ROOTS` | 否 | MCP 进程当前目录 | 允许发布的本地目录；多个目录用系统路径分隔符分隔 |
| `DROP_ENV_FILE` | 否 | 项目根目录 `.env` | 可指定其他 env 文件；相对路径按 MCP 进程当前目录解析 |

复制 `.env.example` 为 `.env` 并填入 Key。服务器启动时会优先读取入口文件相邻的项目根目录 `.env`，然后尝试当前目录 `.env`。已经存在的进程环境变量优先级更高；也可以通过 `DROP_ENV_FILE` 指定其他文件。

macOS/Linux 上多个允许目录用 `:` 分隔：

```bash
export DROP_ALLOWED_ROOTS="/Users/micropue/Desktop/sites:/private/tmp/builds"
```

Windows 使用 `;` 分隔。

### Codex

在 `~/.codex/config.toml` 中增加：

```toml
[mcp_servers.drop]
command = "npx"
args = ["-y", "@micropue/drop-mcp"]
env = { DROP_API_KEY = "your-api-key", DROP_ALLOWED_ROOTS = "/path/to/sites" }
startup_timeout_sec = 20
```

### Claude Desktop

在 `claude_desktop_config.json` 中增加：

```json
{
  "mcpServers": {
    "drop": {
      "command": "npx",
      "args": ["-y", "@micropue/drop-mcp"],
      "env": {
        "DROP_API_KEY": "your-api-key",
        "DROP_ALLOWED_ROOTS": "/path/to/sites"
      }
    }
  }
}
```

修改配置后重启客户端。Key 也可以放在启动目录的 `.env` 中；不要把该文件提交到 Git。

## 发布站点

### 发布本地构建目录

让模型调用：

```json
{
  "slug": "my-site",
  "name": "My Site",
  "path": "/Users/micropue/Desktop/MICROPUE服务中心/my-site/dist",
  "message": "deploy from MCP"
}
```

`path` 必须位于 `DROP_ALLOWED_ROOTS` 中。建议始终使用绝对路径，因为相对路径会相对于 MCP 服务器进程的当前目录解析。

### 使用内联文件

```json
{
  "slug": "hello-drop",
  "files": [
    {
      "path": "index.html",
      "content": "<!doctype html><html><body><h1>Hello DROP</h1></body></html>"
    }
  ]
}
```

`path` 与 `files` 必须且只能提供一个。`name` 仅在首次创建项目时使用。

成功结果包含：

```json
{
  "ok": true,
  "action": "created",
  "url": "https://dropcontent.micropue.com.cn/username/my-site/",
  "projectId": "项目 UUID",
  "slug": "my-site",
  "revision": 1,
  "deploymentId": "部署 ID",
  "fileCount": 1,
  "totalBytes": 68
}
```

`action` 为 `created` 表示新建，`deployed` 表示替换了已有项目的文件快照。

## 部署行为

- 如果 slug 不存在，先 `POST /projects` 创建项目和首个部署。
- 如果 slug 已存在，用 `POST /projects/{id}/deploy` 原子替换文件；旧快照在失败时保持不变。
- 已有项目通过 `If-Match: "rev-N"` 做乐观并发控制。
- 遇到 `412 revision_conflict` 时重新读取项目并重试一次。
- 创建时遇到 `409` 会重新按 slug 查询，以处理并发创建竞争。
- 写请求都带 `Idempotency-Key`。
- 不会修改已有项目的名称、可见性或启用状态；若项目被停用或设置了密码，结果中会给出警告。

## DROP 限制

- 每个项目 1–20 个文件。
- 单文件最大 512 KiB。
- 项目总大小最大 1 MiB。
- 最多 50 个目录。
- 文件路径最长 120 个字符，目录路径最长 100 个字符。
- 只接受 `.html`、`.css`、`.js`，扩展名必须小写。
- 文件必须是有效 UTF-8 文本。
- 路径不能以 `/` 开头或结尾，不能包含 `.`、`..` 或连续 `/`。
- 目录发布默认跳过隐藏文件和 `node_modules`。
- 目录中出现符号链接时直接拒绝，避免读取允许根目录之外的内容。

典型前端构建目录可能包含 `.svg`、`.json`、`.ico`、字体或 source map。DROP v1 不能托管这些文件，因此需要先调整构建产物，或者显式设置：

```json
{
  "ignoreUnsupported": true
}
```

`ignoreUnsupported` 只会跳过文件，不会转换资源。若页面依赖被跳过的文件，站点可能无法正常工作。

## 调试

运行 MCP Inspector：

```bash
npm run build
npm run inspector
```

手动启动服务器：

```bash
node dist/index.js
```

服务器的 stdout 是 JSON-RPC 通道，不要在业务代码中向 stdout 打印日志。错误请使用 `console.error` 写入 stderr。

## 验证

```bash
npm run typecheck
npm test
npm run build
```

测试使用模拟 HTTP 响应，不会调用真实 DROP API。真实发布验证需要配置有效 Key。

## npm 自动发布

`.github/workflows/build-publish.yml` 会在以下场景运行：

- 推送 `v*` 标签，例如 `v0.1.0`
- 在 GitHub Actions 页面手动运行 `workflow_dispatch`

工作流会执行测试与构建、生成 npm tarball、上传 GitHub Actions artifact，然后发布到 npm。

首次使用前：

1. 在 npm 账号下创建可发布 `@micropue` scope 的 Granular Access Token，并按 CI 发布需要配置 2FA 绕过权限。
2. 在 GitHub 仓库的 `Settings > Secrets and variables > Actions` 中添加名为 `NPM_TOKEN` 的 Repository secret。
3. 推送代码后，推送与 `package.json` 版本一致的标签：

```bash
git tag v0.1.0
git push origin v0.1.0
```

工作流会拒绝版本与标签不一致、或 npm 上已存在的同版本包。手动运行时，也会发布当前 `package.json` 中的版本。包以公开 scoped 包形式发布；公开仓库会启用 npm provenance，私有仓库会自动跳过 provenance。

## 常见错误

| 错误 | 处理方式 |
| --- | --- |
| `missing_api_key` | 在项目 `.env` 或 MCP 客户端 `env` 中配置 `DROP_API_KEY` |
| HTTP 401 | Key 无效、过期或被撤销，请重新创建 |
| HTTP 403 | 给 Key 增加读项目和部署所需 scopes |
| HTTP 409 | slug 已被其他项目占用，或并发创建发生冲突 |
| HTTP 412 | 项目 revision 已变化；服务器会自动重试一次 |
| HTTP 413 | 文件数量或大小超过 DROP 限制 |
| HTTP 422 | 文件类型、路径或项目参数未通过校验 |
| HTTP 429 | 触发限流，按返回的 Retry-After 稍后重试 |
| HTTP 503 | DROP 服务暂时不可用，稍后重试 |

## 代码结构

| 文件 | 职责 |
| --- | --- |
| `src/index.ts` | stdio 入口和进程关闭处理 |
| `src/server.ts` | MCP 工具注册、参数校验和结果转换 |
| `src/drop/client.ts` | DROP HTTP 客户端、认证、超时和错误映射 |
| `src/publish.ts` | 创建/部署 upsert 与并发冲突重试 |
| `src/site.ts` | 静态目录扫描、路径安全和 DROP 限制校验 |
| `src/config.ts` | 环境变量解析 |
| `src/errors.ts` | 可读错误模型 |

## License

[MIT](./LICENSE)
