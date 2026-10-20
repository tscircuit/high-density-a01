import type { HighDensitySolverA03 } from "../../lib/HighDensitySolverA03/HighDensitySolverA03"

// Original fillViaOccupants from 10cdce5. This retains the existing per-search
// result cache while independently recomputing geometry after each cache miss.
export function useFrozenA03ViaOccupants(solver: HighDensitySolverA03): void {
  solver["fillViaOccupants"] = (cellId: number, activeConn: number): void => {
    const occs = solver["_viaOccs"]
    occs.length = 0
    const cachedOccupants = solver["viaOccupantsByCell"].get(cellId)
    if (cachedOccupants) {
      for (const connId of cachedOccupants) occs.push(connId)
      return
    }
    const cx = solver.cellCenterX[cellId]!
    const cy = solver.cellCenterY[cellId]!
    const radius = solver["viaKeepoutRadius"]
    solver["forEachCellNearCircle"](cx, cy, radius, (occCellId): void => {
      const qx = Math.max(
        solver.cellMinX[occCellId]!,
        Math.min(solver.cellMaxX[occCellId]!, cx),
      )
      const qy = Math.max(
        solver.cellMinY[occCellId]!,
        Math.min(solver.cellMaxY[occCellId]!, cy),
      )
      const dx = cx - qx
      const dy = cy - qy
      if (!(dx * dx + dy * dy <= radius * radius)) return
      for (let z = 0; z < solver.layers; z++) {
        solver["pushFlatOccupants"](
          z * solver.planeSize + occCellId,
          activeConn,
          occs,
        )
      }
    })
    solver["viaOccupantsByCell"].set(cellId, occs.slice())
  }
}
