import { expect, test } from "bun:test"
import { HighDensitySolverA03 } from "../../lib/HighDensitySolverA03/HighDensitySolverA03"
import { useFrozenA03ViaOccupants } from "../fixtures/useFrozenA03ViaOccupants"
import { viaOccupantCacheNode } from "../fixtures/via-occupant-cache-node"

test("A03 lifetime geometry caching preserves every routing step and rip", (): void => {
  let comparedSteps = 0
  let observedRips = false
  for (const seed of [0, 1, 5]) {
    const props = {
      nodeWithPortPoints: viaOccupantCacheNode,
      traceThickness: 0.1,
      traceMargin: 0.1,
      viaDiameter: 0.3,
      hyperParameters: { shuffleSeed: seed },
    }
    const actual = new HighDensitySolverA03(structuredClone(props))
    const reference = new HighDensitySolverA03(structuredClone(props))
    actual.setup()
    reference.setup()
    useFrozenA03ViaOccupants(reference)
    while (!reference.solved && !reference.failed) {
      actual.step()
      reference.step()
      comparedSteps++
      expect([actual.solved, actual.failed, actual.error]).toEqual([
        reference.solved,
        reference.failed,
        reference.error,
      ])
      expect(actual.openSet).toEqual(reference.openSet)
      expect(actual["nodePool"].length).toBe(reference["nodePool"].length)
      expect(actual["ripChain"].length).toBe(reference["ripChain"].length)
      expect(actual["totalRipEvents"]).toBe(reference["totalRipEvents"])
    }
    expect(actual.solved).toBeTrue()
    expect(actual.iterations).toBe(reference.iterations)
    expect(actual.getOutput()).toEqual(reference.getOutput())
    expect(actual["ripCount"]).toEqual(reference["ripCount"])
    expect(actual["usedCellsFlat"]).toEqual(reference["usedCellsFlat"])
    expect(actual["sharedCellsFlat"]).toEqual(reference["sharedCellsFlat"])
    expect(actual["penalty2d"]).toEqual(reference["penalty2d"])
    expect(actual["heap"]).toEqual(reference["heap"])
    if (actual["totalRipEvents"] > 0) observedRips = true
  }
  expect(comparedSteps).toBeGreaterThan(100)
  expect(observedRips).toBeTrue()
})
