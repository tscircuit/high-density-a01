import { expect, test } from "bun:test"
import { isDeepStrictEqual } from "node:util"
import { HighDensitySolverA01 } from "../../lib/HighDensitySolverA01/HighDensitySolverA01"
import { FrozenHighDensitySolverA01 } from "../fixtures/frozen-a01-object-node-pool-solver"
import { viaOccupantCacheNode } from "../fixtures/via-occupant-cache-node"

function originalState(solver: any): Record<string, unknown> {
  const state: Record<string, unknown> = {}
  for (const name of Object.getOwnPropertyNames(solver)) {
    if (name === "heuristicCache") continue
    const descriptor = Object.getOwnPropertyDescriptor(solver, name)!
    if (!("value" in descriptor)) continue
    state[name] = name === "heap" ? { ...descriptor.value } : descriptor.value
  }
  state.output = solver.getOutput()
  state.activeConnection = solver.activeConnection
  state.openSet = solver.openSet
  return state
}

test("heuristic caching preserves public mutations, accessors, hooks and global dispatch", () => {
  const props = {
    nodeWithPortPoints: viaOccupantCacheNode,
    cellSizeMm: 0.1,
    traceThickness: 0.1,
    traceMargin: 0.1,
    viaDiameter: 0.3,
    stepMultiplier: 1000,
    hyperParameters: { shuffleSeed: 1 },
  }
  const actual: any = new HighDensitySolverA01(structuredClone(props))
  const reference: any = new FrozenHighDensitySolverA01(structuredClone(props))
  actual.setup()
  reference.setup()
  let eligibleSteps = 0
  for (let index = 0; index < 30 && !reference.solved && !reference.failed; index++) {
    const cellSize = [0.1, 0.095, 0.12][index % 3]!
    actual.cellSizeMm = cellSize
    reference.cellSizeMm = cellSize
    actual.hyperParameters.viaBaseCost = reference.hyperParameters.viaBaseCost = (index % 4) / 10
    actual.hyperParameters.greedyMultiplier = reference.hyperParameters.greedyMultiplier = 1 + (index % 5) / 10
    actual.stepMultiplier = reference.stepMultiplier = 1000 + (index % 7)
    actual.step()
    reference.step()
    if (actual.heuristicCache) eligibleSteps++
    expect(isDeepStrictEqual(originalState(actual), originalState(reference))).toBeTrue()
  }
  expect(eligibleSteps).toBeGreaterThan(0)

  class HookedA01 extends HighDensitySolverA01 {
    hookCalls = 0
    protected override getRipCost(id: number): number {
      this.hookCalls++
      this.hyperParameters.viaBaseCost = 0.2 + this.hookCalls / 1000
      return super.getRipCost(id)
    }
  }
  class HookedReference extends FrozenHighDensitySolverA01 {
    hookCalls = 0
    protected override getRipCost(id: number): number {
      this.hookCalls++
      this.hyperParameters.viaBaseCost = 0.2 + this.hookCalls / 1000
      return super.getRipCost(id)
    }
  }
  const hooked: any = new HookedA01(structuredClone(props))
  const hookedReference: any = new HookedReference(structuredClone(props))
  for (let index = 0; index < 5 && !hookedReference.solved && !hookedReference.failed; index++) {
    hooked.step()
    hookedReference.step()
    expect(isDeepStrictEqual(originalState(hooked), originalState(hookedReference))).toBeTrue()
    expect(hooked.heuristicCache).toBeUndefined()
  }
  expect(hooked.hookCalls).toBeGreaterThan(0)

  const getterActual: any = new HighDensitySolverA01(structuredClone(props))
  const getterReference: any = new FrozenHighDensitySolverA01(structuredClone(props))
  getterActual.setup()
  getterReference.setup()
  const actualReads: string[] = []
  const referenceReads: string[] = []
  for (const [solver, reads] of [[getterActual, actualReads], [getterReference, referenceReads]] as const) {
    Object.defineProperty(solver, "cellSizeMm", {
      configurable: true,
      get() {
        reads.push("cellSizeMm")
        solver.hyperParameters.viaBaseCost = 0.2 + reads.length / 1000
        return 0.1
      },
    })
    Object.defineProperty(solver.hyperParameters, "ripTracePenalty", {
      configurable: true,
      get() {
        reads.push("ripTracePenalty")
        solver.hyperParameters.viaBaseCost = 0.3 + reads.length / 1000
        return 0.5
      },
    })
  }
  expect(getterActual.getHeuristicCacheForStep()).toBeUndefined()
  expect(actualReads).toHaveLength(0)
  for (let index = 0; index < 2 && !getterReference.solved && !getterReference.failed; index++) {
    getterActual.step()
    getterReference.step()
    expect(actualReads).toEqual(referenceReads)
    expect(getterActual.getOutput()).toEqual(getterReference.getOutput())
    expect(getterActual.iterations).toBe(getterReference.iterations)
    expect(getterActual.seqCounter).toBe(getterReference.seqCounter)
    expect(getterActual.ripCount).toEqual(getterReference.ripCount)
    expect(getterActual.heuristicCache).toBeUndefined()
  }
  expect(actualReads.length).toBeGreaterThan(0)

  const coercionActual: any = new HighDensitySolverA01(structuredClone(props))
  const coercionReference: any = new FrozenHighDensitySolverA01(structuredClone(props))
  coercionActual.setup()
  coercionReference.setup()
  const coercionCalls = [0, 0]
  for (const [index, solver] of [coercionActual, coercionReference].entries()) {
    solver.ripHistoryCostMultiplier = {
      valueOf() {
        coercionCalls[index] = coercionCalls[index]! + 1
        solver.hyperParameters.viaBaseCost = 0.2 + coercionCalls[index]! / 1000
        return 0
      },
    }
  }
  expect(coercionActual.getHeuristicCacheForStep()).toBeUndefined()
  expect(coercionCalls).toEqual([0, 0])
  for (let index = 0; index < 5 && !coercionReference.solved && !coercionReference.failed; index++) {
    coercionActual.step()
    coercionReference.step()
    const actualState = originalState(coercionActual)
    const referenceState = originalState(coercionReference)
    delete actualState.ripHistoryCostMultiplier
    delete referenceState.ripHistoryCostMultiplier
    expect(isDeepStrictEqual(actualState, referenceState)).toBeTrue()
    expect(coercionCalls[0]).toBe(coercionCalls[1])
    expect(coercionActual.heuristicCache).toBeUndefined()
  }
  expect(coercionCalls[0]).toBeGreaterThan(0)

  const helperGetterActual: any = new HighDensitySolverA01(structuredClone(props))
  const helperGetterReference: any = new FrozenHighDensitySolverA01(structuredClone(props))
  helperGetterActual.setup()
  helperGetterReference.setup()
  let helperGetterCalls = 0
  Object.defineProperty(helperGetterActual, "releaseHeuristicCache", {
    configurable: true,
    get() {
      helperGetterCalls++
      throw new Error("the fallback must not invoke a newly installed helper accessor")
    },
  })
  helperGetterActual.step()
  helperGetterReference.step()
  expect(helperGetterCalls).toBe(0)
  expect(isDeepStrictEqual(originalState(helperGetterActual), originalState(helperGetterReference))).toBeTrue()

  const globalsActual: any = new HighDensitySolverA01(structuredClone(props))
  const globalsReference: any = new FrozenHighDensitySolverA01(structuredClone(props))
  globalsActual.setup()
  globalsReference.setup()
  globalsActual.stepMultiplier = globalsReference.stepMultiplier = 1000
  globalsActual.step()
  globalsReference.step()
  const nativeAbs = Math.abs
  const nativeIterator = Array.prototype[Symbol.iterator]
  let absCalls = 0
  let iteratorCalls = 0
  try {
    Math.abs = (value: number): number => {
      absCalls++
      return nativeAbs(value)
    }
    Array.prototype[Symbol.iterator] = function patchedIterator(): ArrayIterator<any> {
      iteratorCalls++
      return nativeIterator.call(this)
    }
    expect(globalsActual.getHeuristicCacheForStep()).toBeUndefined()
    expect(absCalls).toBe(0)
    expect(iteratorCalls).toBe(0)
    globalsActual.step()
    const actualAbsCalls = absCalls
    const actualIteratorCalls = iteratorCalls
    globalsReference.step()
    expect(absCalls).toBe(actualAbsCalls * 2)
    expect(iteratorCalls).toBe(actualIteratorCalls * 2)
  } finally {
    Math.abs = nativeAbs
    Array.prototype[Symbol.iterator] = nativeIterator
  }
  expect(isDeepStrictEqual(originalState(globalsActual), originalState(globalsReference))).toBeTrue()
})
