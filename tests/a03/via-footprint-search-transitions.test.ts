import { expect, test } from "bun:test"
import { HighDensitySolverA03 } from "../../lib/HighDensitySolverA03/HighDensitySolverA03"
import { useFrozenA03ViaOccupants } from "../fixtures/useFrozenA03ViaOccupants"
import { viaOccupantCacheNode } from "../fixtures/via-occupant-cache-node"

test("A03 footprints reuse geometry while preserving search-cache transitions", (): void => {
  const props = {
    nodeWithPortPoints: viaOccupantCacheNode,
    highResolutionCellSize: 0.25,
    highResolutionCellThickness: 2,
    lowResolutionCellSize: 0.5,
    traceThickness: 0.1,
    traceMargin: 0.1,
    viaDiameter: 0.3,
  }
  const actual = new HighDensitySolverA03(structuredClone(props))
  const reference = new HighDensitySolverA03(structuredClone(props))
  actual.setup()
  reference.setup()
  useFrozenA03ViaOccupants(reference)
  let geometryScans = 0
  const originalScan = actual["forEachCellNearCircle"].bind(actual)
  actual["forEachCellNearCircle"] = (...args): void => {
    geometryScans++
    originalScan(...args)
  }
  const footprints: Uint32Array[] = []
  for (let search = 0; search < 8; search++) {
    for (const solver of [actual, reference]) {
      for (let flatId = 0; flatId < solver["usedCellsFlat"].length; flatId++) {
        solver["usedCellsFlat"][flatId] = ((flatId + search) % 5) - 1
        solver["sharedCellsFlat"][flatId] =
          flatId % 3 === 0 ? [3, 0, 2, 3, 1] : undefined
      }
    }
    if (search > 0) {
      // Ownership edits do not bypass the established current-search cache.
      actual["fillViaOccupants"](0, search % 4)
      reference["fillViaOccupants"](0, search % 4)
      expect(actual["_viaOccs"]).toEqual(reference["_viaOccs"])
    }
    // New searches invalidate occupancy results, as the native search loop does.
    actual["viaOccupantsByCell"].clear()
    reference["viaOccupantsByCell"].clear()
    for (let cellId = 0; cellId < actual.planeSize; cellId++) {
      actual["fillViaOccupants"](cellId, search % 4)
      reference["fillViaOccupants"](cellId, search % 4)
      expect(actual["_viaOccs"]).toEqual(reference["_viaOccs"])
      if (search === 0) footprints.push(actual["viaFootprintCellIds"][cellId]!)
      else
        expect(actual["viaFootprintCellIds"][cellId]).toBe(footprints[cellId])
      // Both caches return the same ordered occupant list on another query.
      actual["fillViaOccupants"](cellId, search % 4)
      reference["fillViaOccupants"](cellId, search % 4)
      expect(actual["_viaOccs"]).toEqual(reference["_viaOccs"])
    }
    expect(actual["viaOccupantsByCell"]).toEqual(
      reference["viaOccupantsByCell"],
    )
  }
  expect(geometryScans).toBe(actual.planeSize)
})
