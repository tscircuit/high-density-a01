import { expect, test } from "bun:test"
import {
  defaultA02Params,
  defaultA03Params,
  defaultA05Params,
  defaultA09Params,
} from "../../lib/default-params"
import { reproParallelSameConnectionSolvingNodeWithPortPoints } from "../../fixtures/repros/repro-parallel-same-connection-solving.fixture"
import { HighDensitySolverA02 } from "../../lib/HighDensitySolverA02/HighDensitySolverA02"
import { HighDensitySolverA03 } from "../../lib/HighDensitySolverA03/HighDensitySolverA03"
import { HighDensitySolverA05 } from "../../lib/HighDensitySolverA05/HighDensitySolverA05"
import { HighDensitySolverA09 } from "../../lib/HighDensitySolverA09/HighDensitySolverA09"

function expectTwoSolvedParallelRoutes(
  routes: Array<{ connectionName: string; route: Array<unknown> }>,
) {
  expect(routes).toHaveLength(2)
  expect(
    routes.every((route) => route.connectionName === "parallel_conn"),
  ).toBe(true)
  expect(routes.every((route) => route.route.length >= 2)).toBe(true)
}

test("A02 keeps both segments when the same connection appears twice", () => {
  const solver = new HighDensitySolverA02({
    ...defaultA02Params,
    nodeWithPortPoints: reproParallelSameConnectionSolvingNodeWithPortPoints,
  })
  solver.MAX_ITERATIONS = 1_000_000
  solver.solve()

  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  expectTwoSolvedParallelRoutes(solver.getOutput())
})

test("A03 keeps both segments when the same connection appears twice", () => {
  const solver = new HighDensitySolverA03({
    ...defaultA03Params,
    nodeWithPortPoints: reproParallelSameConnectionSolvingNodeWithPortPoints,
  })
  solver.MAX_ITERATIONS = 1_000_000
  solver.solve()

  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  expectTwoSolvedParallelRoutes(solver.getOutput())
})

test("A05 keeps both segments when the same connection appears twice", () => {
  const solver = new HighDensitySolverA05({
    ...defaultA05Params,
    nodeWithPortPoints: reproParallelSameConnectionSolvingNodeWithPortPoints,
  })
  solver.MAX_ITERATIONS = 1_000_000
  solver.solve()

  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  expectTwoSolvedParallelRoutes(solver.getOutput())
})

test("A09 keeps both segments when the same connection appears twice", () => {
  const solver = new HighDensitySolverA09({
    ...defaultA09Params,
    nodeWithPortPoints: reproParallelSameConnectionSolvingNodeWithPortPoints,
  })
  solver.MAX_ITERATIONS = 1_000_000
  solver.solve()

  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  expectTwoSolvedParallelRoutes(solver.getOutput())
})
