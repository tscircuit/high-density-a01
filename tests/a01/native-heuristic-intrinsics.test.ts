import { expect, test } from "bun:test"
import { HighDensitySolverA01 } from "../../lib/HighDensitySolverA01/HighDensitySolverA01"
import { viaOccupantCacheNode } from "../fixtures/via-occupant-cache-node"

test("cache eligibility does not invoke replaced global callbacks", () => {
  const arrayIterator = Object.getPrototypeOf([][Symbol.iterator]())
  const mapIterator = Object.getPrototypeOf(new Map()[Symbol.iterator]())
  const setIterator = Object.getPrototypeOf(new Set()[Symbol.iterator]())
  const sharedIterator = Object.getPrototypeOf(arrayIterator)
  const typedArrayPrototype = Object.getPrototypeOf(Uint32Array.prototype)
  const cases: Array<{ owner: object; key: PropertyKey; value?: unknown }> = [
    { owner: globalThis, key: "Math", value: Math },
    { owner: globalThis, key: "Array", value: Array },
    { owner: globalThis, key: "Map", value: Map },
    { owner: globalThis, key: "Set", value: Set },
    { owner: Array.prototype, key: "constructor", value: Array },
    { owner: Array, key: Symbol.species, value: Array },
    { owner: arrayIterator, key: "next" },
    { owner: mapIterator, key: "next" },
    { owner: setIterator, key: "next" },
    { owner: arrayIterator, key: "return" },
    { owner: sharedIterator, key: "return" },
    { owner: Object.prototype, key: "return" },
    { owner: Object.prototype, key: "value" },
    { owner: Object.prototype, key: "-1" },
    { owner: Array.prototype, key: "-1" },
    { owner: Uint32Array.prototype, key: "length" },
    { owner: Float64Array.prototype, key: "length" },
    { owner: typedArrayPrototype, key: "length" },
    { owner: typedArrayPrototype, key: "fill" },
  ]
  for (const entry of cases) {
    const solver: any = new HighDensitySolverA01({
      nodeWithPortPoints: structuredClone(viaOccupantCacheNode),
      cellSizeMm: 0.1,
      stepMultiplier: 1000,
      viaDiameter: 0.3,
    })
    solver.setup()
    expect(solver.getHeuristicCacheForStep()).toBeDefined()
    const original = Object.getOwnPropertyDescriptor(entry.owner, entry.key)
    let calls = 0
    let incorrectlyEligible = false
    try {
      Object.defineProperty(entry.owner, entry.key, {
        configurable: true,
        get() {
          calls++
          solver.hyperParameters.viaBaseCost += 1
          return entry.value
        },
      })
      incorrectlyEligible = solver.getHeuristicCacheForStep() !== undefined
    } finally {
      if (original) Object.defineProperty(entry.owner, entry.key, original)
      else Reflect.deleteProperty(entry.owner, entry.key)
    }
    expect(incorrectlyEligible).toBeFalse()
    expect(calls).toBe(0)
    expect(solver.heuristicCache).toBeUndefined()
  }

  const solver: any = new HighDensitySolverA01({
    nodeWithPortPoints: structuredClone(viaOccupantCacheNode),
    cellSizeMm: 0.1,
    stepMultiplier: 1000,
    viaDiameter: 0.3,
  })
  solver.setup()
  const originalParent = Object.getPrototypeOf(Array.prototype)
  try {
    Object.setPrototypeOf(Array.prototype, Object.create(originalParent))
    expect(solver.getHeuristicCacheForStep()).toBeUndefined()
  } finally {
    Object.setPrototypeOf(Array.prototype, originalParent)
  }
  for (const prototype of [Uint32Array.prototype, Float64Array.prototype]) {
    const parent = Object.getPrototypeOf(prototype)
    try {
      Object.setPrototypeOf(prototype, Object.create(parent))
      expect(solver.getHeuristicCacheForStep()).toBeUndefined()
    } finally {
      Object.setPrototypeOf(prototype, parent)
    }
  }
  let coercions = 0
  solver.iterations = { valueOf() { coercions++; return 0 } }
  expect(solver.getHeuristicCacheForStep()).toBeUndefined()
  expect(coercions).toBe(0)
})
