import path from 'node:path'
import { DropMcpError } from './errors.js'

const DEFAULT_BASE_URL = 'https://drop.micropue.com.cn/v1'
const DEFAULT_TIMEOUT_MS = 20_000

export interface DropConfig {
  apiKey: string
  baseUrl: string
  timeoutMs: number
  allowedRoots: string[]
  cwd: string
}

function parseTimeout(raw: string | undefined): number {
  if (!raw?.trim()) return DEFAULT_TIMEOUT_MS
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 1_000 || value > 120_000) {
    throw new DropMcpError(
      'invalid_config',
      'DROP_REQUEST_TIMEOUT_MS 必须是 1000 到 120000 之间的整数。'
    )
  }
  return value
}

function parseBaseUrl(raw: string | undefined): string {
  const value = (raw?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, '')
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new DropMcpError('invalid_config', 'DROP_API_BASE 不是有效的 URL。')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new DropMcpError('invalid_config', 'DROP_API_BASE 只支持 http:// 或 https://。')
  }
  return value
}

function parseAllowedRoots(raw: string | undefined, cwd: string): string[] {
  const configured = raw?.trim()
  const values = configured ? configured.split(path.delimiter) : [cwd]
  const roots = values
    .map(value => value.trim())
    .filter(Boolean)
    .map(value => path.resolve(cwd, value))

  if (roots.length === 0) {
    throw new DropMcpError(
      'invalid_config',
      'DROP_ALLOWED_ROOTS 至少需要包含一个目录，或不要设置以使用当前工作目录。'
    )
  }
  return [...new Set(roots)]
}

export function readDropConfig(
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd()
): DropConfig {
  return {
    apiKey: (env.DROP_API_KEY ?? '').trim(),
    baseUrl: parseBaseUrl(env.DROP_API_BASE),
    timeoutMs: parseTimeout(env.DROP_REQUEST_TIMEOUT_MS),
    allowedRoots: parseAllowedRoots(env.DROP_ALLOWED_ROOTS, cwd),
    cwd
  }
}
