import path from "path";
import fs from "fs/promises";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import type { ViteDevServer } from "vite";
import { inspectAttr } from "kimi-plugin-inspect-react";
import { spawn } from "child_process";
import type { IncomingMessage, ServerResponse } from "http";

function claudeLocalPlugin() {
  return {
    name: "claude-local",
    configureServer(server: ViteDevServer) {
      server.middlewares.use(
        "/api/local/claude",
        (req: IncomingMessage, res: ServerResponse) => {
          if (req.method !== "POST") {
            res.statusCode = 405;
            res.end(JSON.stringify({ error: "Method not allowed" }));
            return;
          }

          // Only allow requests from localhost
          const remoteAddr = req.socket.remoteAddress;
          if (
            remoteAddr !== "127.0.0.1" &&
            remoteAddr !== "::1" &&
            remoteAddr !== "::ffff:127.0.0.1"
          ) {
            res.statusCode = 403;
            res.setHeader("content-type", "application/json");
            res.end(
              JSON.stringify({
                error: "Forbidden: Claude CLI endpoint is local-only",
              }),
            );
            return;
          }

          let body = "";
          req.on("data", (chunk: Buffer) => {
            body += chunk.toString();
          });
          req.on("end", () => {
            try {
              const { instructions } = JSON.parse(body);
              if (!instructions || typeof instructions !== "string") {
                res.statusCode = 400;
                res.setHeader("content-type", "application/json");
                res.end(JSON.stringify({ error: "Missing instructions" }));
                return;
              }

              const maxLen = 50000;
              const trimmed = instructions.slice(0, maxLen);

              // Use spawn + stdin piping instead of execFile with args
              // to avoid OS argument length limits
              const proc = spawn(
                "claude",
                ["-p", "--output-format", "text", "--max-turns", "3"],
                {
                  timeout: 120000,
                  stdio: ["pipe", "pipe", "pipe"],
                },
              );

              let stdout = "";
              let stderr = "";

              proc.stdout.on("data", (chunk: Buffer) => {
                stdout += chunk.toString();
              });
              proc.stderr.on("data", (chunk: Buffer) => {
                stderr += chunk.toString();
              });

              proc.on("close", (code) => {
                res.setHeader("content-type", "application/json");
                if (code !== 0) {
                  res.statusCode = 500;
                  res.end(
                    JSON.stringify({
                      error: stderr || `Claude CLI exited with code ${code}`,
                    }),
                  );
                } else {
                  res.end(JSON.stringify({ response: stdout }));
                }
              });

              proc.on("error", (err) => {
                res.setHeader("content-type", "application/json");
                res.statusCode = 500;
                res.end(
                  JSON.stringify({
                    error: err.message || "Failed to start Claude CLI",
                  }),
                );
              });

              // Pipe the instructions via stdin
              proc.stdin.write(trimmed);
              proc.stdin.end();
            } catch {
              res.statusCode = 400;
              res.setHeader("content-type", "application/json");
              res.end(JSON.stringify({ error: "Invalid JSON body" }));
            }
          });
        },
      );
    },
  };
}

function apiRoutesPlugin() {
  // Load ALL env vars (not just VITE_) into process.env for API handlers
  const env = loadEnv("development", process.cwd(), "");
  for (const [key, val] of Object.entries(env)) {
    if (process.env[key] === undefined) {
      process.env[key] = val;
    }
  }

  return {
    name: "api-routes",
    configureServer(server: ViteDevServer) {
      server.middlewares.use(
        async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
          const url = req.url || "";

          // Only handle /api/ routes, skip /api/local/ (handled by claudeLocalPlugin)
          if (!url.startsWith("/api/") || url.startsWith("/api/local/")) {
            return next();
          }

          // Map URL to handler file path
          const routePath = url.split("?")[0].replace(/^\/api\//, "");

          // Don't serve _lib or hidden directories
          if (routePath.startsWith("_") || routePath.startsWith(".")) {
            return next();
          }

          const absPath = path.resolve(__dirname, "api", routePath + ".ts");

          try {
            await fs.access(absPath);
          } catch {
            return next();
          }

          try {
            // Use Vite's SSR module loader (handles TS, caching, HMR)
            const mod = await server.ssrLoadModule(absPath);
            const handler = mod.default;

            if (typeof handler !== "function") {
              res.statusCode = 500;
              res.setHeader("content-type", "application/json");
              res.end(JSON.stringify({ error: "Handler is not a function" }));
              return;
            }

            // Convert Node IncomingMessage → Web Request
            const host = req.headers.host || "localhost";
            const fullUrl = `http://${host}${req.url}`;

            const headers = new Headers();
            for (const [key, value] of Object.entries(req.headers)) {
              if (value)
                headers.set(
                  key,
                  Array.isArray(value) ? value.join(", ") : value,
                );
            }

            let body: Buffer | undefined;
            if (req.method !== "GET" && req.method !== "HEAD") {
              body = await new Promise<Buffer>((resolve) => {
                const chunks: Buffer[] = [];
                req.on("data", (chunk: Buffer) => chunks.push(chunk));
                req.on("end", () => resolve(Buffer.concat(chunks)));
              });
            }

            const request = new Request(fullUrl, {
              method: req.method,
              headers,
              body: body && body.length > 0 ? body : undefined,
            });

            // Call the handler and convert Web Response → Node response
            const response: Response = await handler(request);

            res.statusCode = response.status;
            response.headers.forEach((value: string, key: string) => {
              res.setHeader(key, value);
            });

            const responseBody = await response.arrayBuffer();
            res.end(Buffer.from(responseBody));
          } catch (err: any) {
            console.error(`[api-routes] Error in /api/${routePath}:`, err);
            res.statusCode = 500;
            res.setHeader("content-type", "application/json");
            res.end(
              JSON.stringify({ error: err.message || "Internal server error" }),
            );
          }
        },
      );
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  base: "/",
  plugins: [inspectAttr(), react(), claudeLocalPlugin(), apiRoutesPlugin()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
