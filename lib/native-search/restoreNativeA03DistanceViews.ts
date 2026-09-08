import type { NativeA03DistanceTable } from "./decodeNativeA03DistanceSnapshot"

const ViewsUint32Array = Uint32Array
const ViewsUint8Array = Uint8Array
const ViewsFloat64Array = Float64Array
const ViewsArray = Array
const ViewsMap = Map
const viewsApply = Reflect.apply
const viewsSet = Uint8Array.prototype.set
const viewsMapGet = Map.prototype.get
const viewsMapSet = Map.prototype.set
const viewsMapHas = Map.prototype.has
const viewsMapClear = Map.prototype.clear
const viewsIsSafeInteger = Number.isSafeInteger
const viewsLength = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype),
  "length",
)!.get!
const viewsBufferSize = Object.getOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  "byteLength",
)!.get!

/** Restore ABI43 directly into the original JS memo, preserving its identities. */
export function restoreNativeA03DistanceViews(
  buffer: ArrayBufferLike,
  pointer: number,
  words: number,
  target: Map<number, NativeA03DistanceTable>,
): { capacity: number; slots: number } {
  const bytes = viewsApply(viewsBufferSize, buffer, []) as number
  const check = (offset: number, length: number, width: number): void => {
    if (
      !viewsIsSafeInteger(offset) ||
      !viewsIsSafeInteger(length) ||
      offset < 0 ||
      length < 0 ||
      offset % width !== 0 ||
      offset + length * width > bytes
    )
      throw new Error("Invalid native A03 distance view span")
  }
  check(pointer, words, 4)
  if (words < 4) throw new Error("Truncated native A03 distance views")
  const metadata = new ViewsUint32Array(buffer, pointer, words)
  if (metadata[0] !== 1)
    throw new Error("Unsupported native A03 distance views version")
  const capacity = metadata[1]!
  const slots = metadata[2]!
  const count = metadata[3]!
  if (
    capacity > 65_536 ||
    slots > 65_536 ||
    count * capacity !== slots ||
    (capacity === 0 && count !== 0) ||
    words !== 4 + count * 6
  )
    throw new Error("Invalid native A03 distance view accounting")
  const keys = new ViewsMap<number, boolean>()
  // Validate all metadata before changing any surviving JavaScript table.
  for (let i = 0; i < count; i++) {
    const at = 4 + i * 6
    const goal = metadata[at]!
    const length = metadata[at + 1]!
    if (
      goal >= capacity ||
      length !== capacity ||
      viewsApply(viewsMapHas, keys, [goal])
    )
      throw new Error("Invalid native A03 distance view table")
    viewsApply(viewsMapSet, keys, [goal, true])
    check(metadata[at + 2]!, length, 8)
    check(metadata[at + 3]!, length, 8)
    check(metadata[at + 4]!, length, 8)
    check(metadata[at + 5]!, length, 1)
  }
  const restored = new ViewsArray<[number, NativeA03DistanceTable]>(count)
  for (let i = 0; i < count; i++) {
    const at = 4 + i * 6
    const goal = metadata[at]!
    const length = metadata[at + 1]!
    const previous = viewsApply(viewsMapGet, target, [goal]) as
      | NativeA03DistanceTable
      | undefined
    const table =
      previous && viewsApply(viewsLength, previous.valid, []) === length
        ? previous
        : {
            dx: new ViewsFloat64Array(length),
            dy: new ViewsFloat64Array(length),
            distance: new ViewsFloat64Array(length),
            valid: new ViewsUint8Array(length),
          }
    viewsApply(viewsSet, table.dx, [
      new ViewsFloat64Array(buffer, metadata[at + 2]!, length),
    ])
    viewsApply(viewsSet, table.dy, [
      new ViewsFloat64Array(buffer, metadata[at + 3]!, length),
    ])
    viewsApply(viewsSet, table.distance, [
      new ViewsFloat64Array(buffer, metadata[at + 4]!, length),
    ])
    viewsApply(viewsSet, table.valid, [
      new ViewsUint8Array(buffer, metadata[at + 5]!, length),
    ])
    restored[i] = [goal, table]
  }
  viewsApply(viewsMapClear, target, [])
  for (let i = 0; i < restored.length; i++) {
    const entry = restored[i]!
    viewsApply(viewsMapSet, target, [entry[0], entry[1]])
  }
  return { capacity, slots }
}
