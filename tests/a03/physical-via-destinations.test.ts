import { expect, test } from "bun:test"
import { HighDensitySolverA03 } from "../../lib/HighDensitySolverA03/HighDensitySolverA03"

test("physical via expansion preserves destination states and ordered rip values", () => {
  const bytes = (a: ArrayBufferView) =>
    Buffer.from(a.buffer, a.byteOffset, a.byteLength).toString("hex")
  const run = (
    mode: "per-layer" | "physical",
    closed: number,
    blocked: number,
    bound: number,
    goalException: boolean,
    parameters: Record<string, number> = {},
  ) => {
    const s: any = new HighDensitySolverA03({
      viaExpansion: mode,
      viaOccupantQuery: "owner-runs",
      viaDiameter: 0.3,
      highResolutionCellSize: 0.2,
      highResolutionCellThickness: 1,
      lowResolutionCellSize: 0.4,
      hyperParameters: parameters,
      nodeWithPortPoints: {
        capacityMeshNodeId: "physical-destinations",
        center: { x: 0, y: 0 },
        width: 1.2,
        height: 1.2,
        availableZ: [0, 1, 2, 3],
        portPoints: [
          { connectionName: "a", x: -0.6, y: 0, z: 0 },
          { connectionName: "a", x: 0.6, y: 0, z: 3 },
          { connectionName: "b", x: -0.6, y: -0.4, z: 0 },
          { connectionName: "b", x: 0.6, y: -0.4, z: 0 },
          { connectionName: "c", x: -0.6, y: 0.4, z: 1 },
          { connectionName: "c", x: 0.6, y: 0.4, z: 1 },
        ],
      },
    })
    s.setup()
    let cell = 0
    for (let i = 1; i < s.planeSize; i++) {
      if (
        Math.hypot(s.cellCenterX[i], s.cellCenterY[i]) <
        Math.hypot(s.cellCenterX[cell], s.cellCenterY[cell])
      ) {
        cell = i
      }
    }
    const seg = s.unsolvedSegs[0]
    const owners = Array.from(s.connNameToId.values()).filter(
      (id) => id !== seg.connId,
    ) as number[]
    seg.startZ = 0
    seg.startCellId = cell
    seg.endZ = 3
    seg.endCellId = goalException ? cell : (cell + 1) % s.planeSize
    s.neighborOffset.fill(0)
    s.viaAllowed.fill(0)
    s.viaAllowed[cell] = 1
    s.portOwnerFlat.fill(-1)
    s.usedCellsFlat.fill(-1)
    s.sharedCellsFlat.fill(undefined)
    s.usedCellsFlat[cell] = owners[0]
    s.usedCellsFlat[s.planeSize + cell] = owners[1]
    s.sharedCellsFlat[2 * s.planeSize + cell] = [owners[1], owners[0]]
    for (let nz = 1; nz < 4; nz++) {
      if (blocked & (1 << (nz - 1))) {
        s.portOwnerFlat[nz * s.planeSize + cell] = owners[0]
      }
    }
    s.step()
    const priorHead = s.ripChain.append(-1, owners[0])
    s.nodePool.ripHead[0] = priorHead
    s.nodePool.ripCount[0] = 1
    s._moveRipCount = 7
    for (let nz = 1; nz < 4; nz++) {
      const flat = nz * s.planeSize + cell
      if (closed & (1 << (nz - 1))) s.visitedStamp[flat] = s.stamp
      if (bound) {
        s.bestGStamp[flat] = s.stamp
        s.bestGValue[flat] = bound === 1 ? 0 : 3
      }
    }
    let queries = 0
    const original = s.fillViaOccupants
    s.fillViaOccupants = function (...args: any[]) {
      queries++
      return Reflect.apply(original, this, args)
    }
    s.step()
    const chain = (head: number) => {
      const out: number[] = []
      s.ripChain.collect(head, out)
      return out
    }
    return {
      queries,
      ripEntries: s.ripChain.length,
      state: {
        iterations: s.iterations,
        searchIterations: s.searchIterations,
        solved: s.solved,
        failed: s.failed,
        error: s.error,
        nodeCount: s.nodePool.length,
        z: bytes(s.nodePool.z),
        cells: bytes(s.nodePool.cellId),
        g: bytes(s.nodePool.g),
        parent: bytes(s.nodePool.parent),
        ripCount: bytes(s.nodePool.ripCount),
        orderedRips: Array.from({ length: s.nodePool.length }, (_, i) =>
          chain(s.nodePool.ripHead[i]),
        ),
        heapSize: s.heap.size,
        heapF: bytes(s.heap.f),
        heapSeq: bytes(s.heap.seq),
        heapId: bytes(s.heap.id),
        visited: bytes(s.visitedStamp),
        visitedFlat: bytes(s.visitedFlatStamp),
        bestStamp: bytes(s.bestGStamp),
        bestG: bytes(s.bestGValue),
        occupants: [...s._viaOccs],
        moveCost: bytes(new Float64Array([s._moveCost])),
        moveRipCount: s._moveRipCount,
        moveRips: chain(s._moveRippedHead),
      },
    }
  }
  let savedQueries = 0
  let savedRipEntries = 0
  const check = (
    closed: number,
    blocked: number,
    bound: number,
    goal: boolean,
    params: Record<string, number> = {},
  ) => {
    const reference = run("per-layer", closed, blocked, bound, goal, params)
    const actual = run("physical", closed, blocked, bound, goal, params)
    expect(actual.state).toEqual(reference.state)
    expect(actual.queries).toBeLessThanOrEqual(1)
    expect(actual.queries).toBeLessThanOrEqual(reference.queries)
    savedQueries += reference.queries - actual.queries
    savedRipEntries += reference.ripEntries - actual.ripEntries
  }
  for (let closed = 0; closed < 8; closed++) {
    for (let blocked = 0; blocked < 8; blocked++) {
      check(closed, blocked, 0, false)
      check(closed, blocked, 0, true)
      check(closed, blocked, 1, true)
      check(closed, blocked, 2, false)
    }
  }
  for (const value of [
    -Infinity,
    -1,
    -0,
    0,
    Number.MIN_VALUE,
    1e308,
    Infinity,
    NaN,
  ]) {
    for (const key of [
      "viaBaseCost",
      "ripCost",
      "ripViaPenalty",
      "greedyMultiplier",
    ]) {
      check(0, 0, 0, false, { [key]: value })
      check(0, 4, 0, false, { [key]: value })
    }
  }
  expect(savedQueries).toBeGreaterThan(0)
  expect(savedRipEntries).toBeGreaterThan(0)
}, 30000)
