import { expect, test } from "bun:test"
import {
  createPreflightSolver,
  fullPreflightState,
  peekExpansion,
  setRawNaNEdge,
  warmPreflightSolver,
} from "./a03-native-preflight-helpers"

test("row preflight falls back before every unsafe live index or floating payload without replaying the ordinary prefix", () => {
  const controls: Array<{
    name: string
    edit: (s: any, row: { cell: number; edge: number }) => void
  }> = [
    {
      name: "negative CSR start",
      edit: (s, row) => {
        s.neighborOffset[row.cell] = -1
      },
    },
    {
      name: "reversed CSR row",
      edit: (s, row) => {
        s.neighborOffset[row.cell + 1] = s.neighborOffset[row.cell] - 1
      },
    },
    {
      name: "CSR beyond edges",
      edit: (s, row) => {
        s.neighborOffset[row.cell + 1] = s.neighborIds.length + 1
      },
    },
    {
      name: "negative neighbor",
      edit: (s, row) => {
        s.neighborIds[row.edge] = -1
      },
    },
    {
      name: "outside neighbor",
      edit: (s, row) => {
        s.neighborIds[row.edge] = s.planeSize
      },
    },
    {
      name: "raw edge NaN",
      edit: (s, row) => {
        setRawNaNEdge(s, row.edge)
      },
    },
    {
      name: "source infinity",
      edit: (s, row) => {
        s.cellCenterX[row.cell] = Infinity
      },
    },
    {
      name: "goal nonfinite payload",
      edit: (s) => {
        new BigUint64Array(
          s.cellCenterY.buffer,
          s.cellCenterY.byteOffset,
          s.cellCenterY.length,
        )[s.activeConnSeg.endCellId] = 0xfff0000000000123n
      },
    },
    {
      name: "neighbor infinity",
      edit: (s, row) => {
        s.cellCenterY[s.neighborIds[row.edge]] = -Infinity
      },
    },
  ]
  for (const control of controls) {
    const js = createPreflightSolver(false)
    const native = createPreflightSolver(true)
    warmPreflightSolver(js)
    warmPreflightSolver(native)
    let row = peekExpansion(js)
    for (let i = 0; !row && i < 30; i++) {
      js.step()
      native.step()
      row = peekExpansion(js)
    }
    expect(row).not.toBeNull()
    expect(native.nativeSearchActive).toBe(true)
    const before = native.nativeSearchSteps
    const oldIterations = native.iterations
    const oldSearch = native.searchIterations
    for (const solver of [js, native]) control.edit(solver, row!)
    let first = true
    for (let i = 0; i < 3 && !js.failed && !js.solved; i++) {
      let jsError = "",
        nativeError = ""
      try {
        js.step()
      } catch (error) {
        jsError = String(error)
      }
      try {
        native.step()
      } catch (error) {
        nativeError = String(error)
      }
      expect(nativeError).toBe(jsError)
      expect(fullPreflightState(native)).toBe(fullPreflightState(js))
      expect(native.nativeSearchActive).toBe(false)
      expect(native.nativeDeclined).toBe(true)
      expect(native.nativeSearchSteps).toBe(before)
      if (first) {
        expect(native.iterations).toBe(oldIterations + 1)
        expect(native.searchIterations).toBe(oldSearch + 1)
        first = false
      }
    }
  }
})
