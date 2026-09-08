import { expect, test } from "bun:test"
import { defaultA03Params } from "../../lib/default-params"
import { HighDensitySolverA03 } from "../../lib/HighDensitySolverA03/HighDensitySolverA03"

type Table = {
  dx: Float64Array
  dy: Float64Array
  distance: Float64Array
  valid: Uint8Array
}
type State = {
  computeH(z: number, cell: number, toZ: number, goal: number): number
  distanceByGoal: Map<number, Table>
  distanceCacheSlots: number
  distanceCacheCapacity: number
}

function makeSolver(layers = 2, connections = 1) {
  return new HighDensitySolverA03({
    ...defaultA03Params,
    highResolutionCellThickness: 0.2,
    nodeWithPortPoints: {
      capacityMeshNodeId: "distance-cache",
      center: { x: 0, y: 0 },
      width: 1.6,
      height: 1.6,
      availableZ: Array.from({ length: layers }, (_, z) => z),
      portPoints: ["a", "b", "c", "d", "e"]
        .slice(0, connections)
        .flatMap((connectionName, index) => [
          {
            connectionName,
            rootConnectionName: index < 2 ? "shared" : connectionName,
            x: -0.8,
            y: (index - 2) * 0.25,
            z: 0,
          },
          {
            connectionName,
            rootConnectionName: index < 2 ? "shared" : connectionName,
            x: 0.8,
            y: (2 - index) * 0.25,
            z: layers - 1,
          },
        ]),
    },
  })
}

function state(solver: HighDensitySolverA03) {
  // The test observes the private cache while retaining the original math hook.
  return solver as unknown as State
}

// Frozen C37 arithmetic: preserve the callee and argument evaluation order.
function originalH(
  solver: HighDensitySolverA03,
  z: number,
  cellId: number,
  toZ: number,
  toCellId: number,
) {
  const dist = Math.hypot(
    solver.cellCenterX[cellId]! - solver.cellCenterX[toCellId]!,
    solver.cellCenterY[cellId]! - solver.cellCenterY[toCellId]!,
  )
  if (z === toZ) return dist
  return dist + solver.hyperParameters.viaBaseCost
}

function compare(solver: HighDensitySolverA03, cell = 0, goal = 1) {
  for (const [z, toZ] of [
    [0, 0],
    [0, 1],
    [1, 0],
  ] as const) {
    expect(
      Object.is(
        state(solver).computeH(z, cell, toZ, goal),
        originalH(solver, z, cell, toZ, goal),
      ),
    ).toBe(true)
  }
}

test("A03 distances reuse identical displacements while preserving geometry and live costs", () => {
  const solver = makeSolver()
  solver.setup()
  const s = state(solver)
  solver.cellCenterX[0] = 3.3625000000000007
  solver.cellCenterX[1] = 0
  solver.cellCenterY[0] = 3.3000000000000003
  solver.cellCenterY[1] = 0
  compare(solver)
  const table = s.distanceByGoal.get(1)!
  expect(table.distance[0]).toBe(4.711306214841061)
  expect(table.distance[0]).not.toBe(
    Math.sqrt(solver.cellCenterX[0]! ** 2 + solver.cellCenterY[0]! ** 2),
  )
  let reads = 0
  let writes = 0
  table.distance = new Proxy(table.distance, {
    get(target, key) {
      if (key === "0") reads++
      return Reflect.get(target, key, target)
    },
    set(target, key, value) {
      if (key === "0") writes++
      return Reflect.set(target, key, value, target)
    },
  })
  for (const viaCost of [3, -0, -2, Infinity, NaN]) {
    solver.hyperParameters.viaBaseCost = viaCost
    compare(solver)
  }
  expect(reads).toBe(15)
  expect(writes).toBe(0)
  // Coordinate mutation and replacement must both invalidate the displacement.
  solver.cellCenterX[0] = solver.cellCenterX[0]! + 2
  compare(solver)
  solver.cellCenterY = new Float64Array(solver.cellCenterY)
  solver.cellCenterY[1] = solver.cellCenterY[1]! - 3
  compare(solver)
  expect(writes).toBe(2)
  // Translating both ends changes coordinates but leaves the cached metric valid.
  solver.cellCenterX[0] = 4
  solver.cellCenterX[1] = 1
  solver.cellCenterY[0] = 7
  solver.cellCenterY[1] = 3
  compare(solver)
  const beforeTranslation = writes
  solver.cellCenterX[0] += 8
  solver.cellCenterX[1] += 8
  solver.cellCenterY[0] += 8
  solver.cellCenterY[1] += 8
  compare(solver)
  expect(writes).toBe(beforeTranslation)
})

test("A03 signed zero and nonfinite geometry retain exact Math.hypot results", () => {
  const solver = makeSolver()
  solver.setup()
  const s = state(solver)
  for (const [x, goalX, y, goalY] of [
    [-0, 0, 0, -0],
    [0, -0, -0, 0],
    [NaN, 0, 3, 0],
    [Infinity, Infinity, -Infinity, 0],
    [Number.MAX_VALUE, 0, Number.MAX_VALUE, 0],
    [Number.MIN_VALUE, 0, -Number.MIN_VALUE, 0],
  ]) {
    solver.cellCenterX[0] = x!
    solver.cellCenterX[1] = goalX!
    solver.cellCenterY[0] = y!
    solver.cellCenterY[1] = goalY!
    compare(solver)
    compare(solver)
    const table = s.distanceByGoal.get(1)!
    expect(Object.is(table.dx[0], x! - goalX!)).toBe(true)
    expect(Object.is(table.dy[0], y! - goalY!)).toBe(true)
  }
})

test("A03 custom hypot preserves getter, receiver, argument and live-cost ordering", () => {
  const descriptor = Object.getOwnPropertyDescriptor(Math, "hypot")!
  const builtin = Math.hypot
  const run = (cached: boolean) => {
    const solver = makeSolver()
    solver.setup()
    const s = state(solver)
    compare(solver)
    const tables = s.distanceByGoal.size
    const events: string[] = []
    const xs = [4, 1]
    const ys = [9, 5]
    solver.cellCenterX = new Proxy(xs, {
      get(target, key) {
        events.push(`x${String(key)}`)
        return Reflect.get(target, key)
      },
    }) as unknown as Float64Array
    solver.cellCenterY = new Proxy(ys, {
      get(target, key) {
        events.push(`y${String(key)}`)
        return Reflect.get(target, key)
      },
    }) as unknown as Float64Array
    Object.defineProperty(Math, "hypot", {
      configurable: true,
      get() {
        events.push("callee")
        xs[0] = xs[0]! + 1
        return function (this: unknown, dx: number, dy: number) {
          expect(this).toBe(Math)
          events.push(`call:${dx},${dy}`)
          solver.hyperParameters.viaBaseCost = 23
          return builtin(dx, dy)
        }
      },
    })
    const results = [0, 1].map(() =>
      cached ? s.computeH(0, 0, 1, 1) : originalH(solver, 0, 0, 1, 1),
    )
    expect(s.distanceByGoal.size).toBe(tables)
    Object.defineProperty(Math, "hypot", descriptor)
    return { results, events }
  }
  try {
    expect(run(true)).toEqual(run(false))
    expect(run(true).events).toEqual([
      "callee",
      "x0",
      "x1",
      "y0",
      "y1",
      "call:4,4",
      "callee",
      "x0",
      "x1",
      "y0",
      "y1",
      "call:5,4",
    ])
    const solver = makeSolver()
    solver.setup()
    const s = state(solver)
    const error = new Error("custom hypot failure")
    Object.defineProperty(Math, "hypot", {
      configurable: true,
      value: () => {
        throw error
      },
    })
    expect(() => s.computeH(0, 0, 0, 1)).toThrow(error)
    expect(s.distanceCacheSlots).toBe(0)
    Object.defineProperty(Math, "hypot", descriptor)
    compare(solver)
  } finally {
    Object.defineProperty(Math, "hypot", descriptor)
  }
})

test("A03 distance tables retain a bounded FIFO budget through setup and terminal cleanup", () => {
  const solver = makeSolver()
  solver.highResolutionCellSize = 0.1
  solver.lowResolutionCellSize = 0.1
  solver.highResolutionCellThickness = 0
  solver.nodeWithPortPoints.width = 12.8
  solver.nodeWithPortPoints.height = 12.8
  solver.nodeWithPortPoints.portPoints = []
  solver.setup()
  const s = state(solver)
  expect(s.distanceCacheCapacity).toBe(16_384)
  for (let goal = 0; goal < 4; goal++) compare(solver, 7, goal)
  const first = s.distanceByGoal.get(0)
  expect(s.distanceCacheSlots).toBe(65_536)
  compare(solver, 7, 0)
  compare(solver, 7, 4)
  expect([...s.distanceByGoal.keys()]).toEqual([1, 2, 3, 4])
  expect(s.distanceByGoal.has(0)).toBe(false)
  // The live public plane size does not describe the metric inputs or affect
  // the private allocation bound established with the original grid.
  solver.planeSize = 8192
  compare(solver, 7, 1)
  expect(s.distanceCacheCapacity).toBe(16_384)
  expect(s.distanceCacheSlots).toBe(65_536)
  expect(
    [...s.distanceByGoal.values()].reduce(
      (sum, table) => sum + table.valid.length,
      0,
    ),
  ).toBe(s.distanceCacheSlots)
  expect(
    [...s.distanceByGoal.values()].reduce(
      (sum, table) =>
        sum +
        table.dx.byteLength +
        table.dy.byteLength +
        table.distance.byteLength +
        table.valid.byteLength,
      0,
    ),
  ).toBe(1_638_400)
  expect(first!.valid[7]).toBe(1)
  solver.nodeWithPortPoints.width = 6.4
  solver._setup()
  expect(s.distanceByGoal.size).toBe(0)
  expect(s.distanceCacheSlots).toBe(0)
  expect(s.distanceCacheCapacity).toBe(8192)
  compare(solver)
  solver.solved = true
  solver._step()
  expect(s.distanceByGoal.size).toBe(0)
  expect(s.distanceCacheSlots).toBe(0)
  expect(s.distanceCacheCapacity).toBe(0)
  compare(solver)
  expect(s.distanceCacheSlots).toBe(0)
})

test("A03 invalid and oversized cache domains use the original arithmetic", () => {
  const preSetup = makeSolver()
  preSetup.cellCenterX = new Float64Array([1, 0])
  preSetup.cellCenterY = new Float64Array([2, 0])
  for (const size of [0, -1, 1.5, NaN, Infinity, 65_537]) {
    preSetup.planeSize = size
    compare(preSetup)
    expect(state(preSetup).distanceCacheSlots).toBe(0)
  }
  const oversized = makeSolver()
  oversized.highResolutionCellSize = 0.1
  oversized.lowResolutionCellSize = 0.1
  oversized.highResolutionCellThickness = 0
  oversized.nodeWithPortPoints.width = 25.7
  oversized.nodeWithPortPoints.height = 25.6
  oversized.nodeWithPortPoints.portPoints = []
  oversized.setup()
  expect(oversized.planeSize).toBeGreaterThan(65_536)
  compare(oversized)
  expect(state(oversized).distanceCacheCapacity).toBe(0)
  expect(state(oversized).distanceCacheSlots).toBe(0)
  const solver = makeSolver()
  solver.setup()
  const s = state(solver)
  for (const id of [
    -1,
    1.5,
    NaN,
    Infinity,
    solver.planeSize,
    "0",
    0n,
    Symbol("cell"),
  ]) {
    compare(solver, id as number)
    compare(solver, 0, id as number)
    expect(s.distanceCacheSlots).toBe(0)
  }
  compare(solver, -0)
  expect(s.distanceByGoal.size).toBe(1)
  // Non-number coordinate arithmetic must still throw in the original hypot.
  solver.cellCenterX = [1n, 0n] as unknown as Float64Array
  solver.cellCenterY = [2n, 0n] as unknown as Float64Array
  expect(() => s.computeH(0, 0, 0, 1)).toThrow(TypeError)
  expect(() => originalH(solver, 0, 0, 0, 1)).toThrow(TypeError)
})

test("A03 metric lookup never introduces reads of a customized planeSize getter", () => {
  const solver = makeSolver()
  solver.setup()
  let reads = 0
  const size = solver.planeSize
  Object.defineProperty(solver, "planeSize", {
    configurable: true,
    get() {
      reads++
      solver.hyperParameters.viaBaseCost++
      return size
    },
  })
  compare(solver)
  compare(solver)
  expect(reads).toBe(0)
  expect(state(solver).distanceByGoal.size).toBe(1)
})

function fullState(solver: HighDensitySolverA03) {
  return Object.fromEntries(
    Object.entries(solver).filter(
      ([key, value]) =>
        key !== "distanceByGoal" &&
        key !== "distanceCacheSlots" &&
        typeof value !== "function",
    ),
  )
}

for (const layers of [2, 4, 6]) {
  for (const connections of [1, 5]) {
    test(`A03 distance cache preserves every public step on ${layers} layers and ${connections} connections`, () => {
      const cached = makeSolver(layers, connections)
      const reference = makeSolver(layers, connections)
      cached.setup()
      reference.setup()
      if (connections === 5)
        cached.MAX_ITERATIONS = reference.MAX_ITERATIONS = 2000
      const cachedState = state(cached)
      const referenceState = state(reference)
      const computeCached = cachedState.computeH.bind(cached)
      let cachedCalls = 0
      let originalCalls = 0
      cachedState.computeH = (...args) => {
        cachedCalls++
        return computeCached(...args)
      }
      referenceState.computeH = (...args) => {
        originalCalls++
        return originalH(reference, ...args)
      }
      while (!cached.solved && !cached.failed) {
        cached.step()
        reference.step()
        expect(fullState(cached)).toEqual(fullState(reference))
        expect(cached.getOutput()).toEqual(reference.getOutput())
        expect(cachedCalls).toBe(originalCalls)
      }
      expect(cachedCalls).toBeGreaterThan(0)
      expect(cached.solved).toBe(connections === 1)
      expect(cachedState.distanceByGoal.size).toBe(0)
      expect(cachedState.distanceCacheSlots).toBe(0)
    })
  }
}
