import type { NativeA03Snapshot } from "./decodeNativeA03Snapshot"

const BulkUint32Array = Uint32Array
const BulkInt32Array = Int32Array
const BulkFloat64Array = Float64Array
const BulkArray = Array
const BulkMap = Map
const bulkApply = Reflect.apply
const bulkSet = Uint8Array.prototype.set
const bulkMapSet = Map.prototype.set
const bulkMapHas = Map.prototype.has
const bulkFill = Array.prototype.fill
const bulkIsSafeInteger = Number.isSafeInteger
const bulkTypedBuffer = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype),
  "buffer",
)!.get!
const bulkBufferSize = Object.getOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  "byteLength",
)!.get!

/** Copy ABI42 into owned JS arrays before another native export can grow memory. */
export function decodeNativeA03Materialization(
  buffer: ArrayBufferLike,
  pointer: number,
  words: number,
): NativeA03Snapshot {
  const bytes = bulkApply(bulkBufferSize, buffer, []) as number
  const check = (offset: number, length: number, width: number): void => {
    if (
      !bulkIsSafeInteger(offset) ||
      !bulkIsSafeInteger(length) ||
      offset < 0 ||
      length < 0 ||
      offset % width !== 0 ||
      offset + length * width > bytes
    )
      throw new Error("Invalid native A03 materialization span")
  }
  if (words !== 50)
    throw new Error("Invalid native A03 materialization metadata length")
  check(pointer, words, 4)
  const metadata = new BulkUint32Array(buffer, pointer, words)
  if (metadata[0] !== 1 || metadata[5] !== 0)
    throw new Error("Unsupported native A03 materialization version")
  const span = (
    index: number,
    width: number,
  ): { offset: number; length: number } => {
    const at = 10 + index * 2
    const offset = metadata[at]!
    const length = metadata[at + 1]!
    check(offset, length, width)
    return { offset, length }
  }
  const signedArray = (index: number): Int32Array => {
    const { offset, length } = span(index, 4)
    const result = new BulkInt32Array(length)
    bulkApply(bulkSet, result, [new BulkInt32Array(buffer, offset, length)])
    return result
  }
  const unsignedArray = (index: number): Uint32Array => {
    const { offset, length } = span(index, 4)
    const result = new BulkUint32Array(length)
    bulkApply(bulkSet, result, [new BulkUint32Array(buffer, offset, length)])
    return result
  }
  const realArray = (index: number): Float64Array => {
    const { offset, length } = span(index, 8)
    const result = new BulkFloat64Array(length)
    // Same-element-type TypedArray.set copies the raw bytes, including NaNs.
    bulkApply(bulkSet, result, [new BulkFloat64Array(buffer, offset, length)])
    return result
  }
  const signedList = (offset: number, length: number): number[] => {
    check(offset, length, 4)
    const values = new BulkInt32Array(buffer, offset, length)
    const result = new BulkArray<number>(length)
    for (let i = 0; i < length; i++) result[i] = values[i]!
    return result
  }
  const listSpan = (index: number): number[] => {
    const { offset, length } = span(index, 4)
    return signedList(offset, length)
  }
  const heap = {
    length: metadata[1]!,
    f: realArray(0),
    id: signedArray(1),
  }
  const nodes = {
    length: metadata[2]!,
    z: signedArray(2),
    cellId: signedArray(3),
    g: realArray(4),
    parent: signedArray(5),
    ripHead: signedArray(6),
    ripCount: signedArray(7),
  }
  const rips = {
    length: metadata[3]!,
    connId: signedArray(8),
    prev: signedArray(9),
  }
  if (
    heap.length > metadata[11]! ||
    metadata[13] !== metadata[11] ||
    nodes.length > metadata[15]! ||
    metadata[17] !== metadata[15] ||
    metadata[19] !== metadata[15] ||
    metadata[21] !== metadata[15] ||
    metadata[23] !== metadata[15] ||
    metadata[25] !== metadata[15] ||
    rips.length > metadata[27]! ||
    metadata[29] !== metadata[27]
  )
    throw new Error("Invalid native A03 materialization backing length")
  const visited = unsignedArray(10)
  const visitedFlat = unsignedArray(11)
  const bestStamp = unsignedArray(12)
  const bestG = realArray(13)
  const viaScratch = listSpan(14)
  const cellScratch = listSpan(15)
  const layerScratch = listSpan(16)
  const layerStamp = unsignedArray(17)
  const viaOccupants = new BulkMap<number, number[]>()
  const { offset: viaOffset, length: viaLength } = span(18, 4)
  if (viaLength % 3 !== 0)
    throw new Error("Invalid native A03 via list metadata")
  const viaLists = new BulkUint32Array(buffer, viaOffset, viaLength)
  for (let i = 0; i < viaLength; i += 3) {
    const key = viaLists[i]! | 0
    if (key < 0 || bulkApply(bulkMapHas, viaOccupants, [key]))
      throw new Error("Invalid native A03 via list key")
    bulkApply(bulkMapSet, viaOccupants, [
      key,
      signedList(viaLists[i + 1]!, viaLists[i + 2]!),
    ])
  }
  const layerOccupants = new BulkArray<readonly number[] | undefined>(
    metadata[45]!,
  )
  bulkApply(bulkFill, layerOccupants, [undefined])
  const { offset: layerOffset, length: layerLength } = span(19, 4)
  if (layerLength % 3 !== 0)
    throw new Error("Invalid native A03 layer list metadata")
  const layerLists = new BulkUint32Array(buffer, layerOffset, layerLength)
  let previousIndex = -1
  for (let i = 0; i < layerLength; i += 3) {
    const index = layerLists[i]!
    if (index <= previousIndex || index >= metadata[45]!)
      throw new Error("Invalid native A03 layer list index")
    previousIndex = index
    layerOccupants[index] = signedList(layerLists[i + 1]!, layerLists[i + 2]!)
  }
  const moveValues = new BulkFloat64Array(2)
  const moveBits = new BulkUint32Array(
    bulkApply(bulkTypedBuffer, moveValues, []),
  )
  for (let i = 0; i < 4; i++) moveBits[i] = metadata[6 + i]!
  return {
    heap,
    nodes,
    rips,
    visited,
    visitedFlat,
    bestStamp,
    bestG,
    moveCost: moveValues[0]!,
    moveHead: metadata[4]! | 0,
    moveRipCount: moveValues[1]!,
    viaScratch,
    cellScratch,
    layerScratch,
    viaOccupants,
    nativeFootprints: new BulkMap<number, Int32Array>(),
    layerStamp,
    layerOccupants,
  }
}
