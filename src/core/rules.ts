import { normalizeLabel } from './labels'

export interface Rule { id: string; pattern: string; isRegex: boolean; accountId: string | null; categoryId: string; priority: number }

export function ruleMatches(r: Rule, labelNorm: string, accountId: string): boolean {
  if (r.accountId && r.accountId !== accountId) return false
  if (r.isRegex) { try { return new RegExp(r.pattern, 'i').test(labelNorm) } catch { return false } }
  return labelNorm.includes(normalizeLabel(r.pattern))
}

/** Première règle qui correspond, par priorité décroissante puis motif le plus long (le plus précis). */
export function categorize(rules: Rule[], labelNorm: string, accountId: string): string | null {
  const sorted = [...rules].sort((a, b) => b.priority - a.priority || b.pattern.length - a.pattern.length)
  return sorted.find((r) => ruleMatches(r, labelNorm, accountId))?.categoryId ?? null
}

/** Motif appris d'une correction : les 2 premiers mots significatifs du libellé ("CARREFOUR MARKET"). */
export function learnPattern(labelNorm: string): string | null {
  const words = labelNorm.split(' ').filter((w) => w.length >= 3 && !/\d/.test(w))
  return words.length ? words.slice(0, 2).join(' ') : null
}
