import { expect, test } from "bun:test"
import { defaultParams } from "../../../lib/default-params"
import { HighDensitySolverA01 } from "../../../lib/HighDensitySolverA01/HighDensitySolverA01"
import type { NodeWithPortPoints } from "../../../lib/types"
import { validateNoIntersections } from "../../fixtures/validateNoIntersections"

const boundaryCoordinateNoiseMm = 2.1349678824833518e-7

const nodeWithPortPoints: NodeWithPortPoints = {
  capacityMeshNodeId: "boundary-coordinate-tolerance-node",
  center: { x: 5, y: 5 },
  width: 10,
  height: 10,
  availableZ: [0, 1],
  portPoints: [
    {
      connectionName: "transition",
      x: 5,
      y: 10 + boundaryCoordinateNoiseMm,
      z: 0,
    },
    {
      connectionName: "transition",
      x: 5,
      y: -boundaryCoordinateNoiseMm,
      z: 1,
    },
    {
      connectionName: "flat",
      x: -boundaryCoordinateNoiseMm,
      y: 5,
      z: 0,
    },
    {
      connectionName: "flat",
      x: 10 + boundaryCoordinateNoiseMm,
      y: 5,
      z: 0,
    },
  ],
}

function createBoundaryToleranceSolver(): HighDensitySolverA01 {
  const solver = new HighDensitySolverA01({
    ...defaultParams,
    nodeWithPortPoints,
  })
  solver.solve()
  return solver
}

test("A01 deterministically routes noisy boundary coordinates without moving endpoints", () => {
  const firstSolver = createBoundaryToleranceSolver()
  const repeatedSolver = createBoundaryToleranceSolver()
  const firstOutput = firstSolver.getOutput()
  const flatRoute = firstOutput.find((route) => route.connectionName === "flat")
  const transitionRoute = firstOutput.find(
    (route) => route.connectionName === "transition",
  )

  expect(firstSolver.solved).toBe(true)
  expect(firstSolver.failed).toBe(false)
  expect(repeatedSolver.getOutput()).toEqual(firstOutput)
  expect(flatRoute?.route.at(0)).toMatchObject({
    x: -boundaryCoordinateNoiseMm,
    y: 5,
    z: 0,
  })
  expect(flatRoute?.route.at(-1)).toMatchObject({
    x: 10 + boundaryCoordinateNoiseMm,
    y: 5,
    z: 0,
  })
  expect(transitionRoute?.route.at(0)).toMatchObject({
    x: 5,
    y: 10 + boundaryCoordinateNoiseMm,
    z: 0,
  })
  expect(transitionRoute?.route.at(-1)).toMatchObject({
    x: 5,
    y: -boundaryCoordinateNoiseMm,
    z: 1,
  })
  validateNoIntersections(firstOutput)
})
