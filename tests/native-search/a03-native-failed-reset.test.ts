import { expect, test } from "bun:test"
import { HighDensitySolverA03 } from "../../lib/HighDensitySolverA03/HighDensitySolverA03"
import { defaultA03Params } from "../../lib/default-params"
import sample003 from "../dataset01/sample003/sample003.json"

test("an early-rejected setup preserves the existing native heap and search state", () => {
  const create = (native: boolean): any =>
    new HighDensitySolverA03({
      ...defaultA03Params,
      nodeWithPortPoints: structuredClone(sample003),
      useNativeSearch: native,
    })
  const js = create(false),
    native = create(true)
  for (let i = 0; i < 100; i++) {
    js.step()
    native.step()
  }
  expect(native.nativeSearchActive).toBe(true)
  const heap = native.heap
  for (const s of [js, native]) {
    s.lowResolutionCellSize = 0
    s._setup()
  }
  expect(native.failed).toBe(js.failed)
  expect(native.error).toBe(js.error)
  expect(native.openSet).toEqual(js.openSet)
  expect(native.heap).toBe(heap)
  expect(native.heap.f).toEqual(js.heap.f)
  expect(native.heap.id).toEqual(js.heap.id)
  expect(native.nodePool.g).toEqual(js.nodePool.g)
  expect(native.nodePool.cellId).toEqual(js.nodePool.cellId)
  expect(native.activeConnection).toEqual(js.activeConnection)
  expect(native.getOutput()).toEqual(js.getOutput())
  expect(native.nativeSearchActive).toBe(false)
  expect(native.nativeSearchSteps).toBe(0)
})
