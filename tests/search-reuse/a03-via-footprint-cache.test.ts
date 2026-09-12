import { expect, test } from "bun:test"
import { defaultA03Params } from "../../lib/default-params"
import { HighDensitySolverA03 } from "../../lib/HighDensitySolverA03/HighDensitySolverA03"
import sample002 from "../dataset01/sample002/sample002.json"
import sample003 from "../dataset01/sample003/sample003.json"
import repro03 from "../repros/repro03/repro03.json"

type GeometryState = {
  viaFootprintByCell: Map<number, Int32Array>
  viaKeepoutRadius: number
  planeSize: number
  activeConnId: number
  stamp: number
  totalRipEvents: number
  getViaFootprint(cellId: number): Int32Array
  nextStamp(): void
  forEachCellNearCircle(
    cx: number,
    cy: number,
    radius: number,
    visitor: (cellId: number) => void,
  ): void
}

function originalFootprint(
  solver: HighDensitySolverA03,
  cellId: number,
): number[] {
  const state = solver as unknown as GeometryState
  const cx = solver.cellCenterX[cellId]!
  const cy = solver.cellCenterY[cellId]!
  const radius = state.viaKeepoutRadius
  const result: number[] = []
  state.forEachCellNearCircle(cx, cy, radius, (candidate) => {
    const qx = Math.max(
      solver.cellMinX[candidate]!,
      Math.min(solver.cellMaxX[candidate]!, cx),
    )
    const qy = Math.max(
      solver.cellMinY[candidate]!,
      Math.min(solver.cellMaxY[candidate]!, cy),
    )
    const dx = cx - qx
    const dy = cy - qy
    if (dx * dx + dy * dy <= radius * radius) result.push(candidate)
  })
  return result
}

function getResult(solver: HighDensitySolverA03): object {
  return {
    solved: solver.solved,
    failed: solver.failed,
    error: solver.error,
    iterations: solver.iterations,
    rips: (solver as unknown as GeometryState).totalRipEvents,
    routes: solver.getOutput(),
  }
}

test("A03 reuses exact via footprint geometry across searches without retaining stale occupants", () => {
  for (const [width, height] of [
    [4, 4],
    [0.8, 3.2],
    [3.2, 0.8],
    [0.4, 0.4],
  ]) {
    const solver = new HighDensitySolverA03({
      ...defaultA03Params,
      highResolutionCellThickness: 0.4,
      nodeWithPortPoints: { ...sample003, width: width!, height: height! },
    })
    solver.setup()
    const state = solver as unknown as GeometryState
    for (let cellId = 0; cellId < state.planeSize; cellId++) {
      const footprint = state.getViaFootprint(cellId)
      expect([...footprint]).toEqual(originalFootprint(solver, cellId))
      expect(state.getViaFootprint(cellId)).toBe(footprint)
    }
    const footprint = state.getViaFootprint(0)
    state.activeConnId = 0
    state.nextStamp()
    expect(state.getViaFootprint(0)).toBe(footprint)
    solver._setup()
    expect(state.viaFootprintByCell.size).toBe(0)
    expect(state.getViaFootprint(0)).not.toBe(footprint)
  }

  let reuseAcrossSearches = 0
  for (const nodeWithPortPoints of [
    sample002,
    sample003,
    repro03.nodeWithPortPoints,
  ]) {
    const cached = new HighDensitySolverA03({
      ...defaultA03Params,
      nodeWithPortPoints,
    })
    const reference = new HighDensitySolverA03({
      ...defaultA03Params,
      nodeWithPortPoints,
    })
    const state = cached as unknown as GeometryState
    const referenceState = reference as unknown as GeometryState
    const cache = state.viaFootprintByCell
    const originalGet = cache.get.bind(cache)
    const seenStamp = new Map<number, number>()
    cache.get = (cellId): Int32Array | undefined => {
      const value = originalGet(cellId)
      if (value && seenStamp.get(cellId) !== state.stamp) reuseAcrossSearches++
      seenStamp.set(cellId, state.stamp)
      return value
    }
    referenceState.viaFootprintByCell.get = (): undefined => undefined
    referenceState.viaFootprintByCell.set = (): Map<number, Int32Array> =>
      referenceState.viaFootprintByCell
    cached.solve()
    reference.solve()
    expect(getResult(cached)).toEqual(getResult(reference))
    expect(state.viaFootprintByCell.size).toBe(0)
  }
  expect(reuseAcrossSearches).toBeGreaterThan(0)
})
