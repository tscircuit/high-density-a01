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
const state = (s: any): string =>
  JSON.stringify({
    iterations: s.iterations,
    solved: s.solved,
    failed: s.failed,
    error: s.error,
    search: s.searchIterations,
    open: s.openSet,
    output: s.getOutput(),
    calls: s.testCalls,
  })
test("native A03 declines initial custom hooks without extra reads and never joins an existing JavaScript search history", () => {
  for (const key of [
    "computeH",
    "computeMoveCostAndRips",
    "getViaOccupants",
    "getLayerOccupants",
    "fillTraceOccupants",
    "getSearchStateIdx",
    "getViaFootprint",
    "forEachCellNearCircle",
    "cellIdFor",
  ]) {
    const js = create(false),
      native = create(true)
    for (const s of [js, native]) {
      const original = s[key]
      s.testCalls = 0
      Object.defineProperty(s, key, {
        get() {
          s.testCalls++
          return original
        },
        configurable: true,
      })
    }
    for (let i = 0; i < 15; i++) {
      js.step()
      native.step()
      expect(state(native)).toBe(state(js))
    }
    expect(native.nativeSearchSteps).toBe(0)
    expect(native.nativeDeclined).toBe(true)
    delete js[key]
    delete native[key]
    for (let i = 0; i < 200; i++) {
      js.step()
      native.step()
      expect(state(native)).toBe(state(js))
    }
    expect(native.nativeSearchSteps).toBe(0)
  }
  for (const key of ["ripCost", "viaBaseCost", "greedyMultiplier"]) {
    const js = create(false),
      native = create(true)
    for (const s of [js, native]) {
      s.testCalls = 0
      const value = s.hyperParameters[key]
      Object.defineProperty(s.hyperParameters, key, {
        get() {
          s.testCalls++
          return value
        },
        configurable: true,
      })
    }
    for (let i = 0; i < 100; i++) {
      js.step()
      native.step()
      expect(state(native)).toBe(state(js))
    }
    expect(native.nativeSearchSteps).toBe(0)
  }
  const prototype = HighDensitySolverA03.prototype as any
  const original = prototype.computeMoveCostAndRips
  prototype.computeMoveCostAndRips = function (...args: unknown[]): unknown {
    this.testCalls = (this.testCalls ?? 0) + 1
    return Reflect.apply(original, this, args)
  }
  try {
    const js = create(false),
      native = create(true)
    for (let i = 0; i < 100; i++) {
      js.step()
      native.step()
      expect(state(native)).toBe(state(js))
    }
    expect(native.nativeSearchSteps).toBe(0)
    expect(native.nativeDeclined).toBe(true)
  } finally {
    prototype.computeMoveCostAndRips = original
  }
  const ordinary = new HighDensitySolverA03({
    ...defaultA03Params,
    nodeWithPortPoints: structuredClone(sample003),
  })
  for (let i = 0; i < 100; i++) ordinary.step()
  expect(ordinary.useNativeSearch).toBe(false)
  expect(ordinary.nativeSearchSteps).toBe(0)
})
