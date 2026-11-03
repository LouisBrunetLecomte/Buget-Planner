import type { Database, SqlJsStatic } from 'sql.js'
import { drizzle } from 'drizzle-orm/sql-js'
import * as schema from './schema'

const migrations = import.meta.glob('./migrations/*.sql', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

export type Db = ReturnType<typeof drizzle<typeof schema>>

/** Ouvre une base (vide ou depuis des octets) et applique les migrations manquantes. */
export function openDb(SQL: SqlJsStatic, bytes?: Uint8Array): { sqlite: Database; db: Db } {
  const sqlite = bytes ? new SQL.Database(bytes) : new SQL.Database()
  sqlite.exec('PRAGMA foreign_keys = ON; CREATE TABLE IF NOT EXISTS __migrations (name TEXT PRIMARY KEY)')
  const done = new Set((sqlite.exec('SELECT name FROM __migrations')[0]?.values ?? []).map((r) => String(r[0])))
  for (const name of Object.keys(migrations).sort()) {
    if (done.has(name)) continue
    sqlite.exec('BEGIN')
    try {
      sqlite.exec(migrations[name]!.replaceAll('--> statement-breakpoint', ''))
      sqlite.run('INSERT INTO __migrations (name) VALUES (?)', [name])
      sqlite.exec('COMMIT')
    } catch (e) { sqlite.exec('ROLLBACK'); throw e }
  }
  // le client brut reste accessible pour les BLOB (voir extrasRepo.getAttachment)
  return { sqlite, db: Object.assign(drizzle(sqlite, { schema }), { $client: sqlite }) }
}

/** sql.js réinitialise les PRAGMA à chaque export : on les remet. */
export function exportDb(sqlite: Database): Uint8Array<ArrayBuffer> {
  const bytes = sqlite.export() as Uint8Array<ArrayBuffer>
  sqlite.exec('PRAGMA foreign_keys = ON')
  return bytes
}
