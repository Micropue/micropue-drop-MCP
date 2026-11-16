#!/usr/bin/env node
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { loadDotEnv } from './env.js';
import { createDropMcpServer } from './server.js';
function reportError(error) {
    console.error(`[drop-mcp] ${error.stack ?? error.message}`);
}
try {
    loadDotEnv();
    const handle = serveStdio(() => createDropMcpServer(), { onerror: reportError });
    let closing = false;
    const shutdown = async () => {
        if (closing)
            return;
        closing = true;
        try {
            await handle.close();
        }
        catch (error) {
            reportError(error instanceof Error ? error : new Error(String(error)));
        }
    };
    process.once('SIGINT', () => void shutdown());
    process.once('SIGTERM', () => void shutdown());
}
catch (error) {
    reportError(error instanceof Error ? error : new Error(String(error)));
    process.exitCode = 1;
}
//# sourceMappingURL=index.js.map