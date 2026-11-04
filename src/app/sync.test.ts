import { expect, it } from 'vitest'
import { jsonToSealed, sealedToJson, syncEnabled } from './sync'

it('le coffre synchronisé a exactement le format d’une sauvegarde, et revient à l’identique', () => {
  const v = { v: 1 as const, salt: Uint8Array.from([1, 2, 3, 250]), iv: Uint8Array.from([9, 8, 7]), data: Uint8Array.from([0, 255, 128, 64]).buffer }
  const back = jsonToSealed(sealedToJson(v))
  expect([...back.salt]).toEqual([...v.salt])
  expect([...back.iv]).toEqual([...v.iv])
  expect([...new Uint8Array(back.data)]).toEqual([0, 255, 128, 64])
  expect(JSON.parse(sealedToJson(v)).app).toBe('budget')
  expect(() => jsonToSealed('{"app":"autre"}')).toThrow(/invalide/)
})

it('hors de Quansi (app Mac, navigateur seul, tests) : pas de synchro', () => expect(syncEnabled()).toBe(false))
