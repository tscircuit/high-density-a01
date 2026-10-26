import { expect, test } from "bun:test"
import { HighDensitySolverA01 } from "../../lib/HighDensitySolverA01/HighDensitySolverA01"
import { viaOccupantCacheNode } from "../fixtures/via-occupant-cache-node"

test("A01 bounds recycled storage and detaches persistent rip histories", (): void => {
  const solver = new HighDensitySolverA01({
    nodeWithPortPoints: structuredClone(viaOccupantCacheNode),
    cellSizeMm: 0.1,
    viaDiameter: 0.3,
  })
  solver.setup()
  const history = { id: 3, prev: { id: 2, prev: null } }
  solver["nodePool"] = Array.from({ length: 20_000 }, (_, i) => ({
    z: 1,
    row: i,
    col: 8,
    g: i / 13,
    parentIdx: i - 1,
    ripped: history,
  }))
  const oldPool = solver["nodePool"]
  solver["resetNodePool"]()
  expect(solver["nodePool"]).toEqual([])
  expect(solver["recycledSearchNodes"].length).toBe(16_384)
  expect(
    solver["recycledSearchNodes"].every((node) => node.ripped === null),
  ).toBe(true)
  expect(history).toEqual({ id: 3, prev: { id: 2, prev: null } })
  const recycled = solver["recycledSearchNodes"][16_383]!
  const nextHistory = { id: 5, prev: history }
  expect(solver["pushSearchNode"](0, 2, 4, 0.125, -1, nextHistory)).toBe(0)
  expect(solver["nodePool"][0]).toBe(recycled)
  expect(solver["nodePool"][0]).toEqual({
    z: 0,
    row: 2,
    col: 4,
    g: 0.125,
    parentIdx: -1,
    ripped: nextHistory,
  })
  expect(solver["nodePool"][0]!.ripped).toBe(nextHistory)
  expect(oldPool[19_999]!.ripped).toBe(history)
  solver["resetNodePool"]()
  expect(solver["recycledSearchNodes"].length).toBe(16_384)
  expect(recycled.ripped).toBeNull()
  expect(nextHistory.prev).toBe(history)
})
