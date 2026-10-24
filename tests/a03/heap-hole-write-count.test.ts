import { expect, test } from "bun:test"
import type { HighDensitySolverA03 } from "../../lib/HighDensitySolverA03/HighDensitySolverA03"
import { createA03Heap } from "../fixtures/createA03Heap"
import { SwapTypedMinHeap } from "../fixtures/SwapTypedMinHeap"

type HeapStorage = {
  f: Float64Array
  seq: Uint32Array
  id: Int32Array
  ensureCapacity: (size: number) => void
}

function countWrites(
  heap: HighDensitySolverA03["heap"] | SwapTypedMinHeap,
  counter: { writes: number },
): void {
  const storage = heap as unknown as HeapStorage
  storage.ensureCapacity(8_192)
  for (const field of ["f", "seq", "id"] as const) {
    const array = storage[field]
    const counted = new Proxy(array, {
      get(target, property) {
        const value = Reflect.get(target, property, target)
        return typeof value === "function" ? value.bind(target) : value
      },
      set(target, property, value): boolean {
        if (typeof property === "string" && /^\d+$/.test(property)) {
          counter.writes++
        }
        return Reflect.set(target, property, value, target)
      },
    })
    Object.defineProperty(storage, field, { value: counted, writable: true })
  }
}

test("A03 hole sifts reduce indexed typed-array writes while preserving every pop", (): void => {
  const actual = createA03Heap()
  const reference = new SwapTypedMinHeap()
  const actualWork = { writes: 0 }
  const referenceWork = { writes: 0 }
  countWrites(actual, actualWork)
  countWrites(reference, referenceWork)
  for (let index = 4_096; index > 0; index--) {
    actual.push(index, index, index)
    reference.push(index, index, index)
  }
  while (reference.size > 0) {
    expect(actual.pop()).toBe(reference.pop())
  }
  expect(actualWork.writes).toBeGreaterThan(0)
  expect(actualWork.writes).toBeLessThan(referenceWork.writes * 0.55)
  expect({
    workload: { pushes: 4_096, pops: 4_096 },
    beforeSwapSifts: { typedArrayWrites: referenceWork.writes },
    afterHoleSifts: { typedArrayWrites: actualWork.writes },
    typedArrayWritesAvoided: referenceWork.writes - actualWork.writes,
  }).toMatchSnapshot("same queue behavior with fewer typed heap writes")
})
