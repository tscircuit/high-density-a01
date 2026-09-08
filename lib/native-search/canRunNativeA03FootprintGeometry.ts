const ownDescriptor = Object.getOwnPropertyDescriptor
const getPrototype = Object.getPrototypeOf
const isArray = Array.isArray
const isView = ArrayBuffer.isView
const isInteger = Number.isSafeInteger
const isFiniteNumber = Number.isFinite
const ceil = Math.ceil
const apply = Reflect.apply
const arrayPrototype = Array.prototype
const objectPrototype = Object.prototype
const floatPrototype = Float64Array.prototype
const bufferPrototype = ArrayBuffer.prototype
const typedPrototype = getPrototype(floatPrototype)
const typedLength = ownDescriptor(typedPrototype, "length")!.get!
const typedBuffer = ownDescriptor(typedPrototype, "buffer")!.get!

const RECTANGLE_FIELDS = [
  "cellMinX",
  "cellMinY",
  "cellMaxX",
  "cellMaxY",
] as const
const REGION_FIELDS = [
  "id",
  "fineOriginRow",
  "fineOriginCol",
  "fineRows",
  "fineCols",
  "cellScale",
  "rows",
  "cols",
  "offset",
] as const

function ownValue(object: object, field: string): unknown {
  const descriptor = ownDescriptor(object, field)
  return descriptor && "value" in descriptor ? descriptor.value : undefined
}

/** Check the lazy footprint's native transfer domain without invoking accessors. */
export function canRunNativeA03FootprintGeometry(solver: object): boolean {
  const planeSize = ownValue(solver, "planeSize")
  const fineRows = ownValue(solver, "fineRows")
  const fineCols = ownValue(solver, "fineCols")
  const cellSize = ownValue(solver, "highResolutionCellSize")
  const radius = ownValue(solver, "viaKeepoutRadius")
  const minX = ownValue(solver, "boundsMinX")
  const minY = ownValue(solver, "boundsMinY")
  if (
    typeof planeSize !== "number" ||
    !isInteger(planeSize) ||
    planeSize <= 0 ||
    planeSize > 1_048_576 ||
    typeof fineRows !== "number" ||
    !isInteger(fineRows) ||
    fineRows <= 0 ||
    typeof fineCols !== "number" ||
    !isInteger(fineCols) ||
    fineCols <= 0 ||
    typeof cellSize !== "number" ||
    !isFiniteNumber(cellSize) ||
    cellSize <= 0 ||
    typeof radius !== "number" ||
    !isFiniteNumber(radius) ||
    radius < 0 ||
    typeof minX !== "number" ||
    !isFiniteNumber(minX) ||
    typeof minY !== "number" ||
    !isFiniteNumber(minY)
  )
    return false

  for (const name of RECTANGLE_FIELDS) {
    const array = ownValue(solver, name)
    if (
      !isView(array) ||
      getPrototype(array) !== floatPrototype ||
      ownDescriptor(array, "length") !== undefined ||
      apply(typedLength, array, []) !== planeSize ||
      getPrototype(apply(typedBuffer, array, [])) !== bufferPrototype
    )
      return false
  }
  const regions = ownValue(solver, "regions")
  if (
    !isArray(regions) ||
    getPrototype(regions) !== arrayPrototype ||
    ownValue(regions, "length") !== 5
  )
    return false
  let nextOffset = 0
  for (let index = 0; index < 5; index++) {
    const region = ownValue(regions, String(index))
    if (
      !region ||
      typeof region !== "object" ||
      (getPrototype(region) !== objectPrototype &&
        getPrototype(region) !== null)
    )
      return false
    const values: Record<string, number> = {}
    for (const name of REGION_FIELDS) {
      const value = ownValue(region, name)
      if (typeof value !== "number" || !isInteger(value) || value < 0)
        return false
      values[name] = value
    }
    const {
      id,
      fineOriginRow,
      fineOriginCol,
      fineRows: regionRows,
      fineCols: regionCols,
      cellScale,
      rows,
      cols,
      offset,
    } = values
    if (
      id !== index ||
      cellScale! < 1 ||
      offset !== nextOffset ||
      fineOriginRow! > fineRows - regionRows! ||
      fineOriginCol! > fineCols - regionCols! ||
      rows !== ceil(regionRows! / cellScale!) ||
      cols !== ceil(regionCols! / cellScale!)
    )
      return false
    const cells = rows! * cols!
    if (!isInteger(cells) || cells > planeSize - nextOffset) return false
    nextOffset += cells
  }
  return nextOffset === planeSize
}
