import { expect, test } from "bun:test"
import { OccupiedRowRuns } from "../lib/HighDensitySolverA01/OccupiedRowRuns"

test("occupied row intervals exactly track splits, merges, replacements, and reuse", () => {
  const cols = 17
  const rowCount = 5
  const index = new OccupiedRowRuns(cols, rowCount)
  const dense = new Int32Array(cols * rowCount).fill(-1)
  const write = (cell: number, owner: number) => {
    dense[cell] = owner
    index.set(cell, owner)
    const reconstructed = new Int32Array(dense.length).fill(-1)
    for (let r = 0; r < rowCount; r++) {
      const runs = index.rows[r] ?? []
      for (let j = 0; j < runs.length; j++) {
        const run = runs[j]!
        expect(run.owner).not.toBe(-1)
        expect(run.start).toBeGreaterThanOrEqual(0)
        expect(run.end).toBeLessThan(cols)
        expect(run.start).toBeLessThanOrEqual(run.end)
        if (j > 0) {
          const previous = runs[j - 1]!
          expect(previous.end).toBeLessThan(run.start)
          expect(
            previous.end + 1 !== run.start || previous.owner !== run.owner,
          ).toBe(true)
        }
        for (let c = run.start; c <= run.end; c++) {
          reconstructed[r * cols + c] = run.owner
        }
      }
    }
    expect(reconstructed).toEqual(dense)
  }
  // Removing/replacing every position includes both ends and the middle.
  for (let c = 0; c < cols; c++) write(c, 1)
  for (const c of [0, 16, 8, 7, 9]) write(c, -1)
  for (const c of [0, 16, 8, 7, 9]) write(c, 1)
  for (const c of [0, 16, 8, 7, 9]) write(c, 2)
  for (const c of [0, 16, 8, 7, 9]) write(c, 1)
  write(17, 1)
  write(18, 1)
  write(17, 1)
  let seed = 0x71013
  for (let i = 0; i < 5_000; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    const cell = seed % dense.length
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    write(cell, (seed % 6) - 1)
  }
  for (let cell = 0; cell < dense.length; cell++) write(cell, -1)
  expect(index.rows.every((row) => row === undefined)).toBe(true)
  write(dense.length - 1, 4)
  write(dense.length - 1, -1)
})
