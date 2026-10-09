import { expect, test } from "bun:test"
import { PairingHeap } from "../../lib/HighDensitySolverA01/PairingHeap"
import { FrozenBinaryHeap } from "./FrozenBinaryHeap"

test("pairing preserves every ordered priority pop across ties, growth and clear", () => {
  const binary = new FrozenBinaryHeap()
  const pairing = new PairingHeap()
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
    pairing.push(f, seq++, id++)
    expect(pairing.size).toBe(binary.size)
  }
  const pop = () => {
    expect(pairing.pop()).toBe(binary.pop())
    expect(pairing.size).toBe(binary.size)
  }
  for (let i = 0; i < 1000; i++) push(priorities[i % priorities.length]!)
  while (binary.size) pop()
  for (let i = 0; i < 100_000; i++) {
    const choice = next() % 100
    if (choice === 0) {
      pairing.clear()
      binary.clear()
      seq = 0
      expect(pairing.size).toBe(0)
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
  const root = (pairing as any).root
  expect(() => pairing.push(NaN, seq, id)).toThrow(RangeError)
  expect((pairing as any).root).toBe(root)
  expect(pairing.size).toBe(binary.size)
  pop()
  pairing.clear()
  expect((pairing as any).root).toBeNull()
})
