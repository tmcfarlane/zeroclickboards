# ZeroBoard marketing media

The approved one-minute MCP commercial with Rachelle's female commercial narration is served by Cloudflare Worker Static Assets at https://zeroboard-media.trent-a60.workers.dev. The landing page uses the versioned MP4 and poster listed in `manifest.json`; English captions are in `public/zeroboard-mcp-commercial.en.vtt`.

The browser export is 1080p at 60 fps with AAC stereo audio and fast-start MP4 metadata. The picture is preserved from the approved film, and the audio matches the approved master. Assets are public, with immutable caching and CORS for the website's native video player. The player loads the video only when the visitor presses play.

## Update or redeploy

1. Place the approved MP4, poster, `_headers`, and `404.html` in `media/assets/` (ignored by Git). Existing published files can be downloaded from the origin above and verified against `manifest.json`.
2. Use a new versioned filename when the video changes; update the manifest, landing-page URLs, and captions together.
3. Validate and deploy with your authenticated Cloudflare account:

```sh
npx -y wrangler@4.146.0 deploy --config media/wrangler.jsonc --dry-run
npx -y wrangler@4.146.0 deploy --config media/wrangler.jsonc
```

The `_headers` file contains:

```text
/*
  Access-Control-Allow-Origin: *
  Cache-Control: public, max-age=31536000, immutable
  X-Content-Type-Options: nosniff
```

`404.html` returns a short link to https://board.zeroclickdev.ai/ for unknown media paths. This media deployment is independent of the website's Vercel deployment.
