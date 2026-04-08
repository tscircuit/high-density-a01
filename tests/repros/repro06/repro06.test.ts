import { expect, setDefaultTimeout, test } from "bun:test"
import { defaultA04Params } from "../../../lib/default-params"
import { HighDensitySolverA04 } from "../../../lib/HighDensitySolverA04/HighDensitySolverA04"
import repro06 from "./repro06.json"

setDefaultTimeout(120_000)

test("repro06 A04 solves with default geometry", () => {
  const solver = new HighDensitySolverA04({
    ...defaultA04Params,
    nodeWithPortPoints: repro06.nodeWithPortPoints,
  })
  solver.solve()

  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  expect(solver.error).toBeNull()
  expect(solver.iterations).toBeLessThan(10_000_000)
})
