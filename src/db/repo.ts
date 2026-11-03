import { and, desc, eq, gte, inArray, isNull, like, lte, or, sql } from 'drizzle-orm'
import type { Db } from './client'
import { account, category, fxRate, importBatch, importProfile, rule, setting, tag, transaction, transactionSplit, transactionTag } from './schema'
import { normalizeLabel } from '@/core/labels'
import { categorize, learnPattern, ruleMatches } from '@/core/rules'
import { withImportKeys } from '@/core/dedup'
import { findTransferPairs } from '@/core/transfers'
import { validateSplits } from '@/core/splits'
import { rateOn } from '@/core/fx'
import { convert, parseAmount } from '@/core/money'
import type { RawTx } from '@/core/parsers'
import type { CsvMapping } from '@/core/parsers'

export type Account = typeof account.$inferSelect
export type Category = typeof category.$inferSelect
export type Tx = typeof transaction.$inferSelect
export type Rule = typeof rule.$inferSelect

const now = sql`(datetime('now'))`

// ---------- comptes ----------
export const listAccounts = (db: Db) => db.select().from(account).orderBy(account.archived, account.name).all()

/**
 * Solde « d'ouverture » effectif : si le solde a été saisi à une date (« 1 250 € aujourd'hui »), les opérations d'avant
 * (et celles du jour venues d'un relevé importé) y sont déjà comprises ; on les retranche. Ce qu'on saisit ou coche ensuite compte.
 */
export function effectiveOpenings(db: Db): Map<string, number> {
  const rows = db.select({ id: account.id, open: account.openingBalance,
    before: sql<number>`coalesce(sum(case when ${account.balanceDate} is not null and (${transaction.date} < ${account.balanceDate} or (${transaction.date} = ${account.balanceDate} and ${transaction.importKey} is not null)) then ${transaction.amount} else 0 end), 0)` })
    .from(account).leftJoin(transaction, eq(transaction.accountId, account.id)).groupBy(account.id).all()
  return new Map(rows.map((r) => [r.id, r.open - r.before]))
}

/** Solde par compte, dans la devise du compte. */
export function balances(db: Db): Map<string, number> {
  const open = effectiveOpenings(db)
  const rows = db.select({ id: account.id, sum: sql<number>`coalesce(sum(${transaction.amount}), 0)` })
    .from(account).leftJoin(transaction, eq(transaction.accountId, account.id)).groupBy(account.id).all()
  return new Map(rows.map((r) => [r.id, open.get(r.id)! + r.sum]))
}

export const createAccount = (db: Db, v: typeof account.$inferInsert) => db.insert(account).values(v).returning().get()
export const updateAccount = (db: Db, id: string, v: Partial<typeof account.$inferInsert>) =>
  db.update(account).set({ ...v, updatedAt: now }).where(eq(account.id, id)).run()
export const deleteAccount = (db: Db, id: string) => db.delete(account).where(eq(account.id, id)).run()

// ---------- catégories ----------
export const listCategories = (db: Db) => db.select().from(category).orderBy(category.kind, category.name).all()
export const createCategory = (db: Db, v: typeof category.$inferInsert) => db.insert(category).values(v).returning().get()
export const renameCategory = (db: Db, id: string, name: string) => db.update(category).set({ name, updatedAt: now }).where(eq(category.id, id)).run()
/** Les sous-catégories remontent au parent supprimé ; les opérations deviennent "non catégorisées". */
export function deleteCategory(db: Db, id: string) {
  db.transaction((t) => {
    const c = t.select().from(category).where(eq(category.id, id)).get()
    t.update(category).set({ parentId: c?.parentId ?? null }).where(eq(category.parentId, id)).run()
    t.delete(category).where(eq(category.id, id)).run()
  })
}

// ---------- taux de change ----------
export function cachedRates(db: Db, currency: string) {
  return db.select().from(fxRate).where(eq(fxRate.currency, currency)).all()
}
export function saveRates(db: Db, currency: string, rates: Record<string, number>, manual = false) {
  for (const [date, rate] of Object.entries(rates))
    db.insert(fxRate).values({ currency, date, rate, manual }).onConflictDoUpdate({ target: [fxRate.currency, fxRate.date], set: { rate, manual } }).run()
}
function toEur(db: Db, currency: string, date: string, amount: number): { amountEur: number; fxRate: number | null } {
  if (currency === 'EUR') return { amountEur: amount, fxRate: null }
  const rate = rateOn(cachedRates(db, currency), date)
  if (rate === null) throw new Error(`Aucun taux ${currency}→EUR connu. Saisis-en un dans Réglages > Devises.`)
  return { amountEur: convert(amount, rate), fxRate: rate }
}

// ---------- opérations ----------
export interface TxFilter { q?: string; accountId?: string; categoryId?: string | 'none'; from?: string; to?: string; limit?: number; pro?: boolean }

export function listTransactions(db: Db, f: TxFilter = {}) {
  const conds = []
  if (f.accountId) conds.push(eq(transaction.accountId, f.accountId))
  if (f.categoryId === 'none') conds.push(and(isNull(transaction.categoryId), isNull(transaction.transferGroupId)))
  else if (f.categoryId) {
    const ids = [f.categoryId, ...db.select({ id: category.id }).from(category).where(eq(category.parentId, f.categoryId)).all().map((c) => c.id)]
    const splitTx = db.select({ id: transactionSplit.transactionId }).from(transactionSplit).where(inArray(transactionSplit.categoryId, ids))
    conds.push(or(inArray(transaction.categoryId, ids), inArray(transaction.id, splitTx)))
  }
  if (f.pro !== undefined) conds.push(eq(transaction.pro, f.pro))
  if (f.from) conds.push(gte(transaction.date, f.from))
  if (f.to) conds.push(lte(transaction.date, f.to))
  if (f.q) {
    const q = `%${f.q.replace(/[%_]/g, '')}%`, norm = normalizeLabel(f.q), cents = parseAmount(f.q)
    conds.push(or(like(transaction.label, q), like(transaction.notes, q),
      norm ? like(transaction.labelNorm, `%${norm}%`) : undefined,
      cents !== null ? eq(sql`abs(${transaction.amount})`, Math.abs(cents)) : undefined))
  }
  return db.select().from(transaction).where(and(...conds)).orderBy(desc(transaction.date), desc(transaction.createdAt)).limit(f.limit ?? 500).all()
}

export interface NewTx { accountId: string; date: string; amount: number; label: string; categoryId?: string | null; notes?: string | null }

export function addTransaction(db: Db, v: NewTx) {
  const acc = db.select().from(account).where(eq(account.id, v.accountId)).get()
  if (!acc) throw new Error('Compte introuvable')
  const labelNorm = normalizeLabel(v.label)
  const categoryId = v.categoryId !== undefined ? v.categoryId : categorize(db.select().from(rule).all(), labelNorm, v.accountId)
  return db.insert(transaction).values({ ...v, labelNorm, categoryId, currency: acc.currency, ...toEur(db, acc.currency, v.date, v.amount) }).returning().get()
}

/**
 * Modifie une opération. Si la catégorie change et qu'aucune règle existante ne donne déjà ce résultat,
 * crée une règle "apprise" pour que les prochaines opérations au même libellé soient bien classées.
 */
export function updateTransaction(db: Db, id: string, patch: Partial<Pick<Tx, 'date' | 'amount' | 'label' | 'categoryId' | 'notes' | 'pro' | 'vatRate' | 'expenseReport'>>, learn = true) {
  return db.transaction((t) => {
    const cur = t.select().from(transaction).where(eq(transaction.id, id)).get()
    if (!cur) throw new Error('Opération introuvable')
    const next = { ...cur, ...patch }
    const extra = patch.label !== undefined ? { labelNorm: normalizeLabel(next.label) } : {}
    const fx = patch.amount !== undefined || patch.date !== undefined ? toEur(t as unknown as Db, cur.currency, next.date, next.amount) : {}
    t.update(transaction).set({ ...patch, ...extra, ...fx, updatedAt: now }).where(eq(transaction.id, id)).run()
    let learned: string | null = null
    if (learn && patch.categoryId && patch.categoryId !== cur.categoryId) learned = learnRule(t as unknown as Db, extra.labelNorm ?? cur.labelNorm, cur.accountId, patch.categoryId)
    return { learned }
  })
}

function learnRule(db: Db, labelNorm: string, accountId: string, categoryId: string): string | null {
  const rules = db.select().from(rule).all()
  if (categorize(rules, labelNorm, accountId) === categoryId) return null
  const pattern = learnPattern(labelNorm)
  if (!pattern) return null
  const same = rules.find((r) => !r.isRegex && normalizeLabel(r.pattern) === pattern)
  // une règle apprise plus récente l'emporte sur les règles par défaut de même motif
  if (same) db.update(rule).set({ categoryId, learned: true, priority: same.priority, updatedAt: now }).where(eq(rule.id, same.id)).run()
  else db.insert(rule).values({ pattern, categoryId, learned: true, priority: 1 }).run()
  return pattern
}

export const deleteTransactions = (db: Db, ids: string[]) => db.delete(transaction).where(inArray(transaction.id, ids)).run()
export const setCategoryBulk = (db: Db, ids: string[], categoryId: string | null) =>
  db.update(transaction).set({ categoryId, updatedAt: now }).where(inArray(transaction.id, ids)).run()

/** Réapplique les règles aux opérations non catégorisées (après ajout d'une règle). */
export function applyRulesToUncategorized(db: Db): number {
  const rules = db.select().from(rule).all()
  const todo = db.select().from(transaction).where(and(isNull(transaction.categoryId), isNull(transaction.transferGroupId))).all()
  let n = 0
  for (const t of todo) {
    const c = categorize(rules, t.labelNorm, t.accountId)
    if (c) { db.update(transaction).set({ categoryId: c }).where(eq(transaction.id, t.id)).run(); n++ }
  }
  return n
}

// ---------- ventilation & tags ----------
export const getSplits = (db: Db, txId: string) => db.select().from(transactionSplit).where(eq(transactionSplit.transactionId, txId)).all()
export function setSplits(db: Db, txId: string, parts: { categoryId: string; amount: number }[]) {
  db.transaction((t) => {
    const tx = t.select().from(transaction).where(eq(transaction.id, txId)).get()
    if (!tx) throw new Error('Opération introuvable')
    if (parts.length) { const err = validateSplits(tx.amount, parts); if (err) throw new Error(err) }
    t.delete(transactionSplit).where(eq(transactionSplit.transactionId, txId)).run()
    for (const p of parts) t.insert(transactionSplit).values({ transactionId: txId, ...p }).run()
    t.update(transaction).set({ categoryId: null, updatedAt: now }).where(eq(transaction.id, txId)).run()
  })
}
export const listSplitTxIds = (db: Db) => new Set(db.selectDistinct({ id: transactionSplit.transactionId }).from(transactionSplit).all().map((r) => r.id))

export const getTags = (db: Db, txId: string) =>
  db.select({ name: tag.name }).from(transactionTag).innerJoin(tag, eq(tag.id, transactionTag.tagId)).where(eq(transactionTag.transactionId, txId)).all().map((r) => r.name)
export function setTags(db: Db, txId: string, names: string[]) {
  db.transaction((t) => {
    t.delete(transactionTag).where(eq(transactionTag.transactionId, txId)).run()
    for (const name of new Set(names.map((n) => n.trim().toLowerCase()).filter(Boolean))) {
      const id = t.insert(tag).values({ name }).onConflictDoUpdate({ target: tag.name, set: { name } }).returning().get().id
      t.insert(transactionTag).values({ transactionId: txId, tagId: id }).run()
    }
  })
}

// ---------- import ----------
export interface ImportPreview { rows: (RawTx & { importKey: string; labelNorm: string; duplicate: boolean; categoryId: string | null })[] }

export function previewImport(db: Db, accountId: string, rows: RawTx[]): ImportPreview {
  const existing = new Set(db.select({ k: transaction.importKey }).from(transaction).where(eq(transaction.accountId, accountId)).all().map((r) => r.k))
  const rules = db.select().from(rule).all()
  return { rows: withImportKeys(rows).map((r) => ({ ...r, duplicate: existing.has(r.importKey), categoryId: categorize(rules, r.labelNorm, accountId) })) }
}

export function importRows(db: Db, accountId: string, fileName: string, rows: RawTx[]) {
  return db.transaction((t) => {
    const tdb = t as unknown as Db
    const acc = t.select().from(account).where(eq(account.id, accountId)).get()
    if (!acc) throw new Error('Compte introuvable')
    const bad = rows.find((r) => r.currency && r.currency !== acc.currency)
    if (bad) throw new Error(`Le fichier contient des opérations en ${bad.currency} mais le compte est en ${acc.currency}.`)
    const { rows: prev } = previewImport(tdb, accountId, rows)
    const batch = t.insert(importBatch).values({ accountId, fileName, imported: 0, skipped: 0 }).returning().get()
    let imported = 0
    for (const r of prev) {
      if (r.duplicate) continue
      t.insert(transaction).values({
        accountId, date: r.date, amount: r.amount, label: r.label, labelNorm: r.labelNorm, categoryId: r.categoryId,
        currency: acc.currency, ...toEur(tdb, acc.currency, r.date, r.amount), importKey: r.importKey, importBatchId: batch.id,
      }).onConflictDoNothing().run()
      imported++
    }
    t.update(importBatch).set({ imported, skipped: prev.length - imported }).where(eq(importBatch.id, batch.id)).run()
    return { batchId: batch.id, imported, skipped: prev.length - imported }
  })
}

export const listImports = (db: Db) => db.select().from(importBatch).orderBy(desc(importBatch.createdAt)).all()
/** Annule un import : supprime ses opérations (cascade). */
export const undoImport = (db: Db, batchId: string) => db.delete(importBatch).where(eq(importBatch.id, batchId)).run()

export const findProfile = (db: Db, signature: string) =>
  db.select().from(importProfile).where(eq(importProfile.headerSignature, signature)).get()?.mapping as CsvMapping | undefined
export const saveProfile = (db: Db, name: string, signature: string, mapping: CsvMapping) =>
  db.insert(importProfile).values({ name, headerSignature: signature, mapping }).onConflictDoUpdate({ target: importProfile.headerSignature, set: { mapping, name } }).run()

// ---------- virements internes ----------
export function transferSuggestions(db: Db) {
  const txs = db.select().from(transaction).where(isNull(transaction.transferGroupId)).all()
  return findTransferPairs(txs).map(([o, i]) => [txs.find((t) => t.id === o.id)!, txs.find((t) => t.id === i.id)!] as const)
}
export function linkTransfer(db: Db, ids: [string, string]) {
  const g = crypto.randomUUID()
  db.update(transaction).set({ transferGroupId: g, categoryId: null, updatedAt: now }).where(inArray(transaction.id, ids)).run()
  return g
}
export const unlinkTransfer = (db: Db, groupId: string) =>
  db.update(transaction).set({ transferGroupId: null, updatedAt: now }).where(eq(transaction.transferGroupId, groupId)).run()

// ---------- règles ----------
export const listRules = (db: Db) => db.select().from(rule).orderBy(desc(rule.priority), rule.pattern).all()
export const createRule = (db: Db, v: typeof rule.$inferInsert) => db.insert(rule).values(v).returning().get()
export const deleteRule = (db: Db, id: string) => db.delete(rule).where(eq(rule.id, id)).run()
export const ruleHits = (r: Rule, txs: Tx[]) => txs.filter((t) => ruleMatches(r, t.labelNorm, t.accountId)).length

// ---------- réglages ----------
export const getSetting = <T>(db: Db, key: string): T | undefined => db.select().from(setting).where(eq(setting.key, key)).get()?.value as T | undefined
export const putSetting = (db: Db, key: string, value: unknown) =>
  db.insert(setting).values({ key, value }).onConflictDoUpdate({ target: setting.key, set: { value } }).run()
