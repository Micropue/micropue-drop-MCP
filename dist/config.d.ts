export interface DropConfig {
    apiKey: string;
    baseUrl: string;
    timeoutMs: number;
    allowedRoots: string[];
    cwd: string;
}
export declare function readDropConfig(env?: NodeJS.ProcessEnv, cwd?: string): DropConfig;
