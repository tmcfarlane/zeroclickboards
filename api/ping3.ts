// Web Standard, but with NO config object at all
export default async function handler(_req: Request): Promise<Response> {
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ route: 'ping3', step: 'entered', ts: Date.now(), nodeVersion: process.version }))
  return new Response(JSON.stringify({ ok: true, ts: Date.now() }), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}
