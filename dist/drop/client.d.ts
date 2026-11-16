import type { CreateProjectInput, DeployProjectInput, DropMe, DropProject, DropProjectDeploymentResponse, DropProjectList, DropProjectSummary } from './types.js';
export type DropFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
export interface DropClientOptions {
    apiKey: string;
    baseUrl: string;
    timeoutMs?: number;
    fetchImpl?: DropFetch;
}
export interface ListProjectsOptions {
    page?: number;
    perPage?: number;
    q?: string;
    sort?: 'updated_desc' | 'created_desc' | 'name_asc';
}
export declare class DropClient {
    readonly baseUrl: string;
    readonly timeoutMs: number;
    private readonly apiKey;
    private readonly fetchImpl;
    constructor(options: DropClientOptions);
    me(): Promise<DropMe>;
    listProjects(options?: ListProjectsOptions): Promise<DropProjectList>;
    getProject(projectId: string): Promise<{
        project: DropProject;
        etag?: string;
    }>;
    findProjectBySlug(slug: string): Promise<DropProjectSummary | null>;
    getProjectBySlug(slug: string): Promise<DropProject>;
    createProject(input: CreateProjectInput): Promise<DropProjectDeploymentResponse>;
    deployProject(projectId: string, revision: number, input: DeployProjectInput): Promise<DropProjectDeploymentResponse>;
    private endpoint;
    private request;
}
