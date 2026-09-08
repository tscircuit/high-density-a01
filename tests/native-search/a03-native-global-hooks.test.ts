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
    solved: s.solved,
    failed: s.failed,
    error: s.error,
    iterations: s.iterations,
    search: s.searchIterations,
    openSet: s.openSet,
    active: s.activeConnection,
    output: s.getOutput(),
  })

test("native A03 materializes before replaced globals without extra removed callback or getter reads", () => {
  const typed = Object.getPrototypeOf(Uint8Array.prototype)
  const controls: Array<[object, PropertyKey]> = [
    [Math, "hypot"],
    [Math, "min"],
    [Math, "max"],
    [Math, "round"],
    [Number, "isInteger"],
    [Object, "is"],
    [Array.prototype, "push"],
    [Array.prototype, "includes"],
    [Array.prototype, "slice"],
    [Array.prototype, Symbol.iterator],
    [Map.prototype, "get"],
    [Map.prototype, "set"],
    [Map.prototype, "clear"],
    [typed, "set"],
    [typed, "fill"],
    [typed, Symbol.iterator],
    [typed, "length"],
    [typed, "buffer"],
  ]
  for (const [target, key] of controls) {
    const js = create(false),
      native = create(true)
    for (let i = 0; i < 100; i++) {
      js.step()
      native.step()
    }
    expect(native.nativeSearchActive).toBe(true)
    const descriptor = Object.getOwnPropertyDescriptor(target, key)!
    const original = descriptor.value ?? descriptor.get
    let active = 0,
      a = 0,
      b = 0
    const callback = function (this: unknown, ...args: unknown[]): unknown {
      if (active === 1) a++
      if (active === 2) b++
      return Reflect.apply(original, this, args)
    }
    Object.defineProperty(
      target,
      key,
      "value" in descriptor
        ? { ...descriptor, value: callback }
        : { ...descriptor, get: callback },
    )
    let errorA = "",
      errorB = ""
    try {
      active = 1
      try {
        js.step()
      } catch (e) {
        errorA = String(e)
      }
      active = 2
      try {
        native.step()
      } catch (e) {
        errorB = String(e)
      }
    } finally {
      active = 0
      Object.defineProperty(target, key, descriptor)
    }
    expect(errorB).toBe(errorA)
    expect(b).toBe(a)
    expect(state(native)).toBe(state(js))
    expect(native.nativeSearchActive).toBe(false)
    expect(native.nativeDeclined).toBe(true)
  }
})
