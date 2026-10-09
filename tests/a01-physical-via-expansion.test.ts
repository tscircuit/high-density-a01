import { expect, test } from "bun:test"
import { HighDensitySolverA01 } from "../lib/HighDensitySolverA01/HighDensitySolverA01"
import { defaultParams } from "../lib/default-params"

test("physical vias preserve destination eligibility, numeric costs and ordered rip histories", () => {
  let cases = 0
  let originalQueries = 0
  let physicalQueries = 0
  for (const layers of [2, 3, 4, 6]) {
    for (let mask = 0; mask < 16; mask++) {
      for (const cost of [10, -10, Infinity, -Infinity, Number.NaN]) {
        const records: unknown[] = []
        for (const mode of ["per-layer", "physical"] as const) {
          const solver = new HighDensitySolverA01({
            ...defaultParams,
            viaExpansion: mode,
            nodeWithPortPoints: {
              capacityMeshNodeId: "physical-via",
              center: { x: 0, y: 0 },
              width: 2,
              height: 2,
              portPoints: Array.from({ length: layers }, (_, z) => [
                { x: -0.8, y: -0.8, z, connectionName: `net${z}` },
                { x: 0.8, y: 0.8, z, connectionName: `net${z}` },
              ]).flat(),
            },
          }) as any
          solver.setup()
          expect(solver.layers).toBe(layers)
          expect(solver.getConstructorParams()[0].viaExpansion).toBe(mode)
          const row = Math.floor(solver.rows / 2)
          const col = Math.floor(solver.cols / 2)
          const z = mask % layers
          const endZ = (z + 1) % layers
          solver.activeConnId = 0
          solver.activeConnSeg = {
            connId: 0,
            startZ: z,
            startRow: row,
            startCol: col,
            startPoint: { x: 0, y: 0, z },
            endZ,
            endRow: mask & 8 ? row : row + 2,
            endCol: col,
            endPoint: { x: 0, y: 0.2, z: endZ },
          }
          solver.connIdToRootNet = ["shared", "shared", "foreign", "third"]
          solver.overlapFriendlyRootNets = new Set(mask & 4 ? ["shared"] : [])
          solver.portOwnerFlat.fill(-1)
          solver.usedCellsFlat.fill(-1)
          solver.stamp = 1
          solver.visitedStamp.fill(solver.stamp)
          solver.visitedStamp[(z * solver.rows + row) * solver.cols + col] = 0
          for (let nz = 0; nz < layers; nz++) {
            const flat = (nz * solver.rows + row) * solver.cols + col
            if (nz !== z && ((mask >> (nz % 4)) & 1) === 0) {
              solver.visitedStamp[flat] = 0
            }
            solver.portOwnerFlat[flat] = [-1, 0, 1, 2, -2][(mask + nz) % 5]
            solver.usedCellsFlat[flat] = (nz % 3) + 1
          }
          const ripped = { id: 2, prev: null }
          solver.nodePool = [{ z, row, col, g: 0, f: 0, parentIdx: -1, ripped }]
          solver.heap.clear()
          solver.heap.push(0, 0, 0)
          solver.seqCounter = 1
          solver.searchIterations = 0
          solver.baseSearchBudgetIters = 1000000
          // A pure custom cost remains valid in physical mode, including the
          // original negative/nonfinite arithmetic behavior.
          solver.getRipCost = () => cost
          let queries = 0
          const fill = solver.fillViaOccupants
          solver.fillViaOccupants = function (...args: unknown[]): void {
            queries++
            Reflect.apply(fill, this, args)
          }
          solver.step()
          const semanticNodes = solver.nodePool.map((node: any) => {
            const ripIds: number[] = []
            for (let r = node.ripped; r; r = r.prev) ripIds.push(r.id)
            return {
              z: node.z,
              row: node.row,
              col: node.col,
              parentIdx: node.parentIdx,
              // Byte views also distinguish signed zero and NaN payloads.
              costs: Array.from(
                new Uint8Array(new Float64Array([node.g, node.f]).buffer),
              ),
              ripIds,
            }
          })
          records.push({
            semanticNodes,
            visited: Array.from(solver.visitedStamp),
            seq: solver.seqCounter,
            heap: solver.heap,
            solved: solver.solved,
            failed: solver.failed,
            searchIterations: solver.searchIterations,
          })
          if (mode === "per-layer") originalQueries += queries
          else {
            physicalQueries += queries
            if (layers > 2) expect(queries).toBeLessThanOrEqual(1)
          }
        }
        expect(records[1]).toEqual(records[0])
        cases++
      }
    }
  }
  expect(cases).toBe(320)
  expect(physicalQueries).toBeLessThan(originalQueries)
  const direct = new HighDensitySolverA01({
    ...defaultParams,
    nodeWithPortPoints: {
      capacityMeshNodeId: "default-physical-mode",
      center: { x: 0, y: 0 },
      width: 1,
      height: 1,
      portPoints: [],
    },
  })
  expect(direct.viaExpansion).toBe("per-layer")
})
