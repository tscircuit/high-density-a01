import { expect, setDefaultTimeout, test } from "bun:test"
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
import { getConnectionPortPointPairs } from "../../lib/getConnectionPortPointPairs"
import { HighDensitySolverA01 } from "../../lib/HighDensitySolverA01/HighDensitySolverA01"
import { HighDensitySolverA02 } from "../../lib/HighDensitySolverA02/HighDensitySolverA02"
import { HighDensitySolverA03 } from "../../lib/HighDensitySolverA03/HighDensitySolverA03"
import { HighDensitySolverA05 } from "../../lib/HighDensitySolverA05/HighDensitySolverA05"
import { HighDensitySolverA08 } from "../../lib/HighDensitySolverA08/HighDensitySolverA08"
import { HighDensitySolverA09 } from "../../lib/HighDensitySolverA09/HighDensitySolverA09"
import type {
  HighDensityIntraNodeRoute,
  NodeWithPortPoints,
} from "../../lib/types"
import { validateNoIntersections } from "../fixtures/validateNoIntersections"
import prevNextLinkedChains from "./prev-next.json"

setDefaultTimeout(120_000)

const nodeWithPortPoints = prevNextLinkedChains as NodeWithPortPoints

const expectedPairKeys = [
  "bottom-start|top-right-end",
  "left-start|top-left-end",
].sort()

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

function getRoutePairKey(route: HighDensityIntraNodeRoute) {
  const start = route.route[0]
  const end = route.route[route.route.length - 1]

  if (!start || !end) {
    throw new Error(`Route for ${route.connectionName} is missing endpoints`)
  }

  const startId = getClosestPortPointId(route.connectionName, start)
  const endId = getClosestPortPointId(route.connectionName, end)

  return [startId, endId].sort().join("|")
}

function getClosestPortPointId(
  connectionName: string,
  point: { x: number; y: number; z: number; portPointId?: string },
) {
  if (point.portPointId) return point.portPointId

  let closestId: string | undefined
  let closestDistance = Number.POSITIVE_INFINITY

  for (const portPoint of nodeWithPortPoints.portPoints) {
    if (
      portPoint.connectionName !== connectionName ||
      portPoint.z !== point.z
    ) {
      continue
    }

    const distance = Math.hypot(portPoint.x - point.x, portPoint.y - point.y)
    if (distance < closestDistance) {
      closestDistance = distance
      closestId = portPoint.portPointId
    }
  }

  expect(closestId).toBeDefined()
  expect(closestDistance).toBeLessThan(1)
  return closestId!
}

function expectLinkedSegments(routes: HighDensityIntraNodeRoute[]) {
  expect(routes).toHaveLength(expectedPairKeys.length)
  expect(routes.map(getRoutePairKey).sort()).toEqual(expectedPairKeys)
  validateNoIntersections(routes)
}

test("getConnectionPortPointPairs uses prev/next ids instead of fixture order", () => {
  const pairs = getConnectionPortPointPairs(nodeWithPortPoints.portPoints)

  expect(
    pairs
      .map(([start, end]) =>
        [start.portPointId, end.portPointId].sort().join("|"),
      )
      .sort(),
  ).toEqual(expectedPairKeys)
})

test("prev-next linked chains A01 snapshot", async () => {
  const solver = createA01Solver()
  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()

  const routes = solver.getOutput()
  expectLinkedSegments(routes)

  await expect(solver.visualize()).toMatchGraphicsSvg(import.meta.path)
})

for (const [solverName, createSolver] of [
  ["A01", createA01Solver],
  ["A02", createA02Solver],
  ["A03", createA03Solver],
  ["A05", createA05Solver],
  ["A08", createA08Solver],
  ["A09", createA09Solver],
] as const) {
  test(`${solverName} preserves all prev/next linked segments`, () => {
    const solver = createSolver()

    expect(solver.solved).toBeTrue()
    expect(solver.failed).toBeFalse()
    expect(solver.error).toBeNull()

    const routes = solver.getOutput()
    expectLinkedSegments(routes)
  })
}
