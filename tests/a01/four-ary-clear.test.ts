import { expect, test } from "bun:test"
import {
  createA01Heap,
  getLogicalA01Heap,
} from "../fixtures/fourAryHeapTestUtils"

test("four-ary A01 clear and partial child groups preserve logical queue state", (): void => {
  const actual = createA01Heap(true)
  const original = createA01Heap(false)
  for (const size of [1, 2, 3, 4, 5, 6, 15, 16, 17, 64, 257, 1025]) {
    for (let id = 0; id < size; id++) {
      const priority = (id * 73) % 19
      const sequence = Number.MAX_SAFE_INTEGER - size + id
      actual.push(priority, sequence, id)
      original.push(priority, sequence, id)
    }
    expect(getLogicalA01Heap(actual)).toEqual(getLogicalA01Heap(original))
    for (let popped = 0; popped < Math.floor(size / 2); popped++) {
      expect(actual.pop()).toBe(original.pop())
    }
    expect(getLogicalA01Heap(actual)).toEqual(getLogicalA01Heap(original))
    actual.clear()
    original.clear()
    expect(actual.size).toBe(0)
    expect(original.size).toBe(0)
    for (let id = 0; id < size; id++) {
      actual.push(1, id, id)
      original.push(1, id, id)
    }
    while (original.size > 0) expect(actual.pop()).toBe(original.pop())
    expect(actual.size).toBe(0)
  }
})
