import { describe, expect, it, vi } from 'vitest'
import type {
  DropProject,
  DropProjectDeploymentResponse,
  DropProjectSummary
} from '../src/drop/types.js'
import { DropMcpError } from '../src/errors.js'
import { publishSite, type PublishClient } from '../src/publish.js'
import { createSiteSnapshot } from '../src/site.js'

const summary: DropProjectSummary = {
  id: 'project-id',
  name: 'Demo',
  slug: 'demo',
  path: '/micropue/demo/',
  url: 'https://dropcontent.example.test/micropue/demo/',
  visibility: 'public',
  enabled: true,
  revision: 3,
  updatedAt: '2026-01-01T00:00:00.000Z'
}

function project(overrides: Partial<DropProject> = {}): DropProject {
  return {
    ...summary,
    hasPassword: false,
    folders: ['assets'],
    files: [
      {
        path: 'index.html',
        content: '<h1>Hello</h1>',
        language: 'html',
        bytes: 14
      }
    ],
    createdAt: '2026-01-01T00:00:00.000Z',
    lastDeployedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

function deploymentResponse(
  revision: number,
  overrides: Partial<DropProject> = {}
): DropProjectDeploymentResponse {
  const deployedProject = project({ revision, ...overrides })
  return {
    project: deployedProject,
    deployment: {
      id: `deployment-${revision}`,
      revision,
      status: 'live',
      url: deployedProject.url,
      fileCount: 2,
      totalBytes: 123,
      message: 'deploy',
      source: 'api',
      createdAt: '2026-01-01T00:00:00.000Z'
    }
  }
}

function snapshot() {
  return createSiteSnapshot([
    { path: 'index.html', content: '<h1>Hello</h1>' },
    { path: 'assets/site.css', content: 'body{}' }
  ])
}

function fakeClient(): {
  client: PublishClient
  findProjectBySlug: ReturnType<typeof vi.fn>
  createProject: ReturnType<typeof vi.fn>
  deployProject: ReturnType<typeof vi.fn>
} {
  const findProjectBySlug = vi.fn()
  const createProject = vi.fn()
  const deployProject = vi.fn()
  return {
    client: { findProjectBySlug, createProject, deployProject },
    findProjectBySlug,
    createProject,
    deployProject
  }
}

describe('publishSite', () => {
  it('creates a new public project and returns its URL', async () => {
    const fake = fakeClient()
    fake.findProjectBySlug.mockResolvedValue(null)
    fake.createProject.mockResolvedValue(deploymentResponse(1))

    const result = await publishSite(fake.client, {
      slug: 'demo',
      name: 'Demo',
      message: 'first deploy',
      snapshot: snapshot()
    })

    expect(result).toMatchObject({
      action: 'created',
      url: summary.url,
      projectId: summary.id,
      revision: 1,
      deploymentId: 'deployment-1',
      publiclyAccessible: true,
      retriedAfterConflict: false
    })
    expect(fake.createProject).toHaveBeenCalledWith({
      name: 'Demo',
      slug: 'demo',
      visibility: 'public',
      folders: ['assets'],
      files: [
        { path: 'assets/site.css', content: 'body{}' },
        { path: 'index.html', content: '<h1>Hello</h1>' }
      ],
      message: 'first deploy'
    })
    expect(fake.deployProject).not.toHaveBeenCalled()
  })

  it('deploys an existing project using its current revision', async () => {
    const fake = fakeClient()
    fake.findProjectBySlug.mockResolvedValue(summary)
    fake.deployProject.mockResolvedValue(deploymentResponse(4))

    const result = await publishSite(fake.client, {
      slug: 'demo',
      name: 'Ignored for existing projects',
      snapshot: snapshot(),
      requireExisting: true
    })

    expect(result.action).toBe('deployed')
    expect(fake.createProject).not.toHaveBeenCalled()
    expect(fake.deployProject).toHaveBeenCalledWith(
      summary.id,
      3,
      expect.objectContaining({ folders: ['assets'] })
    )
  })

  it('refuses to create a missing project when an existing project is required', async () => {
    const fake = fakeClient()
    fake.findProjectBySlug.mockResolvedValue(null)

    await expect(publishSite(fake.client, {
      slug: 'missing',
      name: 'Missing',
      snapshot: snapshot(),
      requireExisting: true
    })).rejects.toMatchObject({
      code: 'project_not_found',
      message: '未找到 slug 为 "missing" 的项目。',
      hint: expect.stringContaining('drop_publish_site')
    })

    expect(fake.createProject).not.toHaveBeenCalled()
    expect(fake.deployProject).not.toHaveBeenCalled()
  })

  it('re-reads a concurrently created project after a 409', async () => {
    const fake = fakeClient()
    fake.findProjectBySlug
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(summary)
    fake.createProject.mockRejectedValue(
      new DropMcpError('drop_api_error', 'Project URL is already taken.', { statusCode: 409 })
    )
    fake.deployProject.mockResolvedValue(deploymentResponse(4))

    const result = await publishSite(fake.client, {
      slug: 'demo',
      name: 'Demo',
      snapshot: snapshot()
    })

    expect(result.action).toBe('deployed')
    expect(fake.findProjectBySlug).toHaveBeenCalledTimes(2)
    expect(fake.deployProject).toHaveBeenCalledWith(
      summary.id,
      3,
      expect.any(Object)
    )
  })

  it('refreshes the revision and retries once after a 412', async () => {
    const fake = fakeClient()
    const refreshed = { ...summary, revision: 4 }
    fake.findProjectBySlug
      .mockResolvedValueOnce(summary)
      .mockResolvedValueOnce(refreshed)
    fake.deployProject
      .mockRejectedValueOnce(
        new DropMcpError('drop_api_error', 'Revision is stale.', { statusCode: 412 })
      )
      .mockResolvedValueOnce(deploymentResponse(5))

    const result = await publishSite(fake.client, {
      slug: 'demo',
      name: 'Demo',
      snapshot: snapshot()
    })

    expect(result.retriedAfterConflict).toBe(true)
    expect(fake.deployProject).toHaveBeenCalledTimes(2)
    expect(fake.deployProject.mock.calls[0]?.slice(0, 2)).toEqual([summary.id, 3])
    expect(fake.deployProject.mock.calls[1]?.slice(0, 2)).toEqual([summary.id, 4])
  })

  it('returns warnings for skipped files and non-public projects', async () => {
    const fake = fakeClient()
    fake.findProjectBySlug.mockResolvedValue(summary)
    fake.deployProject.mockResolvedValue(deploymentResponse(4, {
      visibility: 'password',
      enabled: false
    }))

    const result = await publishSite(fake.client, {
      slug: 'demo',
      name: 'Demo',
      snapshot: createSiteSnapshot(
        [{ path: 'index.html', content: '<h1>Hello</h1>' }],
        ['notes.txt']
      )
    })

    expect(result.publiclyAccessible).toBe(false)
    expect(result.warnings).toEqual([
      '已跳过不支持的文件：notes.txt',
      expect.stringContaining('停用状态'),
      expect.stringContaining('密码保护')
    ])
  })

  it('does not swallow non-conflict write failures', async () => {
    const fake = fakeClient()
    fake.findProjectBySlug.mockResolvedValue(summary)
    fake.deployProject.mockRejectedValue(
      new DropMcpError('drop_api_error', 'Forbidden.', { statusCode: 403 })
    )

    await expect(publishSite(fake.client, {
      slug: 'demo',
      name: 'Demo',
      snapshot: snapshot()
    })).rejects.toMatchObject({ statusCode: 403 })
  })
})
