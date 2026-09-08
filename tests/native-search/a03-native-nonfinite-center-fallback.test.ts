import { expect, test } from "bun:test"
import { HighDensitySolverA03 } from "../../lib/HighDensitySolverA03/HighDensitySolverA03"
import { defaultA03Params } from "../../lib/default-params"
import sample003 from "../dataset01/sample003/sample003.json"
const raw = (value: Float64Array): number[] =>
  Array.from(new Uint32Array(value.buffer, value.byteOffset, value.length * 2))
const create = (native: boolean): any =>
  new HighDensitySolverA03({
    ...defaultA03Params,
    nodeWithPortPoints: structuredClone(sample003),
    useNativeSearch: native,
  })
const state = (s: any): string =>
  JSON.stringify({
    iterations: s.iterations,
    solved: s.solved,
    failed: s.failed,
    error: s.error,
    search: s.searchIterations,
    open: s.openSet,
    output: s.getOutput(),
  })
test("native rejects nonfinite public centers before initial or live pop and preserves original JavaScript raw backing", () => {
  for (const warm of [0, 20])
    for (const bits of [
      0x7ff8000000000001n,
      0xfff0000000000123n,
      0x7ff0000000000000n,
      0xfff0000000000000n,
    ]) {
      const js = create(false),
        native = create(true)
      js.setup()
      native.setup()
      for (let i = 0; i < warm; i++) {
        js.step()
        native.step()
      }
      const count = native.nativeSearchSteps
      if (warm) expect(count).toBeGreaterThan(0)
      for (const s of [js, native])
        new BigUint64Array(
          s.cellCenterX.buffer,
          s.cellCenterX.byteOffset,
          s.cellCenterX.length,
        ).fill(bits)
      for (let i = 0; i < 30 && !js.solved && !js.failed; i++) {
        js.step()
        native.step()
        expect(state(native)).toBe(state(js))
        expect(native.nativeSearchActive).toBe(false)
        expect(native.nativeDeclined).toBe(true)
        expect(native.nativeSearchSteps).toBe(count)
        expect(raw(native.heap.f)).toEqual(raw(js.heap.f))
        expect(raw(native.nodePool.g)).toEqual(raw(js.nodePool.g))
        expect(raw(native.bestGValue)).toEqual(raw(js.bestGValue))
      }
    }
})
