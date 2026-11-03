/** Libellé normalisé : majuscules, sans accents, sans numéros de carte/dates/références qui varient. */
export function normalizeLabel(label: string): string {
  return label
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\b(CB|PRLV|VIR|SEPA|CARTE|X\d{4})\b/g, ' ')
    .replace(/\b\d{2}[/.]\d{2}([/.]\d{2,4})?\b/g, ' ')
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
