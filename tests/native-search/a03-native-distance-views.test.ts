import { expect, test } from "bun:test"
import type { NativeA03DistanceTable } from "../../lib/native-search/decodeNativeA03DistanceSnapshot"
import { restoreNativeA03DistanceViews } from "../../lib/native-search/restoreNativeA03DistanceViews"

test("distance views retain FIFO identities and raw slots without borrowing native memory", () => {
  const buffer = new ArrayBuffer(2048)
  const metadata = new Uint32Array(buffer, 4, 16)
  metadata.set([1, 3, 6, 2, 2, 3, 256, 280, 304, 328, 0, 3, 336, 360, 384, 408])
  const rawValues = [
    0x7ff8000000000001n,
    0xfff8000000000123n,
    0x8000000000000000n,
  ]
  for (const pointer of [256, 280, 304, 336, 360, 384])
    new BigUint64Array(buffer, pointer, 3).set(rawValues)
  new Uint8Array(buffer, 328, 3).set([1, 0, 1])
  new Uint8Array(buffer, 408, 3).set([0, 1, 0])
  const existing: NativeA03DistanceTable = {
    dx: new Float64Array(3),
    dy: new Float64Array(3),
    distance: new Float64Array(3),
    valid: new Uint8Array(3),
  }
  const retained = [existing.dx, existing.dy, existing.distance, existing.valid]
  const target = new Map<number, NativeA03DistanceTable>([
    [1, existing],
    [2, existing],
  ])
  const get = Map.prototype.get
  const set = Map.prototype.set
  const typed = Object.getPrototypeOf(Uint8Array.prototype)
  const length = Object.getOwnPropertyDescriptor(typed, "length")!
  const typedBuffer = Object.getOwnPropertyDescriptor(typed, "buffer")!
  const typedSet = typed.set
  const globalFloat = globalThis.Float64Array
  const arrayIterator = Array.prototype[Symbol.iterator]
  let result: { capacity: number; slots: number } | undefined
  const unexpected = (): never => {
    throw new Error("Unexpected changed-global callback")
  }
  try {
    Map.prototype.get = unexpected
    Map.prototype.set = unexpected
    Object.defineProperty(typed, "length", {
      configurable: true,
      get: unexpected,
    })
    Object.defineProperty(typed, "buffer", {
      configurable: true,
      get: unexpected,
    })
    typed.set = unexpected
    globalThis.Float64Array = unexpected as any
    Array.prototype[Symbol.iterator] = unexpected
    result = restoreNativeA03DistanceViews(buffer, 4, 16, target)
  } finally {
    Map.prototype.get = get
    Map.prototype.set = set
    Object.defineProperty(typed, "length", length)
    Object.defineProperty(typed, "buffer", typedBuffer)
    typed.set = typedSet
    globalThis.Float64Array = globalFloat
    Array.prototype[Symbol.iterator] = arrayIterator
  }
  expect(result).toEqual({ capacity: 3, slots: 6 })
  expect([...target.keys()]).toEqual([2, 0])
  expect(target.get(2)).toBe(existing)
  expect([existing.dx, existing.dy, existing.distance, existing.valid]).toEqual(
    retained,
  )
  for (let i = 0; i < retained.length; i++)
    expect(
      [existing.dx, existing.dy, existing.distance, existing.valid][i],
    ).toBe(retained[i])
  const raw = (values: Float64Array): bigint[] => [
    ...new BigUint64Array(values.buffer, values.byteOffset, values.length),
  ]
  for (const table of target.values())
    for (const values of [table.dx, table.dy, table.distance])
      expect(raw(values)).toEqual(rawValues)
  expect([...existing.valid]).toEqual([1, 0, 1])
  expect([...target.get(0)!.valid]).toEqual([0, 1, 0])
  expect(target.get(0)!.dx.buffer).not.toBe(buffer)
  const malformed = (word: number, value: number): void => {
    const copy = buffer.slice(0)
    new Uint32Array(copy, 4, 16)[word] = value
    expect(() => restoreNativeA03DistanceViews(copy, 4, 16, target)).toThrow()
    expect([...target.keys()]).toEqual([2, 0])
    expect(raw(existing.dx)).toEqual(rawValues)
  }
  for (const [word, value] of [
    [0, 2],
    [1, 0],
    [1, 65537],
    [2, 5],
    [3, 3],
    [4, 3],
    [5, 2],
    [6, 257],
    [9, 2048],
    [10, 2],
  ])
    malformed(word!, value!)
  for (const count of [0, 1, 3, 4, 15, 17])
    expect(() =>
      restoreNativeA03DistanceViews(buffer, 4, count, target),
    ).toThrow()
  new Uint8Array(buffer).fill(0)
  expect(raw(existing.dx)).toEqual(rawValues)
  expect(raw(target.get(0)!.distance)).toEqual(rawValues)
  expect([...target.get(0)!.valid]).toEqual([0, 1, 0])
})
