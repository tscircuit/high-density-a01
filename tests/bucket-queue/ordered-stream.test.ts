import { expect, test } from "bun:test"
import { BucketHeap } from "../../lib/HighDensitySolverA01/BucketHeap"
import { FrozenBinaryHeap } from "./FrozenBinaryHeap"

test("bucketed preserves every ordered priority pop across ties, growth and clear", () => {
  const binary = new FrozenBinaryHeap()
  const bucketed = new BucketHeap()
  let seq = 0
  let id = 0
  let random = 123456789
  const next = () => {
    random ^= random << 13
    random ^= random >>> 17
    random ^= random << 5
    return random >>> 0
  }
  const priorities = [
    -Infinity,
    -Number.MAX_VALUE,
    -1,
    -Number.MIN_VALUE,
    -0,
    0,
    Number.MIN_VALUE,
    1,
    Number.MAX_VALUE,
    Infinity,
  ]
  const push = (f: number) => {
    binary.push(f, seq, id)
    bucketed.push(f, seq++, id++)
    expect(bucketed.size).toBe(binary.size)
  }
  const pop = () => {
    expect(bucketed.pop()).toBe(binary.pop())
    expect(bucketed.size).toBe(binary.size)
  }
  for (let i = 0; i < 1000; i++) push(priorities[i % priorities.length]!)
  while (binary.size) pop()
  for (let i = 0; i < 100_000; i++) {
    const choice = next() % 100
    if (choice === 0) {
      bucketed.clear()
      binary.clear()
      seq = 0
      expect(bucketed.size).toBe(0)
    } else if (choice < 43 && binary.size) {
      pop()
    } else {
      const f =
        choice < 70
          ? priorities[next() % priorities.length]!
          : ((next() % 10_000) - 5000) / 7
      push(f)
    }
  }
  while (binary.size) pop()
  push(1)
  expect(() => bucketed.push(NaN, seq, id)).toThrow(RangeError)
  expect(bucketed.size).toBe(binary.size)
  pop()
  bucketed.clear()
  expect(bucketed.size).toBe(0)
})
