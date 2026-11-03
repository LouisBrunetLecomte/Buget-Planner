import { and, desc, eq, gte, isNull, lte } from 'drizzle-orm'
import type { Database } from 'sql.js'
import type { Db } from './client'
import * as schema from './schema'
import { attachment, transaction } from './schema'
import { getSetting, listAccounts, listCategories, putSetting } from './repo'
import { actualsBetween } from './budgetRepo'
import { euros, toCsv, vatOf } from '@/core/exporters'
import type { FiscalKind } from '@/core/fiscal'

// ---------- pièces jointes (stockées dans la base chiffrée) ----------
export const MAX_ATTACHMENT = 5 * 1024 * 1024
export function addAttachment(db: Db, transactionId: string, name: string, mime: string, data: Uint8Array) {
  if (data.byteLength > MAX_ATTACHMENT) throw new Error('Fichier trop lourd (5 Mo max). Pour une photo, elle est réduite automatiquement.')
  if (!/^(image\/(jpeg|png|webp)|application\/pdf)$/.test(mime)) throw new Error('Formats acceptés : JPEG, PNG, WebP ou PDF.')
  return db.insert(attachment).values({ transactionId, name, mime, data }).returning({ id: attachment.id }).get()
}
export const listAttachments = (db: Db, transactionId: string) =>
  db.select({ id: attachment.id, name: attachment.name, mime: attachment.mime, ocrText: attachment.ocrText }).from(attachment).where(eq(attachment.transactionId, transactionId)).all()
/**
 * Lecture directe via sql.js : dans le navigateur (sans Buffer), Drizzle décode les BLOB en texte UTF-8,
 * ce qui corromprait les images. Ne pas repasser par db.select() pour la colonne data.
 */
function rawData(db: Db, id: string): Uint8Array | null {
  const st = (db as unknown as { $client: Database }).$client.prepare('SELECT data FROM attachment WHERE id = ?')
  try { st.bind([id]); return st.step() ? (st.get()[0] as Uint8Array) : null } finally { st.free() }
}
export function getAttachment(db: Db, id: string) {
  const meta = db.select({ id: attachment.id, name: attachment.name, mime: attachment.mime, ocrText: attachment.ocrText }).from(attachment).where(eq(attachment.id, id)).get()
  const data = meta && rawData(db, id)
  return meta && data ? { ...meta, data } : undefined
}
export const deleteAttachment = (db: Db, id: string) => db.delete(attachment).where(eq(attachment.id, id)).run()
export const setOcrText = (db: Db, id: string, text: string) => db.update(attachment).set({ ocrText: text }).where(eq(attachment.id, id)).run()

// ---------- freelance ----------
export const isFreelance = (db: Db) => getSetting<boolean>(db, 'freelance') ?? false
export const setFreelance = (db: Db, v: boolean) => putSetting(db, 'freelance', v)

export function freelanceSummary(db: Db, from: string, to: string) {
  const txs = db.select().from(transaction).where(and(eq(transaction.pro, true), gte(transaction.date, from), lte(transaction.date, to), isNull(transaction.transferGroupId))).orderBy(transaction.date).all()
  let recettesHt = 0, tvaCollectee = 0, depensesHt = 0, tvaDeductible = 0
  for (const t of txs) {
    const v = vatOf(t.amountEur, t.vatRate)
    if (t.amountEur > 0) { recettesHt += v.ht; tvaCollectee += v.tva } else { depensesHt -= v.ht; tvaDeductible -= v.tva }
  }
  const notes = db.select().from(transaction).where(and(eq(transaction.expenseReport, true), gte(transaction.date, from), lte(transaction.date, to))).orderBy(desc(transaction.date)).all()
  return { txs, recettesHt, tvaCollectee, depensesHt, tvaDeductible, tvaDue: tvaCollectee - tvaDeductible, resultat: recettesHt - depensesHt, notes }
}

/** Export comptable : une ligne par opération pro, HT / TVA / TTC séparés. */
export function accountingCsv(db: Db, from: string, to: string) {
  const { txs } = freelanceSummary(db, from, to)
  const cats = listCategories(db), accs = listAccounts(db)
  return toCsv(['Date', 'Libellé', 'Compte', 'Catégorie', 'Sens', 'HT', 'Taux TVA', 'TVA', 'TTC', 'Note de frais'],
    txs.map((t) => { const v = vatOf(t.amountEur, t.vatRate); return [t.date, t.label, accs.find((a) => a.id === t.accountId)?.name ?? '', cats.find((c) => c.id === t.categoryId)?.name ?? '', t.amountEur > 0 ? 'Recette' : 'Dépense', euros(Math.abs(v.ht)), t.vatRate ?? 0, euros(Math.abs(v.tva)), euros(Math.abs(t.amountEur)), t.expenseReport ? 'oui' : ''] }))
}

// ---------- fiscal ----------
/** Dépenses de l'année dans les catégories marquées fiscales (sous-catégories comprises). */
export function fiscalTotals(db: Db, year: number): Record<FiscalKind, number> {
  const cats = listCategories(db)
  const kindOf = (id: string): FiscalKind | null => { const c = cats.find((x) => x.id === id); return c?.fiscal ?? (c?.parentId ? cats.find((x) => x.id === c.parentId)?.fiscal ?? null : null) }
  const out: Record<FiscalKind, number> = { don: 0, garde: 0, domicile: 0 }
  for (const [, m] of actualsBetween(db, `${year}-01`, `${year}-12`)) for (const [c, s] of m) { const k = c && kindOf(c); if (k) out[k] -= s }
  return out
}

// ---------- exports ----------
export function transactionsCsv(db: Db) {
  const cats = listCategories(db), accs = listAccounts(db)
  const name = (id: string | null) => { const c = cats.find((x) => x.id === id); if (!c) return ''; const p = cats.find((x) => x.id === c.parentId); return p ? `${p.name} > ${c.name}` : c.name }
  const txs = db.select().from(transaction).orderBy(transaction.date).all()
  return toCsv(['Date', 'Compte', 'Libellé', 'Montant', 'Devise', 'Montant EUR', 'Catégorie', 'Notes', 'Virement interne', 'Pro'],
    txs.map((t) => [t.date, accs.find((a) => a.id === t.accountId)?.name ?? '', t.label, euros(t.amount), t.currency, euros(t.amountEur), name(t.categoryId), t.notes, t.transferGroupId ? 'oui' : '', t.pro ? 'oui' : '']))
}

/** Export complet lisible (RGPD) : toutes les tables, pièces jointes en base64. Non chiffré : à manipuler avec soin. */
export function exportAllJson(db: Db): string {
  const tables = Object.entries(schema).filter(([, v]) => typeof v === 'object' && v !== null && 'getSQL' in (v as object)) as [string, typeof transaction][]
  const out: Record<string, unknown[]> = {}
  for (const [k, t] of tables) out[k] = k === 'attachment'
    ? db.select({ id: attachment.id, transactionId: attachment.transactionId, name: attachment.name, mime: attachment.mime, ocrText: attachment.ocrText }).from(attachment).all().map((a) => ({ ...a, data: b64(rawData(db, a.id) ?? new Uint8Array()) }))
    : db.select().from(t).all()
  return JSON.stringify({ app: 'budget', exportedAt: new Date().toISOString(), tables: out }, null, 2)
}
const b64 = (u: Uint8Array) => { let s = ''; for (const x of u) s += String.fromCharCode(x); return btoa(s) }

// ---------- assistant ----------
import { DEFAULT_ASSISTANT, type AssistantSettings } from '@/core/assistant'
export const assistantSettings = (db: Db): AssistantSettings => ({ ...DEFAULT_ASSISTANT, ...getSetting<Partial<AssistantSettings>>(db, 'assistant') })
export const saveAssistantSettings = (db: Db, s: AssistantSettings) => putSetting(db, 'assistant', s)
