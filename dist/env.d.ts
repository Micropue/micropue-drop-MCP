export interface DotEnvOptions {
    entryUrl?: string;
    cwd?: string;
    env?: NodeJS.ProcessEnv;
}
export declare function loadDotEnv(options?: DotEnvOptions): string | undefined;
