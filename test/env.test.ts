import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { loadDotEnv } from '../src/env.js'

const ENV_NAME = 'DROP_MCP_DOTENV_TEST'
const temporaryDirectories: string[] = []

afterEach(() => {
  delete process.env[ENV_NAME]
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('loadDotEnv', () => {
  it('loads the project root env file relative to the entry module', () => {
    const root = mkdtempSync(join(tmpdir(), 'drop-mcp-env-'))
    temporaryDirectories.push(root)
    mkdirSync(join(root, 'dist'))
    writeFileSync(join(root, '.env'), `${ENV_NAME}=from-dotenv\n`)

    const loaded = loadDotEnv({
      entryUrl: pathToFileURL(join(root, 'dist', 'index.js')).href,
      cwd: join(root, 'unrelated-working-directory')
    })

    expect(loaded).toBe(join(root, '.env'))
    expect(process.env[ENV_NAME]).toBe('from-dotenv')
  })
})
