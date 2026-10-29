import { expect, test } from "bun:test"
import {
  HighDensitySolverA03,
} from "../lib/HighDensitySolverA03/HighDensitySolverA03"

type Params = ConstructorParameters<typeof HighDensitySolverA03>[0]
type Solver = HighDensitySolverA03

const makeParams = (seed: number): Params => ({
  nodeWithPortPoints: {
    capacityMeshNodeId: "test-node",
    center: { x: 0, y: 0 },
    width: 1.6,
    height: 1.8,
    availableZ: [0, 1],
    portPoints: [
      { connectionName: "a", x: -0.7, y: -0.6, z: 0 },
      { connectionName: "a", x: 0.7, y: 0.6, z: 0 },
      { connectionName: "b", x: -0.7, y: 0.6, z: 1 },
      { connectionName: "b", x: 0.7, y: -0.6, z: 1 },
    ],
  },
  viaDiameter: 0.3,
  highResolutionCellSize: 0.1,
  lowResolutionCellSize: 0.4,
  highResolutionCellThickness: 2,
  viaMinDistFromBorder: 0.1,
  hyperParameters: { shuffleSeed: seed },
})

const state = (solver: Solver): unknown => ({
  solved: solver.solved,
  failed: solver.failed,
  error: solver.error,
  iterations: solver.iterations,
  progress: solver.progress,
  limit: solver.MAX_ITERATIONS,
  baseSearchBudgetIters: (solver as any).baseSearchBudgetIters,
  unsolved: solver.unsolvedConnections,
  solvedConnections: [...solver.solvedConnectionsMap],
  activeConnection: solver.activeConnection,
  openSet: solver.openSet,
  gridStats: solver.gridStats,
  output: solver.getOutput(),
})

test("A03 budget preparation preserves eager routing and limits", () => {
  let completed = 0
  for (const seed of [0, 1, 5]) {
    for (const variant of [
      "normal",
      "empty",
      "duplicate",
      "linked",
      "thin",
      "layers",
    ] as const) {
      const params = makeParams(seed)
      if (variant === "empty") params.nodeWithPortPoints.portPoints = []
      if (variant === "duplicate") {
        const points = params.nodeWithPortPoints.portPoints
        points.push({
          ...points[0]!,
          connectionName: "a2",
          rootConnectionName: "a",
        })
        points.push({
          ...points[1]!,
          connectionName: "a2",
          rootConnectionName: "a",
        })
      }
      if (variant === "linked") {
        const points = params.nodeWithPortPoints.portPoints
        points[0]!.portPointId = "start"
        points[0]!.nextPortPointId = "end"
        points[1]!.portPointId = "end"
        points[1]!.prevPortPointId = "start"
      }
      if (variant === "thin") params.nodeWithPortPoints.width = 0.15
      if (variant === "layers") {
        params.nodeWithPortPoints.availableZ = [3, 1, 0, 2]
      }
      for (const cap of [undefined, 150_000, 900_000]) {
        const original = new HighDensitySolverA03(structuredClone(params))
        const prepared = new HighDensitySolverA03(structuredClone(params))
        original.setup()
        prepared.prepareSearchBudget()
        expect(prepared.MAX_ITERATIONS).toBe(original.MAX_ITERATIONS)
        expect((prepared as any).baseSearchBudgetIters).toBe(
          (original as any).baseSearchBudgetIters,
        )
        expect(prepared.unsolvedConnections).toEqual(
          original.unsolvedConnections,
        )
        expect([...prepared.solvedConnectionsMap]).toEqual([])
        expect(prepared._setupDone).toBe(false)
        expect(prepared.cellCenterX).toBeUndefined()
        expect(prepared.neighborIds).toBeUndefined()
        expect((prepared as any).usedCellsFlat).toBeUndefined()
        expect((prepared as any).visitedStamp).toBeUndefined()
        if (cap !== undefined) {
          original.MAX_ITERATIONS = Math.min(original.MAX_ITERATIONS, cap)
          prepared.MAX_ITERATIONS = Math.min(prepared.MAX_ITERATIONS, cap)
        }
        prepared.prepareSearchBudget()
        prepared.setup()
        expect(state(prepared)).toEqual(state(original))
        for (
          let step = 0;
          step < 10_000 && !original.solved && !original.failed;
          step++
        ) {
          original.step()
          prepared.step()
          expect(state(prepared)).toEqual(state(original))
        }
        expect(original.solved || original.failed).toBe(true)
        if (original.solved) completed++
        const before = state(prepared)
        prepared.prepareSearchBudget()
        prepared.setup()
        expect(state(prepared)).toEqual(before)
      }
    }
  }
  expect(completed).toBeGreaterThan(0)

  for (const overrides of [
    { lowResolutionCellSize: 0.15 },
    { lowResolutionCellSize: 0 },
    { lowResolutionCellSize: Number.POSITIVE_INFINITY },
    { maxCellCount: 1 },
  ]) {
    const params = { ...makeParams(0), ...overrides }
    const original = new HighDensitySolverA03(structuredClone(params))
    const prepared = new HighDensitySolverA03(structuredClone(params))
    original.setup()
    prepared.prepareSearchBudget()
    for (const key of [
      "failed",
      "solved",
      "error",
      "iterations",
      "progress",
      "MAX_ITERATIONS",
    ] as const) {
      expect(prepared[key]).toEqual(original[key])
    }
    prepared.prepareSearchBudget()
    prepared.setup()
    expect(prepared.error).toBe(original.error)
    expect(prepared.cellCenterX).toBeUndefined()
  }

  for (const requested of [
    1,
    150_000,
    900_000,
    100_000_000,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ]) {
    const original = new HighDensitySolverA03(makeParams(0))
    const prepared = new HighDensitySolverA03(makeParams(0))
    original.MAX_ITERATIONS = requested
    prepared.MAX_ITERATIONS = requested
    original.setup()
    prepared.prepareSearchBudget()
    prepared.setup()
    expect(state(prepared)).toEqual(state(original))
  }

  const large = makeParams(0)
  large.nodeWithPortPoints.width = 2000
  large.nodeWithPortPoints.height = 2000
  const metadataOnly = new HighDensitySolverA03(large)
  metadataOnly.prepareSearchBudget()
  expect(metadataOnly.planeSize).toBeGreaterThan(1_000_000)
  expect(metadataOnly.MAX_ITERATIONS).toBe(12_000_000)
  expect((metadataOnly as any).baseSearchBudgetIters).toBe(4_000_000)
  expect(metadataOnly.cellCenterX).toBeUndefined()
  expect(metadataOnly.neighborIds).toBeUndefined()

  const callbackCalls = (
    SolverClass: typeof HighDensitySolverA03,
  ): unknown[] => {
    const calls: unknown[] = []
    const params = makeParams(0)
    const solver = new SolverClass({
      ...params,
      initialPenaltyFn: (input): number => {
        calls.push(input)
        params.nodeWithPortPoints.width += 0.001
        return input.row * 0.2 + input.col * 0.3
      },
    })
    solver.setup()
    return [calls, state(solver)]
  }
  expect(callbackCalls(HighDensitySolverA03)).toEqual(
    callbackCalls(HighDensitySolverA03),
  )

  const withCallback = new HighDensitySolverA03({
    ...makeParams(0),
    initialPenaltyFn: (): number => 0,
  })
  expect(() => withCallback.prepareSearchBudget()).toThrow(
    "does not support initialPenaltyFn",
  )
  withCallback.setup()
  const callbackSetupState = state(withCallback)
  withCallback.prepareSearchBudget()
  expect(state(withCallback)).toEqual(callbackSetupState)

  const eager = new HighDensitySolverA03(makeParams(0))
  eager.setup()
  eager.step()
  const eagerState = state(eager)
  eager.prepareSearchBudget()
  expect(state(eager)).toEqual(eagerState)
})
