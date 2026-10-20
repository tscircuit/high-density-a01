import { expect, test } from "bun:test"
import {
  HighDensitySolverA03,
  type HighDensitySolverA03Props,
} from "../../lib/HighDensitySolverA03/HighDensitySolverA03"
import props from "../fixtures/bugreport107-cmn21-a03.json" with {
  type: "json",
}

test("A03 routes the bugreport107 tie consistently across platforms", () => {
  const solver = new HighDensitySolverA03(props as HighDensitySolverA03Props)
  solver.solve()

  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  const route = solver
    .getOutput()
    .find((r) => r.connectionName === "source_trace_73__source_net_73")
  expect(route).toBeDefined()
  expect(route!.route[4]).toEqual({
    x: -12.292792792792792,
    y: 6.113370888059204,
    z: 2,
  })
})
