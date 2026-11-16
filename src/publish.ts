import type {
  DropProject,
  DropProjectDeploymentResponse,
  DropProjectSummary
} from './drop/types.js'
import { DropMcpError } from './errors.js'
import type { SiteSnapshot } from './site.js'

export interface PublishSiteInput {
  slug: string
  name: string
  message?: string
  snapshot: SiteSnapshot
}

export interface PublishSiteResult {
  url: string
  projectId: string
  slug: string
  projectPath: string
  action: 'created' | 'deployed'
  revision: number
  deploymentId: string
  fileCount: number
  totalBytes: number
  visibility: 'public' | 'password'
  enabled: boolean
  publiclyAccessible: boolean
  retriedAfterConflict: boolean
  warnings: string[]
}

export interface PublishClient {
  findProjectBySlug(slug: string): Promise<DropProjectSummary | null>
  createProject(input: {
    name: string
    slug: string
    visibility: 'public'
    folders: string[]
    files: Array<{ path: string; content: string }>
    message?: string
  }): Promise<DropProjectDeploymentResponse>
  deployProject(
    projectId: string,
    revision: number,
    input: {
      folders: string[]
      files: Array<{ path: string; content: string }>
      message?: string
    }
  ): Promise<DropProjectDeploymentResponse>
}

function responseError(message: string): DropMcpError {
  return new DropMcpError('invalid_api_response', message)
}

function validateResponse(
  response: DropProjectDeploymentResponse
): { project: DropProject; deployment: DropProjectDeploymentResponse['deployment'] } {
  if (!response || typeof response !== 'object') {
    throw responseError('DROP API 未返回部署结果。')
  }
  const { project, deployment } = response
  if (
    !project ||
    typeof project.id !== 'string' ||
    typeof project.name !== 'string' ||
    typeof project.url !== 'string' ||
    typeof project.slug !== 'string' ||
    typeof project.path !== 'string' ||
    (project.visibility !== 'public' && project.visibility !== 'password') ||
    typeof project.enabled !== 'boolean' ||
    !Number.isInteger(project.revision) ||
    project.revision < 1
  ) {
    throw responseError('DROP API 返回的项目信息不完整。')
  }
  if (
    !deployment ||
    typeof deployment.id !== 'string' ||
    !Number.isInteger(deployment.revision) ||
    deployment.revision < 1 ||
    typeof deployment.url !== 'string' ||
    !Number.isInteger(deployment.fileCount) ||
    deployment.fileCount < 1 ||
    !Number.isInteger(deployment.totalBytes) ||
    deployment.totalBytes < 0
  ) {
    throw responseError('DROP API 返回的部署信息不完整。')
  }
  return { project, deployment }
}

function accessWarnings(project: Pick<DropProject, 'enabled' | 'visibility'>): string[] {
  const warnings: string[] = []
  if (!project.enabled) {
    warnings.push('项目目前处于停用状态，公开地址暂时无法访问；本工具不会自动修改已有的启用状态。')
  }
  if (project.visibility === 'password') {
    warnings.push('项目受密码保护，访问公开地址时需要密码；本工具不会自动修改已有的可见性。')
  }
  return warnings
}

function isHttpStatus(error: unknown, status: number): boolean {
  return error instanceof DropMcpError && error.statusCode === status
}

export async function publishSite(
  client: PublishClient,
  input: PublishSiteInput
): Promise<PublishSiteResult> {
  const files = input.snapshot.files.map(file => ({
    path: file.path,
    content: file.content
  }))
  const warnings: string[] = []
  if (input.snapshot.ignored.length > 0) {
    const preview = input.snapshot.ignored.slice(0, 8).join(', ')
    const suffix = input.snapshot.ignored.length > 8
      ? ` 等 ${input.snapshot.ignored.length} 个文件`
      : ''
    warnings.push(`已跳过不支持的文件：${preview}${suffix}`)
  }

  let existing = await client.findProjectBySlug(input.slug)
  let action: 'created' | 'deployed' = existing ? 'deployed' : 'created'

  if (!existing) {
    try {
      const response = validateResponse(await client.createProject({
        name: input.name,
        slug: input.slug,
        visibility: 'public',
        folders: input.snapshot.folders,
        files,
        ...(input.message ? { message: input.message } : {})
      }))
      return {
        url: response.project.url,
        projectId: response.project.id,
        slug: response.project.slug,
        projectPath: response.project.path,
        action: 'created',
        revision: response.deployment.revision,
        deploymentId: response.deployment.id,
        fileCount: response.deployment.fileCount,
        totalBytes: response.deployment.totalBytes,
        visibility: response.project.visibility,
        enabled: response.project.enabled,
        publiclyAccessible: response.project.enabled && response.project.visibility === 'public',
        retriedAfterConflict: false,
        warnings: [...warnings, ...accessWarnings(response.project)]
      }
    } catch (error) {
      if (!isHttpStatus(error, 409)) throw error

      // Another publisher may have created the same slug between our read and write.
      existing = await client.findProjectBySlug(input.slug)
      if (!existing) throw error
      action = 'deployed'
    }
  }

  let target = existing
  let retriedAfterConflict = false

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = validateResponse(await client.deployProject(
        target.id,
        target.revision,
        {
          folders: input.snapshot.folders,
          files,
          ...(input.message ? { message: input.message } : {})
        }
      ))
      return {
        url: response.project.url,
        projectId: response.project.id,
        slug: response.project.slug,
        projectPath: response.project.path,
        action,
        revision: response.deployment.revision,
        deploymentId: response.deployment.id,
        fileCount: response.deployment.fileCount,
        totalBytes: response.deployment.totalBytes,
        visibility: response.project.visibility,
        enabled: response.project.enabled,
        publiclyAccessible: response.project.enabled && response.project.visibility === 'public',
        retriedAfterConflict,
        warnings: [...warnings, ...accessWarnings(response.project)]
      }
    } catch (error) {
      if (!isHttpStatus(error, 412) || attempt > 0) throw error

      retriedAfterConflict = true
      const refreshed = await client.findProjectBySlug(input.slug)
      if (!refreshed) {
        throw new DropMcpError(
          'project_not_found',
          `部署时 revision 冲突，但随后无法重新找到 slug 为 "${input.slug}" 的项目。`
        )
      }
      target = refreshed
    }
  }

  throw new DropMcpError('deploy_failed', '部署未完成。')
}
