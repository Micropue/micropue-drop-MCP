import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface DotEnvOptions {
  entryUrl?: string
  cwd?: string
  env?: NodeJS.ProcessEnv
}

export function loadDotEnv(options: DotEnvOptions = {}): string | undefined {
  const cwd = options.cwd ?? process.cwd()
  const env = options.env ?? process.env
  const entryUrl = options.entryUrl ?? import.meta.url
  const configuredPath = env.DROP_ENV_FILE?.trim()
  const candidates = configuredPath
    ? [resolve(cwd, configuredPath)]
    : [
        resolve(dirname(fileURLToPath(entryUrl)), '..', '.env'),
        resolve(cwd, '.env')
      ]

  const dotenvPath = [...new Set(candidates)].find(candidate => existsSync(candidate))
  if (!dotenvPath) return undefined

  process.loadEnvFile(dotenvPath)
  return dotenvPath
}
