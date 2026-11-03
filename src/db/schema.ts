import { sql } from 'drizzle-orm'
import { sqliteTable, text, integer, real, uniqueIndex, index, primaryKey, customType } from 'drizzle-orm/sqlite-core'

const id = () => text('id').primaryKey().$defaultFn(() => crypto.randomUUID())
const stamps = {
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
}

export const ACCOUNT_TYPES = ['courant', 'epargne', 'carte', 'especes', 'credit', 'investissement'] as const
export const CATEGORY_KINDS = ['depense', 'revenu', 'transfert'] as const

export const account = sqliteTable('account', {
  id: id(),
  name: text('name').notNull(),
  type: text('type', { enum: ACCOUNT_TYPES }).notNull(),
  currency: text('currency').notNull().default('EUR'),
  openingBalance: integer('opening_balance').notNull().default(0), // centimes, devise du compte
  balanceDate: text('balance_date'), // si renseignée : openingBalance est le solde à cette date (sinon : avant toute opération)
  bank: text('bank'),
  archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
  ...stamps,
})

export const category = sqliteTable('category', {
  id: id(),
  name: text('name').notNull(),
  parentId: text('parent_id'),
  kind: text('kind', { enum: CATEGORY_KINDS }).notNull(),
  color: text('color'),
  rollover: integer('rollover', { mode: 'boolean' }).notNull().default(false), // report du reste d'un mois sur l'autre
  bucket: text('bucket', { enum: ['besoin', 'envie'] }), // méthode 50/30/20
  fiscal: text('fiscal', { enum: ['don', 'garde', 'domicile'] }), // récapitulatif fiscal annuel
  ...stamps,
})

export const importBatch = sqliteTable('import_batch', {
  id: id(),
  accountId: text('account_id').notNull().references(() => account.id, { onDelete: 'cascade' }),
  fileName: text('file_name').notNull(),
  imported: integer('imported').notNull(),
  skipped: integer('skipped').notNull(),
  ...stamps,
})

export const transaction = sqliteTable('transaction', {
  id: id(),
  accountId: text('account_id').notNull().references(() => account.id, { onDelete: 'cascade' }),
  date: text('date').notNull(), // YYYY-MM-DD
  amount: integer('amount').notNull(), // centimes, devise du compte/opération
  currency: text('currency').notNull(),
  amountEur: integer('amount_eur').notNull(),
  fxRate: real('fx_rate'), // null si EUR
  label: text('label').notNull(),
  labelNorm: text('label_norm').notNull(),
  categoryId: text('category_id').references(() => category.id, { onDelete: 'set null' }),
  notes: text('notes'),
  importKey: text('import_key'), // null pour la saisie manuelle
  importBatchId: text('import_batch_id').references(() => importBatch.id, { onDelete: 'cascade' }),
  transferGroupId: text('transfer_group_id'),
  pro: integer('pro', { mode: 'boolean' }).notNull().default(false), // mode freelance
  vatRate: real('vat_rate'),
  expenseReport: integer('expense_report', { mode: 'boolean' }).notNull().default(false), // note de frais à se faire rembourser
  ...stamps,
}, (t) => [
  uniqueIndex('tx_dedup').on(t.accountId, t.importKey),
  index('tx_date').on(t.date),
  index('tx_account').on(t.accountId),
])

export const transactionSplit = sqliteTable('transaction_split', {
  id: id(),
  transactionId: text('transaction_id').notNull().references(() => transaction.id, { onDelete: 'cascade' }),
  categoryId: text('category_id').notNull().references(() => category.id, { onDelete: 'cascade' }),
  amount: integer('amount').notNull(),
})

export const tag = sqliteTable('tag', { id: id(), name: text('name').notNull().unique() })
export const transactionTag = sqliteTable('transaction_tag', {
  transactionId: text('transaction_id').notNull().references(() => transaction.id, { onDelete: 'cascade' }),
  tagId: text('tag_id').notNull().references(() => tag.id, { onDelete: 'cascade' }),
}, (t) => [primaryKey({ columns: [t.transactionId, t.tagId] })])

export const rule = sqliteTable('rule', {
  id: id(),
  pattern: text('pattern').notNull(),
  isRegex: integer('is_regex', { mode: 'boolean' }).notNull().default(false),
  accountId: text('account_id').references(() => account.id, { onDelete: 'cascade' }),
  categoryId: text('category_id').notNull().references(() => category.id, { onDelete: 'cascade' }),
  priority: integer('priority').notNull().default(0),
  learned: integer('learned', { mode: 'boolean' }).notNull().default(false),
  ...stamps,
})

export const importProfile = sqliteTable('import_profile', {
  id: id(),
  name: text('name').notNull(),
  headerSignature: text('header_signature').notNull().unique(), // en-têtes du CSV : retrouve le mapping au prochain import
  mapping: text('mapping', { mode: 'json' }).notNull(),
  ...stamps,
})

export const fxRate = sqliteTable('fx_rate', {
  currency: text('currency').notNull(),
  date: text('date').notNull(),
  rate: real('rate').notNull(), // 1 unité de devise = rate EUR
  manual: integer('manual', { mode: 'boolean' }).notNull().default(false),
}, (t) => [primaryKey({ columns: [t.currency, t.date] })])

export const setting = sqliteTable('setting', { key: text('key').primaryKey(), value: text('value', { mode: 'json' }) })

export const RECURRING_KINDS = ['revenu', 'charge', 'abonnement'] as const
export const recurring = sqliteTable('recurring', {
  id: id(),
  name: text('name').notNull(),
  kind: text('kind', { enum: RECURRING_KINDS }).notNull(),
  accountId: text('account_id').references(() => account.id, { onDelete: 'set null' }),
  categoryId: text('category_id').references(() => category.id, { onDelete: 'set null' }),
  amount: integer('amount').notNull(), // centimes EUR, signé (négatif = sortie)
  freq: text('freq', { enum: ['week', 'month', 'year'] }).notNull(),
  interval: integer('interval').notNull().default(1),
  startDate: text('start_date').notNull(), // première échéance (date valide)
  dayOfMonth: integer('day_of_month'), // jour voulu (1-31 ; 31 = dernier jour), ramené à la fin des mois courts
  endDate: text('end_date'),
  pattern: text('pattern'), // motif du libellé pour reconnaître les prélèvements
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  debtId: text('debt_id'), // mensualité d'un crédit (supprimée avec lui)
  ...stamps,
})

export const budgetLine = sqliteTable('budget_line', {
  id: id(),
  categoryId: text('category_id').notNull().references(() => category.id, { onDelete: 'cascade' }),
  amount: integer('amount').notNull(), // centimes, positif
  validFrom: text('valid_from').notNull(), // YYYY-MM
  validTo: text('valid_to'),
}, (t) => [index('budget_line_cat').on(t.categoryId)])

export const budgetException = sqliteTable('budget_exception', {
  id: id(),
  categoryId: text('category_id').notNull().references(() => category.id, { onDelete: 'cascade' }),
  month: text('month').notNull(),
  amount: integer('amount').notNull(),
  reason: text('reason'),
  ...stamps,
}, (t) => [uniqueIndex('budget_exception_cat_month').on(t.categoryId, t.month)])

// ---------- phase 4 : objectifs, dettes, patrimoine, scénarios ----------
export const goal = sqliteTable('goal', {
  id: id(),
  name: text('name').notNull(),
  target: integer('target').notNull(),
  deadline: text('deadline'),
  accountId: text('account_id').references(() => account.id, { onDelete: 'set null' }), // si lié : avancement = solde du compte
  ...stamps,
})
export const goalContribution = sqliteTable('goal_contribution', {
  id: id(),
  goalId: text('goal_id').notNull().references(() => goal.id, { onDelete: 'cascade' }),
  date: text('date').notNull(),
  amount: integer('amount').notNull(),
  note: text('note'),
})
export const savingsRule = sqliteTable('savings_rule', {
  id: id(),
  kind: text('kind', { enum: ['arrondi', 'pourcentage'] }).notNull(),
  value: real('value').notNull(), // arrondi : pas en centimes (100 = à l'euro) ; pourcentage : % des revenus
  goalId: text('goal_id').notNull().references(() => goal.id, { onDelete: 'cascade' }),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
})
export const debt = sqliteTable('debt', {
  id: id(),
  name: text('name').notNull(),
  principal: integer('principal').notNull(),
  rate: real('rate').notNull(), // taux annuel en %
  payment: integer('payment').notNull(),
  startMonth: text('start_month').notNull(),
  extraMonthly: integer('extra_monthly').notNull().default(0),
  ...stamps,
})
export const asset = sqliteTable('asset', {
  id: id(),
  name: text('name').notNull(),
  kind: text('kind', { enum: ['immobilier', 'investissement', 'vehicule', 'autre'] }).notNull(),
  ...stamps,
})
export const assetValue = sqliteTable('asset_value', {
  assetId: text('asset_id').notNull().references(() => asset.id, { onDelete: 'cascade' }),
  date: text('date').notNull(),
  value: integer('value').notNull(),
}, (t) => [primaryKey({ columns: [t.assetId, t.date] })])
export const scenario = sqliteTable('scenario', {
  id: id(),
  name: text('name').notNull(),
  changes: text('changes', { mode: 'json' }).notNull(),
  ...stamps,
})

// ---------- phase 6 : pièces jointes ----------
const bytes = customType<{ data: Uint8Array }>({ dataType: () => 'blob' })
export const attachment = sqliteTable('attachment', {
  id: id(),
  transactionId: text('transaction_id').notNull().references(() => transaction.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  mime: text('mime').notNull(),
  data: bytes('data').notNull(),
  ocrText: text('ocr_text'),
  ...stamps,
})
