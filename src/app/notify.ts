import { useEffect } from 'react'
import { today } from '@/core/dates'
import { alertSettings, alerts } from '@/db/analyticsRepo'
import { getSetting, listTransactions, putSetting } from '@/db/repo'
import { mutate, useDb } from './store'
import type { Db } from '@/db/client'

/**
 * Notifications système pour les nouvelles alertes (une seule fois par alerte).
 * ponytail: sans service worker, elles ne partent que lorsque l'app est ouverte ; le service worker arrive avec la PWA (phase 6).
 */
function check(db: Db) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
  remind(db)
  if (!alertSettings(db).notifications) return
  const seen = new Set(getSetting<string[]>(db, 'notifiedAlerts') ?? [])
  const fresh = alerts(db, today()).filter((a) => !seen.has(a.id) && (a.severity !== 'info' || a.type === 'echeance'))
  if (!fresh.length) return
  for (const a of fresh.slice(0, 3)) new Notification(a.title, { body: a.body, tag: a.id })
  mutate((d) => putSetting(d, 'notifiedAlerts', [...seen, ...fresh.map((a) => a.id)].slice(-500)), { undoable: false })
}

/** Rappel quotidien : une fois par jour, passé l'heure choisie, si rien n'a encore été noté aujourd'hui. */
function remind(db: Db) {
  const h = alertSettings(db).reminderHour, d = today()
  if (h === null || new Date().getHours() < h || getSetting<string>(db, 'lastReminder') === d) return
  if (!listTransactions(db, { from: d, to: d, limit: 1 }).length) new Notification('Tes dépenses du jour', { body: 'Une minute pour noter ce que tu as dépensé aujourd’hui ?', tag: 'rappel' })
  mutate((x) => putSetting(x, 'lastReminder', d), { undoable: false })
}

export function useAlertNotifications() {
  const { db, version } = useDb()
  useEffect(() => { const t = setTimeout(() => check(db), 2000); return () => clearTimeout(t) }, [db, version])
  useEffect(() => { const t = setInterval(() => check(db), 10 * 60_000); return () => clearInterval(t) }, [db])
}
