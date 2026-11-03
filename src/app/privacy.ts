import { useSyncExternalStore } from 'react'
import { privacy } from '@/core/money'

// Simple préférence d'affichage (aucune donnée) : peut rester en clair dans localStorage
const KEY = 'budget:privacy'
privacy.hidden = localStorage.getItem(KEY) === '1'
const listeners = new Set<() => void>()
export function togglePrivacy() {
  privacy.hidden = !privacy.hidden
  localStorage.setItem(KEY, privacy.hidden ? '1' : '0')
  listeners.forEach((l) => l())
}
export const usePrivacy = () => useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l) }, () => privacy.hidden)
