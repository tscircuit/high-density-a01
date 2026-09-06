import { expect, test } from "bun:test"
import { HighDensitySolverA01 } from "../lib/HighDensitySolverA01/HighDensitySolverA01"
import { HighDensitySolverA03 } from "../lib/HighDensitySolverA03/HighDensitySolverA03"
import type { NodeWithPortPoints, PortPoint } from "../lib/types"

type ConnectionSegment = { connId: number }
type SharedPortProbe = {
  connNameToId: Map<string, number>
  connIdToRootNet: string[]
  portOwnerFlat: Int32Array
  activeConnSeg: ConnectionSegment | null
  unsolvedConnections: ConnectionSegment[]
  _moveCost: number
}
type A01PortProbe = SharedPortProbe & {
  rows: number
  cols: number
  sharedCrossRootPortCells: Set<number>
  pointToCell(point: PortPoint): { z: number; row: number; col: number }
  computeMoveCostAndRips(
    activeConn: number,
    fromZ: number,
    fromRow: number,
    fromCol: number,
    toZ: number,
    toRow: number,
    toCol: number,
    ripped: null,
    viaOccupants: number[] | undefined,
  ): void
}
type A03PortProbe = SharedPortProbe & {
  planeSize: number
  sharedCrossRootPortFlat: Uint8Array
  pointToCell(point: PortPoint): { z: number; cellId: number }
  computeMoveCostAndRips(
    activeConn: number,
    toZ: number,
    toCellId: number,
    isVia: boolean,
    rippedHead: number,
    currentRipCount: number,
    lateralCost: number,
    viaOccupants: number[] | undefined,
  ): void
}
type PortAdmission = {
  owner: number
  ownerRoot: string | undefined
  crossRoot: boolean
  sameRootMoveCost: number
  foreignMoveCost: number
}

const getSharedPortAdmission = (
  solver: HighDensitySolverA01 | HighDensitySolverA03,
  point: PortPoint,
): PortAdmission => {
  const sharedProbe = solver as unknown as SharedPortProbe
  const sharedConnectionId = sharedProbe.connNameToId.get("branch")!
  const foreignConnectionId = sharedProbe.connNameToId.get("foreign")!
  const segments = [...sharedProbe.unsolvedConnections]
  if (sharedProbe.activeConnSeg) segments.push(sharedProbe.activeConnSeg)
  const sharedSegment = segments.find(
    (segment): boolean => segment.connId === sharedConnectionId,
  )
  const foreignSegment = segments.find(
    (segment): boolean => segment.connId === foreignConnectionId,
  )
  if (!sharedSegment || !foreignSegment) {
    throw new Error("Expected both unprocessed connection demands")
  }

  if (solver instanceof HighDensitySolverA01) {
    const probe = solver as unknown as A01PortProbe
    const cell = probe.pointToCell(point)
    const flatIndex = (cell.z * probe.rows + cell.row) * probe.cols + cell.col
    probe.activeConnSeg = sharedSegment
    probe.computeMoveCostAndRips(
      sharedConnectionId,
      cell.z,
      cell.row,
      cell.col - 1,
      cell.z,
      cell.row,
      cell.col,
      null,
      undefined,
    )
    const sameRootMoveCost = probe._moveCost
    probe.activeConnSeg = foreignSegment
    probe.computeMoveCostAndRips(
      foreignConnectionId,
      cell.z,
      cell.row,
      cell.col - 1,
      cell.z,
      cell.row,
      cell.col,
      null,
      undefined,
    )
    const owner = probe.portOwnerFlat[flatIndex]!
    return {
      owner,
      ownerRoot: probe.connIdToRootNet[owner],
      crossRoot: probe.sharedCrossRootPortCells.has(flatIndex),
      sameRootMoveCost,
      foreignMoveCost: probe._moveCost,
    }
  }

  const probe = solver as unknown as A03PortProbe
  const cell = probe.pointToCell(point)
  const flatIndex = cell.z * probe.planeSize + cell.cellId
  probe.activeConnSeg = sharedSegment
  probe.computeMoveCostAndRips(
    sharedConnectionId,
    cell.z,
    cell.cellId,
    false,
    -1,
    0,
    0.1,
    undefined,
  )
  const sameRootMoveCost = probe._moveCost
  probe.activeConnSeg = foreignSegment
  probe.computeMoveCostAndRips(
    foreignConnectionId,
    cell.z,
    cell.cellId,
    false,
    -1,
    0,
    0.1,
    undefined,
  )
  const owner = probe.portOwnerFlat[flatIndex]!
  return {
    owner,
    ownerRoot: probe.connIdToRootNet[owner],
    crossRoot: probe.sharedCrossRootPortFlat[flatIndex] === 1,
    sameRootMoveCost,
    foreignMoveCost: probe._moveCost,
  }
}

test("same-root shared ports retain ownership against foreign route moves", (): void => {
  for (const Solver of [HighDensitySolverA01, HighDensitySolverA03]) {
    for (const foreignSharesPort of [false, true]) {
      const nodeWithPortPoints: NodeWithPortPoints = {
        capacityMeshNodeId: "shared-port-ownership",
        center: { x: 0, y: 0 },
        width: 2,
        height: 2,
        availableZ: [0, 1],
        portPoints: [
          {
            x: 0,
            y: 0,
            z: 0,
            connectionName: "main",
            rootConnectionName: "net",
          },
          {
            x: 0,
            y: 0.8,
            z: 0,
            connectionName: "main",
            rootConnectionName: "net",
          },
          {
            x: 0,
            y: 0,
            z: 0,
            connectionName: "branch",
            rootConnectionName: "net",
          },
          {
            x: 0,
            y: 0.8003,
            z: 0,
            connectionName: "branch",
            rootConnectionName: "net",
          },
          {
            x: foreignSharesPort ? 0 : -1,
            y: 0,
            z: 0,
            connectionName: "foreign",
            rootConnectionName: "other",
          },
          {
            x: 1,
            y: 0,
            z: 0,
            connectionName: "foreign",
            rootConnectionName: "other",
          },
        ],
      }
      const original: NodeWithPortPoints = structuredClone(nodeWithPortPoints)
      const solver = new Solver({
        nodeWithPortPoints,
        viaDiameter: 0.3,
        cellSizeMm: 0.1,
      })
      solver.step()
      const admission = getSharedPortAdmission(
        solver,
        nodeWithPortPoints.portPoints[0]!,
      )

      if (foreignSharesPort) {
        expect(admission.owner).toBe(-2)
        expect(admission.crossRoot).toBeTrue()
      } else {
        expect(admission.foreignMoveCost).toBe(-1)
        expect(admission.sameRootMoveCost).toBeGreaterThanOrEqual(0)
        expect(admission.owner).toBeGreaterThanOrEqual(0)
        expect(admission.ownerRoot).toBe("net")
        expect(admission.crossRoot).toBeFalse()
      }
      expect(nodeWithPortPoints).toEqual(original)
      expect(solver.failed).toBeFalse()
    }
  }
})
