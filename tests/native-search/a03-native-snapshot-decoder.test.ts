import { expect, test } from "bun:test"
import { decodeNativeA03Snapshot } from "../../lib/native-search/decodeNativeA03Snapshot"

// Independent ABI-v1 fixture with literal IEEE words: do not use the native
// serializer or JS-number conversions to construct or check floating payloads.
const floatBits = [
  0x7ff8000000000001n,
  0xfff8000000000123n,
  0x7ff0000000000001n,
  0n,
  0x8000000000000000n,
  0x7ff0000000000000n,
  0xfff0000000000000n,
  1n,
  0x3ff0000000000000n,
  0xbff0000000000000n,
]
const signedBits = (value: number): bigint => BigInt(value >>> 0)
const realBits = (values: Float64Array): bigint[] => [
  ...new BigUint64Array(values.buffer, values.byteOffset, values.length),
]
const makeWire = (): { words: bigint[]; positions: Record<string, number> } => {
  const words: bigint[] = []
  const positions: Record<string, number> = {}
  const mark = (name: string, ...values: bigint[]): void => {
    positions[name] = words.length
    words.push(...values)
  }
  mark("version", 1n)
  mark("heapLength", 2n)
  mark("heapCapacity", BigInt(floatBits.length))
  for (let i = 0; i < floatBits.length; i++)
    words.push(
      floatBits[i]!,
      signedBits(i === 2 ? -2147483648 : i === 3 ? 2147483647 : i - 1),
    )
  mark("nodeLength", 1n)
  mark("nodeCapacity", BigInt(floatBits.length))
  for (let i = 0; i < floatBits.length; i++)
    words.push(
      signedBits(i - 2),
      signedBits(i + 8),
      floatBits[i]!,
      signedBits(-1),
      signedBits(i - 1),
      signedBits(i === 3 ? -2147483648 : i),
    )
  mark("ripLength", 1n)
  mark("ripCapacity", 3n)
  words.push(2n, 0xffffffffn, 0x7fffffffn, 0n, 0x80000000n, 1n)
  mark("visited", 3n, 0n, 1n, 0xffffffffn)
  mark("visitedFlat", 3n, 0xffffffffn, 0n, 7n)
  mark("bestStamp", 2n, 3n, 0xffffffffn)
  mark("bestG", BigInt(floatBits.length), ...floatBits)
  mark("moveCost", 0x8000000000000000n)
  mark("moveHead", 0xffffffffn)
  mark("moveRipCount", 0x41e0000000000000n)
  mark("viaScratch", 3n, 8n, 2n, 8n)
  mark("cellScratch", 0n)
  mark("layerScratch", 2n, 0xffffffffn, 0x80000000n)
  mark("viaMapCount", 2n)
  mark("viaMapKey", 9n, 2n, 5n, 2n, 2n, 0n)
  mark("footprintCount", 2n, 7n, 3n, 3n, 1n, 3n, 1n, 0n)
  mark("layerCount", 3n)
  mark("layerAbsent", 0n, 0n)
  mark("layerPresentEmpty", 0xffffffffn, 1n, 0n)
  mark("layerPresent", 7n, 1n, 2n, 9n, 4n)
  return { words, positions }
}

test("A03 snapshots preserve backing bits and ordering and reject malformed wire data", () => {
  const { words, positions } = makeWire()
  const backing = new ArrayBuffer((words.length + 4) * 8)
  const encoded = new BigUint64Array(backing, 16, words.length)
  encoded.set(words)
  const snapshot = decodeNativeA03Snapshot(backing, 16, words.length)
  expect(snapshot.heap.length).toBe(2)
  expect(snapshot.heap.f.length).toBe(floatBits.length)
  expect(realBits(snapshot.heap.f)).toEqual(floatBits)
  expect([...snapshot.heap.id]).toEqual([
    -1, 0, -2147483648, 2147483647, 3, 4, 5, 6, 7, 8,
  ])
  expect(snapshot.nodes.length).toBe(1)
  expect(realBits(snapshot.nodes.g)).toEqual(floatBits)
  expect([...snapshot.nodes.z]).toEqual([-2, -1, 0, 1, 2, 3, 4, 5, 6, 7])
  expect([...snapshot.nodes.cellId]).toEqual([
    8, 9, 10, 11, 12, 13, 14, 15, 16, 17,
  ])
  expect([...snapshot.nodes.parent]).toEqual(
    new Array(floatBits.length).fill(-1),
  )
  expect([...snapshot.nodes.ripHead]).toEqual([-1, 0, 1, 2, 3, 4, 5, 6, 7, 8])
  expect([...snapshot.nodes.ripCount]).toEqual([
    0, 1, 2, -2147483648, 4, 5, 6, 7, 8, 9,
  ])
  expect(snapshot.rips.length).toBe(1)
  expect([...snapshot.rips.connId]).toEqual([2, 2147483647, -2147483648])
  expect([...snapshot.rips.prev]).toEqual([-1, 0, 1])
  expect([...snapshot.visited]).toEqual([0, 1, 4294967295])
  expect([...snapshot.visitedFlat]).toEqual([4294967295, 0, 7])
  expect([...snapshot.bestStamp]).toEqual([3, 4294967295])
  expect(realBits(snapshot.bestG)).toEqual(floatBits)
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
  expect(
    [...snapshot.nativeFootprints].map(([key, value]) => [key, [...value]]),
  ).toEqual([
    [7, [3, 1, 3]],
    [1, []],
  ])
  expect([...snapshot.layerStamp]).toEqual([0, 4294967295, 7])
  expect(snapshot.layerOccupants).toEqual([undefined, [], [9, 4]])
  // The decoded state must survive native memory reuse, including NaN bits.
  encoded.fill(0n)
  expect(realBits(snapshot.heap.f)).toEqual(floatBits)
  expect(realBits(snapshot.nodes.g)).toEqual(floatBits)
  expect(realBits(snapshot.bestG)).toEqual(floatBits)
  expect([...snapshot.nativeFootprints.get(7)!]).toEqual([3, 1, 3])

  const decode = (data: bigint[]): unknown => {
    const array = new BigUint64Array(data)
    return decodeNativeA03Snapshot(array.buffer, 0, array.length)
  }
  for (let length = 0; length < words.length; length++)
    expect(() => decode(words.slice(0, length))).toThrow()
  for (const [name, value, error] of [
    ["version", 2n, "Unsupported native A03 snapshot version"],
    ["heapLength", 11n, "Invalid native A03 heap length"],
    ["nodeLength", 11n, "Invalid native A03 node length"],
    ["ripLength", 4n, "Invalid native A03 rip length"],
    ["heapCapacity", 0xffffffffn, "Invalid native A03 snapshot length"],
    ["visited", 0xffffffffn, "Invalid native A03 snapshot length"],
    ["viaMapCount", 0xffffffffn, "Invalid native A03 snapshot length"],
    ["footprintCount", 0xffffffffn, "Invalid native A03 snapshot length"],
    ["layerCount", 0xffffffffn, "Invalid native A03 snapshot length"],
    ["moveHead", 0xffffffffffffffffn, "Invalid native A03 integer word"],
    ["viaMapKey", 0x100000009n, "Invalid native A03 integer word"],
  ] as const) {
    const malformed = words.slice()
    malformed[positions[name]!] = value
    expect(() => decode(malformed)).toThrow(error)
  }
  const presence = words.slice()
  presence[positions.layerPresent! + 1] = 2n
  expect(() => decode(presence)).toThrow(
    "Invalid native A03 layer presence flag",
  )
  expect(() => decode([...words, 0n])).toThrow(
    "Unexpected native A03 snapshot suffix",
  )
})
