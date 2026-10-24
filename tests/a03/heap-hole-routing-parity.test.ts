import { expect, test } from "bun:test"
import {
  HighDensitySolverA03,
  type HighDensitySolverA03Props,
} from "../../lib/HighDensitySolverA03/HighDensitySolverA03"
import bugreport107 from "../fixtures/bugreport107-cmn21-a03.json" with {
  type: "json",
}
import { SwapTypedMinHeap } from "../fixtures/SwapTypedMinHeap"
import { viaOccupantCacheNode } from "../fixtures/via-occupant-cache-node"
import sample002 from "../dataset01/sample002/sample002.json" with {
  type: "json",
}

test("A03 hole sifts preserve real routing pops, iterations, rips and copper", (): void => {
  const configurations: HighDensitySolverA03Props[] = [
    {
      nodeWithPortPoints: viaOccupantCacheNode,
      traceThickness: 0.1,
      traceMargin: 0.1,
      viaDiameter: 0.3,
    },
    bugreport107 as HighDensitySolverA03Props,
    { nodeWithPortPoints: sample002, viaDiameter: 0.3, maxCellCount: 200_000 },
  ]
  let comparedPops = 0
  let ripEvents = 0
  for (const config of configurations) {
    for (const shuffleSeed of [0, 1, 17]) {
      const props = {
        ...config,
        stepMultiplier: shuffleSeed === 1 ? 37 : 1,
        hyperParameters: { ...config.hyperParameters, shuffleSeed },
      }
      const actual = new HighDensitySolverA03(structuredClone(props))
      const reference = new HighDensitySolverA03(structuredClone(props))
      actual.setup()
      reference.setup()
      reference["heap"] =
        new SwapTypedMinHeap() as unknown as HighDensitySolverA03["heap"]
      const pops: number[][] = [[], []]
      for (const [index, solver] of [actual, reference].entries()) {
        const heap = solver["heap"]
        const pop = heap.pop.bind(heap)
        heap.pop = (): number => {
          const id = pop()
          pops[index]!.push(id)
          return id
        }
        solver.solve()
      }
      expect(actual.solved).toBe(true)
      expect(actual.failed).toBe(reference.failed)
      expect(actual.error).toBe(reference.error)
      expect(actual.iterations).toBe(reference.iterations)
      expect(pops[0]).toEqual(pops[1])
      expect(actual.getOutput()).toEqual(reference.getOutput())
      expect(actual["totalRipEvents"]).toBe(reference["totalRipEvents"])
      expect(actual["penalty2d"]).toEqual(reference["penalty2d"])
      expect(actual["usedCellsFlat"]).toEqual(reference["usedCellsFlat"])
      expect(actual["sharedCellsFlat"]).toEqual(reference["sharedCellsFlat"])
      expect(actual["ripCount"]).toEqual(reference["ripCount"])
      comparedPops += pops[0]!.length
      ripEvents += actual["totalRipEvents"]
    }
  }
  expect(comparedPops).toBeGreaterThan(1_000)
  expect(ripEvents).toBeGreaterThan(0)
})
