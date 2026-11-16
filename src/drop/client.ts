import { randomUUID } from 'node:crypto'
import { DropMcpError } from '../errors.js'
import type {
  CreateProjectInput,
  DeployProjectInput,
  DropMe,
  DropProject,
  DropProjectDeploymentResponse,
  DropProjectList,
  DropProjectSummary
} from './types.js'

export type DropFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export interface DropClientOptions {
  apiKey: string
  baseUrl: string
  timeoutMs?: number
  fetchImpl?: DropFetch
}

interface DropResponse<T> {
  data: T
  status: number
  etag?: string
  requestId?: string
}

interface ProblemBody {
  type?: string
  title?: string
  status?: number
  code?: string
  detail?: string
  requestId?: string
  errors?: Array<{ path?: string; message?: string }>
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: unknown
  headers?: Record<string, string>
}

export interface ListProjectsOptions {
  page?: number
  perPage?: number
  q?: string
  sort?: 'updated_desc' | 'created_desc' | 'name_asc'
}

function idempotencyKey(): string {
  return `drop-mcp-${randomUUID()}`
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds)
  const date = Date.parse(value)
  if (Number.isNaN(date)) return undefined
  return Math.max(0, Math.ceil((date - Date.now()) / 1000))
}

function apiErrorMessage(status: number, problem: ProblemBody): string {
  const title = problem.title?.trim()
  const detail = problem.detail?.trim()
  if (title && detail) return `DROP API ${status} ${title}: ${detail}`
  if (detail) return `DROP API ${status}: ${detail}`
  if (title) return `DROP API ${status}: ${title}`
  return `DROP API 请求失败（HTTP ${status}）。`
}

function apiHint(status: number): string | undefined {
  switch (status) {
    case 401:
      return '请检查 DROP_API_KEY 是否有效、过期或已被撤销。'
    case 403:
      return '请给该 API Key 添加所需的 projects:read、projects:write 和 deployments:write scope。'
    case 413:
      return '每个项目最多 20 个文件、单文件 512 KiB、总大小 1 MiB。'
    case 422:
      return '请根据校验信息修正请求。DROP 只接受 .html、.css 和 .js 文件。'
    case 429:
      return 'DROP API 已限流，请稍后重试。'
    case 503:
      return 'DROP 服务暂时不可用，请稍后重试。'
    default:
      return undefined
  }
}

export class DropClient {
  readonly baseUrl: string
  readonly timeoutMs: number
  private readonly apiKey: string
  private readonly fetchImpl: DropFetch

  constructor(options: DropClientOptions) {
    if (!options.apiKey.trim()) {
      throw new DropMcpError(
        'missing_api_key',
        '未配置 DROP_API_KEY。',
        { hint: '在 MCP 客户端的 env 中设置 DROP_API_KEY，或启动前 export DROP_API_KEY=...。' }
      )
    }

    const baseUrl = options.baseUrl.replace(/\/+$/, '')
    let url: URL
    try {
      url = new URL(baseUrl)
    } catch {
      throw new DropMcpError('invalid_config', 'DROP_API_BASE 不是有效的 URL。')
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new DropMcpError('invalid_config', 'DROP_API_BASE 只支持 http:// 或 https://。')
    }

    this.apiKey = options.apiKey.trim()
    this.baseUrl = baseUrl
    this.timeoutMs = options.timeoutMs ?? 20_000
    this.fetchImpl = options.fetchImpl ?? fetch
  }

  async me(): Promise<DropMe> {
    return (await this.request<DropMe>('me')).data
  }

  async listProjects(options: ListProjectsOptions = {}): Promise<DropProjectList> {
    const url = this.endpoint('projects')
    url.searchParams.set('page', String(options.page ?? 1))
    url.searchParams.set('perPage', String(options.perPage ?? 20))
    if (options.q?.trim()) url.searchParams.set('q', options.q.trim())
    if (options.sort) url.searchParams.set('sort', options.sort)
    return (await this.request<DropProjectList>(url)).data
  }

  async getProject(projectId: string): Promise<{ project: DropProject; etag?: string }> {
    const response = await this.request<DropProject>(
      `projects/${encodeURIComponent(projectId)}`
    )
    return response.etag === undefined
      ? { project: response.data }
      : { project: response.data, etag: response.etag }
  }

  async findProjectBySlug(slug: string): Promise<DropProjectSummary | null> {
    const wanted = slug.trim().toLowerCase()
    let page = 1

    for (;;) {
      const result = await this.listProjects({
        page,
        perPage: 100,
        q: wanted,
        sort: 'updated_desc'
      })
      const match = result.data.find(project => project.slug === wanted)
      if (match) return match

      const pages = Number(result.pagination?.pages ?? 1)
      if (!Number.isFinite(pages) || page >= pages) return null
      page += 1
    }
  }

  async getProjectBySlug(slug: string): Promise<DropProject> {
    const summary = await this.findProjectBySlug(slug)
    if (!summary) {
      throw new DropMcpError('project_not_found', `未找到 slug 为 "${slug}" 的项目。`)
    }
    return (await this.getProject(summary.id)).project
  }

  async createProject(input: CreateProjectInput): Promise<DropProjectDeploymentResponse> {
    const response = await this.request<DropProjectDeploymentResponse>('projects', {
      method: 'POST',
      body: input,
      headers: { 'Idempotency-Key': idempotencyKey() }
    })
    return response.data
  }

  async deployProject(
    projectId: string,
    revision: number,
    input: DeployProjectInput
  ): Promise<DropProjectDeploymentResponse> {
    const response = await this.request<DropProjectDeploymentResponse>(
      `projects/${encodeURIComponent(projectId)}/deploy`,
      {
        method: 'POST',
        body: input,
        headers: {
          'If-Match': `"rev-${revision}"`,
          'Idempotency-Key': idempotencyKey()
        }
      }
    )
    return response.data
  }

  private endpoint(pathname: string): URL {
    return new URL(pathname.replace(/^\/+/, ''), `${this.baseUrl}/`)
  }

  private async request<T>(pathOrUrl: string | URL, options: RequestOptions = {}): Promise<DropResponse<T>> {
    const url = typeof pathOrUrl === 'string' ? this.endpoint(pathOrUrl) : pathOrUrl
    const headers = new Headers(options.headers)
    headers.set('Authorization', `Bearer ${this.apiKey}`)
    headers.set('Accept', 'application/json, application/problem+json')
    if (options.body !== undefined) headers.set('Content-Type', 'application/json')

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    timer.unref()

    let response: Response
    try {
      const body = options.body === undefined ? undefined : JSON.stringify(options.body)
      response = await this.fetchImpl(url, {
        method: options.method ?? 'GET',
        headers,
        ...(body === undefined ? {} : { body }),
        redirect: 'follow',
        signal: controller.signal
      })
    } catch (error) {
      if (controller.signal.aborted) {
        throw new DropMcpError(
          'request_timeout',
          `访问 DROP API 超时（${this.timeoutMs} ms）。`,
          { hint: '可以增大 DROP_REQUEST_TIMEOUT_MS，或稍后重试。' }
        )
      }
      const detail = error instanceof Error ? error.message : String(error)
      throw new DropMcpError('network_error', `无法连接 DROP API：${detail}`)
    } finally {
      clearTimeout(timer)
    }

    const text = await response.text()
    let parsed: unknown
    if (text) {
      try {
        parsed = JSON.parse(text)
      } catch {
        if (response.ok) {
          throw new DropMcpError(
            'invalid_api_response',
            'DROP API 返回了无法解析的 JSON。'
          )
        }
      }
    }

    if (!response.ok) {
      const problem = (parsed && typeof parsed === 'object' ? parsed : {}) as ProblemBody
      const issues = Array.isArray(problem.errors)
        ? problem.errors
            .filter(issue => issue && typeof issue.message === 'string')
            .map(issue => ({
              ...(typeof issue.path === 'string' ? { path: issue.path } : {}),
              message: issue.message as string
            }))
        : undefined
      const retryAfterSeconds = parseRetryAfter(response.headers.get('retry-after'))
      const requestId =
        (typeof problem.requestId === 'string' && problem.requestId) ||
        response.headers.get('x-request-id') ||
        undefined
      const hint = apiHint(response.status)

      throw new DropMcpError('drop_api_error', apiErrorMessage(response.status, problem), {
        statusCode: response.status,
        ...(typeof problem.code === 'string' ? { apiCode: problem.code } : {}),
        ...(requestId ? { requestId } : {}),
        ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
        ...(issues?.length ? { issues } : {}),
        ...(hint ? { hint } : {})
      })
    }

    if (parsed === undefined) {
      throw new DropMcpError('invalid_api_response', 'DROP API 返回了空响应。')
    }

    const etag = response.headers.get('etag') ?? undefined
    const requestId = response.headers.get('x-request-id') ?? undefined
    return {
      data: parsed as T,
      status: response.status,
      ...(etag === undefined ? {} : { etag }),
      ...(requestId === undefined ? {} : { requestId })
    }
  }
}
