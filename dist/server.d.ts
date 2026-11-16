import { McpServer } from '@modelcontextprotocol/server';
import { DropClient } from './drop/client.js';
export interface PublishEnvironment {
    allowedRoots: string[];
    cwd: string;
}
export interface DropRuntime {
    getClient(): DropClient;
    getPublishEnvironment(): PublishEnvironment;
}
export declare function createDefaultRuntime(env?: NodeJS.ProcessEnv, cwd?: string): DropRuntime;
export declare function createDropMcpServer(runtime?: DropRuntime): McpServer;
