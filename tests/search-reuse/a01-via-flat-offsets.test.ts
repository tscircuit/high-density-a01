import { expect, test } from "bun:test"
import { defaultParams } from "../../lib/default-params"
import { HighDensitySolverA01 } from "../../lib/HighDensitySolverA01/HighDensitySolverA01"
import sample003 from "../dataset01/sample003/sample003.json"

type SearchState = {
  rows: number
  cols: number
  layers: number
  planeSize: number
  activeConnId: number
  usedCellsFlat: Int32Array
  rootOverlapAllowed: Uint8Array
  viaScanFlatOffsets: Int32Array | null
  getViaOccupants(row: number, col: number, activeConn: number): number[]
  nextStamp(): void
}

function originalOccupants(
  state: SearchState,
  row: number,
  col: number,
  radius: number,
): number[] {
  const occupants: number[] = []
  for (let z = 0; z < state.layers; z++) {
    for (let dr = -radius; dr <= radius; dr++) {
      for (let dc = -radius; dc <= radius; dc++) {
        if (dr * dr + dc * dc > radius * radius) continue
        const r = row + dr
        const c = col + dc
        if (r < 0 || c < 0 || r >= state.rows || c >= state.cols) continue
        const owner =
          state.usedCellsFlat[z * state.planeSize + r * state.cols + c]!
        if (owner === -1 || owner === state.activeConnId) continue
        if (state.rootOverlapAllowed[owner] === 1) continue
        if (!occupants.includes(owner)) occupants.push(owner)
      }
    }
  }
  return occupants
}

test("A01 flat via offsets preserve interior, edge, and corner occupant order", () => {
  for (const viaDiameter of [0, 0.2, 0.3, 0.6]) {
    const solver = new HighDensitySolverA01({
      ...defaultParams,
      viaDiameter,
      nodeWithPortPoints: { ...sample003, width: 1.3, height: 0.9 },
    })
    solver.setup()
    const state = solver as unknown as SearchState
    const radius = Math.ceil(viaDiameter / 2 / defaultParams.cellSizeMm)
    for (const activeConn of [0, 1]) {
      state.activeConnId = activeConn
      state.nextStamp()
      for (let flatIdx = 0; flatIdx < state.usedCellsFlat.length; flatIdx++) {
        state.usedCellsFlat[flatIdx] = ((flatIdx * 5 + activeConn) % 7) - 1
      }
      for (let row = 0; row < state.rows; row++) {
        for (let col = 0; col < state.cols; col++) {
          expect(state.getViaOccupants(row, col, activeConn)).toEqual(
            originalOccupants(state, row, col, radius),
          )
        }
      }
    }
    const offsets = state.viaScanFlatOffsets
    state.nextStamp()
    state.getViaOccupants(0, 0, state.activeConnId)
    expect(state.viaScanFlatOffsets).toBe(offsets)
    solver._setup()
    expect(state.viaScanFlatOffsets).toBeNull()
  }
})
