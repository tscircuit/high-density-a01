const SnapshotUint32Array = Uint32Array
const SnapshotInt32Array = Int32Array
const SnapshotFloat64Array = Float64Array
const SnapshotArray = Array
const SnapshotMap = Map
const snapshotApply = Reflect.apply
const snapshotMapSet = Map.prototype.set
const snapshotArrayFill = Array.prototype.fill
const snapshotBuffer = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype),
  "buffer",
)!.get!

export type NativeA03Snapshot = {
  heap: { length: number; f: Float64Array; id: Int32Array }
  nodes: {
    length: number
    z: Int32Array
    cellId: Int32Array
    g: Float64Array
    parent: Int32Array
    ripHead: Int32Array
    ripCount: Int32Array
  }
  rips: { length: number; connId: Int32Array; prev: Int32Array }
  visited: Uint32Array
  visitedFlat: Uint32Array
  bestStamp: Uint32Array
  bestG: Float64Array
  moveCost: number
  moveHead: number
  moveRipCount: number
  viaScratch: number[]
  cellScratch: number[]
  layerScratch: number[]
  viaOccupants: Map<number, number[]>
  nativeFootprints: Map<number, Int32Array>
  layerStamp: Uint32Array
  layerOccupants: Array<readonly number[] | undefined>
}

/** Decode the versioned ABI without allocating a BigInt for every word. */
export function decodeNativeA03Snapshot(
  buffer: ArrayBufferLike,
  pointer: number,
  words: number,
): NativeA03Snapshot {
  const unsigned = new SnapshotUint32Array(buffer, pointer, words * 2)
  const doubles = new SnapshotFloat64Array(buffer, pointer, words)
  let cursor = 0
  const integer = (): number => {
    if (cursor >= words) throw new Error("Truncated native A03 snapshot")
    const low = unsigned[cursor * 2]!
    const high = unsigned[cursor++ * 2 + 1]!
    if (high !== 0) throw new Error("Invalid native A03 integer word")
    return low
  }
  const signed = (): number => integer() | 0
  const real = (): number => {
    if (cursor >= words) throw new Error("Truncated native A03 snapshot")
    return doubles[cursor++]!
  }
  const copyReal = (target: Uint32Array, index: number): void => {
    if (cursor >= words) throw new Error("Truncated native A03 snapshot")
    target[index * 2] = unsigned[cursor * 2]!
    target[index * 2 + 1] = unsigned[cursor * 2 + 1]!
    cursor++
  }
  const length = (): number => {
    const value = integer()
    if (value > words - cursor)
      throw new Error("Invalid native A03 snapshot length")
    return value
  }
  const signedList = (): number[] => {
    const result = new SnapshotArray<number>(length())
    for (let i = 0; i < result.length; i++) result[i] = signed()
    return result
  }
  const stampArray = (): Uint32Array => {
    const count = length()
    const result = new SnapshotUint32Array(count)
    for (let i = 0; i < count; i++) result[i] = integer()
    return result
  }
  if (integer() !== 1)
    throw new Error("Unsupported native A03 snapshot version")
  const heapLength = integer()
  const heapCapacity = length()
  if (heapLength > heapCapacity)
    throw new Error("Invalid native A03 heap length")
  const heap = {
    length: heapLength,
    f: new SnapshotFloat64Array(heapCapacity),
    id: new SnapshotInt32Array(heapCapacity),
  }
  const heapBits = new SnapshotUint32Array(
    snapshotApply(snapshotBuffer, heap.f, []),
  )
  for (let i = 0; i < heapCapacity; i++) {
    copyReal(heapBits, i)
    heap.id[i] = signed()
  }
  const nodeLength = integer()
  const nodeCapacity = length()
  if (nodeLength > nodeCapacity)
    throw new Error("Invalid native A03 node length")
  const nodes = {
    length: nodeLength,
    z: new SnapshotInt32Array(nodeCapacity),
    cellId: new SnapshotInt32Array(nodeCapacity),
    g: new SnapshotFloat64Array(nodeCapacity),
    parent: new SnapshotInt32Array(nodeCapacity),
    ripHead: new SnapshotInt32Array(nodeCapacity),
    ripCount: new SnapshotInt32Array(nodeCapacity),
  }
  const nodeBits = new SnapshotUint32Array(
    snapshotApply(snapshotBuffer, nodes.g, []),
  )
  for (let i = 0; i < nodeCapacity; i++) {
    nodes.z[i] = signed()
    nodes.cellId[i] = signed()
    copyReal(nodeBits, i)
    nodes.parent[i] = signed()
    nodes.ripHead[i] = signed()
    nodes.ripCount[i] = signed()
  }
  const ripLength = integer()
  const ripCapacity = length()
  if (ripLength > ripCapacity) throw new Error("Invalid native A03 rip length")
  const rips = {
    length: ripLength,
    connId: new SnapshotInt32Array(ripCapacity),
    prev: new SnapshotInt32Array(ripCapacity),
  }
  for (let i = 0; i < ripCapacity; i++) {
    rips.connId[i] = signed()
    rips.prev[i] = signed()
  }
  const visited = stampArray()
  const visitedFlat = stampArray()
  const bestStamp = stampArray()
  const bestLength = length()
  const bestG = new SnapshotFloat64Array(bestLength)
  const bestBits = new SnapshotUint32Array(
    snapshotApply(snapshotBuffer, bestG, []),
  )
  for (let i = 0; i < bestLength; i++) copyReal(bestBits, i)
  const moveCost = real()
  const moveHead = signed()
  const moveRipCount = real()
  const viaScratch = signedList()
  const cellScratch = signedList()
  const layerScratch = signedList()
  const viaOccupants = new SnapshotMap<number, number[]>()
  const viaCount = length()
  for (let i = 0; i < viaCount; i++) {
    const key = signed()
    snapshotApply(snapshotMapSet, viaOccupants, [key, signedList()])
  }
  const nativeFootprints = new SnapshotMap<number, Int32Array>()
  const footprintCount = length()
  for (let i = 0; i < footprintCount; i++) {
    const key = signed()
    const list = signedList()
    const cells = new SnapshotInt32Array(list.length)
    for (let j = 0; j < list.length; j++) cells[j] = list[j]!
    snapshotApply(snapshotMapSet, nativeFootprints, [key, cells])
  }
  const layerLength = length()
  const layerStamp = new SnapshotUint32Array(layerLength)
  const layerOccupants = new SnapshotArray<readonly number[] | undefined>(
    layerLength,
  )
  snapshotApply(snapshotArrayFill, layerOccupants, [undefined])
  for (let i = 0; i < layerLength; i++) {
    layerStamp[i] = integer()
    const present = integer()
    if (present > 1) throw new Error("Invalid native A03 layer presence flag")
    if (present) layerOccupants[i] = signedList()
  }
  if (cursor !== words) throw new Error("Unexpected native A03 snapshot suffix")
  return {
    heap,
    nodes,
    rips,
    visited,
    visitedFlat,
    bestStamp,
    bestG,
    moveCost,
    moveHead,
    moveRipCount,
    viaScratch,
    cellScratch,
    layerScratch,
    viaOccupants,
    nativeFootprints,
    layerStamp,
    layerOccupants,
  }
}
