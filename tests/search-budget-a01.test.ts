import { expect, test } from "bun:test"
import { HighDensitySolverA01 } from "../lib/HighDensitySolverA01/HighDensitySolverA01"
import type { NodeWithPortPoints } from "../lib/types"

test("A01 budget preparation preserves eager setup and routing", () => {
  const makeNode = (seed: number): NodeWithPortPoints => ({
    capacityMeshNodeId: `budget-${seed}`,
    center: { x: 0.13, y: -0.17 },
    width: 1.2 + seed * 0.013,
    height: 1.3 + seed * 0.017,
    availableZ: seed % 2 === 0 ? [0, 1, 2, 3] : undefined,
    portPoints: [
      {
        connectionName: "a",
        rootConnectionName: "root-a",
        portPointId: "a0",
        nextPortPointId: "a1",
        x: -0.3,
        y: -0.4,
        z: 0,
      },
      {
        connectionName: "a",
        rootConnectionName: "root-a",
        portPointId: "a1",
        prevPortPointId: "a0",
        x: 0.5,
        y: -0.4,
        z: seed % 2,
      },
      { connectionName: "b", rootConnectionName: "root-b", x: -0.3, y: 0.2, z: 0 },
      { connectionName: "b", rootConnectionName: "root-b", x: 0.5, y: 0.2, z: 0 },
      ...(seed % 3 === 0
        ? [
            {
              connectionName: "duplicate",
              rootConnectionName: "root-a",
              x: -0.3,
              y: -0.4,
              z: 0,
            },
            {
              connectionName: "duplicate",
              rootConnectionName: "root-a",
              x: 0.5,
              y: -0.4,
              z: seed % 2,
            },
          ]
        : []),
    ],
  })
  const snapshot = (solver: HighDensitySolverA01): unknown => {
    const value = solver as any
    return {
      solved: solver.solved,
      failed: solver.failed,
      error: solver.error,
      iterations: solver.iterations,
      progress: solver.progress,
      maxIterations: solver.MAX_ITERATIONS,
      baseSearchBudget: value.baseSearchBudgetIters,
      gridStats: solver.gridStats,
      unsolved: solver.unsolvedConnections,
      active: solver.activeConnection,
      open: solver.openSet,
      routes: [...solver.solvedConnectionsMap],
      visited: value.visitedStamp,
      used: value.usedCellsFlat,
      owners: value.portOwnerFlat,
      penalties: value.penalty2d,
    }
  }

  for (let seed = 0; seed < 8; seed++) {
    const props = {
      nodeWithPortPoints: makeNode(seed),
      cellSizeMm: 0.1,
      viaDiameter: 0.3,
      hyperParameters: { shuffleSeed: seed },
    }
    const original = new HighDensitySolverA01(structuredClone(props))
    const prepared = new HighDensitySolverA01(structuredClone(props))
    original.setup()
    prepared.prepareSearchBudget()
    const value = prepared as any
    expect(prepared.MAX_ITERATIONS).toBe(original.MAX_ITERATIONS)
    expect(value.baseSearchBudgetIters).toBe((original as any).baseSearchBudgetIters)
    expect(prepared.gridStats).toEqual(original.gridStats)
    expect(prepared.unsolvedConnections).toEqual(original.unsolvedConnections)
    expect(prepared.solvedConnectionsMap.size).toBe(0)
    expect(prepared._setupDone).toBe(false)
    for (const field of [
      "penalty2d",
      "usedCellsFlat",
      "portOwnerFlat",
      "usedDiagFlat",
      "visitedStamp",
      "heap",
      "nodePool",
    ]) {
      expect(value[field]).toBeUndefined()
    }
    const capped = seed % 2 === 0 ? 175_001 : original.MAX_ITERATIONS
    original.MAX_ITERATIONS = capped
    prepared.MAX_ITERATIONS = capped
    prepared.prepareSearchBudget()
    expect(prepared.MAX_ITERATIONS).toBe(capped)
    prepared.setup()
    expect(snapshot(prepared)).toEqual(snapshot(original))
    prepared.setup()
    prepared.prepareSearchBudget()
    expect(snapshot(prepared)).toEqual(snapshot(original))
    for (let step = 0; step < 20_000 && !original.solved && !original.failed; step++) {
      original.step()
      prepared.step()
      expect(snapshot(prepared)).toEqual(snapshot(original))
    }
    expect(original.solved || original.failed).toBe(true)
    expect(prepared.getOutput()).toEqual(original.getOutput())
  }

  for (const effort of [0, 0.5, 3]) {
    for (const requested of [50_000, 150_001, 3_000_000]) {
      const props = {
        nodeWithPortPoints: makeNode(1),
        cellSizeMm: 0.1,
        viaDiameter: 0.3,
        effort,
      }
      const original = new HighDensitySolverA01(structuredClone(props))
      const prepared = new HighDensitySolverA01(structuredClone(props))
      original.MAX_ITERATIONS = requested
      prepared.MAX_ITERATIONS = requested
      original.setup()
      prepared.prepareSearchBudget()
      prepared.setup()
      expect(snapshot(prepared)).toEqual(snapshot(original))
    }
  }

  for (const node of [
    { ...makeNode(2), width: 40.01, height: 30.03 },
    { ...makeNode(1), portPoints: [], availableZ: [] },
  ]) {
    const props = { nodeWithPortPoints: node, cellSizeMm: 0.1, viaDiameter: 0.3 }
    const original = new HighDensitySolverA01(structuredClone(props))
    const prepared = new HighDensitySolverA01(structuredClone(props))
    original.setup()
    prepared.prepareSearchBudget()
    expect(prepared.gridStats).toEqual(original.gridStats)
    expect(prepared.MAX_ITERATIONS).toBe(original.MAX_ITERATIONS)
    prepared.setup()
    expect(snapshot(prepared)).toEqual(snapshot(original))
  }

  const failedProps = {
    nodeWithPortPoints: makeNode(1),
    cellSizeMm: 0.1,
    viaDiameter: 0.3,
    maxCellCount: 1,
  }
  const originalFailed = new HighDensitySolverA01(structuredClone(failedProps))
  const preparedFailed = new HighDensitySolverA01(structuredClone(failedProps))
  originalFailed.setup()
  preparedFailed.prepareSearchBudget()
  preparedFailed.prepareSearchBudget()
  expect(preparedFailed.failed).toBe(originalFailed.failed)
  expect(preparedFailed.error).toBe(originalFailed.error)
  expect(preparedFailed.MAX_ITERATIONS).toBe(originalFailed.MAX_ITERATIONS)
  expect((preparedFailed as any).usedCellsFlat).toBeUndefined()
  preparedFailed.setup()
  expect(preparedFailed.failed).toBe(true)
  expect(preparedFailed.error).toBe(originalFailed.error)

  const callbackNode = makeNode(1)
  const callbackProps = {
    nodeWithPortPoints: callbackNode,
    cellSizeMm: 0.1,
    viaDiameter: 0.3,
  }
  const originalCallbackNode = structuredClone(callbackNode)
  const ordinary = new HighDensitySolverA01({
    ...callbackProps,
    initialPenaltyFn: ({ row, col }) => {
      callbackNode.portPoints[1]!.x = 0.1
      return row + col / 7
    },
  })
  const originalCallback = new HighDensitySolverA01({
    ...callbackProps,
    nodeWithPortPoints: originalCallbackNode,
    initialPenaltyFn: ({ row, col }) => {
      originalCallbackNode.portPoints[1]!.x = 0.1
      return row + col / 7
    },
  })
  expect(() => ordinary.prepareSearchBudget()).toThrow(
    "does not support initialPenaltyFn",
  )
  expect(ordinary._setupDone).toBe(false)
  ordinary.setup()
  originalCallback.setup()
  expect(snapshot(ordinary)).toEqual(snapshot(originalCallback))
})
