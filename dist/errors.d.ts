export interface DropErrorOptions {
    statusCode?: number;
    apiCode?: string;
    requestId?: string;
    retryAfterSeconds?: number;
    issues?: Array<{
        path?: string;
        message: string;
    }>;
    hint?: string;
}
export declare class DropMcpError extends Error {
    readonly code: string;
    readonly statusCode?: number;
    readonly apiCode?: string;
    readonly requestId?: string;
    readonly retryAfterSeconds?: number;
    readonly issues?: Array<{
        path?: string;
        message: string;
    }>;
    readonly hint?: string;
    constructor(code: string, message: string, options?: DropErrorOptions);
}
export declare function inputError(message: string, hint?: string): DropMcpError;
export declare function formatError(error: unknown): string;
