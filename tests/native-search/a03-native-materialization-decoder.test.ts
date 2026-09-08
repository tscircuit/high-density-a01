import { expect, test } from "bun:test"
import { decodeNativeA03Materialization } from "../../lib/native-search/decodeNativeA03Materialization"

test("bulk A03 materialization owns all raw backing and preserves sparse ordered lists", () => {
  const buffer = new ArrayBuffer(4096)
  // Deliberately only four-byte aligned: the metadata contains raw scalar words.
  const pointer = 4
  const metadata = new Uint32Array(buffer, pointer, 50)
  metadata.set([1, 1, 1, 1, 0xffffffff, 0, 0, 0x80000000, 0, 0x41e00000])
  let next = 256
  const integers = (values: number[]): [number, number] => {
    const at = next
    new Int32Array(buffer, at, values.length).set(values)
    next += Math.max(8, Math.ceil(values.length / 2) * 8)
    return [at, values.length]
  }
  const bits = [0x7ff8000000000001n, 0xfff8000000000123n, 0x8000000000000000n]
  const reals = (): [number, number] => {
    const at = next
    new BigUint64Array(buffer, at, bits.length).set(bits)
    next += bits.length * 8
    return [at, bits.length]
  }
  const spans: Array<[number, number]> = [
    reals(),
    integers([-1, 2147483647, -2147483648]),
    integers([0, 1, -1]),
    integers([9, 8, 7]),
    reals(),
    integers([-1, 0, 1]),
    integers([-1, 0, 1]),
    integers([0, 1, 2]),
    integers([5, -1]),
    integers([-1, 0]),
    integers([1, -1, 0]),
    integers([0, 3, -1]),
    integers([-1, 0, 2]),
    reals(),
    integers([8, 2, 8]),
    integers([]),
    integers([-1, -2147483648]),
    integers([0, -1, 7]),
  ]
  const firstVia = integers([5, 2])
  const empty = integers([])
  const layer = integers([9, 4])
  spans.push(integers([9, ...firstVia, 2, ...empty]))
  spans.push(integers([1, ...empty, 2, ...layer]))
  for (let i = 0; i < spans.length; i++) metadata.set(spans[i]!, 10 + i * 2)
  const originalArrayIterator = Array.prototype[Symbol.iterator]
  let snapshot: ReturnType<typeof decodeNativeA03Materialization>
  try {
    Array.prototype[Symbol.iterator] = (): never => {
      throw new Error("Unexpected changed Array iterator callback")
    }
    snapshot = decodeNativeA03Materialization(buffer, pointer, 50)
  } finally {
    Array.prototype[Symbol.iterator] = originalArrayIterator
  }
  const raw = (values: Float64Array): bigint[] => [
    ...new BigUint64Array(values.buffer, values.byteOffset, values.length),
  ]
  expect(snapshot.heap.length).toBe(1)
  expect(raw(snapshot.heap.f)).toEqual(bits)
  expect([...snapshot.heap.id]).toEqual([-1, 2147483647, -2147483648])
  expect(snapshot.nodes.length).toBe(1)
  expect(raw(snapshot.nodes.g)).toEqual(bits)
  expect(raw(snapshot.bestG)).toEqual(bits)
  expect([...snapshot.nodes.z]).toEqual([0, 1, -1])
  expect([...snapshot.nodes.cellId]).toEqual([9, 8, 7])
  expect([...snapshot.nodes.parent]).toEqual([-1, 0, 1])
  expect([...snapshot.nodes.ripHead]).toEqual([-1, 0, 1])
  expect([...snapshot.nodes.ripCount]).toEqual([0, 1, 2])
  expect(snapshot.rips.length).toBe(1)
  expect([...snapshot.rips.connId]).toEqual([5, -1])
  expect([...snapshot.rips.prev]).toEqual([-1, 0])
  expect([...snapshot.visited]).toEqual([1, 4294967295, 0])
  expect([...snapshot.visitedFlat]).toEqual([0, 3, 4294967295])
  expect([...snapshot.bestStamp]).toEqual([4294967295, 0, 2])
  expect(Object.is(snapshot.moveCost, -0)).toBe(true)
  expect(snapshot.moveHead).toBe(-1)
  expect(snapshot.moveRipCount).toBe(2147483648)
  expect(snapshot.viaScratch).toEqual([8, 2, 8])
  expect(snapshot.cellScratch).toEqual([])
  expect(snapshot.layerScratch).toEqual([-1, -2147483648])
  expect([...snapshot.viaOccupants]).toEqual([
    [9, [5, 2]],
    [2, []],
  ])
  expect([...snapshot.nativeFootprints]).toEqual([])
  expect([...snapshot.layerStamp]).toEqual([0, 4294967295, 7])
  expect(snapshot.layerOccupants).toEqual([undefined, [], [9, 4]])

  const malformed = (word: number, value: number): void => {
    const copy = buffer.slice(0)
    new Uint32Array(copy, pointer, 50)[word] = value
    expect(() => decodeNativeA03Materialization(copy, pointer, 50)).toThrow()
  }
  for (const [word, value] of [
    [0, 2],
    [5, 1],
    [1, 4],
    [2, 4],
    [3, 3],
    [10, 257],
    [11, 0xffffffff],
    [13, 2],
    [17, 2],
    [29, 1],
    [47, 5],
    [49, 5],
  ])
    malformed(word!, value!)
  for (let count = 0; count < 50; count++)
    expect(() =>
      decodeNativeA03Materialization(buffer, pointer, count),
    ).toThrow()
  for (const at of [-1, 1, 4096, Number.NaN, Number.POSITIVE_INFINITY])
    expect(() => decodeNativeA03Materialization(buffer, at, 50)).toThrow()
  const duplicate = buffer.slice(0)
  new Uint32Array(duplicate, spans[18]![0], 6)[3] = 9
  expect(() => decodeNativeA03Materialization(duplicate, pointer, 50)).toThrow()
  const badLayer = buffer.slice(0)
  new Uint32Array(badLayer, spans[19]![0], 6)[3] = 1
  expect(() => decodeNativeA03Materialization(badLayer, pointer, 50)).toThrow()

  // Reusing native memory must not mutate any restored backing or list.
  new Uint8Array(buffer).fill(0)
  expect(raw(snapshot.heap.f)).toEqual(bits)
  expect(raw(snapshot.nodes.g)).toEqual(bits)
  expect(raw(snapshot.bestG)).toEqual(bits)
  expect(snapshot.layerOccupants).toEqual([undefined, [], [9, 4]])
  expect([...snapshot.viaOccupants]).toEqual([
    [9, [5, 2]],
    [2, []],
  ])
})
