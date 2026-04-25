import { expect, setDefaultTimeout, test } from "bun:test"

setDefaultTimeout(120_000)
import "graphics-debug/matcher"
import { defaultA09Params } from "../../../lib/default-params"
import { HighDensitySolverA09 } from "../../../lib/HighDensitySolverA09/HighDensitySolverA09"
import {
  findRouteGeometryViolations,
  findSameLayerIntersections,
  validateNoIntersections,
  validateRouteGeometry,
} from "../../fixtures/validateNoIntersections"
import sample009 from "./sample009.json"

function createSolver() {
  const solver = new HighDensitySolverA09({
    ...defaultA09Params,
    nodeWithPortPoints: sample009.nodeWithPortPoints,
  })
  solver.MAX_ITERATIONS = 100_000_000
  solver.solve()
  return solver
}

test("sample009 A09 solve", async () => {
  const solver = createSolver()

  console.log(
    `solved=${solver.solved} failed=${solver.failed} iterations=${solver.iterations} error=${solver.error}`,
  )
  console.log(`routes=${solver.getOutput().length}`)

  expect(solver.iterations).toBeGreaterThan(0)
  expect(solver.effort).toBe(1)
  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  expect(solver.getOutput()).toHaveLength(6)

  const graphics = solver.visualize()
  expect(graphics).toBeTruthy()
  await expect(graphics).toMatchGraphicsSvg(import.meta.path, {
    svgName: "sample009-a09",
  })

  const routes = solver.getOutput()
  const intersections = findSameLayerIntersections(routes)
  const violations = findRouteGeometryViolations(routes)

  if (intersections.length > 0) {
    console.log("Found intersections:")
    for (const intersection of intersections) {
      console.log(
        `  ${intersection.trace1} x ${intersection.trace2} on z=${intersection.z} [${intersection.type}] at (${intersection.point.x.toFixed(3)}, ${intersection.point.y.toFixed(3)})`,
      )
    }
  }

  if (violations.length > 0) {
    console.log("Found route geometry violations:")
    for (const violation of violations) {
      console.log(
        `  ${violation.trace1} x ${violation.trace2} [${violation.type}] z=${violation.z ?? "all"} dist=${violation.distance.toFixed(3)} req=${violation.requiredDistance.toFixed(3)}`,
      )
    }
  }

  validateNoIntersections(routes)
  validateRouteGeometry(routes)

  const node = sample009.nodeWithPortPoints
  const bottomBoundaryY = node.center.y - node.height / 2
  const sourceNet0 = routes.find(
    (route) => route.connectionName === "source_net_0_mst10",
  )
  expect(sourceNet0).toBeDefined()
  expect(Math.min(...sourceNet0!.route.map((point) => point.y))).toBeLessThan(
    bottomBoundaryY + 0.2,
  )

  for (const route of routes) {
    for (const via of route.vias) {
      const sitsOnLayerTransition = route.route.some((point, index) => {
        if (
          Math.abs(point.x - via.x) > 1e-6 ||
          Math.abs(point.y - via.y) > 1e-6
        ) {
          return false
        }

        const previous = route.route[index - 1]
        const next = route.route[index + 1]
        const previousMatches =
          previous &&
          Math.abs(previous.x - via.x) <= 1e-6 &&
          Math.abs(previous.y - via.y) <= 1e-6 &&
          previous.z !== point.z
        const nextMatches =
          next &&
          Math.abs(next.x - via.x) <= 1e-6 &&
          Math.abs(next.y - via.y) <= 1e-6 &&
          next.z !== point.z
        return Boolean(previousMatches || nextMatches)
      })

      expect(sitsOnLayerTransition).toBeTrue()
    }
  }
})

test("sample009 A09 visualize shows active iteration state", () => {
  const solver = new HighDensitySolverA09({
    ...defaultA09Params,
    nodeWithPortPoints: sample009.nodeWithPortPoints,
  })
  solver.MAX_ITERATIONS = 100_000_000
  solver.setup()
  solver.step()
  solver.step()
  solver.step()

  const graphics = solver.visualize()
  expect(graphics.title).toContain("order 1/")
  expect(graphics.title).toContain("connection 1/")
  expect(graphics.texts?.[0]?.text).toContain("active 0/")
  expect(graphics.points?.length ?? 0).toBeGreaterThan(
    sample009.nodeWithPortPoints.portPoints.length,
  )
})
