import { expect, test } from "bun:test"
import type { HighDensityIntraNodeRoute } from "../lib/types"
import {
  findSameLayerIntersections,
  findRouteGeometryViolations,
  validateNoIntersections,
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

test("route geometry validator ignores declared shared endpoints", () => {
  const routes: HighDensityIntraNodeRoute[] = [
    {
      connectionName: "net_a",
      traceThickness: 0.1,
      viaDiameter: 0.2,
      route: [
        { x: 0, y: 0, z: 0, portPointId: "shared-port" },
        { x: -1, y: 1, z: 0 },
      ],
      vias: [],
    },
    {
      connectionName: "net_b",
      traceThickness: 0.1,
      viaDiameter: 0.2,
      route: [
        { x: 0, y: 0, z: 0, portPointId: "shared-port" },
        { x: 1, y: 1, z: 0 },
      ],
      vias: [],
    },
  ]

  expect(findSameLayerIntersections(routes)).toHaveLength(0)
  expect(findRouteGeometryViolations(routes)).toHaveLength(0)
  expect(() => validateNoIntersections(routes)).not.toThrow()
  expect(() => validateRouteGeometry(routes)).not.toThrow()
})

for (const axis of ["x", "y"] as const)
  for (const kind of [
    "trace_clearance",
    "via_trace_clearance",
    "via_via_clearance",
  ] as const)
    test(`clearance broad phase preserves ${kind} at the ${axis} tolerance boundary`, () => {
      const point = (value: number) => ({
        x: axis === "x" ? value : 0,
        y: axis === "y" ? value : 0,
        z: 0,
      })
      for (const gap of [0.19, 0.2 - 2e-6, 0.2 - 5e-7, 0.2, 0.21]) {
        const a: HighDensityIntraNodeRoute = {
          connectionName: "a",
          traceThickness: 0.2,
          viaDiameter: 0.2,
          route: kind === "trace_clearance" ? [point(-2), point(0)] : [],
          vias: kind === "trace_clearance" ? [] : [point(0)],
        }
        const b: HighDensityIntraNodeRoute = {
          connectionName: "b",
          traceThickness: 0.2,
          viaDiameter: 0.2,
          route:
            kind === "via_via_clearance" ? [] : [point(gap), point(gap + 2)],
          vias: kind === "via_via_clearance" ? [point(gap)] : [],
        }
        expect(
          findRouteGeometryViolations([a, b]).some((v) => v.type === kind),
        ).toBe(gap + 1e-6 < 0.2)
        expect(
          findRouteGeometryViolations([b, a]).some((v) => v.type === kind),
        ).toBe(gap + 1e-6 < 0.2)
      }
    })
