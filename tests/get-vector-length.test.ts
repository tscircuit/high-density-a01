import { expect, test } from "bun:test"
import { getVectorLength } from "../lib/getVectorLength"

test("vector length is stable at routing ties and extreme magnitudes", () => {
  expect(getVectorLength(0, 0)).toBe(0)
  expect(Object.is(getVectorLength(-0, -0), 0)).toBe(true)
  expect(getVectorLength(3, 4)).toBe(5)
  expect(getVectorLength(-3, -4)).toBe(5)
  expect(getVectorLength(0, -4)).toBe(4)
  expect(getVectorLength(0.3, 0.4)).toBe(0.5)
  expect(getVectorLength(0.40000000000000213, -0.4999500000000001)).toBe(
    0.6402733810646839,
  )
  expect(getVectorLength(3e200, 4e200) / 1e200).toBeCloseTo(5, 14)
  expect(getVectorLength(3e-200, 4e-200) / 1e-200).toBeCloseTo(5, 14)
  expect(getVectorLength(Number.MIN_VALUE, 0)).toBe(Number.MIN_VALUE)
})
