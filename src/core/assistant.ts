// Assistant optionnel via Ollama (modèle local, gratuit). Rien ne part sur Internet : l'URL par défaut est la machine elle-même.
export interface AssistantSettings { enabled: boolean; url: string; model: string }
export const DEFAULT_ASSISTANT: AssistantSettings = { enabled: false, url: 'http://localhost:11434', model: 'llama3.2' }
export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string }

export async function ollamaChat(s: AssistantSettings, messages: ChatMessage[], signal?: AbortSignal): Promise<string> {
  const url = new URL('/api/chat', s.url)
  if (!/^(localhost|127\.0\.0\.1|\[::1\])$/.test(url.hostname) && !/^(10|192\.168|172\.(1[6-9]|2\d|3[01]))\./.test(url.hostname))
    throw new Error('Par sécurité, l’assistant ne parle qu’à un Ollama sur cette machine ou le réseau local.')
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: s.model, messages, stream: false, options: { temperature: 0.2 } }), signal })
  if (!res.ok) throw new Error(`Ollama a répondu ${res.status}. Le modèle « ${s.model} » est-il installé (ollama pull ${s.model}) ?`)
  const j = (await res.json()) as { message?: { content?: string } }
  return j.message?.content?.trim() ?? ''
}

export const SYSTEM_PROMPT = `Tu es un assistant de budget personnel. Réponds en français, brièvement, uniquement à partir des données fournies.
Si l'information manque, dis-le. Montants en euros. Ne donne pas de conseil d'investissement personnalisé.`

/** Choix d'une catégorie parmi une liste fermée : la réponse du modèle est ramenée à un nom existant, sinon null. */
export function matchCategory(answer: string, names: string[]): string | null {
  const a = answer.toLowerCase()
  return [...names].sort((x, y) => y.length - x.length).find((n) => a.includes(n.toLowerCase())) ?? null
}
