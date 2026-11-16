import { McpServer, type CallToolResult } from '@modelcontextprotocol/server'
import { z } from 'zod'
import { readDropConfig } from './config.js'
import { DropClient } from './drop/client.js'
import { DropMcpError, formatError, inputError } from './errors.js'
import { publishSite, type PublishSiteResult } from './publish.js'
import {
  createSiteSnapshot,
  loadDirectorySnapshot,
  normalizeSlug,
  type SiteSnapshot
} from './site.js'

const SERVER_NAME = 'drop-mcp'
const SERVER_VERSION = '0.1.0'

export interface PublishEnvironment {
  allowedRoots: string[]
  cwd: string
}

export interface DropRuntime {
  getClient(): DropClient
  getPublishEnvironment(): PublishEnvironment
}

export function createDefaultRuntime(
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd()
): DropRuntime {
  let config: ReturnType<typeof readDropConfig> | undefined
  let client: DropClient | undefined

  const getConfig = () => {
    config ??= readDropConfig(env, cwd)
    return config
  }

  return {
    getClient() {
      if (client) return client
      const current = getConfig()
      client = new DropClient({
        apiKey: current.apiKey,
        baseUrl: current.baseUrl,
        timeoutMs: current.timeoutMs
      })
      return client
    },
    getPublishEnvironment() {
      const current = getConfig()
      return {
        allowedRoots: current.allowedRoots,
        cwd: current.cwd
      }
    }
  }
}

function success(text: string, structuredContent: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: 'text', text }],
    structuredContent
  }
}

function failure(error: unknown): CallToolResult {
  const known = error instanceof DropMcpError
  return {
    content: [{ type: 'text', text: formatError(error) }],
    isError: true,
    structuredContent: {
      ok: false,
      error: {
        code: known ? error.code : 'internal_error',
        message: error instanceof Error ? error.message : '未知错误',
        ...(known && error.statusCode !== undefined ? { status: error.statusCode } : {}),
        ...(known && error.apiCode ? { apiCode: error.apiCode } : {}),
        ...(known && error.requestId ? { requestId: error.requestId } : {}),
        ...(known && error.retryAfterSeconds !== undefined
          ? { retryAfterSeconds: error.retryAfterSeconds }
          : {}),
        ...(known && error.issues?.length ? { issues: error.issues } : {}),
        ...(known && error.hint ? { hint: error.hint } : {})
      }
    }
  }
}

function slugInput(): z.ZodString {
  return z.string()
    .min(1)
    .max(40)
    .describe('DROP 项目 slug，1–40 位小写字母、数字或连字符；大写会自动转小写。')
}

function publishText(result: PublishSiteResult): string {
  const lines = [
    result.action === 'created' ? '已创建并发布静态站点。' : '静态站点已部署。',
    `公开地址: ${result.url}`,
    `项目 ID: ${result.projectId}`,
    `slug: ${result.slug}`,
    `revision: ${result.revision}`,
    `文件: ${result.fileCount} 个，共 ${result.totalBytes} 字节`
  ]
  if (!result.publiclyAccessible) lines.push('注意: 站点当前不是公开可访问状态。')
  if (result.retriedAfterConflict) lines.push('说明: 部署遇到 revision 冲突，已重新读取并成功重试。')
  if (result.warnings.length > 0) {
    lines.push('', ...result.warnings.map(warning => `警告: ${warning}`))
  }
  return lines.join('\n')
}

function jsonText(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

function requireName(raw: string | undefined, fallback: string): string {
  const name = raw?.trim() || fallback
  if (Array.from(name).length > 80) {
    throw inputError('项目名称不能超过 80 个字符。')
  }
  return name
}

function normalizeMessage(raw: string | undefined): string | undefined {
  const message = raw?.trim()
  if (!message) return undefined
  if (message.length > 200) throw inputError('部署说明不能超过 200 个字符。')
  return message
}

export function createDropMcpServer(runtime: DropRuntime = createDefaultRuntime()): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {} } }
  )

  server.registerTool(
    'drop_whoami',
    {
      title: 'DROP account and connectivity check',
      description: 'Verify DROP_API_KEY connectivity and return the current DROP account, key scopes, and limits. It never returns the secret key.',
      inputSchema: z.object({}),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async () => {
      try {
        const me = await runtime.getClient().me()
        const text = [
          'DROP API 连接正常。',
          `账号: @${me.account.username} (${me.account.nickname})`,
          `Key: ${me.key.name} (${me.key.prefix}...)`,
          `Scopes: ${me.key.scopes.join(', ') || '(none)'}`,
          `限制: ${me.limits.projects} 个项目，每项目 ${me.limits.filesPerProject} 个文件，单文件 ${me.limits.fileBytes} 字节，总计 ${me.limits.projectBytes} 字节`
        ].join('\n')
        return success(text, { ok: true, ...me })
      } catch (error) {
        return failure(error)
      }
    }
  )

  server.registerTool(
    'drop_list_projects',
    {
      title: 'List DROP projects',
      description: 'List static-site projects owned by the current DROP account. Supports search by name or slug and pagination.',
      inputSchema: z.object({
        query: z.string().max(80).optional().describe('Search text for project name or slug.'),
        page: z.number().int().min(1).optional().describe('One-based page number. Defaults to 1.'),
        perPage: z.number().int().min(1).max(100).optional().describe('Items per page (1–100). Defaults to 20.'),
        sort: z.enum(['updated_desc', 'created_desc', 'name_asc']).optional()
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async input => {
      try {
        const result = await runtime.getClient().listProjects({
          ...(input.page === undefined ? {} : { page: input.page }),
          ...(input.perPage === undefined ? {} : { perPage: input.perPage }),
          ...(input.query === undefined ? {} : { q: input.query }),
          ...(input.sort === undefined ? {} : { sort: input.sort })
        })
        const text = `共 ${result.pagination.total} 个项目。\n${jsonText(result)}`
        return success(text, { ok: true, ...result })
      } catch (error) {
        return failure(error)
      }
    }
  )

  server.registerTool(
    'drop_get_project',
    {
      title: 'Get a DROP project',
      description: 'Get one DROP project including its current revision, public URL, metadata, folders, and file contents. Provide exactly one of projectId or slug.',
      inputSchema: z.object({
        projectId: z.string().min(1).max(100).optional().describe('DROP project UUID.'),
        slug: slugInput().optional()
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async input => {
      try {
        const provided = Number(Boolean(input.projectId)) + Number(Boolean(input.slug))
        if (provided !== 1) {
          throw inputError('projectId 和 slug 必须且只能提供一个。')
        }

        const client = runtime.getClient()
        const project = input.projectId
          ? (await client.getProject(input.projectId)).project
          : await client.getProjectBySlug(normalizeSlug(input.slug as string))
        return success(jsonText(project), { ok: true, project })
      } catch (error) {
        return failure(error)
      }
    }
  )

  server.registerTool(
    'drop_publish_site',
    {
      title: 'Publish a static site to DROP',
      description: [
        'Create or atomically replace a DROP static-site project by slug, then return its public URL.',
        'Provide exactly one source: path (a local directory restricted by DROP_ALLOWED_ROOTS) or files (inline path/content pairs).',
        'DROP accepts only .html, .css, and .js files: at most 20 files, 512 KiB per file, and 1 MiB total.',
        'Existing projects are deployed with optimistic concurrency (If-Match) and one conflict retry.'
      ].join(' '),
      inputSchema: z.object({
        slug: slugInput(),
        name: z.string().min(1).max(80).optional().describe('Project name used only when creating a new project. Defaults to the slug.'),
        path: z.string().min(1).optional().describe('Local directory containing the deployable static output. Must be under DROP_ALLOWED_ROOTS.'),
        files: z.array(z.object({
          path: z.string().min(1).max(120),
          content: z.string()
        })).min(1).max(20).optional().describe('Inline project files, used instead of path.'),
        ignoreUnsupported: z.boolean().optional().describe('When publishing a directory, explicitly skip unsupported regular files instead of failing. Defaults to false.'),
        message: z.string().max(200).optional().describe('Optional deployment message.')
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true
      }
    },
    async input => {
      try {
        const sources = Number(Boolean(input.path)) + Number(Boolean(input.files))
        if (sources !== 1) {
          throw inputError('path 和 files 必须且只能提供一个。')
        }

        const slug = normalizeSlug(input.slug)
        let snapshot: SiteSnapshot
        if (input.path) {
          const environment = runtime.getPublishEnvironment()
          snapshot = await loadDirectorySnapshot({
            sourcePath: input.path,
            allowedRoots: environment.allowedRoots,
            cwd: environment.cwd,
            ignoreUnsupported: input.ignoreUnsupported ?? false
          })
        } else {
          snapshot = createSiteSnapshot(input.files ?? [])
        }

        const message = normalizeMessage(input.message)
        const result = await publishSite(runtime.getClient(), {
          slug,
          name: requireName(input.name, slug),
          ...(message === undefined ? {} : { message }),
          snapshot
        })
        return success(publishText(result), { ok: true, ...result })
      } catch (error) {
        return failure(error)
      }
    }
  )

  return server
}
