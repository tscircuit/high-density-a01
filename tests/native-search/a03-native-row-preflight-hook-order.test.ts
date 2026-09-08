import { expect, test } from "bun:test"
import {
  createPreflightSolver,
  fullPreflightState,
  peekExpansion,
  setRawNaNEdge,
  warmPreflightSolver,
} from "./a03-native-preflight-helpers"

test("a live invalid later edge preserves an earlier throwing JavaScript heuristic and its partial search writes", () => {
  const probe = createPreflightSolver(false)
  warmPreflightSolver(probe)
  let selected: { extra: number; badEdge: number; firstCell: number } | null =
    null
  for (let extra = 0; extra < 30 && !selected; extra++) {
    const row = peekExpansion(probe)
    const calls: number[] = []
    const original = probe.computeH
    probe.computeH = function (
      z: number,
      cell: number,
      toZ: number,
      toCell: number,
    ): number {
      calls.push(cell)
      return Reflect.apply(original, this, [z, cell, toZ, toCell])
    }
    probe.step()
    probe.computeH = original
    if (!row || calls.length === 0) continue
    const first = probe.neighborOffset[row.cell]
    const end = probe.neighborOffset[row.cell + 1]
    for (let edge = first; edge + 1 < end; edge++) {
      if (probe.neighborIds[edge] === calls[0]) {
        selected = { extra, badEdge: end - 1, firstCell: calls[0]! }
        break
      }
    }
  }
  expect(selected).not.toBeNull()
  const js = createPreflightSolver(false)
  const native = createPreflightSolver(true)
  warmPreflightSolver(js)
  warmPreflightSolver(native)
  for (let i = 0; i < selected!.extra; i++) {
    js.step()
    native.step()
  }
  expect(native.nativeSearchActive).toBe(true)
  const before = native.nativeSearchSteps
  const events: number[][] = [[], []]
  const solvers = [js, native]
  for (let i = 0; i < solvers.length; i++) {
    const solver = solvers[i]
    setRawNaNEdge(solver, selected!.badEdge)
    solver.computeH = function (_z: number, cell: number): never {
      events[i]!.push(cell)
      throw new Error("heuristic failed before the later invalid edge")
    }
  }
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
  expect(jsError).toContain("heuristic failed before the later invalid edge")
  expect(nativeError).toBe(jsError)
  expect(events[0]).toEqual([selected!.firstCell])
  expect(events[1]).toEqual(events[0])
  expect(fullPreflightState(native)).toBe(fullPreflightState(js))
  expect(native.nativeSearchActive).toBe(false)
  expect(native.nativeDeclined).toBe(true)
  expect(native.nativeSearchSteps).toBe(before)
})
