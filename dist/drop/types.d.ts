export type DropVisibility = 'public' | 'password';
export interface DropFileInput {
    path: string;
    content: string;
}
export interface DropProjectFile extends DropFileInput {
    language: 'html' | 'css' | 'js';
    bytes: number;
}
export interface DropPagination {
    page: number;
    perPage: number;
    total: number;
    pages: number;
}
export interface DropProjectSummary {
    id: string;
    name: string;
    slug: string;
    path: string;
    url: string;
    visibility: DropVisibility;
    enabled: boolean;
    revision: number;
    updatedAt: string;
}
export interface DropProject extends DropProjectSummary {
    hasPassword: boolean;
    folders: string[];
    files: DropProjectFile[];
    createdAt: string;
    lastDeployedAt: string | null;
}
export interface DropDeployment {
    id: string;
    revision: number;
    status: 'queued' | 'building' | 'live' | 'failed';
    url: string;
    fileCount: number;
    totalBytes: number;
    message?: string | null;
    source?: 'web' | 'api';
    createdAt: string;
}
export interface DropProjectList {
    data: DropProjectSummary[];
    pagination: DropPagination;
}
export interface DropProjectDeploymentResponse {
    project: DropProject;
    deployment: DropDeployment;
}
export interface DropMe {
    account: {
        id: string;
        username: string;
        nickname: string;
        avatarUrl: string;
        profileUrl: string;
    };
    key: {
        id: string;
        name: string;
        prefix: string;
        scopes: string[];
        expiresAt: string | null;
        lastUsedAt?: string | null;
    };
    limits: {
        projects: number;
        filesPerProject: number;
        fileBytes: number;
        projectBytes: number;
        foldersPerProject: number;
    };
}
export interface CreateProjectInput {
    name: string;
    slug: string;
    visibility: DropVisibility;
    folders: string[];
    files: DropFileInput[];
    message?: string;
}
export interface DeployProjectInput {
    folders: string[];
    files: DropFileInput[];
    message?: string;
}
