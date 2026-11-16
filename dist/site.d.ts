import type { DropFileInput } from './drop/types.js';
export declare const MAX_FILES = 20;
export declare const MAX_FILE_BYTES: number;
export declare const MAX_TOTAL_BYTES: number;
export declare const MAX_PATH_LENGTH = 120;
export declare const MAX_FOLDER_LENGTH = 100;
export declare const MAX_FOLDERS = 50;
export interface SiteSnapshot {
    files: SiteFileInput[];
    folders: string[];
    totalBytes: number;
    ignored: string[];
}
export interface SiteFileInput extends DropFileInput {
}
export interface DirectorySnapshotOptions {
    sourcePath: string;
    allowedRoots: string[];
    cwd: string;
    ignoreUnsupported?: boolean;
}
export declare function normalizeSlug(raw: string): string;
export declare function createSiteSnapshot(files: ReadonlyArray<{
    path: string;
    content: string;
}>, ignored?: string[]): SiteSnapshot;
export declare function loadDirectorySnapshot(options: DirectorySnapshotOptions): Promise<SiteSnapshot>;
