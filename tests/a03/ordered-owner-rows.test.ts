import { expect, test } from "bun:test"
import { OrderedOwnerRows } from "../../lib/HighDensitySolverA03/OrderedOwnerRows"

test("owner runs retain layer and shared-owner order across empty gaps", () => {
  let seed = 123456789
  const next = () => {
    seed ^= seed << 13
    seed ^= seed >>> 17
    seed ^= seed << 5
    return seed >>> 0
  }
  for (const layers of [1, 2, 4]) {
    const regions = [
      { rows: 2, cols: 11, offset: 0 },
      { rows: 0, cols: 3, offset: 22 },
      { rows: 3, cols: 7, offset: 22 },
    ]
    const planeSize = 43
    const primary = new Int32Array(planeSize * layers).fill(-1)
    const shared: Array<number[] | undefined> = new Array(primary.length)
    const tuple = (cell: number) =>
      Array.from({ length: layers }, (_, z) => {
        const flat = z * planeSize + cell
        return [primary[flat], ...(shared[flat] ?? [])]
      })
    for (let pass = 0; pass < 50; pass++) {
      for (let cell = 0; cell < planeSize; cell++) {
        for (let z = 0; z < layers; z++) {
          const flat = z * planeSize + cell
          if (cell > 0 && next() % 3 !== 0) {
            primary[flat] = primary[flat - 1]!
            shared[flat] = shared[flat - 1]?.slice()
          } else {
            primary[flat] = (next() % 5) - 1
            shared[flat] = [undefined, [], [1, 3], [3, 1], [2]][next() % 5]
          }
        }
      }
      const index = new OrderedOwnerRows(
        regions,
        planeSize,
        layers,
        primary,
        shared,
      )
      for (let r = 0; r < regions.length; r++) {
        const region = regions[r]!
        for (let row = 0; row < region.rows; row++) {
          const expected: Array<{ firstColumn: number; lastColumn: number }> =
            []
          let lastTuple = ""
          for (let col = 0; col < region.cols; col++) {
            const cell = region.offset + row * region.cols + col
            const value = tuple(cell)
            if (
              value.every((owners) => owners[0] === -1 && owners.length === 1)
            ) {
              lastTuple = ""
              continue
            }
            const current = JSON.stringify(value)
            const previous = expected[expected.length - 1]
            if (previous && lastTuple === current) previous.lastColumn = col
            else expected.push({ firstColumn: col, lastColumn: col })
            lastTuple = current
          }
          expect(index.regions[r]![row] ?? []).toEqual(expected)
        }
      }
    }
  }
})
