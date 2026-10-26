import { expect, test } from "bun:test"
import { createA01Heap } from "../fixtures/fourAryHeapTestUtils"

test("four-ary A01 extraction matches an independent stable priority oracle", (): void => {
  const actual = createA01Heap(true)
  const expected: Array<{ f: number; seq: number; id: number }> = []
  const priorities = [
    -Infinity,
    -Number.MAX_VALUE,
    -1,
    -Number.MIN_VALUE,
    -0,
    0,
    Number.MIN_VALUE,
    0.5,
    1,
    Number.MAX_VALUE,
    Infinity,
  ]
  let random = 932731
  let sequence = 2 ** 32 - 2048
  for (let operation = 0; operation < 12_000; operation++) {
    random = (Math.imul(random, 1664525) + 1013904223) >>> 0
    if (expected.length > 0 && random % 3 === 0) {
      expected.sort((a, b) =>
        a.f !== b.f ? (a.f < b.f ? -1 : 1) : a.seq - b.seq,
      )
      expect(actual.pop()).toBe(expected.shift()!.id)
    } else {
      const item = {
        f: priorities[random % priorities.length]!,
        seq: sequence++,
        id: operation,
      }
      actual.push(item.f, item.seq, item.id)
      expected.push(item)
    }
    expect(actual.size).toBe(expected.length)
  }
  expected.sort((a, b) =>
    a.f !== b.f ? (a.f < b.f ? -1 : 1) : a.seq - b.seq,
  )
  for (const item of expected) expect(actual.pop()).toBe(item.id)
  expect(actual.size).toBe(0)
})
