import { expect, test } from "bun:test"
import { defaultParams } from "../../lib/default-params"
import { HighDensitySolverA01 } from "../../lib/HighDensitySolverA01/HighDensitySolverA01"
import type { NodeWithPortPoints } from "../../lib/types"
import sample002 from "../dataset01/sample002/sample002.json"
import sample003 from "../dataset01/sample003/sample003.json"
import sample007 from "../dataset01/sample007/sample007.json"
import prevNext from "../prev-next/prev-next.json"
import repro03 from "../repros/repro03/repro03.json"
import repro05 from "../repros/repro05/repro05.json"
import { LegacyDuplicateHeap } from "./legacy-duplicate-heap"

const fixtures = [
  sample002,
  sample003,
  sample007.nodeWithPortPoints,
  prevNext,
  repro03.nodeWithPortPoints,
  repro05[0]!.nodeWithPortPoints,
]

function run(nodeWithPortPoints: NodeWithPortPoints, legacy: boolean) {
  const solver = new HighDensitySolverA01({
    ...defaultParams,
    nodeWithPortPoints,
  })
  solver.setup()
  const state = solver as any
  const pool = state.nodePool
  if (legacy) state.heap = new LegacyDuplicateHeap(pool)
  const heap = state.heap
  const pop = heap.pop.bind(heap)
  const expanded: unknown[] = []
  const expandedIndex = new Map<number, number>()
  let stamp = -1
  heap.pop = (): number => {
    const id = pop()
    const cell = pool.cellIdx[id]
    if (state.visitedStamp[cell] !== state.stamp) {
      if (stamp !== state.stamp) {
        stamp = state.stamp
        expandedIndex.clear()
      }
      const rips = []
      for (let r = pool.ripped[id]; r; r = r.prev) rips.push(r.id)
      if (pool.parentIdx[id] !== -1 && !expandedIndex.has(pool.parentIdx[id])) {
        throw new Error(
          "Expanded node refers to a parent that was never expanded",
        )
      }
      expanded.push({
        conn: state.activeConnId,
        cell,
        g: pool.g[id],
        rips,
        parent:
          pool.parentIdx[id] === -1
            ? -1
            : expandedIndex.get(pool.parentIdx[id]),
      })
      expandedIndex.set(id, expanded.length - 1)
    }
    return id
  }
  // Compare real search work while no scheduler/budget boundary can intervene.
  // Production budget formulas are unchanged; stage quality is evaluated separately.
  state.baseSearchBudgetIters = Infinity
  let searches = 0
  const searchLimit = nodeWithPortPoints === sample003 ? Infinity : 8
  while (!solver.solved && !solver.failed && searches < searchLimit) {
    state.stepOnce()
    if (state.activeConnSeg === null) searches++
    if (expanded.length > 200000)
      throw new Error("Expansion comparison exceeded its diagnostic bound")
  }
  expect(expanded.length).toBeGreaterThan(100)
  expect(state.consecutiveSkips).toBe(0)
  return {
    expanded,
    searches,
    routes: solver.getOutput(),
    solved: solver.solved,
    failed: solver.failed,
    error: solver.error,
    rips: state.totalRipEvents,
  }
}

test("indexed A01 expands the same cells, g, parent state and rip chains as the duplicate queue", () => {
  for (const fixture of fixtures)
    expect(run(fixture, false)).toEqual(run(fixture, true))
})

test("unsafe numeric inputs select the legacy queue before the first enqueue", () => {
  for (const params of [
    { hyperParameters: { greedyMultiplier: NaN } },
    { hyperParameters: { greedyMultiplier: Infinity } },
    { hyperParameters: { greedyMultiplier: 0, viaBaseCost: Infinity } },
    { hyperParameters: { ripCost: -1 } },
    { initialPenaltyFn: () => NaN },
    { initialPenaltyFn: () => -1 },
  ]) {
    const runUnsafe = (legacy: boolean) => {
      const solver = new HighDensitySolverA01({
        ...defaultParams,
        nodeWithPortPoints: sample003,
        ...params,
      })
      solver.setup()
      const state = solver as any
      if (legacy) state.heap = new LegacyDuplicateHeap(state.nodePool)
      for (let i = 0; i < 1500 && !solver.solved && !solver.failed; i++)
        state.stepOnce()
      if (!legacy) expect(state.heap.indexed).toBe(false)
      return {
        routes: solver.getOutput(),
        solved: solver.solved,
        failed: solver.failed,
        nodes: state.nodePool.length,
        searchIterations: state.searchIterations,
        cells: [...state.nodePool.cellIdx.slice(0, state.nodePool.length)],
        g: [...state.nodePool.g.slice(0, state.nodePool.length)],
      }
    }
    expect(runUnsafe(false)).toEqual(runUnsafe(true))
  }
})

test("empty available layers retain the legacy start-node behavior", () => {
  const nodeWithPortPoints = {
    capacityMeshNodeId: "empty-layers",
    center: { x: 0, y: 0 },
    width: 0.1,
    height: 0.1,
    availableZ: [],
    portPoints: [
      { x: -0.04, y: 0, z: 0, connectionName: "a" },
      { x: 0.04, y: 0, z: 0, connectionName: "a" },
    ],
  }
  const runEmpty = (legacy: boolean) => {
    const solver = new HighDensitySolverA01({
      ...defaultParams,
      nodeWithPortPoints,
    })
    solver.setup()
    const state = solver as any
    if (legacy) state.heap = new LegacyDuplicateHeap(state.nodePool)
    solver.solve()
    if (!legacy) expect(state.heap.indexed).toBe(false)
    return {
      solved: solver.solved,
      failed: solver.failed,
      iterations: solver.iterations,
      routes: solver.getOutput(),
    }
  }
  expect(runEmpty(false)).toEqual(runEmpty(true))
  expect(runEmpty(false).solved).toBe(true)
})
