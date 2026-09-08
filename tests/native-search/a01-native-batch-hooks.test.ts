import { expect, test } from "bun:test"
import { defaultParams } from "../../lib/default-params"
import { HighDensitySolverA01 } from "../../lib/HighDensitySolverA01/HighDensitySolverA01"
import sample003 from "../dataset01/sample003/sample003.json"

test("batch guards preserve custom methods, progress hooks, accessors and unusual counters", () => {
  const mutations: Array<(s: any) => void> = []
  for (const name of [
    "step",
    "_step",
    "stepOnce",
    "advanceNativeSearch",
    "tryFinalAcceptance",
  ])
    mutations.push((s) => {
      const original = s[name]
      s[name] = function (...args: any[]) {
        return original.apply(this, args)
      }
    })
  mutations.push((s) => {
    s.computeProgress = () => 0.123
  })
  for (const name of [
    "iterations",
    "MAX_ITERATIONS",
    "stepMultiplier",
    "searchBudgetIters",
    "cellSizeMm",
    "hyperParameters",
  ])
    mutations.push((s) => {
      const value = s[name]
      Object.defineProperty(s, name, {
        get() {
          s.reads++
          return value
        },
      })
    })
  for (const name of ["viaBaseCost", "ripCost", "greedyMultiplier"])
    mutations.push((s) => {
      const value = s.hyperParameters[name]
      Object.defineProperty(s.hyperParameters, name, {
        get() {
          s.reads++
          return value
        },
      })
    })
  mutations.push(
    (s) => {
      s.stepMultiplier = 2
    },
    (s) => {
      s.MAX_ITERATIONS = Infinity
    },
    (s) => {
      s.searchIterations = NaN
    },
  )
  for (const mutate of mutations) {
    const solver: any = new HighDensitySolverA01({
      ...defaultParams,
      nodeWithPortPoints: structuredClone(sample003),
      useNativeSearch: true,
    })
    solver.step()
    expect(solver.nativeSearchActive).toBe(true)
    solver.reads = 0
    mutate(solver)
    const steps = solver.nativeSearchSteps
    expect(solver.stepNativeBatch(100)).toBe(0)
    expect(solver.nativeSearchSteps).toBe(steps)
    expect(solver.reads).toBe(0)
  }
})
