import { expect, test } from "bun:test"
import { createA03Heap } from "../fixtures/createA03Heap"
import { SwapTypedMinHeap } from "../fixtures/SwapTypedMinHeap"

test("A03 hole sifts preserve heap slots and pops across numeric coercions, ties and reuse", (): void => {
  const actual = createA03Heap()
  const reference = new SwapTypedMinHeap()
  const priorities = [
    NaN,
    Infinity,
    -Infinity,
    0,
    -0,
    1,
    -1,
    Number.MIN_VALUE,
    -Number.MIN_VALUE,
    Number.MAX_VALUE,
    -Number.MAX_VALUE,
  ]
  const sequences = [
    0,
    -0,
    1,
    1,
    -1,
    2 ** 32 - 1,
    2 ** 32,
    2 ** 32 + 1,
    2 ** 53 - 1,
    1.75,
    -1.75,
    NaN,
    Infinity,
    -Infinity,
  ]
  let randomState = 314159265
  const assertSlots = (includeInactive = false): void => {
    expect(actual.size).toBe(reference.size)
    expect(actual["f"].length).toBe(reference["f"].length)
    const count = includeInactive ? actual["f"].length : actual.size
    for (const field of ["seq", "id"] as const) {
      expect(actual[field].subarray(0, count)).toEqual(
        reference[field].subarray(0, count),
      )
    }
    // Object.is also checks the sign of zero and treats matching NaNs as equal.
    for (let index = 0; index < count; index++) {
      if (!Object.is(actual["f"][index], reference["f"][index])) {
        throw new Error(`Priority differs at heap slot ${index}`)
      }
    }
  }
  for (let index = 0; index < 4_097; index++) {
    const priority = 4_097 - index
    const sequence = sequences[index % sequences.length]!
    const id = index % 2 ? index + 2 ** 32 : -index - 2 ** 31
    actual.push(priority, sequence, id)
    reference.push(priority, sequence, id)
    assertSlots(index % 1_024 === 0)
  }
  expect(actual["f"].length).toBe(8_192)
  while (reference.size > 0) {
    expect(actual.pop()).toBe(reference.pop())
    assertSlots()
  }
  assertSlots(true)
  for (let operation = 0; operation < 10_000; operation++) {
    randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0
    const clearing = operation % 997 === 0
    if (clearing) {
      actual.clear()
      reference.clear()
    } else if (
      reference.size > 0 &&
      (randomState % 3 === 0 || reference.size >= 256)
    ) {
      expect(actual.pop()).toBe(reference.pop())
    } else {
      const priority = priorities[randomState % priorities.length]!
      const sequence = sequences[(randomState >>> 8) % sequences.length]!
      const id = sequences[(randomState >>> 16) % sequences.length]!
      actual.push(priority, sequence, id)
      reference.push(priority, sequence, id)
    }
    assertSlots(clearing)
  }
  while (reference.size > 0) {
    expect(actual.pop()).toBe(reference.pop())
    assertSlots()
  }
  assertSlots(true)
})
