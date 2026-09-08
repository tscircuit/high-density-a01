import { expect, test } from "bun:test"
import { defaultA03Params } from "../../lib/default-params"
import { HighDensitySolverA03 } from "../../lib/HighDensitySolverA03/HighDensitySolverA03"
import type { NodeWithPortPoints } from "../../lib/types"

type State = {
  layers: number
  planeSize: number
  stamp: number
  activeConnId: number
  connNameToId: Map<string, number>
  usedCellsFlat: Int32Array
  sharedCellsFlat: Array<number[] | undefined>
  rootOverlapAllowed: Uint8Array
  viaOccupantsByCell: Map<number, number[]>
  layerOccupantsByCell: Array<readonly number[] | undefined>
  layerOccupantStamp: Uint32Array
  _viaOccs: number[]
  _layerOccs: number[]
  getViaFootprint(cellId: number): Int32Array
  getViaOccupants(cellId: number, activeConn: number): number[]
  getLayerOccupants(cellId: number, activeConn: number): readonly number[]
  pushFlatOccupants(flatIdx: number, activeConn: number, out: number[]): void
  nextStamp(): void
}

function makeSolver(layers: number, connectionCount = 5) {
  const nodeWithPortPoints: NodeWithPortPoints = {
    capacityMeshNodeId: "layer-occupants",
    center: { x: 0, y: 0 },
    width: 1.6,
    height: 1.6,
    availableZ: Array.from({ length: layers }, (_, z) => z),
    portPoints: ["a", "b", "c", "d", "e"]
      .slice(0, connectionCount)
      .flatMap((connectionName, index) => [
        {
          connectionName,
          rootConnectionName: index < 2 ? "shared" : connectionName,
          x: -0.8,
          y: (index - 2) * 0.25,
          z: 0,
        },
        {
          connectionName,
          rootConnectionName: index < 2 ? "shared" : connectionName,
          x: 0.8,
          y: (2 - index) * 0.25,
          z: layers - 1,
        },
      ]),
  }
  return new HighDensitySolverA03({
    ...defaultA03Params,
    highResolutionCellThickness: 0.2,
    nodeWithPortPoints,
  })
}

function originalCell(state: State, cellId: number, active: number) {
  const out: number[] = []
  for (let z = 0; z < state.layers; z++) {
    state.pushFlatOccupants(z * state.planeSize + cellId, active, out)
  }
  return out
}

// Frozen whole-query algorithm, independent of the new per-cell union.
function originalVia(state: State, cellId: number, active: number) {
  const shouldCache = state.layers > 2
  if (shouldCache) {
    const cached = state.viaOccupantsByCell.get(cellId)
    if (cached) return cached
  }
  const out: number[] = shouldCache ? [] : state._viaOccs
  out.length = 0
  for (const cell of state.getViaFootprint(cellId)) {
    for (let z = 0; z < state.layers; z++) {
      state.pushFlatOccupants(z * state.planeSize + cell, active, out)
    }
  }
  if (shouldCache) state.viaOccupantsByCell.set(cellId, out)
  return out
}

test("A03 layer unions preserve primary/shared/root order and invalidate per search", () => {
  for (const layers of [2, 4, 6]) {
    const solver = makeSolver(layers)
    solver.setup()
    const state = solver as unknown as State
    const [a, b, c, d, e] = ["a", "b", "c", "d", "e"].map(
      (name) => state.connNameToId.get(name)!,
    ) as [number, number, number, number, number]
    state.activeConnId = a
    state.nextStamp()
    state.usedCellsFlat.fill(-1)
    state.sharedCellsFlat.fill(undefined)
    const center = Math.floor(state.planeSize / 2)
    const footprint = state.getViaFootprint(center)
    expect(footprint.length).toBeGreaterThan(2)
    for (const [index, cell] of [...footprint].entries()) {
      for (let z = 0; z < layers; z++) {
        const flat = z * state.planeSize + cell
        state.usedCellsFlat[flat] = [a, c, d][(index + z) % 3]!
        state.sharedCellsFlat[flat] = [b, e, c, e, a, d]
      }
      expect(state.getLayerOccupants(cell, a)).toEqual(
        originalCell(state, cell, a),
      )
      expect(state.getLayerOccupants(cell, a)).not.toBe(state._layerOccs)
    }
    expect(state.rootOverlapAllowed[b]).toBe(1)
    const expected = [...originalVia(state, center, a)]
    state.viaOccupantsByCell.clear()
    expect(state.getViaOccupants(center, a)).toEqual(expected)

    let scans = 0
    const push = state.pushFlatOccupants.bind(state)
    state.pushFlatOccupants = (flat, active, out) => {
      scans++
      push(flat, active, out)
    }
    state.viaOccupantsByCell.clear()
    expect(state.getViaOccupants(center, a)).toEqual(expected)
    expect(scans).toBe(0)
    if (layers === 2)
      expect(state.getViaOccupants(center, a)).toBe(state._viaOccs)

    const saved = state.getLayerOccupants(footprint[0]!, a)
    state.usedCellsFlat.fill(-1)
    state.sharedCellsFlat.fill(undefined)
    state.activeConnId = c
    state.nextStamp()
    for (const cell of footprint) {
      expect(state.getLayerOccupants(cell, c)).toEqual([])
    }
    const empty = state.getLayerOccupants(footprint[0]!, c)
    expect(empty).toBe(state.getLayerOccupants(footprint[1]!, c))
    expect(Object.isFrozen(empty)).toBe(true)
    expect(saved.length).toBeGreaterThan(0)
    expect(scans).toBe(footprint.length * layers)

    // A completed search can leave a stamp while activeConnId is cleared.
    // Its occupancy must remain readable through the original private query.
    state.usedCellsFlat[footprint[0]!] = e
    state.activeConnId = -1
    expect(state.getLayerOccupants(footprint[0]!, -1)).toEqual([e])
    state.viaOccupantsByCell.clear()
    expect(state.getViaOccupants(center, -1)).toEqual([e])
    // A different caller must also bypass the active connection's cell lists.
    state.activeConnId = c
    expect(state.getLayerOccupants(footprint[0]!, a)).toEqual([e])

    state.stamp = 0xffff_ffff
    state.nextStamp()
    expect(state.stamp).toBe(1)
    expect(state.getLayerOccupants(footprint[0]!, c)).toEqual([e])
    const oldLists = state.layerOccupantsByCell
    solver._setup()
    expect(state.layerOccupantsByCell).not.toBe(oldLists)
    expect(state.layerOccupantStamp.every((stamp) => stamp === 0)).toBe(true)
  }
})

// Compare the complete mutable search state, including backing heap/pool and
// exploration buffers. Only the new cache and its scratch storage are omitted.
function searchState(solver: HighDensitySolverA03) {
  const omitted = new Set([
    "layerOccupantsByCell",
    "layerOccupantStamp",
    "_layerOccs",
  ])
  return Object.fromEntries(
    Object.entries(solver).filter(
      ([key, value]) => !omitted.has(key) && typeof value !== "function",
    ),
  )
}

for (const layers of [2, 4, 6]) {
  for (const connections of [1, 5]) {
    test(`A03 ${layers}-layer ${connections}-connection public steps match the original scan`, () => {
      const cached = makeSolver(layers, connections)
      const reference = makeSolver(layers, connections)
      if (connections === 5) {
        // Include the public iteration-limit failure boundary in a small test.
        cached.setup()
        reference.setup()
        cached.MAX_ITERATIONS = reference.MAX_ITERATIONS = 2000
      }
      const state = cached as unknown as State
      const referenceState = reference as unknown as State
      let cachedScans = 0
      let referenceScans = 0
      let inCachedVia = false
      let inReferenceVia = false
      const cachedVia = state.getViaOccupants.bind(state)
      state.getViaOccupants = (cell, active) => {
        inCachedVia = true
        const occupants = cachedVia(cell, active)
        inCachedVia = false
        return occupants
      }
      referenceState.getViaOccupants = (cell, active) => {
        inReferenceVia = true
        const occupants = originalVia(referenceState, cell, active)
        inReferenceVia = false
        return occupants
      }
      const push = state.pushFlatOccupants.bind(state)
      state.pushFlatOccupants = (flat, active, out) => {
        if (inCachedVia) cachedScans++
        push(flat, active, out)
      }
      const referencePush =
        referenceState.pushFlatOccupants.bind(referenceState)
      referenceState.pushFlatOccupants = (flat, active, out) => {
        if (inReferenceVia) referenceScans++
        referencePush(flat, active, out)
      }
      while (!cached.solved && !cached.failed) {
        cached.step()
        reference.step()
        expect(searchState(cached)).toEqual(searchState(reference))
        expect(cached.getOutput()).toEqual(reference.getOutput())
      }
      expect(cached.solved).toBe(connections === 1)
      expect(cachedScans).toBeLessThan(referenceScans)
      if (connections === 5) {
        expect(cachedScans).toBeLessThan(referenceScans / 2)
      }
      expect(state.layerOccupantsByCell).toEqual([])
      expect(state.layerOccupantStamp.length).toBe(0)
    })
  }
}

test("A03 retains the original direct scan outside the bounded cache", () => {
  for (const layers of [1, 2]) {
    const solver = makeSolver(layers)
    solver.setup()
    const state = solver as unknown as State
    state.activeConnId = 0
    state.nextStamp()
    // Emulate the unallocated cache selected for oversized planes.
    state.layerOccupantStamp = new Uint32Array(0)
    state.getLayerOccupants = () => {
      throw new Error("An ineligible query used the per-cell union")
    }
    const expected = [...originalVia(state, 0, 0)]
    expect(state.getViaOccupants(0, 0)).toEqual(expected)
  }
})
