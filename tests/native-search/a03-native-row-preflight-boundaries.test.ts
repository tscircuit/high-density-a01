import { expect, test } from "bun:test"
import {
  createPreflightSolver,
  fullPreflightState,
  warmPreflightSolver,
} from "./a03-native-preflight-helpers"

test("guarded native goal, empty and visited duplicate boundaries ignore graph rows the original pop never reads", () => {
  for (const kind of ["goal", "duplicate"] as const) {
    const js = createPreflightSolver(false)
    const native = createPreflightSolver(true)
    warmPreflightSolver(js)
    warmPreflightSolver(native)
    let found = false
    for (let i = 0; i < 10000 && !js.solved && !js.failed; i++) {
      if (js.activeConnSeg && js.heap.n) {
        const id = js.heap.id[0]
        const cell = js.nodePool.cellId[id]
        const z = js.nodePool.z[id]
        const visited = js.visitedStamp[z * js.planeSize + cell] === js.stamp
        const goal =
          z === js.activeConnSeg.endZ && cell === js.activeConnSeg.endCellId
        if (
          (kind === "goal" && goal && !visited) ||
          (kind === "duplicate" && visited)
        ) {
          found = true
          break
        }
      }
      js.step()
      native.step()
    }
    expect(found).toBe(true)
    expect(native.nativeSearchActive).toBe(true)
    for (const solver of [js, native]) solver.neighborCosts.fill(NaN)
    const before = native.nativeSearchSteps
    if (kind === "goal") {
      expect(native.stepNativeBatch(100)).toBe(0)
      expect(native.nativeSearchActive).toBe(true)
      expect(native.nativeSearchSteps).toBe(before)
      expect(fullPreflightState(native)).toBe(fullPreflightState(js))
      js.step()
      native.step()
      expect(native.nativeSearchActive).toBe(false)
    } else {
      expect(native.stepNativeBatch(1)).toBe(1)
      js.step()
      expect(native.nativeSearchActive).toBe(true)
    }
    expect(native.nativeSearchSteps).toBe(before + 1)
    expect(native.nativeDeclined).toBe(false)
    expect(fullPreflightState(native)).toBe(fullPreflightState(js))
  }
  const js = createPreflightSolver(false)
  const native = createPreflightSolver(true)
  for (const solver of [js, native]) {
    solver.setup()
    solver.step()
    // Live empty rows are valid for the next expansion. The original JS only
    // reads that row; its globally stale final CSR offset is never accessed.
    solver.neighborOffset.fill(0)
    solver.viaAllowed.fill(0)
  }
  expect(native.nativeSearchActive).toBe(true)
  js.step()
  native.step()
  expect(native.nativeSearchActive).toBe(true)
  expect(native.openSet.length).toBe(0)
  expect(fullPreflightState(native)).toBe(fullPreflightState(js))
  for (const solver of [js, native]) solver.neighborCosts.fill(NaN)
  const before = native.nativeSearchSteps
  expect(native.stepNativeBatch(100)).toBe(0)
  expect(native.nativeSearchSteps).toBe(before)
  expect(native.nativeSearchActive).toBe(true)
  js.step()
  native.step()
  expect(native.failed).toBe(true)
  expect(native.nativeSearchActive).toBe(false)
  expect(native.nativeDeclined).toBe(false)
  expect(native.nativeSearchSteps).toBe(before + 1)
  expect(fullPreflightState(native)).toBe(fullPreflightState(js))
})
