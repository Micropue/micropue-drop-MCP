import type { DropProjectDeploymentResponse, DropProjectSummary } from './drop/types.js';
import type { SiteSnapshot } from './site.js';
export interface PublishSiteInput {
    slug: string;
    name: string;
    message?: string;
    snapshot: SiteSnapshot;
}
export interface PublishSiteResult {
    url: string;
    projectId: string;
    slug: string;
    projectPath: string;
    action: 'created' | 'deployed';
    revision: number;
    deploymentId: string;
    fileCount: number;
    totalBytes: number;
    visibility: 'public' | 'password';
    enabled: boolean;
    publiclyAccessible: boolean;
    retriedAfterConflict: boolean;
    warnings: string[];
}
export interface PublishClient {
    findProjectBySlug(slug: string): Promise<DropProjectSummary | null>;
    createProject(input: {
        name: string;
        slug: string;
        visibility: 'public';
        folders: string[];
        files: Array<{
            path: string;
            content: string;
        }>;
        message?: string;
    }): Promise<DropProjectDeploymentResponse>;
    deployProject(projectId: string, revision: number, input: {
        folders: string[];
        files: Array<{
            path: string;
            content: string;
        }>;
        message?: string;
    }): Promise<DropProjectDeploymentResponse>;
}
export declare function publishSite(client: PublishClient, input: PublishSiteInput): Promise<PublishSiteResult>;
