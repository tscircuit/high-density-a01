import { expect, test } from "bun:test"
import { createA05BorderPenaltyFn } from "../../lib/HighDensitySolverA05/HighDensitySolverA05"

test("A05 border penalty is strongest near the border and zero in the interior", () => {
  const penaltyFn = createA05BorderPenaltyFn({
    strength: 0.15,
    falloff: 0.12,
  })

  expect(penaltyFn({ px: 0.02, py: 0.5 })).toBeGreaterThan(
    penaltyFn({ px: 0.08, py: 0.5 }),
  )
  expect(penaltyFn({ px: 0.08, py: 0.5 })).toBeGreaterThan(0)
  expect(penaltyFn({ px: 0.5, py: 0.5 })).toBe(0)
})

test("A05 border penalty can be disabled", () => {
  const penaltyFn = createA05BorderPenaltyFn({
    strength: 0,
    falloff: 0.12,
  })

  expect(penaltyFn({ px: 0.01, py: 0.4 })).toBe(0)
})
