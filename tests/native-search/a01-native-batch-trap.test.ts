import { expect, test } from "bun:test"
import { defaultParams } from "../../lib/default-params"
import { HighDensitySolverA01 } from "../../lib/HighDensitySolverA01/HighDensitySolverA01"
import sample003 from "../dataset01/sample003/sample003.json"

test("a trap after three completed batch pops preserves increment-before-throw counters and prior heap view", () => {
  const trap = new WebAssembly.Instance(
    new WebAssembly.Module(
      new Uint8Array([
        0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 3, 2, 1, 0, 7, 8, 1, 4,
        116, 114, 97, 112, 0, 0, 10, 5, 1, 3, 0, 0, 11,
      ]),
    ),
  ).exports.trap as () => never
  const make = () =>
    new HighDensitySolverA01({
      ...defaultParams,
      nodeWithPortPoints: structuredClone(sample003),
      useNativeSearch: true,
    })
  const single = make(),
    batch = make()
  single.step()
  batch.step()
  const singleKernel = (single as any).nativeSearchKernel
  const batchKernel = (batch as any).nativeSearchKernel
  const singleExports = singleKernel.exports,
    batchExports = batchKernel.exports
  let attempts = 0
  singleKernel.exports = {
    ...singleExports,
    kernel_advance(...args: number[]) {
      const status = singleExports.kernel_advance(...args)
      if (++attempts === 4) trap()
      return status
    },
  }
  // Rust unit coverage tests the actual publication order on a kernel panic.
  // This bridge control mutates real kernel state, then throws a real WASM trap
  // before publishing the last attempt, exercising the TypeScript catch path.
  batchKernel.exports = {
    ...batchExports,
    kernel_advance_many(limit: number, ...args: number[]) {
      for (let i = 0; i < limit; i++) {
        let state = new Uint32Array(
          batchExports.memory.buffer,
          batchExports.kernel_pointer(8),
          5,
        )
        const previousHeap = state[0]!
        state[3] = i + 1
        expect(batchExports.kernel_advance(...args)).toBe(0)
        state = new Uint32Array(
          batchExports.memory.buffer,
          batchExports.kernel_pointer(8),
          5,
        )
        if (i === 3) {
          state[0] = previousHeap
          trap()
        }
        state[4] = i + 1
      }
      return limit
    },
  }
  expect(() => {
    for (let i = 0; i < 100; i++) single.step()
  }).toThrow()
  expect(() => batch.stepNativeBatch(100)).toThrow()
  const snapshot = (s: HighDensitySolverA01) => ({
    iterations: s.iterations,
    searchIterations: (s as any).searchIterations,
    nativeSteps: s.nativeSearchSteps,
    openSet: s.openSet,
    active: s.activeConnection,
    failed: s.failed,
    solved: s.solved,
    error: s.error,
    output: s.getOutput(),
  })
  expect(snapshot(batch)).toEqual(snapshot(single))
  expect(batch.nativeSearchSteps).toBe(3)
  expect(batch.nativeSearchBatchedSteps).toBe(3)
  expect(batch.iterations).toBe(5)
  expect(batch.visualize()).toEqual(single.visualize())
})
