import app from "./app";
import { config } from "./config";
import { ensureDirectoryExists } from "./utils/fs";
import { initMongo } from "./config/mongo";

async function start() {
    await ensureDirectoryExists(config.uploadDir);
    await ensureDirectoryExists(config.staticDir);
    await initMongo();
    const server = app.listen(config.port, () => {
        console.log(`Server listening on http://localhost:${config.port}`);
    });

    // Long-running AI extraction requests can exceed default Node timeouts.
    // These settings help avoid the backend closing the connection early.
    const requestTimeoutMs = Number(process.env.SERVER_REQUEST_TIMEOUT_MS ?? 15 * 60 * 1000); // 15 min
    const headersTimeoutMs = Number(process.env.SERVER_HEADERS_TIMEOUT_MS ?? 70 * 1000); // must be > keepAliveTimeout
    const keepAliveTimeoutMs = Number(process.env.SERVER_KEEP_ALIVE_TIMEOUT_MS ?? 65 * 1000);
    const socketTimeoutMs = Number(process.env.SERVER_SOCKET_TIMEOUT_MS ?? 0); // 0 = no idle socket timeout

    server.requestTimeout = requestTimeoutMs;
    server.headersTimeout = headersTimeoutMs;
    server.keepAliveTimeout = keepAliveTimeoutMs;
    server.setTimeout(socketTimeoutMs);

    console.log("[server] timeouts", {
        requestTimeoutMs: server.requestTimeout,
        headersTimeoutMs: server.headersTimeout,
        keepAliveTimeoutMs: server.keepAliveTimeout,
        socketTimeoutMs,
    });
}

start().catch((error) => {
    console.error("Failed to start server", error);
    process.exit(1);
});

