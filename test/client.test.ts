import { describe, expect, it, vi } from 'vitest'
import { DropClient, type DropFetch } from '../src/drop/client.js'

const BASE_URL = 'https://drop.example.test/v1'
const API_KEY = 'unit-test-key'

function clientWithFetch(fetchImpl: DropFetch): DropClient {
  return new DropClient({
    apiKey: API_KEY,
    baseUrl: BASE_URL,
    timeoutMs: 1_000,
    fetchImpl
  })
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: {
      'content-type': 'application/json',
      ...(init.headers ?? {})
    }
  })
}

describe('DropClient', () => {
  it('sends authenticated account requests', async () => {
    const fetchMock = vi.fn<DropFetch>(async () => jsonResponse({
      account: {},
      key: {},
      limits: {}
    }))
    const client = clientWithFetch(fetchMock)

    await client.me()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(String(url)).toBe(`${BASE_URL}/me`)
    const headers = new Headers(init?.headers)
    expect(headers.get('authorization')).toBe(`Bearer ${API_KEY}`)
    expect(headers.get('accept')).toContain('application/problem+json')
  })

  it('encodes list filters as query parameters', async () => {
    const fetchMock = vi.fn<DropFetch>(async () => jsonResponse({
      data: [],
      pagination: { page: 2, perPage: 10, total: 0, pages: 1 }
    }))
    const client = clientWithFetch(fetchMock)

    await client.listProjects({
      page: 2,
      perPage: 10,
      q: 'my site',
      sort: 'name_asc'
    })

    const url = new URL(String(fetchMock.mock.calls[0]?.[0]))
    expect(url.pathname).toBe('/v1/projects')
    expect(url.searchParams.get('page')).toBe('2')
    expect(url.searchParams.get('perPage')).toBe('10')
    expect(url.searchParams.get('q')).toBe('my site')
    expect(url.searchParams.get('sort')).toBe('name_asc')
  })

  it('uses idempotency keys and revision preconditions for writes', async () => {
    const fetchMock = vi.fn<DropFetch>(async () => jsonResponse({
      project: {},
      deployment: {}
    }))
    const client = clientWithFetch(fetchMock)

    await client.createProject({
      name: 'Demo',
      slug: 'demo',
      visibility: 'public',
      folders: [],
      files: [{ path: 'index.html', content: '<h1>Demo</h1>' }]
    })
    await client.deployProject('project-id', 7, {
      folders: [],
      files: [{ path: 'index.html', content: '<h1>Updated</h1>' }]
    })

    const createInit = fetchMock.mock.calls[0]?.[1]
    const deployInit = fetchMock.mock.calls[1]?.[1]
    const createHeaders = new Headers(createInit?.headers)
    const deployHeaders = new Headers(deployInit?.headers)

    expect(createHeaders.get('idempotency-key')).toMatch(/^drop-mcp-/)
    expect(deployHeaders.get('idempotency-key')).toMatch(/^drop-mcp-/)
    expect(deployHeaders.get('if-match')).toBe('"rev-7"')
    expect(JSON.parse(String(deployInit?.body))).toMatchObject({
      files: [{ path: 'index.html', content: '<h1>Updated</h1>' }]
    })
  })

  it('maps problem JSON and request metadata into a readable error', async () => {
    const fetchMock = vi.fn<DropFetch>(async () => jsonResponse({
      type: 'https://drop.example.test/problems/unauthorized',
      title: 'Unauthorized',
      status: 401,
      code: 'invalid_api_key',
      detail: 'The API key is expired.',
      requestId: 'req_123'
    }, {
      status: 401,
      headers: { 'x-request-id': 'req_123' }
    }))
    const client = clientWithFetch(fetchMock)

    const error = await client.me().catch(value => value)

    expect(error).toMatchObject({
      code: 'drop_api_error',
      statusCode: 401,
      apiCode: 'invalid_api_key',
      requestId: 'req_123'
    })
    expect(error.message).toContain('The API key is expired.')
    expect(error.hint).toContain('DROP_API_KEY')
  })

  it('exposes Retry-After on rate limits', async () => {
    const fetchMock = vi.fn<DropFetch>(async () => jsonResponse({
      title: 'Too Many Requests',
      status: 429,
      code: 'rate_limited',
      detail: 'Slow down.',
      requestId: 'req_429'
    }, {
      status: 429,
      headers: { 'retry-after': '12' }
    }))
    const client = clientWithFetch(fetchMock)

    const error = await client.listProjects().catch(value => value)

    expect(error).toMatchObject({
      statusCode: 429,
      retryAfterSeconds: 12,
      apiCode: 'rate_limited'
    })
  })

  it('rejects missing API keys without making a request', () => {
    expect(() => new DropClient({
      apiKey: '   ',
      baseUrl: BASE_URL
    })).toThrow(/DROP_API_KEY/)
  })
})
