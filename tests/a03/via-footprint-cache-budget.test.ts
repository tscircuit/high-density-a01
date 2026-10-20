import { expect, test } from "bun:test"
import { HighDensitySolverA03 } from "../../lib/HighDensitySolverA03/HighDensitySolverA03"
import { useFrozenA03ViaOccupants } from "../fixtures/useFrozenA03ViaOccupants"
import { viaOccupantCacheNode } from "../fixtures/via-occupant-cache-node"

test("A03 bounds retained footprints and streams unchanged occupants beyond the budget", (): void => {
  const props = {
    nodeWithPortPoints: viaOccupantCacheNode,
    highResolutionCellSize: 0.25,
    highResolutionCellThickness: 2,
    lowResolutionCellSize: 0.5,
    traceThickness: 0.1,
    traceMargin: 0.1,
    viaDiameter: 0.3,
  }
  for (const budget of [0, 1, 8, 25, undefined]) {
    const actual = new HighDensitySolverA03(structuredClone(props))
    const reference = new HighDensitySolverA03(structuredClone(props))
    actual.setup()
    reference.setup()
    useFrozenA03ViaOccupants(reference)
    expect(actual["maxViaFootprintCacheEntries"]).toBe(16 * actual.planeSize)
    if (budget !== undefined) actual["maxViaFootprintCacheEntries"] = budget
    let oversizedFootprintSeen = false
    const originalScan = actual["forEachCellNearCircle"].bind(actual)
    let geometryScans = 0
    actual["forEachCellNearCircle"] = (...args): void => {
      geometryScans++
      originalScan(...args)
    }
    for (let search = 0; search < 4; search++) {
      for (const solver of [actual, reference]) {
        for (
          let flatId = 0;
          flatId < solver["usedCellsFlat"].length;
          flatId++
        ) {
          solver["usedCellsFlat"][flatId] = ((flatId + search) % 5) - 1
          solver["sharedCellsFlat"][flatId] =
            flatId % 3 === 0 ? [3, 0, 2, 3, 1] : undefined
        }
        solver["viaOccupantsByCell"].clear()
      }
      for (let cellId = 0; cellId < actual.planeSize; cellId++) {
        actual["fillViaOccupants"](cellId, search % 4)
        reference["fillViaOccupants"](cellId, search % 4)
        expect(actual["_viaOccs"]).toEqual(reference["_viaOccs"])
        const scansBeforeCacheHit = geometryScans
        actual["fillViaOccupants"](cellId, search % 4)
        expect(geometryScans).toBe(scansBeforeCacheHit)
        expect(actual["_viaOccs"]).toEqual(reference["_viaOccs"])
        if (!actual["viaFootprintCellIds"][cellId])
          oversizedFootprintSeen = true
      }
      const retainedEntries = actual["viaFootprintCellIds"].reduce(
        (count, footprint) => count + (footprint?.length ?? 0),
        0,
      )
      expect(actual["viaFootprintCacheEntries"]).toBe(retainedEntries)
      expect(retainedEntries).toBeLessThanOrEqual(
        actual["maxViaFootprintCacheEntries"],
      )
      expect(actual["viaOccupantsByCell"]).toEqual(
        reference["viaOccupantsByCell"],
      )
    }
    if (budget !== undefined) {
      expect(oversizedFootprintSeen).toBeTrue()
      expect(geometryScans).toBeGreaterThan(actual.planeSize)
      if (budget > 0 && actual["viaFootprintCacheEntries"] < budget) {
        expect(actual["viaFootprintCacheClosed"]).toBeTrue()
      }
    }
  }

  // A valid large via can cover the whole plane. Its footprint must not be
  // retained when it exceeds the quota, even though each occupant is visited.
  const giantProps = { ...props, viaDiameter: 100 }
  const giant = new HighDensitySolverA03(structuredClone(giantProps))
  const giantReference = new HighDensitySolverA03(structuredClone(giantProps))
  giant.setup()
  giantReference.setup()
  useFrozenA03ViaOccupants(giantReference)
  giant["maxViaFootprintCacheEntries"] = giant.planeSize - 1
  for (const solver of [giant, giantReference]) {
    solver["usedCellsFlat"].fill(2)
    solver["fillViaOccupants"](0, 0)
  }
  expect(giant["_viaOccs"]).toEqual(giantReference["_viaOccs"])
  expect(giant["_viaOccs"]).toEqual([2])
  expect(giant["viaFootprintCellIds"][0]).toBeUndefined()
  expect(giant["viaFootprintCacheEntries"]).toBe(0)
  expect(giant["viaFootprintCacheClosed"]).toBeTrue()
  // Once admission closes, a later small footprint also streams directly. This
  // avoids repeatedly building and discarding ID arrays near the quota.
  giant["viaKeepoutRadius"] = 0.01
  giantReference["viaKeepoutRadius"] = 0.01
  giant["viaOccupantsByCell"].clear()
  giantReference["viaOccupantsByCell"].clear()
  giant["fillViaOccupants"](0, 0)
  giantReference["fillViaOccupants"](0, 0)
  expect(giant["_viaOccs"]).toEqual(giantReference["_viaOccs"])
  expect(giant["viaFootprintCellIds"][0]).toBeUndefined()
  expect(giant["viaFootprintCacheEntries"]).toBe(0)

  const defaultGiant = new HighDensitySolverA03(structuredClone(giantProps))
  defaultGiant.setup()
  defaultGiant["usedCellsFlat"].fill(2)
  expect(defaultGiant.planeSize).toBeGreaterThan(17)
  for (let cellId = 0; cellId < 17; cellId++) {
    defaultGiant["fillViaOccupants"](cellId, 0)
    expect(defaultGiant["_viaOccs"]).toEqual([2])
    expect(defaultGiant["viaFootprintCacheEntries"]).toBeLessThanOrEqual(
      16 * defaultGiant.planeSize,
    )
  }
  expect(defaultGiant["viaFootprintCacheEntries"]).toBe(
    16 * defaultGiant.planeSize,
  )
  expect(defaultGiant["viaFootprintCellIds"][16]).toBeUndefined()

  for (const budget of [0, 25]) {
    const actual = new HighDensitySolverA03(structuredClone(props))
    const reference = new HighDensitySolverA03(structuredClone(props))
    actual.setup()
    reference.setup()
    actual["maxViaFootprintCacheEntries"] = budget
    useFrozenA03ViaOccupants(reference)
    while (!reference.solved && !reference.failed) {
      actual.step()
      reference.step()
      expect([actual.solved, actual.failed, actual.error]).toEqual([
        reference.solved,
        reference.failed,
        reference.error,
      ])
      expect(actual["heap"]).toEqual(reference["heap"])
      expect(actual["totalRipEvents"]).toBe(reference["totalRipEvents"])
    }
    expect(actual.solved).toBeTrue()
    expect(actual["totalRipEvents"]).toBeGreaterThan(0)
    expect(actual.iterations).toBe(reference.iterations)
    expect(actual.getOutput()).toEqual(reference.getOutput())
    expect(actual["ripCount"]).toEqual(reference["ripCount"])
    expect(actual["usedCellsFlat"]).toEqual(reference["usedCellsFlat"])
    expect(actual["sharedCellsFlat"]).toEqual(reference["sharedCellsFlat"])
    expect(actual["penalty2d"]).toEqual(reference["penalty2d"])
    expect(actual["viaFootprintCacheEntries"]).toBeLessThanOrEqual(budget)
  }
})
