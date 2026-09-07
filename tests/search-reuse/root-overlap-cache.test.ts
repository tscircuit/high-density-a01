import { expect, test } from "bun:test"
import { defaultA03Params, defaultParams } from "../../lib/default-params"
import { HighDensitySolverA01 } from "../../lib/HighDensitySolverA01/HighDensitySolverA01"
import { HighDensitySolverA03 } from "../../lib/HighDensitySolverA03/HighDensitySolverA03"
import type { NodeWithPortPoints } from "../../lib/types"

type SearchState = {
  activeConnId: number
  connNameToId: Map<string, number>
  overlapFriendlyRootNets: Set<string>
  portOwnerFlat: Int32Array
  usedCellsFlat: Int32Array
  rootOverlapAllowed: Uint8Array
  cols: number
  rows: number
  _moveCost: number
  nextStamp(): void
  computeMoveCostAndRips(...args: unknown[]): void
}

const nodeWithPortPoints: NodeWithPortPoints = {
  capacityMeshNodeId: "root-overlap",
  center: { x: 0, y: 0 },
  width: 4,
  height: 4,
  availableZ: [0, 1],
  portPoints: [
    { portPointId: "a0", connectionName: "a", rootConnectionName: "shared", x: -2, y: -1, z: 0 },
    { portPointId: "a1", connectionName: "a", rootConnectionName: "shared", x: 2, y: 1, z: 0 },
    { portPointId: "b0", connectionName: "b", rootConnectionName: "shared", x: -2, y: 1, z: 1 },
    { portPointId: "b1", connectionName: "b", rootConnectionName: "shared", x: 2, y: -1, z: 1 },
    { portPointId: "c0", connectionName: "c", rootConnectionName: "other", x: -1, y: -2, z: 0 },
    { portPointId: "c1", connectionName: "c", rootConnectionName: "other", x: 1, y: 2, z: 0 },
  ],
}

test("cached root overlap preserves sentinel and owner exemptions and refreshes per active connection", () => {
  for (const [SolverClass, params] of [
    [HighDensitySolverA01, defaultParams],
    [HighDensitySolverA03, defaultA03Params],
  ] as const) {
    const solver = new SolverClass({ ...params, nodeWithPortPoints })
    solver.setup()
    const state = solver as unknown as SearchState
    const a = state.connNameToId.get("a")!
    const b = state.connNameToId.get("b")!
    const c = state.connNameToId.get("c")!
    state.portOwnerFlat.fill(-1)
    state.usedCellsFlat.fill(-1)
    for (const allowSharedRoot of [false, true]) {
      if (allowSharedRoot) state.overlapFriendlyRootNets.add("shared")
      else state.overlapFriendlyRootNets.delete("shared")
      state.activeConnId = a
      state.nextStamp()
      const sharesRoot = allowSharedRoot || SolverClass === HighDensitySolverA03
      expect(state.rootOverlapAllowed[b] === 1).toBe(sharesRoot)
      expect(state.rootOverlapAllowed[c]).toBe(0)
      for (const owner of [-2, -1, a, b, c]) {
        if (SolverClass === HighDensitySolverA01) {
          const row = Math.floor(state.rows / 2)
          const col = Math.floor(state.cols / 2)
          const target = row * state.cols + col
          state.portOwnerFlat[target] = owner
          state.computeMoveCostAndRips(a, 0, row, col - 1, 0, row, col, null)
        } else {
          const target = 1
          state.portOwnerFlat[target] = owner
          state.computeMoveCostAndRips(a, 0, target, false, -1, 0, 0.1)
        }
        const blocked = owner === c || (owner === b && !sharesRoot)
        expect(state._moveCost < 0).toBe(blocked)
      }
    }
    state.activeConnId = c
    state.nextStamp()
    expect(state.rootOverlapAllowed[a]).toBe(0)
    expect(state.rootOverlapAllowed[b]).toBe(0)
  }
})
