import { expect, test } from "bun:test"
import { HighDensitySolverA01 } from "../lib/HighDensitySolverA01/HighDensitySolverA01"
import type { PortPoint } from "../lib/types"

type Ripped = { id: number; prev: Ripped | null }
type OccupancyHarness = {
  connNameToId: Map<string, number>
  usedCellsFlat: Int32Array
  usedDiagFlat: Int32Array
  rows: number
  cols: number
  _moveCost: number
  _moveRipped: Ripped | null
  activeConnId: number
  nextStamp(): void
  ripTrace(id: number): void
  getViaOccupants(row: number, col: number, active: number): number[]
  computeMoveCostAndRips(
    active: number,
    fromZ: number,
    fromRow: number,
    fromCol: number,
    toZ: number,
    toRow: number,
    toCol: number,
    ripped: Ripped | null,
  ): void
}

test("ripping a shared route preserves surviving cell, halo, and diagonal owners", (): void => {
  const portPoints: PortPoint[] = []
  for (const [name, start, end, root] of [
    ["long", [-1, -1], [1, 1], "shared"],
    ["short", [-0.5, -0.5], [0.5, 0.5], "shared"],
    ["duplicate", [-1, -1], [1, 1], "shared"],
    ["foreign", [-1.8, 1.8], [1.8, 1.8], "foreign"],
  ] as const) {
    portPoints.push(
      {
        connectionName: name,
        rootConnectionName: root,
        x: start[0],
        y: start[1],
        z: 0,
      },
      {
        connectionName: name,
        rootConnectionName: root,
        x: end[0],
        y: end[1],
        z: 0,
      },
    )
  }
  const solver = new HighDensitySolverA01({
    nodeWithPortPoints: {
      capacityMeshNodeId: "shared",
      center: { x: 0, y: 0 },
      width: 4,
      height: 4,
      availableZ: [0],
      portPoints,
    },
    cellSizeMm: 0.2,
    viaDiameter: 0.3,
    traceThickness: 0.1,
    traceMargin: 0.1,
    hyperParameters: { shuffleSeed: 0 },
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  const state = solver as unknown as OccupancyHarness
  const long = state.connNameToId.get("long")!
  const short = state.connNameToId.get("short")!
  const foreign = state.connNameToId.get("foreign")!
  const cell = 9 * state.cols + 9
  const halo = 9 * state.cols + 10
  const diagonal = (9 * (state.cols - 1) + 9) * 2

  // A new trace or via must account for both extant routes, even though their
  // same-net copper was allowed to share the site when they were committed.
  state.activeConnId = foreign
  state.nextStamp()
  state.computeMoveCostAndRips(foreign, 0, 9, 8, 0, 9, 9, null)
  const displaced = new Set<number>()
  for (let r = state._moveRipped; r; r = r.prev) displaced.add(r.id)
  expect(displaced).toEqual(new Set([long, short]))
  state.activeConnId = foreign
  state.nextStamp()
  expect(new Set(state.getViaOccupants(9, 9, foreign))).toEqual(
    new Set([long, short]),
  )

  for (let round = 0; round < 2; round++) {
    const removed = state.usedCellsFlat[cell]!
    const survivor = removed === long ? short : long
    state.ripTrace(removed)
    expect(state.usedCellsFlat[cell]).toBe(survivor)
    expect(state.usedCellsFlat[halo]).toBe(survivor)
    expect(state.usedDiagFlat[diagonal]).toBe(survivor)
    state.activeConnId = foreign
    state.nextStamp()
    expect(state.getViaOccupants(9, 9, foreign)).toEqual([survivor])
    state.computeMoveCostAndRips(foreign, 0, 9, 10, 0, 10, 9, null)
    expect(state._moveCost).toBe(-1)
    solver.solved = false
    solver.solve()
    expect(solver.solved).toBe(true)
  }
})
