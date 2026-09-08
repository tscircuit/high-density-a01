import { HighDensitySolverA03 } from "../../lib/HighDensitySolverA03/HighDensitySolverA03"
import { defaultA03Params } from "../../lib/default-params"
import sample003 from "../dataset01/sample003/sample003.json"

export const createPreflightSolver = (native: boolean, layers = 2): any =>
  new HighDensitySolverA03({
    ...defaultA03Params,
    nodeWithPortPoints: {
      ...structuredClone(sample003),
      availableZ: Array.from({ length: layers }, (_, i) => i),
    },
    useNativeSearch: native,
  })

export const warmPreflightSolver = (solver: any): void => {
  for (let i = 0; i < 100; i++) solver.step()
}

export const peekExpansion = (
  solver: any,
): { cell: number; edge: number } | null => {
  if (!solver.activeConnSeg || solver.heap.n === 0) return null
  const id = solver.heap.id[0]
  const cell = solver.nodePool.cellId[id]
  const z = solver.nodePool.z[id]
  if (
    solver.visitedStamp[z * solver.planeSize + cell] === solver.stamp ||
    (cell === solver.activeConnSeg.endCellId && z === solver.activeConnSeg.endZ)
  )
    return null
  const first = solver.neighborOffset[cell]
  const end = solver.neighborOffset[cell + 1]
  for (let edge = first; edge < end; edge++)
    if (
      solver.visitedStamp[z * solver.planeSize + solver.neighborIds[edge]] !==
      solver.stamp
    )
      return { cell, edge }
  return null
}

// Find a real later expansion without altering its costs, ordering or state.
// Default CSR rows are disjoint, so changing this edge cannot affect prior rows.
export const findLaterRow = (
  layers: number,
): { cell: number; edge: number; pops: number } => {
  const probe = createPreflightSolver(false, layers)
  warmPreflightSolver(probe)
  const seen = new Set<number>()
  const connection = probe.activeConnSeg
  for (let pops = 0; pops < 80; pops++) {
    if (probe.activeConnSeg !== connection) break
    const row = peekExpansion(probe)
    if (row && pops >= 4 && !seen.has(row.cell)) return { ...row, pops }
    if (probe.heap.n) seen.add(probe.nodePool.cellId[probe.heap.id[0]])
    probe.step()
  }
  throw new Error("Fixture needs a distinct later expansion row")
}

const normalize = (value: any): any => {
  if (typeof value === "number") {
    if (Number.isNaN(value)) return { number: "NaN" }
    if (Object.is(value, -0)) return { number: "-0" }
    if (!Number.isFinite(value)) return { number: String(value) }
    return value
  }
  if (ArrayBuffer.isView(value))
    return {
      type: value.constructor.name,
      bytes: Array.from(
        new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
      ),
    }
  if (value instanceof Map)
    return Array.from(value, ([key, item]) => [key, normalize(item)])
  if (Array.isArray(value)) return value.map(normalize)
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {}
    for (const key of Object.keys(value)) result[key] = normalize(value[key])
    return result
  }
  return value
}

export const fullPreflightState = (s: any): string => {
  const storage = s.nativeSearchActive
    ? s.nativeKernel.snapshot()
    : {
        heap: { length: s.heap.n, f: s.heap.f, id: s.heap.id },
        nodes: {
          length: s.nodePool.length,
          z: s.nodePool.z,
          cellId: s.nodePool.cellId,
          g: s.nodePool.g,
          parent: s.nodePool.parent,
          ripHead: s.nodePool.ripHead,
          ripCount: s.nodePool.ripCount,
        },
        rips: {
          length: s.ripChain.length,
          connId: s.ripChain.connId,
          prev: s.ripChain.prev,
        },
        visited: s.visitedStamp,
        visitedFlat: s.visitedFlatStamp,
        bestStamp: s.bestGStamp,
        bestG: s.bestGValue,
        moveCost: s._moveCost,
        moveHead: s._moveRippedHead,
        moveRipCount: s._moveRipCount,
        viaScratch: s._viaOccs,
        cellScratch: s._cellOccs,
        layerScratch: s._layerOccs,
        viaOccupants: s.viaOccupantsByCell,
        layerStamp: s.layerOccupantStamp,
        layerOccupants: s.layerOccupantsByCell,
      }
  delete storage.nativeFootprints
  const distance = s.nativeSearchActive
    ? s.nativeKernel.distanceSnapshot()
    : {
        capacity: s.distanceCacheCapacity,
        slots: s.distanceCacheSlots,
        tables: s.distanceByGoal,
      }
  return JSON.stringify(
    normalize({
      iterations: s.iterations,
      solved: s.solved,
      failed: s.failed,
      error: s.error,
      progress: s.progress,
      openSet: s.openSet,
      active: s.activeConnection,
      searchIterations: s.searchIterations,
      consecutiveSkips: s.consecutiveSkips,
      unsolved: s.unsolvedConnections,
      ripCount: s.ripCount,
      totalRipEvents: s.totalRipEvents,
      output: s.getOutput(),
      storage,
      distance,
      footprints: s.viaFootprintByCell,
      usedCellsFlat: s.usedCellsFlat,
      sharedCellsFlat: s.sharedCellsFlat,
      penalty2d: s.penalty2d,
    }),
  )
}

export const setRawNaNEdge = (solver: any, edge: number): void => {
  new Uint32Array(
    solver.neighborCosts.buffer,
    solver.neighborCosts.byteOffset,
    solver.neighborCosts.length,
  )[edge] = 0x7fc12345
}
