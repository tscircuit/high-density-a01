import { expect, test } from "bun:test"
import "bun-match-svg"
import "graphics-debug/matcher"
import {
  defaultA02Params,
  defaultA03Params,
  defaultA05Params,
  defaultA08Params,
  defaultA09Params,
  defaultParams,
} from "../../lib/default-params"
import { HighDensitySolverA01 } from "../../lib/HighDensitySolverA01/HighDensitySolverA01"
import { HighDensitySolverA02 } from "../../lib/HighDensitySolverA02/HighDensitySolverA02"
import { HighDensitySolverA03 } from "../../lib/HighDensitySolverA03/HighDensitySolverA03"
import { HighDensitySolverA05 } from "../../lib/HighDensitySolverA05/HighDensitySolverA05"
import { HighDensitySolverA08 } from "../../lib/HighDensitySolverA08/HighDensitySolverA08"
import { HighDensitySolverA09 } from "../../lib/HighDensitySolverA09/HighDensitySolverA09"
import type { NodeWithPortPoints } from "../../lib/types"
import prevNextLinkedChains from "./prev-next.json"

const nodeWithPortPoints = prevNextLinkedChains as NodeWithPortPoints
const maxIterations = 1_000_000

/**
 * Runs a solver to completion with a shared high iteration cap for snapshot tests.
 *
 * @param solver - Solver instance configured for the current fixture.
 * @returns The same solver instance after `solve()` finishes.
 *
 * @remarks
 * The shared helper keeps each snapshot case focused on solver-specific parameters.
 */
const solveSolver = <TSolver extends { MAX_ITERATIONS: number; solve(): void }>(
  solver: TSolver,
) => {
  solver.MAX_ITERATIONS = maxIterations
  solver.solve()
  return solver
}

const createA01Solver = () =>
  solveSolver(
    new HighDensitySolverA01({
      ...defaultParams,
      cellSizeMm: 0.25,
      nodeWithPortPoints,
    }),
  )

const createA02Solver = () =>
  solveSolver(
    new HighDensitySolverA02({
      ...defaultA02Params,
      outerGridCellSize: 0.25,
      innerGridCellSize: 0.5,
      nodeWithPortPoints,
    }),
  )

const createA03Solver = () =>
  solveSolver(
    new HighDensitySolverA03({
      ...defaultA03Params,
      highResolutionCellSize: 0.25,
      lowResolutionCellSize: 0.5,
      nodeWithPortPoints,
    }),
  )

const createA05Solver = () =>
  solveSolver(
    new HighDensitySolverA05({
      ...defaultA05Params,
      highResolutionCellSize: 0.25,
      lowResolutionCellSize: 0.5,
      nodeWithPortPoints,
    }),
  )

const createA08Solver = () =>
  solveSolver(
    new HighDensitySolverA08({
      ...defaultA08Params,
      cellSizeMm: 0.25,
      nodeWithPortPoints,
    }),
  )

const createA09Solver = () =>
  solveSolver(
    new HighDensitySolverA09({
      ...defaultA09Params,
      highResolutionCellSize: 0.25,
      lowResolutionCellSize: 0.5,
      nodeWithPortPoints,
    }),
  )

for (const [solverName, createSolver] of [
  ["A01", createA01Solver],
  ["A02", createA02Solver],
  ["A03", createA03Solver],
  ["A05", createA05Solver],
  ["A08", createA08Solver],
  ["A09", createA09Solver],
] as const) {
  test(`${solverName} SVG snapshot`, async () => {
    await expect(createSolver().visualize()).toMatchGraphicsSvg(
      import.meta.path,
      {
        svgName: solverName,
      },
    )
  })
}
