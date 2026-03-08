import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { inspectAttr } from 'kimi-plugin-inspect-react'
import { spawn } from 'child_process'
import type { IncomingMessage, ServerResponse } from 'http'

function claudeLocalPlugin() {
  return {
    name: 'claude-local',
    configureServer(server: any) {
      server.middlewares.use('/api/local/claude', (req: IncomingMessage, res: ServerResponse) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end(JSON.stringify({ error: 'Method not allowed' }));
          return;
        }

        // Only allow requests from localhost
        const remoteAddr = req.socket.remoteAddress;
        if (remoteAddr !== '127.0.0.1' && remoteAddr !== '::1' && remoteAddr !== '::ffff:127.0.0.1') {
          res.statusCode = 403;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ error: 'Forbidden: Claude CLI endpoint is local-only' }));
          return;
        }

        let body = '';
        req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        req.on('end', () => {
          try {
            const { instructions } = JSON.parse(body);
            if (!instructions || typeof instructions !== 'string') {
              res.statusCode = 400;
              res.setHeader('content-type', 'application/json');
              res.end(JSON.stringify({ error: 'Missing instructions' }));
              return;
            }

            const maxLen = 50000;
            const trimmed = instructions.slice(0, maxLen);

            // Use spawn + stdin piping instead of execFile with args
            // to avoid OS argument length limits
            const proc = spawn('claude', ['-p', '--output-format', 'text', '--max-turns', '3'], {
              timeout: 120000,
              stdio: ['pipe', 'pipe', 'pipe'],
            });

            let stdout = '';
            let stderr = '';

            proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
            proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

            proc.on('close', (code) => {
              res.setHeader('content-type', 'application/json');
              if (code !== 0) {
                res.statusCode = 500;
                res.end(JSON.stringify({ error: stderr || `Claude CLI exited with code ${code}` }));
              } else {
                res.end(JSON.stringify({ response: stdout }));
              }
            });

            proc.on('error', (err) => {
              res.setHeader('content-type', 'application/json');
              res.statusCode = 500;
              res.end(JSON.stringify({ error: err.message || 'Failed to start Claude CLI' }));
            });

            // Pipe the instructions via stdin
            proc.stdin.write(trimmed);
            proc.stdin.end();
          } catch {
            res.statusCode = 400;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ error: 'Invalid JSON body' }));
          }
        });
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [inspectAttr(), react(), claudeLocalPlugin()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
