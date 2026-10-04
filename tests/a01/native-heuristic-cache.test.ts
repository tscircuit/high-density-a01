import { expect, test } from "bun:test"
import { HighDensitySolverA01 } from "../../lib/HighDensitySolverA01/HighDensitySolverA01"
import { FrozenHighDensitySolverA01 } from "../fixtures/frozen-a01-object-node-pool-solver"

test("native heuristic cache preserves the frozen numeric oracle and search epochs", () => {
  const solver: any = new HighDensitySolverA01({
    nodeWithPortPoints: {
      capacityMeshNodeId: "heuristic-oracle",
      center: { x: 0, y: 0 },
      width: 2,
      height: 2,
      availableZ: [0, 1, 2],
      portPoints: [
        { x: -0.8, y: -0.8, z: 0, connectionName: "A" },
        { x: 0.8, y: 0.8, z: 2, connectionName: "A" },
      ],
    },
    cellSizeMm: 0.1,
    stepMultiplier: 1000,
    viaDiameter: 0.3,
  })
  solver.setup()
  const oracle = FrozenHighDensitySolverA01.prototype["computeH"]
  let cache = solver.getHeuristicCacheForStep()
  expect(cache).toBeDefined()
  let reusedEntries = 0
  for (let index = 0; index < 59_710; index++) {
    const block = Math.floor(index / 1000)
    if (index % 1000 === 0) {
      solver.cellSizeMm = [0.1, -0, +0, Number.MIN_VALUE, 0.3][block % 5]
      solver.hyperParameters.viaBaseCost = [0.1, -0, +0, 4][block % 4]
      solver.crossLayerSearch = block % 2 === 0
      solver.minViaRow = block % 4
      solver.maxViaRow = 19 - (block % 4)
      solver.minViaCol = block % 3
      solver.maxViaCol = 19 - (block % 3)
      solver.stamp = block + 1
      cache = solver.getHeuristicCacheForStep()
      expect(cache).toBeDefined()
    }
    const z = index % 3
    const row = (index * 7) % 20
    const col = (index * 11) % 20
    const toZ = block % 3
    const toRow = (block * 3) % 20
    const toCol = (block * 13) % 20
    const key = (z * solver.rows + row) * solver.cols + col
    if (
      cache.goalZ === toZ &&
      cache.goalRow === toRow &&
      cache.goalCol === toCol &&
      cache.searchStamp === solver.stamp &&
      cache.epochs[key] === cache.epoch
    )
      reusedEntries++
    const expected = oracle.call(solver, z, row, col, toZ, toRow, toCol)
    const actual = solver.getCachedHeuristic(
      cache,
      key,
      z,
      row,
      col,
      toZ,
      toRow,
      toCol,
    )
    expect(Object.is(actual, expected)).toBeTrue()
  }
  expect(reusedEntries).toBeGreaterThan(30_000)
  solver.cellSizeMm = -0
  solver.crossLayerSearch = false
  cache = solver.getHeuristicCacheForStep()
  expect(
    Object.is(solver.getCachedHeuristic(cache, 0, 0, 0, 0, 0, 0, 0), -0),
  ).toBeTrue()
  expect(
    Object.is(solver.getCachedHeuristic(cache, 0, 0, 0, 0, 0, 0, 0), -0),
  ).toBeTrue()
  cache.epoch = 0xffffffff
  solver.resetHeuristicEpoch(cache)
  expect(cache.epoch).toBe(1)
  expect(cache.epochs.every((epoch: number) => epoch === 0)).toBeTrue()
  solver.cellSizeMm = Number.MAX_VALUE
  cache = solver.getHeuristicCacheForStep()
  const infinite = solver.getCachedHeuristic(cache, 0, 0, 0, 0, 0, 19, 19)
  expect(infinite).toBe(Infinity)
  expect(cache.epochs[0]).not.toBe(cache.epoch)
  for (const value of [Infinity, -Infinity, NaN]) {
    solver.cellSizeMm = value
    expect(solver.getHeuristicCacheForStep()).toBeUndefined()
    expect(
      Object.is(
        solver.computeH(0, 0, 0, 0, 19, 19),
        oracle.call(solver, 0, 0, 0, 0, 19, 19),
      ),
    ).toBeTrue()
  }
  solver.cellSizeMm = 0.1
  const originalHyperParameters = solver.hyperParameters
  solver.hyperParameters = { ...originalHyperParameters }
  expect(solver.getHeuristicCacheForStep()).toBeUndefined()
  solver.hyperParameters = originalHyperParameters
  expect(solver.getHeuristicCacheForStep()).toBeDefined()
  solver.stepMultiplier = 1
  expect(solver.getHeuristicCacheForStep()).toBeUndefined()
  solver.stepMultiplier = 1000
  expect(solver.getHeuristicCacheForStep()).toBeDefined()
  let multiplierReads = 0
  Object.defineProperty(solver, "stepMultiplier", {
    configurable: true,
    get() {
      multiplierReads++
      return 1000
    },
  })
  expect(solver.getHeuristicCacheForStep()).toBeUndefined()
  expect(multiplierReads).toBe(0)
  Object.defineProperty(solver, "stepMultiplier", {
    configurable: true,
    writable: true,
    value: 1000,
  })
  solver.rows = 4
  solver.cols = 3
  solver.layers = 1
  solver.planeSize = 12
  solver.visitedStamp = new Uint32Array(12)
  cache = solver.getHeuristicCacheForStep()
  expect(cache).toBeDefined()
  const invalidColumn = solver.getCachedHeuristic(cache, 3, 0, 0, 3, 0, 0, 0)
  const validCell = solver.getCachedHeuristic(cache, 3, 0, 1, 0, 0, 0, 0)
  expect(invalidColumn).toBe(oracle.call(solver, 0, 0, 3, 0, 0, 0))
  expect(validCell).toBe(oracle.call(solver, 0, 1, 0, 0, 0, 0))
  expect(validCell).not.toBe(invalidColumn)
  solver.rows = 1024
  solver.cols = 1024
  expect(solver.getHeuristicCacheForStep()).toBeUndefined()
})
