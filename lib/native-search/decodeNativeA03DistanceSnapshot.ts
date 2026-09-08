const DistanceUint32Array = Uint32Array
const DistanceUint8Array = Uint8Array
const DistanceFloat64Array = Float64Array
const DistanceMap = Map
const distanceApply = Reflect.apply
const distanceMapSet = Map.prototype.set
const distanceMapHas = Map.prototype.has
const distanceBuffer = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype),
  "buffer",
)!.get!

export type NativeA03DistanceTable = {
  dx: Float64Array
  dy: Float64Array
  distance: Float64Array
  valid: Uint8Array
}

export type NativeA03DistanceSnapshot = {
  capacity: number
  slots: number
  tables: Map<number, NativeA03DistanceTable>
}

/** Restore the original JavaScript memo, including unused backing slots and FIFO order. */
export function decodeNativeA03DistanceSnapshot(
  buffer: ArrayBufferLike,
  pointer: number,
  words: number,
): NativeA03DistanceSnapshot {
  const unsigned = new DistanceUint32Array(buffer, pointer, words * 2)
  let cursor = 0
  const integer = (): number => {
    if (cursor >= words)
      throw new Error("Truncated native A03 distance snapshot")
    const low = unsigned[cursor * 2]!
    const high = unsigned[cursor++ * 2 + 1]!
    if (high !== 0) throw new Error("Invalid native A03 distance integer word")
    return low
  }
  const realArray = (length: number): Float64Array => {
    if (length > words - cursor)
      throw new Error("Truncated native A03 distance array")
    const result = new DistanceFloat64Array(length)
    const bits = new DistanceUint32Array(
      distanceApply(distanceBuffer, result, []),
    )
    for (let i = 0; i < length; i++, cursor++) {
      bits[i * 2] = unsigned[cursor * 2]!
      bits[i * 2 + 1] = unsigned[cursor * 2 + 1]!
    }
    return result
  }
  if (integer() !== 1)
    throw new Error("Unsupported native A03 distance snapshot version")
  const capacity = integer()
  const slots = integer()
  const count = integer()
  if (
    capacity > 65_536 ||
    slots > 65_536 ||
    count * capacity !== slots ||
    (capacity === 0 && count !== 0) ||
    count > words - cursor
  ) {
    throw new Error("Invalid native A03 distance slot accounting")
  }
  const tables = new DistanceMap<number, NativeA03DistanceTable>()
  for (let i = 0; i < count; i++) {
    const goal = integer()
    const length = integer()
    if (
      goal >= capacity ||
      length !== capacity ||
      distanceApply(distanceMapHas, tables, [goal]) ||
      length * 4 > words - cursor
    ) {
      throw new Error("Invalid native A03 distance table")
    }
    const dx = realArray(length)
    const dy = realArray(length)
    const distance = realArray(length)
    const valid = new DistanceUint8Array(length)
    for (let j = 0; j < length; j++) {
      const value = integer()
      if (value > 1)
        throw new Error("Invalid native A03 distance validity flag")
      valid[j] = value
    }
    distanceApply(distanceMapSet, tables, [goal, { dx, dy, distance, valid }])
  }
  if (cursor !== words)
    throw new Error("Unexpected native A03 distance snapshot suffix")
  return { capacity, slots, tables }
}
