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

const createA01Solver = () => {
  const solver = new HighDensitySolverA01({
    ...defaultParams,
    cellSizeMm: 0.25,
    nodeWithPortPoints,
  })
  solver.MAX_ITERATIONS = 1_000_000
  solver.solve()
  return solver
}

const createA02Solver = () => {
  const solver = new HighDensitySolverA02({
    ...defaultA02Params,
    outerGridCellSize: 0.25,
    innerGridCellSize: 0.5,
    nodeWithPortPoints,
  })
  solver.MAX_ITERATIONS = 1_000_000
  solver.solve()
  return solver
}

const createA03Solver = () => {
  const solver = new HighDensitySolverA03({
    ...defaultA03Params,
    highResolutionCellSize: 0.25,
    lowResolutionCellSize: 0.5,
    nodeWithPortPoints,
  })
  solver.MAX_ITERATIONS = 1_000_000
  solver.solve()
  return solver
}

const createA05Solver = () => {
  const solver = new HighDensitySolverA05({
    ...defaultA05Params,
    highResolutionCellSize: 0.25,
    lowResolutionCellSize: 0.5,
    nodeWithPortPoints,
  })
  solver.MAX_ITERATIONS = 1_000_000
  solver.solve()
  return solver
}

const createA08Solver = () => {
  const solver = new HighDensitySolverA08({
    ...defaultA08Params,
    cellSizeMm: 0.25,
    nodeWithPortPoints,
  })
  solver.MAX_ITERATIONS = 1_000_000
  solver.solve()
  return solver
}

const createA09Solver = () => {
  const solver = new HighDensitySolverA09({
    ...defaultA09Params,
    highResolutionCellSize: 0.25,
    lowResolutionCellSize: 0.5,
    nodeWithPortPoints,
  })
  solver.MAX_ITERATIONS = 1_000_000
  solver.solve()
  return solver
}

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
