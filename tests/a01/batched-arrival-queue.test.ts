import { expect, test } from "bun:test"
import { HighDensitySolverA01 } from "../../lib/HighDensitySolverA01/HighDensitySolverA01"
import { viaOccupantCacheNode } from "../fixtures/via-occupant-cache-node"

type Queue = {
  push: (priority: number, sequence: number, id: number) => void
  pop: () => number
  size: number
}
type BatchedQueue = Queue & { skipDominated: (limit: number) => number }

test("grouped queue retains priority ties through mixed pushes, skips, and pops", () => {
  const solver = new HighDensitySolverA01({
    nodeWithPortPoints: viaOccupantCacheNode,
    cellSizeMm: 0.1,
    viaDiameter: 0.3,
  })
  solver.setup()
  const reference = solver["heap"] as Queue & { toGrouped: () => BatchedQueue }
  const actual = reference.toGrouped()
  let seed = 9371
  let sequence = 0
  const random = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 2 ** 32
  }
  for (let round = 0; round < 1000; round++) {
    for (let i = 0; i < 31; i++) {
      const priority = [Infinity, -Infinity, -0, 0, 1, 1, 2, 10][
        Math.floor(random() * 8)
      ]!
      const id = random() < 0.7 ? -1 : sequence
      reference.push(priority, sequence, id)
      actual.push(priority, sequence++, id)
    }
    const count = actual.skipDominated(1 + (round % 17))
    for (let i = 0; i < count; i++) expect(reference.pop()).toBe(-1)
    for (let i = 0; i < 19 && actual.size > 0; i++) {
      expect(actual.pop()).toBe(reference.pop())
    }
    expect(actual.size).toBe(reference.size)
  }
  while (actual.size > 0) expect(actual.pop()).toBe(reference.pop())
  expect(reference.size).toBe(0)
})
