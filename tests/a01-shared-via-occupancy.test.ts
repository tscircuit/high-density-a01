import { expect, test } from "bun:test"
import { HighDensitySolverA01 } from "../lib/HighDensitySolverA01/HighDensitySolverA01"
import type { PortPoint } from "../lib/types"

type ViaOccupancyHarness = {
  connNameToId: Map<string, number>
  usedCellsFlat: Int32Array
  rows: number
  cols: number
  solvedRoutes: Map<number, Array<{ viaCells: Array<{ row: number; col: number }> }>>
  activeConnId: number
  nextStamp(): void
  ripTrace(id: number): void
  getViaOccupants(row: number, col: number, active: number): number[]
}

test("ripping a route through a shared via retains the other route's full footprint", (): void => {
  const portPoints: PortPoint[] = []
  for (const [name, start, end, root] of [
    ["long", [-1, 0], [1, 0], "shared"],
    ["short", [-1, 0], [0.5, 0], "shared"],
    ["duplicate", [-1, 0], [1, 0], "shared"],
    ["foreign", [-0.8, 0.8], [0.8, 0.8], "foreign"],
  ] as const) {
    portPoints.push(
      { connectionName: name, rootConnectionName: root, x: start[0], y: start[1], z: 0 },
      { connectionName: name, rootConnectionName: root, x: end[0], y: end[1],
        z: root === "shared" ? 1 : 0 },
    )
  }
  const solver = new HighDensitySolverA01({
    nodeWithPortPoints: { capacityMeshNodeId: "shared-via", center: { x: 0, y: 0 },
      width: 2, height: 2, availableZ: [0, 1], portPoints },
    cellSizeMm: 0.2, viaDiameter: 0.3, traceThickness: 0.1, traceMargin: 0.1,
    viaMinDistFromBorder: 0.8, hyperParameters: { shuffleSeed: 0 },
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  const state = solver as unknown as ViaOccupancyHarness
  const long = state.connNameToId.get("long")!
  const short = state.connNameToId.get("short")!
  const foreign = state.connNameToId.get("foreign")!
  const via = state.solvedRoutes.get(long)![0]!.viaCells[0]!
  expect(via).toBeDefined()
  expect(state.solvedRoutes.get(short)![0]!.viaCells).toContainEqual(via)
  const center = via.row * state.cols + via.col
  for (let round = 0; round < 2; round++) {
    state.activeConnId = foreign
    state.nextStamp()
    expect(new Set(state.getViaOccupants(via.row, via.col, foreign))).toEqual(new Set([long, short]))
    const removed = state.usedCellsFlat[center]!
    const survivor = removed === long ? short : long
    state.ripTrace(removed)
    for (const z of [0, 1]) {
      const layerCenter = z * state.rows * state.cols + center
      expect(state.usedCellsFlat[layerCenter]).toBe(survivor)
      expect(state.usedCellsFlat[layerCenter + state.cols]).toBe(survivor)
    }
    state.activeConnId = foreign
    state.nextStamp()
    expect(state.getViaOccupants(via.row, via.col, foreign)).toEqual([survivor])
    solver.solved = false
    solver.solve()
    expect(solver.solved).toBe(true)
  }
})
