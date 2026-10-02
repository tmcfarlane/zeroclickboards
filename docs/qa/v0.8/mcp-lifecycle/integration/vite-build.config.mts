import original from '/Users/tmcfarlane/Documents/Codex/2026-09-30/zeroboard-chatgpt-integration/work/zeroboard-ai-ci/vite.config.ts';
export default { ...original, cacheDir: '/private/tmp/zeroboard-mcp-integrated-vite-cache', build: { ...original.build, outDir: '/private/tmp/zeroboard-mcp-integrated-built-smoke/dist', emptyOutDir: true } };
