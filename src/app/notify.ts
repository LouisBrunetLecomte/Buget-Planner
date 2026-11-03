import { useEffect } from 'react'
import { today } from '@/core/dates'
import { alertSettings, alerts } from '@/db/analyticsRepo'
import { getSetting, putSetting } from '@/db/repo'
import { mutate, useDb } from './store'
import type { Db } from '@/db/client'

/**
 * Notifications système pour les nouvelles alertes (une seule fois par alerte).
 * ponytail: sans service worker, elles ne partent que lorsque l'app est ouverte ; le service worker arrive avec la PWA (phase 6).
 */
function check(db: Db) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted' || !alertSettings(db).notifications) return
  const seen = new Set(getSetting<string[]>(db, 'notifiedAlerts') ?? [])
  const fresh = alerts(db, today()).filter((a) => !seen.has(a.id) && (a.severity !== 'info' || a.type === 'echeance'))
  if (!fresh.length) return
  for (const a of fresh.slice(0, 3)) new Notification(a.title, { body: a.body, tag: a.id })
  mutate((d) => putSetting(d, 'notifiedAlerts', [...seen, ...fresh.map((a) => a.id)].slice(-500)), { undoable: false })
}

export function useAlertNotifications() {
  const { db, version } = useDb()
  useEffect(() => { const t = setTimeout(() => check(db), 2000); return () => clearTimeout(t) }, [db, version])
  useEffect(() => { const t = setInterval(() => check(db), 30 * 60_000); return () => clearInterval(t) }, [db])
}
