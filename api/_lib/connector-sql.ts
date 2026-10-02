import type postgres from 'postgres'
import type { SqlExecutor } from '../../mcp-server/src/oauth-store.js'

/** Keep independent statements off the same in-flight transaction-pooler socket. */
export function createConnectorSqlExecutor(sql: postgres.Sql): SqlExecutor {
  return {
    async query(statement, values) {
      const connection = await sql.reserve()
      try {
        const rows = await connection.unsafe(statement, values as postgres.ParameterOrJSON<never>[])
        return { rows: rows as unknown as { value: unknown }[] }
      } finally {
        connection.release()
      }
    },
  }
}
