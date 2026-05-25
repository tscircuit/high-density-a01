import { expect, test } from "bun:test"
import "bun-match-svg"
import "graphics-debug/matcher"
import {
  defaultA08Params,
  defaultParams,
  defaultA02Params,
  defaultA03Params,
  defaultA05Params,
  defaultA09Params,
} from "../../../lib/default-params"
import { reproParallelSameConnectionSolvingNodeWithPortPoints } from "../../../fixtures/repros/repro-parallel-same-connection-solving.fixture"
import { HighDensitySolverA01 } from "../../../lib/HighDensitySolverA01/HighDensitySolverA01"
import { HighDensitySolverA02 } from "../../../lib/HighDensitySolverA02/HighDensitySolverA02"
import { HighDensitySolverA03 } from "../../../lib/HighDensitySolverA03/HighDensitySolverA03"
import { HighDensitySolverA05 } from "../../../lib/HighDensitySolverA05/HighDensitySolverA05"
import { HighDensitySolverA08 } from "../../../lib/HighDensitySolverA08/HighDensitySolverA08"
import { HighDensitySolverA09 } from "../../../lib/HighDensitySolverA09/HighDensitySolverA09"

function expectTwoSolvedParallelRoutes(
  routes: Array<{ connectionName: string; route: Array<unknown> }>,
) {
  expect(routes).toHaveLength(2)
  expect(
    routes.every((route) => route.connectionName === "parallel_conn"),
  ).toBe(true)
  expect(routes.every((route) => route.route.length >= 2)).toBe(true)
}

function createA01Solver() {
  const solver = new HighDensitySolverA01({
    ...defaultParams,
    nodeWithPortPoints: reproParallelSameConnectionSolvingNodeWithPortPoints,
  })
  solver.MAX_ITERATIONS = 1_000_000
  solver.solve()
  return solver
}

function createA02Solver() {
  const solver = new HighDensitySolverA02({
    ...defaultA02Params,
    nodeWithPortPoints: reproParallelSameConnectionSolvingNodeWithPortPoints,
  })
  solver.MAX_ITERATIONS = 1_000_000
  solver.solve()
  return solver
}

function createA03Solver() {
  const solver = new HighDensitySolverA03({
    ...defaultA03Params,
    nodeWithPortPoints: reproParallelSameConnectionSolvingNodeWithPortPoints,
  })
  solver.MAX_ITERATIONS = 1_000_000
  solver.solve()
  return solver
}

function createA05Solver() {
  const solver = new HighDensitySolverA05({
    ...defaultA05Params,
    nodeWithPortPoints: reproParallelSameConnectionSolvingNodeWithPortPoints,
  })
  solver.MAX_ITERATIONS = 1_000_000
  solver.solve()
  return solver
}

function createA08Solver() {
  const solver = new HighDensitySolverA08({
    ...defaultA08Params,
    nodeWithPortPoints: reproParallelSameConnectionSolvingNodeWithPortPoints,
  })
  solver.MAX_ITERATIONS = 1_000_000
  solver.solve()
  return solver
}

function createA09Solver() {
  const solver = new HighDensitySolverA09({
    ...defaultA09Params,
    nodeWithPortPoints: reproParallelSameConnectionSolvingNodeWithPortPoints,
  })
  solver.MAX_ITERATIONS = 1_000_000
  solver.solve()
  return solver
}

test("A01 keeps both segments when the same connection appears twice", async () => {
  const solver = createA01Solver()
  await expect(solver.visualize()).toMatchGraphicsSvg(import.meta.path, {
    svgName: "a01",
  })
  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  expectTwoSolvedParallelRoutes(solver.getOutput())
})

test("A02 keeps both segments when the same connection appears twice", async () => {
  const solver = createA02Solver()
  await expect(solver.visualize()).toMatchGraphicsSvg(import.meta.path, {
    svgName: "a02",
  })
  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  expectTwoSolvedParallelRoutes(solver.getOutput())
})

test("A03 keeps both segments when the same connection appears twice", async () => {
  const solver = createA03Solver()
  await expect(solver.visualize()).toMatchGraphicsSvg(import.meta.path, {
    svgName: "a03",
  })
  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  expectTwoSolvedParallelRoutes(solver.getOutput())
})

test("A05 keeps both segments when the same connection appears twice", async () => {
  const solver = createA05Solver()
  await expect(solver.visualize()).toMatchGraphicsSvg(import.meta.path, {
    svgName: "a05",
  })
  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  expectTwoSolvedParallelRoutes(solver.getOutput())
})

test("A08 keeps both segments when the same connection appears twice", async () => {
  const solver = createA08Solver()
  await expect(solver.visualize()).toMatchGraphicsSvg(import.meta.path, {
    svgName: "a08",
  })
  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  expectTwoSolvedParallelRoutes(solver.getOutput())
})

test("A09 keeps both segments when the same connection appears twice", async () => {
  const solver = createA09Solver()
  await expect(solver.visualize()).toMatchGraphicsSvg(import.meta.path, {
    svgName: "a09",
  })
  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  expectTwoSolvedParallelRoutes(solver.getOutput())
})
