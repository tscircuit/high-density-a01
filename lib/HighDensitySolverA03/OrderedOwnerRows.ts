export interface OrderedOwnerRun {
  firstColumn: number
  lastColumn: number
}

interface RegionRows {
  rows: number
  cols: number
  offset: number
}

/** Nonempty intervals whose cells have the same ordered owners on every layer. */
export class OrderedOwnerRows {
  readonly regions: Array<Array<OrderedOwnerRun[] | undefined>>

  constructor(
    regions: RegionRows[],
    planeSize: number,
    layers: number,
    primary: Int32Array,
    shared: Array<number[] | undefined>,
  ) {
    this.regions = new Array(regions.length)
    for (let regionIdx = 0; regionIdx < regions.length; regionIdx++) {
      const region = regions[regionIdx]!
      const rows: Array<OrderedOwnerRun[] | undefined> = new Array(region.rows)
      this.regions[regionIdx] = rows
      for (let row = 0; row < region.rows; row++) {
        const firstCell = region.offset + row * region.cols
        let previousCell = -1
        let run: OrderedOwnerRun | undefined
        for (let col = 0; col < region.cols; col++) {
          const cell = firstCell + col
          let occupied = false
          for (let z = 0; z < layers; z++) {
            const flat = z * planeSize + cell
            if (primary[flat] !== -1 || shared[flat]?.length) {
              occupied = true
              break
            }
          }
          if (!occupied) {
            run = undefined
            continue
          }

          let same = run !== undefined
          for (let z = 0; same && z < layers; z++) {
            const a = z * planeSize + previousCell
            const b = z * planeSize + cell
            if (primary[a] !== primary[b]) {
              same = false
              break
            }
            const left = shared[a]
            const right = shared[b]
            const length = left?.length ?? 0
            if (length !== (right?.length ?? 0)) {
              same = false
              break
            }
            for (let i = 0; i < length; i++) {
              if (left![i] !== right![i]) {
                same = false
                break
              }
            }
          }
          if (same) {
            run!.lastColumn = col
          } else {
            run = { firstColumn: col, lastColumn: col }
            const list = rows[row] ?? (rows[row] = [])
            list.push(run)
          }
          previousCell = cell
        }
      }
    }
  }
}
