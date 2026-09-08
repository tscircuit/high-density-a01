import { expect, test } from "bun:test"
import { decodeNativeA03DistanceSnapshot } from "../../lib/native-search/decodeNativeA03DistanceSnapshot"

test("A03 distance snapshots retain FIFO and raw memo slots across callback changes", () => {
  const floats = [
    0x7ff8000000000001n,
    0xfff8000000000123n,
    0x7ff0000000000001n,
    0n,
    0x8000000000000000n,
    0x7ff0000000000000n,
    0xfff0000000000000n,
    1n,
  ]
  const valid = [0n, 1n, 1n, 0n, 1n, 0n, 1n, 1n]
  const words = [1n, 8n, 16n, 2n]
  for (const goal of [6n, 1n])
    words.push(goal, 8n, ...floats, ...floats, ...floats, ...valid)
  const wire = new BigUint64Array(words.length + 4)
  wire.set(words, 2)
  const snapshot = decodeNativeA03DistanceSnapshot(
    wire.buffer,
    16,
    words.length,
  )
  expect([snapshot.capacity, snapshot.slots]).toEqual([8, 16])
  expect([...snapshot.tables.keys()]).toEqual([6, 1])
  for (const table of snapshot.tables.values()) {
    for (const values of [table.dx, table.dy, table.distance]) {
      expect([...new BigUint64Array(values.buffer)]).toEqual(floats)
    }
    expect([...table.valid]).toEqual(valid.map(Number))
  }
  wire.fill(0n)
  expect([
    ...new BigUint64Array(snapshot.tables.get(6)!.distance.buffer),
  ]).toEqual(floats)

  // Materialization can happen after the user patches any of these globals.
  // Captured constructors and Map methods must avoid new user callbacks.
  const NativeMap = Map
  const NativeFloat64Array = Float64Array
  const NativeUint32Array = Uint32Array
  const NativeUint8Array = Uint8Array
  const originalSet = Map.prototype.set
  const originalHas = Map.prototype.has
  const input = new BigUint64Array(words)
  let callbacks = 0
  const forbidden = () => {
    callbacks++
    throw new Error("unexpected materialization callback")
  }
  let restored: ReturnType<typeof decodeNativeA03DistanceSnapshot>
  try {
    Map.prototype.set = forbidden as never
    Map.prototype.has = forbidden as never
    globalThis.Map = forbidden as never
    globalThis.Float64Array = forbidden as never
    globalThis.Uint32Array = forbidden as never
    globalThis.Uint8Array = forbidden as never
    restored = decodeNativeA03DistanceSnapshot(input.buffer, 0, words.length)
  } finally {
    globalThis.Map = NativeMap
    globalThis.Float64Array = NativeFloat64Array
    globalThis.Uint32Array = NativeUint32Array
    globalThis.Uint8Array = NativeUint8Array
    Map.prototype.set = originalSet
    Map.prototype.has = originalHas
  }
  expect(callbacks).toBe(0)
  expect([...restored!.tables.keys()]).toEqual([6, 1])
  expect([...new BigUint64Array(restored!.tables.get(1)!.dy.buffer)]).toEqual(
    floats,
  )

  const decode = (data: bigint[]) =>
    decodeNativeA03DistanceSnapshot(
      new BigUint64Array(data).buffer,
      0,
      data.length,
    )
  expect(decode([1n, 0n, 0n, 0n])).toEqual({
    capacity: 0,
    slots: 0,
    tables: new Map(),
  })
  expect(decode([1n, 65536n, 0n, 0n]).capacity).toBe(65536)
  for (let length = 0; length < words.length; length++) {
    expect(() => decode(words.slice(0, length))).toThrow()
  }
  for (const [index, value] of [
    [0, 2n],
    [1, 65537n],
    [2, 15n],
    [3, 0n],
    [4, 8n],
    [5, 7n],
    [30, 2n],
    [38, 6n],
    [39, 7n],
    [0, 0x100000001n],
  ] as const) {
    const malformed = words.slice()
    malformed[index] = value
    expect(() => decode(malformed)).toThrow()
  }
  expect(() => decode([...words, 0n])).toThrow()
})
