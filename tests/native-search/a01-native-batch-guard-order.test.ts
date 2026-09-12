import { expect, test } from "bun:test"
import { defaultParams } from "../../lib/default-params"
import { HighDensitySolverA01 } from "../../lib/HighDensitySolverA01/HighDensitySolverA01"
import sample003 from "../dataset01/sample003/sample003.json"
import { frozenStepNativeBatch } from "./a01-batch-guard-reference"

test("hoisted guards retain the frozen descriptor/value access order and fallback decisions", () => {
  for (const scenario of [
    "native",
    "invalid-counter",
    "descriptor-getter",
    "custom-method",
    "cost-getter",
  ] as const) {
    const run = (frozen: boolean): unknown => {
      const solver = new HighDensitySolverA01({
        ...defaultParams,
        nodeWithPortPoints: structuredClone(sample003),
        useNativeSearch: true,
      })
      solver.step()
      expect(solver.nativeSearchActive).toBe(true)
      const events: string[] = []
      if (scenario === "invalid-counter") (solver as any).searchIterations = NaN
      if (scenario === "descriptor-getter")
        Object.defineProperty(solver, "_setupDone", {
          get(): boolean {
            events.push("unexpected getter")
            return true
          },
        })
      if (scenario === "custom-method")
        solver.step = function (): void {
          throw new Error("custom step must not run")
        }
      if (scenario === "cost-getter")
        Object.defineProperty(solver.hyperParameters, "ripCost", {
          get(): number {
            events.push("unexpected cost getter")
            return 1
          },
        })
      const hp = solver.hyperParameters
      solver.hyperParameters = new Proxy(hp, {
        get(target, key, receiver) {
          events.push(`hp get ${String(key)}`)
          return Reflect.get(target, key, receiver)
        },
        getOwnPropertyDescriptor(target, key) {
          events.push(`hp descriptor ${String(key)}`)
          return Reflect.getOwnPropertyDescriptor(target, key)
        },
        getPrototypeOf(target) {
          events.push("hp prototype")
          return Reflect.getPrototypeOf(target)
        },
      })
      const proxy = new Proxy(solver, {
        get(target, key, receiver) {
          events.push(`get ${String(key)}`)
          return Reflect.get(target, key, receiver)
        },
        getOwnPropertyDescriptor(target, key) {
          events.push(`descriptor ${String(key)}`)
          return Reflect.getOwnPropertyDescriptor(target, key)
        },
        getPrototypeOf(target) {
          events.push("prototype")
          return Reflect.getPrototypeOf(target)
        },
        has(target, key) {
          events.push(`has ${String(key)}`)
          return Reflect.has(target, key)
        },
        set(target, key, value, receiver) {
          events.push(`set ${String(key)}`)
          return Reflect.set(target, key, value, receiver)
        },
      })
      const method = frozen
        ? frozenStepNativeBatch
        : HighDensitySolverA01.prototype.stepNativeBatch
      const consumed = method.call(proxy, 50)
      const accessOrder = [...events]
      expect(accessOrder).not.toContain("unexpected getter")
      expect(accessOrder).not.toContain("unexpected cost getter")
      if (scenario === "native") expect(consumed).toBeGreaterThan(0)
      else expect(consumed).toBe(0)
      const result = {
        consumed,
        accessOrder,
        iterations: solver.iterations,
        nativeSteps: solver.nativeSearchSteps,
        openSet: solver.openSet,
        output: solver.getOutput(),
        visualize: solver.visualize(),
      }
      // Explicitly reset the test owner to release its instance without a solve.
      solver._setup()
      return result
    }
    expect(run(false)).toEqual(run(true))
  }
})
