export const config = { runtime: 'nodejs', maxDuration: 10 }

export default async function handler() {
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ route: 'ping', step: 'entered', ts: Date.now(), nodeVersion: process.version }))
  return new Response(JSON.stringify({ ok: true, ts: Date.now() }), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}
