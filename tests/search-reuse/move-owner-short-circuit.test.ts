import { expect, test } from "bun:test"
import { defaultA03Params, defaultParams } from "../../lib/default-params"
import { HighDensitySolverA01 } from "../../lib/HighDensitySolverA01/HighDensitySolverA01"
import { HighDensitySolverA03 } from "../../lib/HighDensitySolverA03/HighDensitySolverA03"
import type { NodeWithPortPoints } from "../../lib/types"

type RippedNode = { id: number; prev: RippedNode | null }
type SearchState = {
  activeConnId: number
  activeConnSeg: object | null
  connNameToId: Map<string, number>
  portOwnerFlat: Int32Array
  usedCellsFlat: Int32Array
  cellOwners: Array<number[] | undefined>
  diagonalOwners: Array<number[] | undefined>
  usedDiagFlat: Int32Array
  rootOverlapAllowed: Uint8Array
  planeSize: number
  _moveCost: number
  _moveRipped: RippedNode | null
  _moveRippedHead: number
  _moveRipCount: number
  nextStamp(): void
  computeMoveCostAndRips(...args: unknown[]): void
}

const nodeWithPortPoints: NodeWithPortPoints = {
  capacityMeshNodeId: "owner-short-circuit",
  center: { x: 0, y: 0 },
  width: 4,
  height: 4,
  availableZ: [0, 1],
  portPoints: ["a", "b", "c"].flatMap((connectionName, index) => {
    const rootConnectionName = index < 2 ? "shared" : "other"
    return [
      { connectionName, rootConnectionName, x: -2, y: index - 1, z: 0 },
      { connectionName, rootConnectionName, x: 2, y: index - 1, z: 1 },
    ]
  }),
}

test("move guards preserve ownership, endpoint exemptions and blocker scratch without empty-table reads", () => {
  for (const solver of [
    new HighDensitySolverA01({ ...defaultParams, nodeWithPortPoints }),
    new HighDensitySolverA03({ ...defaultA03Params, nodeWithPortPoints }),
  ]) {
    solver.setup()
    const state = solver as unknown as SearchState
    const a = state.connNameToId.get("a")!
    const b = state.connNameToId.get("b")!
    const c = state.connNameToId.get("c")!
    state.activeConnId = a
    state.nextStamp()
    state.portOwnerFlat.fill(-1)
    state.usedCellsFlat.fill(-1)
    const flags = state.rootOverlapAllowed
    const inputRip: RippedNode = { id: b, prev: null }
    let endReads = 0
    let endSegment: object | null = null
    Object.defineProperty(state, "activeConnSeg", {
      configurable: true,
      get() {
        endReads++
        return endSegment
      },
    })
    let tableReads = 0
    const observedFlags = new Proxy(flags, {
      get(target, key) {
        if (key === "-1" || key === "-2") {
          throw new Error("An empty fixed owner indexed the overlap table")
        }
        if (typeof key === "string" && /^\d+$/.test(key)) tableReads++
        return Reflect.get(target, key, target)
      },
    })

    state.rootOverlapAllowed = observedFlags
    const toZ = 1
    const row =
      solver instanceof HighDensitySolverA01 ? Math.floor(solver.rows / 2) : 0
    const col =
      solver instanceof HighDensitySolverA01 ? Math.floor(solver.cols / 2) : 0
    const cellId =
      solver instanceof HighDensitySolverA01
        ? row * solver.cols + col
        : Math.floor(state.planeSize / 2)
    const target = toZ * state.planeSize + cellId

    for (const isVia of [false, true]) {
      for (const isEnd of [false, true]) {
        endSegment = {
          endZ: isEnd ? toZ : 0,
          endRow: row,
          endCol: col,
          endCellId: cellId,
        }
        for (const owner of [-2, -1, a, b, c]) {
          state.portOwnerFlat[target] = owner
          state._moveCost = 123
          state._moveRipped = null
          state._moveRippedHead = 123
          state._moveRipCount = 123
          tableReads = 0
          endReads = 0
          if (solver instanceof HighDensitySolverA01) {
            state.computeMoveCostAndRips(
              a,
              isVia ? 0 : toZ,
              row,
              isVia ? col : col - 1,
              toZ,
              row,
              col,
              inputRip,
            )
          } else {
            state.computeMoveCostAndRips(a, toZ, cellId, isVia, -1, 3, 0.1)
          }
          const foreign = owner >= 0 && owner !== a
          const allowedRoot = owner === b
          const needsEnd = foreign && !allowedRoot
          const blocked = needsEnd && !isEnd
          const baseCost = isVia
            ? solver.hyperParameters.viaBaseCost
            : solver instanceof HighDensitySolverA01
              ? solver.cellSizeMm
              : 0.1
          expect(state._moveCost).toBe(blocked ? -1 : baseCost)
          expect(tableReads).toBe(foreign ? 1 : 0)
          expect(endReads).toBe(needsEnd ? 1 : 0)
          if (solver instanceof HighDensitySolverA01) {
            expect(state._moveRipped as RippedNode | null).toBe(inputRip)
          } else {
            expect(state._moveRippedHead).toBe(-1)
            expect(state._moveRipCount).toBe(blocked ? 123 : 3)
          }
        }
      }
    }

    if (solver instanceof HighDensitySolverA01) {
      state.portOwnerFlat[target] = -1
      const crossingIndex =
        ((toZ * (solver.rows - 1) + row - 1) * (solver.cols - 1) + col - 1) *
          2 +
        1
      for (const traceOwner of [-1, a, b, c]) {
        for (const crossingOwner of [-1, a, b, c]) {
          state.usedCellsFlat[target] = traceOwner
          state.cellOwners[target] =
            traceOwner === -1 ? undefined : [traceOwner]
          state.usedDiagFlat[crossingIndex] = crossingOwner
          state.diagonalOwners[crossingIndex] =
            crossingOwner === -1 ? undefined : [crossingOwner]
          tableReads = 0
          endReads = 0
          state.computeMoveCostAndRips(
            a,
            toZ,
            row - 1,
            col - 1,
            toZ,
            row,
            col,
            inputRip,
          )
          const traceForeign = traceOwner !== -1 && traceOwner !== a
          const crossingForeign = crossingOwner !== -1 && crossingOwner !== a
          const ripTrace =
            traceForeign && !(traceOwner === b)
          const blocked =
            crossingForeign && !(crossingOwner === b)
          let cost = Math.SQRT2 * solver.cellSizeMm
          let expectedRip = inputRip
          if (ripTrace) {
            if (traceOwner !== b) {
              cost += solver.hyperParameters.ripCost
              expectedRip = { id: traceOwner, prev: inputRip }
            }
            cost += solver.hyperParameters.ripTracePenalty
          }
          expect(state._moveCost).toBe(blocked ? -1 : cost)
          expect(state._moveRipped).toEqual(expectedRip)
          expect(tableReads).toBe(
            Number(traceForeign) + Number(crossingForeign),
          )
          expect(endReads).toBe(0)
        }
      }
      state.usedCellsFlat.fill(-1)
      state.usedDiagFlat.fill(-1)
      state.cellOwners.fill(undefined)
      state.diagonalOwners.fill(undefined)
    }
  }
})
