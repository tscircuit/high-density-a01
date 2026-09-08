import { expect, test } from "bun:test"
import { HighDensitySolverA03 } from "../../lib/HighDensitySolverA03/HighDensitySolverA03"
import { defaultA03Params } from "../../lib/default-params"
import sample003 from "../dataset01/sample003/sample003.json"
const create = (native: boolean): any =>
  new HighDensitySolverA03({
    ...defaultA03Params,
    nodeWithPortPoints: structuredClone(sample003),
    useNativeSearch: native,
  })
const bits = (array: Float64Array): number[] =>
  Array.from(new Uint32Array(array.buffer, array.byteOffset, array.length * 2))
const state = (s: any): string =>
  JSON.stringify({
    solved: s.solved,
    failed: s.failed,
    error: s.error,
    iterations: s.iterations,
    search: s.searchIterations,
    openSet: s.openSet,
    active: s.activeConnection,
    output: s.getOutput(),
  })
test("raw NaN Float32 edges decline native initially and materialize before a live affected pop", () => {
  for (const warm of [0, 20])
    for (const payload of [0x7fc00001, 0xffc12345, 0x7fa00001]) {
      const js = create(false),
        native = create(true)
      js.setup()
      native.setup()
      for (let i = 0; i < warm; i++) {
        js.step()
        native.step()
        expect(state(native)).toBe(state(js))
      }
      const before = native.nativeSearchSteps
      if (warm) expect(before).toBeGreaterThan(0)
      for (const s of [js, native])
        new Uint32Array(
          s.neighborCosts.buffer,
          s.neighborCosts.byteOffset,
          s.neighborCosts.length,
        ).fill(payload)
      for (let i = 0; i < 50 && !js.solved && !js.failed; i++) {
        js.step()
        native.step()
        expect(state(native)).toBe(state(js))
        expect(native.nativeSearchActive).toBe(false)
        expect(native.nativeDeclined).toBe(true)
        expect(native.nativeSearchSteps).toBe(before)
        expect(native.heap.n).toBe(js.heap.n)
        expect(bits(native.heap.f)).toEqual(bits(js.heap.f))
        expect(native.heap.id).toEqual(js.heap.id)
        expect(native.nodePool.length).toBe(js.nodePool.length)
        expect(bits(native.nodePool.g)).toEqual(bits(js.nodePool.g))
        expect(bits(native.bestGValue)).toEqual(bits(js.bestGValue))
      }
    }
})
