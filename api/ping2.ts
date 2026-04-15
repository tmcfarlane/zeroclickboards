// Legacy Node.js (req, res) signature
export const config = { runtime: 'nodejs', maxDuration: 10 }

type NodeRes = {
  statusCode: number
  setHeader: (name: string, value: string) => void
  end: (body: string) => void
}

export default function handler(_req: unknown, res: NodeRes) {
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ route: 'ping2', step: 'entered', ts: Date.now(), nodeVersion: process.version }))
  res.statusCode = 200
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(JSON.stringify({ ok: true, ts: Date.now() }))
}
