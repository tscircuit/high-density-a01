import { expect, test } from "bun:test"
import { HighDensitySolverA01 } from "../lib/HighDensitySolverA01/HighDensitySolverA01"

type Cell = { z: number; row: number; col: number }
type Point = { x: number; y: number; z: number }
type RippedNode = { id: number; prev: RippedNode | null }
type SearchNode = Cell & {
  g: number
  f: number
  parentIdx: number
  ripped: RippedNode | null
}
type OccupancyProbe = {
  _setup(): void
  connIdToRootNet: string[]
  connIdToName: string[]
  overlapFriendlyRootNets: Set<string>
  usedCellsFlat: Int32Array
  usedDiagFlat: Int32Array
  portOwnerFlat: Int32Array
  activeConnId: number
  activeConnSeg: {
    connId: number
    startZ: number
    startRow: number
    startCol: number
    startPoint: Point
    endZ: number
    endRow: number
    endCol: number
    endPoint: Point
  } | null
  nodePool: SearchNode[]
  solvedRoutes: Map<number, unknown[]>
  _moveCost: number
  _moveRipped: RippedNode | null
  hyperParameters: {
    ripCost: number
    ripTracePenalty: number
    ripViaPenalty: number
  }
  finalizeRoute(goalNodeIndex: number): void
  ripTrace(connId: number): void
  computeMoveCostAndRips(
    activeConn: number,
    fromZ: number,
    fromRow: number,
    fromCol: number,
    toZ: number,
    toRow: number,
    toCol: number,
    ripped: RippedNode | null,
    viaOccupants: number[] | undefined,
  ): void
}
type CopperKind = "trace" | "via" | "diagonal"

const createOccupancyProbe = (): OccupancyProbe => {
  const solver = new HighDensitySolverA01({
    nodeWithPortPoints: {
      capacityMeshNodeId: "shared-copper-occupancy",
      center: { x: 0, y: 0 },
      width: 3,
      height: 3,
      availableZ: [0, 1],
      portPoints: [],
    },
    cellSizeMm: 1,
    viaDiameter: 0.3,
  })
  const probe = solver as unknown as OccupancyProbe
  probe._setup()
  probe.connIdToRootNet = ["shared", "shared", "shared", "shared", "foreign"]
  probe.connIdToName = ["a", "b", "c", "same-net-control", "foreign"]
  probe.overlapFriendlyRootNets.add("shared")
  return probe
}

const commitCopper = (
  probe: OccupancyProbe,
  connId: number,
  kind: CopperKind,
  ripped: RippedNode | null = null,
): void => {
  const branchStart: Cell =
    connId === 1
      ? { z: 0, row: 1, col: 2 }
      : connId === 2
        ? { z: 0, row: 0, col: 1 }
        : { z: 0, row: 1, col: 0 }
  const cells: Cell[] =
    kind === "trace"
      ? [branchStart, { z: 0, row: 1, col: 1 }]
      : kind === "via"
        ? [branchStart, { z: 0, row: 1, col: 1 }, { z: 1, row: 1, col: 1 }]
        : [
            ...(connId === 1
              ? [{ z: 0, row: 0, col: 1 }]
              : connId === 2
                ? [{ z: 0, row: 1, col: 0 }]
                : []),
            { z: 0, row: 0, col: 0 },
            { z: 0, row: 1, col: 1 },
          ]
  const first: Cell = cells[0]!
  const last: Cell = cells[cells.length - 1]!
  probe.activeConnId = connId
  probe.activeConnSeg = {
    connId,
    startZ: first.z,
    startRow: first.row,
    startCol: first.col,
    startPoint: { x: first.col, y: first.row, z: first.z },
    endZ: last.z,
    endRow: last.row,
    endCol: last.col,
    endPoint: { x: last.col, y: last.row, z: last.z },
  }
  probe.nodePool = cells.map(
    (cell: Cell, index: number): SearchNode => ({
      ...cell,
      g: 0,
      f: 0,
      parentIdx: index - 1,
      ripped,
    }),
  )
  probe.finalizeRoute(cells.length - 1)
  probe.activeConnSeg = null
}

const queryCopper = (
  probe: OccupancyProbe,
  activeConn: number,
  kind: CopperKind,
): number[] => {
  probe.computeMoveCostAndRips(
    activeConn,
    0,
    kind === "via" ? 1 : 0,
    1,
    kind === "via" ? 1 : 0,
    1,
    kind === "diagonal" ? 0 : 1,
    null,
    undefined,
  )
  const owners: number[] = []
  for (
    let node: RippedNode | null = probe._moveRipped;
    node;
    node = node.prev
  ) {
    owners.push(node.id)
  }
  return owners.sort((left: number, right: number): number => left - right)
}

test("A01 retains every shared copper owner through query, rip and displacement", (): void => {
  for (const kind of ["trace", "via", "diagonal"] as const) {
    for (const ownerCount of [2, 3]) {
      for (const removedOwner of [0, ownerCount - 1]) {
        const probe: OccupancyProbe = createOccupancyProbe()
        const owners: number[] = Array.from(
          { length: ownerCount },
          (_: unknown, index: number): number => index,
        )
        for (const owner of owners) commitCopper(probe, owner, kind)
        expect(probe.portOwnerFlat[4]).toBe(-1)
        expect(queryCopper(probe, 3, kind)).toEqual([])
        expect(probe._moveCost).toBeGreaterThanOrEqual(0)
        const sameNetCost: number = probe._moveCost
        const beforeRip: number[] = queryCopper(probe, 4, kind)
        if (kind === "diagonal") {
          expect(probe._moveCost).toBe(-1)
        } else {
          expect(beforeRip).toEqual(owners)
          expect(probe._moveCost).toBeCloseTo(
            sameNetCost +
              owners.length *
                (probe.hyperParameters.ripCost +
                  (kind === "via"
                    ? probe.hyperParameters.ripViaPenalty
                    : probe.hyperParameters.ripTracePenalty)),
          )
        }

        probe.ripTrace(removedOwner)
        const survivors: number[] = owners.filter(
          (owner: number): boolean => owner !== removedOwner,
        )
        for (const owner of survivors) {
          expect(probe.solvedRoutes.has(owner)).toBeTrue()
        }
        expect(probe.solvedRoutes.has(removedOwner)).toBeFalse()
        expect(queryCopper(probe, 3, kind)).toEqual([])
        expect(probe._moveCost).toBeGreaterThanOrEqual(0)
        const afterRip: number[] = queryCopper(probe, 4, kind)
        if (kind === "diagonal") {
          expect(probe._moveCost).toBe(-1)
          expect(probe.usedDiagFlat[0]).not.toBe(-1)
          for (const owner of survivors) probe.ripTrace(owner)
          expect(queryCopper(probe, 4, kind)).toEqual([])
          expect(probe._moveCost).toBeGreaterThanOrEqual(0)
          expect(probe.usedDiagFlat[0]).toBe(-1)
        } else {
          expect(afterRip).toEqual(survivors)
          commitCopper(probe, 4, kind, probe._moveRipped)
          for (const owner of owners) {
            expect(probe.solvedRoutes.has(owner)).toBeFalse()
          }
          expect(probe.solvedRoutes.has(4)).toBeTrue()
          expect(probe.usedCellsFlat[4]).toBe(4)
        }
      }
    }
  }

  // Via footprint displacement must collect every owner, including owners
  // discovered while materializing copper beyond the searched cell centers.
  const displacedProbe: OccupancyProbe = createOccupancyProbe()
  for (const owner of [0, 1, 2]) commitCopper(displacedProbe, owner, "trace")
  commitCopper(displacedProbe, 4, "via")
  for (const owner of [0, 1, 2]) {
    expect(displacedProbe.solvedRoutes.has(owner)).toBeFalse()
  }
  expect(displacedProbe.solvedRoutes.has(4)).toBeTrue()
  expect(displacedProbe.usedCellsFlat[4]).toBe(4)
})
