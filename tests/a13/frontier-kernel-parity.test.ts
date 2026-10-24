import { expect, test } from "bun:test"
import { JavascriptSearchKernel } from "../../lib/HighDensitySolverA13/search/JavascriptSearchKernel"
import type { SearchInputs } from "../../lib/HighDensitySolverA13/search/SearchInputs"
import { FrozenVersionedSearchKernel } from "../fixtures/FrozenVersionedSearchKernel"

function makeInputs(
  cols: number,
  rows: number,
  layers: number,
  seed: number,
): SearchInputs {
  const plane = cols * rows
  const states = plane * layers
  const inputs: SearchInputs = {
    traceCost: new Uint16Array(states),
    viaCost: new Uint16Array(plane),
    fixed: new Uint8Array(states),
    fixedVia: new Uint8Array(plane),
    history: new Float64Array(states),
    viaHistory: new Float64Array(plane),
    heuristicCost: new Float64Array(states),
    viaAllowed: new Uint8Array(plane),
  }
  let random = seed
  for (let i = 0; i < states; i++) {
    random = (Math.imul(random, 1664525) + 1013904223) >>> 0
    inputs.traceCost[i] = random % 11
    inputs.fixed[i] = Number(random % 19 === 0)
    inputs.history[i] = (random % 31) / 10
    inputs.heuristicCost[i] = (random % 17) / 4
    if (i < plane) {
      inputs.viaCost[i] = random % 7
      inputs.fixedVia[i] = Number(random % 23 === 0)
      inputs.viaHistory[i] = (random % 13) / 10
      inputs.viaAllowed[i] = Number(random % 5 !== 0)
    }
  }
  return inputs
}

test("A13 frontier positions preserve every kernel chunk, parent and heap priority through resets and growth", (): void => {
  for (let seed = 1; seed <= 32; seed++) {
    const cols = 1 + (seed % 13)
    const rows = 1 + (seed % 7)
    const layers = 1 + (seed % 4)
    const states = cols * rows * layers
    const actual = new JavascriptSearchKernel(cols, rows, layers, 0.1, 0.15)
    const reference = new FrozenVersionedSearchKernel(
      cols,
      rows,
      layers,
      0.1,
      0.15,
    )
    const actualParents = new Int32Array(states)
    const referenceParents = new Int32Array(states)
    for (let reset = 0; reset < 4; reset++) {
      const inputs = makeInputs(cols, rows, layers, seed + reset * 100)
      if (reset === 1) inputs.heuristicCost.fill(seed % 2 ? 0 : -0)
      if (reset === 2) inputs.heuristicCost.fill(NaN)
      if (reset === 3) inputs.heuristicCost.fill(Infinity)
      const start = (seed + reset * 11) % states
      const goal = (states - 1 - reset * 7 + states * 10) % states
      actual.begin(inputs, start, goal, 0.5 + reset)
      reference.begin(inputs, start, goal, 0.5 + reset)
      let totalExpansions = 0
      for (let chunk = 0; chunk < 200 && totalExpansions < 2_000; chunk++) {
        const steps = [0, 0.1, 1, 7.5, 32, 1_000][chunk % 6]!
        const budget = [0, 0.5, 1, 13.5, 10_000][chunk % 5]!
        const expected = reference.run(steps, budget)
        const result = actual.run(steps, budget)
        expect(result).toEqual(expected)
        actual.copyParents(actualParents)
        reference.copyParents(referenceParents)
        expect(actualParents).toEqual(referenceParents)
        totalExpansions += result.expansions
        if (result.status === 1 || result.status === 2) break
      }
    }
  }

  // NaN history is accepted by the kernel API and keeps improving states. A
  // fixed wall makes the goal unreachable, forcing stale pops and heap growth.
  const cols = 64
  const rows = 16
  const layers = 4
  const states = cols * rows * layers
  const inputs = makeInputs(cols, rows, layers, 17)
  inputs.fixed.fill(0)
  inputs.fixedVia.fill(0)
  inputs.viaAllowed.fill(1)
  inputs.history.fill(NaN)
  inputs.viaHistory.fill(NaN)
  inputs.heuristicCost.fill(NaN)
  for (let z = 0; z < layers; z++) {
    for (let row = 0; row < rows; row++) {
      inputs.fixed[z * cols * rows + row * cols + 32] = 1
    }
  }
  const priorities: Float64Array[][] = [[], []]
  const allocations: number[][] = [[], []]
  const OriginalFloat64Array = Float64Array
  const constructors = [FrozenVersionedSearchKernel, JavascriptSearchKernel]
  const results: Array<
    Array<{ status: number; expansions: number; parents: number[] }>
  > = []
  for (const [index, Kernel] of constructors.entries()) {
    const originals = new Map<string, any>()
    try {
      for (const name of [
        "Float64Array",
        "Int32Array",
        "Uint32Array",
        "Uint8Array",
      ]) {
        const Original = (globalThis as any)[name]
        originals.set(name, Original)
        ;(globalThis as any)[name] = new Proxy(Original, {
          construct(target, args) {
            const array = Reflect.construct(target, args) as
              | Float64Array
              | Int32Array
              | Uint32Array
              | Uint8Array
            allocations[index]!.push(array.byteLength)
            if (name === "Float64Array") {
              priorities[index]!.push(array as Float64Array)
            }
            return array
          },
        })
      }
      const kernel = new Kernel(cols, rows, layers, 0.1, 0.15)
      kernel.begin(inputs, 0, states - 1, 0.5)
      const parents = new Int32Array(states)
      const chunks = []
      let expansions = 0
      for (let chunk = 0; chunk < 500 && expansions < 3_000; chunk++) {
        const result = kernel.run([1, 7.5, 256][chunk % 3]!, 3_000 - expansions)
        kernel.copyParents(parents)
        chunks.push({ ...result, parents: Array.from(parents) })
        expansions += result.expansions
        if (result.status === 1 || result.status === 2) break
      }
      expect(expansions).toBe(3_000)
      results.push(chunks)
    } finally {
      for (const [name, Original] of originals)
        (globalThis as any)[name] = Original
    }
  }
  expect(Float64Array).toBe(OriginalFloat64Array)
  expect(results[1]).toEqual(results[0])
  const referenceHeaps = priorities[0]!.slice(1)
  const actualHeaps = priorities[1]!.slice(1)
  expect(actualHeaps.map((heap) => heap.length)).toEqual(
    referenceHeaps.map((heap) => heap.length),
  )
  expect(actualHeaps.at(-1)!.length).toBeGreaterThan(1_024)
  for (let growth = 0; growth < actualHeaps.length; growth++) {
    const actual = actualHeaps[growth]!
    const reference = referenceHeaps[growth]!
    for (let i = 0; i < actual.length; i++) {
      if (!Object.is(actual[i], reference[i]))
        throw new Error(`Heap priority differs after growth ${growth} at ${i}`)
    }
  }
  const allocated = allocations.map((sizes) =>
    sizes.reduce((sum, size) => sum + size, 0),
  )
  const removedVersionBytes = referenceHeaps.reduce(
    (sum, heap) => sum + heap.length * 4,
    0,
  )
  expect(allocated[0]! - allocated[1]!).toBe(removedVersionBytes)
})
