export interface DropErrorOptions {
  statusCode?: number
  apiCode?: string
  requestId?: string
  retryAfterSeconds?: number
  issues?: Array<{ path?: string; message: string }>
  hint?: string
}

export class DropMcpError extends Error {
  readonly code: string
  readonly statusCode?: number
  readonly apiCode?: string
  readonly requestId?: string
  readonly retryAfterSeconds?: number
  readonly issues?: Array<{ path?: string; message: string }>
  readonly hint?: string

  constructor(code: string, message: string, options: DropErrorOptions = {}) {
    super(message)
    this.name = 'DropMcpError'
    this.code = code
    if (options.statusCode !== undefined) this.statusCode = options.statusCode
    if (options.apiCode !== undefined) this.apiCode = options.apiCode
    if (options.requestId !== undefined) this.requestId = options.requestId
    if (options.retryAfterSeconds !== undefined) this.retryAfterSeconds = options.retryAfterSeconds
    if (options.issues !== undefined) this.issues = options.issues
    if (options.hint !== undefined) this.hint = options.hint
  }
}

export function inputError(message: string, hint?: string): DropMcpError {
  return new DropMcpError('invalid_input', message, hint === undefined ? {} : { hint })
}

export function formatError(error: unknown): string {
  if (error instanceof DropMcpError) {
    const lines = [`[${error.code}] ${error.message}`]
    if (error.apiCode) lines.push(`DROP 错误码: ${error.apiCode}`)
    if (error.statusCode !== undefined) lines.push(`HTTP 状态: ${error.statusCode}`)
    if (error.requestId) lines.push(`请求 ID: ${error.requestId}`)
    if (error.retryAfterSeconds !== undefined) {
      lines.push(`建议 ${error.retryAfterSeconds} 秒后重试`)
    }
    if (error.issues?.length) {
      for (const issue of error.issues) {
        lines.push(`- ${issue.path ? `${issue.path}: ` : ''}${issue.message}`)
      }
    }
    if (error.hint) lines.push(error.hint)
    return lines.join('\n')
  }

  if (error instanceof Error) {
    return `[internal_error] ${error.message}`
  }

  return '[internal_error] 未知错误'
}
