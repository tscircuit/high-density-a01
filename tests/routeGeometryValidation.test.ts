import { expect, test } from "bun:test"
import type { HighDensityIntraNodeRoute } from "../lib/types"
import {
  findRouteGeometryViolations,
  validateRouteGeometry,
} from "./fixtures/validateNoIntersections"

test("route geometry validator accepts well-spaced routes", () => {
  const routes: HighDensityIntraNodeRoute[] = [
    {
      connectionName: "net_a",
      traceThickness: 0.1,
      viaDiameter: 0.2,
      route: [
        { x: 0, y: 0, z: 0 },
        { x: 2, y: 0, z: 0 },
      ],
      vias: [],
    },
    {
      connectionName: "net_b",
      traceThickness: 0.1,
      viaDiameter: 0.2,
      route: [
        { x: 0, y: 0.5, z: 0 },
        { x: 2, y: 0.5, z: 0 },
      ],
      vias: [],
    },
  ]

  expect(findRouteGeometryViolations(routes)).toHaveLength(0)
  expect(() => validateRouteGeometry(routes)).not.toThrow()
})

test("route geometry validator catches trace clearance violations", () => {
  const routes: HighDensityIntraNodeRoute[] = [
    {
      connectionName: "net_a",
      traceThickness: 0.2,
      viaDiameter: 0.2,
      route: [
        { x: 0, y: 0, z: 0 },
        { x: 2, y: 0, z: 0 },
      ],
      vias: [],
    },
    {
      connectionName: "net_b",
      traceThickness: 0.2,
      viaDiameter: 0.2,
      route: [
        { x: 0, y: 0.15, z: 0 },
        { x: 2, y: 0.15, z: 0 },
      ],
      vias: [],
    },
  ]

  const violations = findRouteGeometryViolations(routes)
  expect(
    violations.some((violation) => violation.type === "trace_clearance"),
  ).toBe(true)
})

test("route geometry validator catches via clearance violations", () => {
  const routes: HighDensityIntraNodeRoute[] = [
    {
      connectionName: "net_a",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
      ],
      vias: [{ x: 0.5, y: 0.12 }],
    },
    {
      connectionName: "net_b",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: 0.55, y: -0.2, z: 0 },
        { x: 0.55, y: 0.8, z: 0 },
      ],
      vias: [{ x: 0.65, y: 0.12 }],
    },
  ]

  const violations = findRouteGeometryViolations(routes)
  expect(
    violations.some((violation) => violation.type === "via_via_clearance"),
  ).toBe(true)
  expect(
    violations.some((violation) => violation.type === "via_trace_clearance"),
  ).toBe(true)
})
