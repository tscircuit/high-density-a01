import { expect, test } from "bun:test"
import {
  normalizeRouteToTotalSegmentCount,
  runForceDirectedRouteReflow,
} from "../lib/routeReflow"
import type {
  HighDensityIntraNodeRoute,
  NodeWithPortPoints,
} from "../lib/types"

test("normalizeRouteToTotalSegmentCount counts vias toward the target total", () => {
  const route: HighDensityIntraNodeRoute = {
    connectionName: "conn00",
    rootConnectionName: "root00",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    vias: [{ x: 0, y: 0.5 }],
    route: [
      { x: -3, y: 0, z: 0 },
      { x: -2, y: 0.25, z: 0 },
      { x: -1, y: 0.5, z: 0 },
      { x: 0, y: 0.5, z: 0 },
      { x: 0, y: 0.5, z: 1 },
      { x: 1, y: 0.5, z: 1 },
      { x: 2, y: 0.25, z: 1 },
      { x: 3, y: 0, z: 1 },
    ],
  }

  const normalized = normalizeRouteToTotalSegmentCount(route, 16)

  expect(normalized.route.length - 1).toBe(16)
  expect(normalized.vias).toEqual([{ x: 0, y: 0.5 }])
  expect(normalized.route[0]).toEqual(route.route[0])
  expect(normalized.route[normalized.route.length - 1]).toEqual(
    route.route[route.route.length - 1],
  )
})

test("runForceDirectedRouteReflow keeps routes inside node bounds", () => {
  const nodeWithPortPoints: NodeWithPortPoints = {
    capacityMeshNodeId: "route-reflow-bounds",
    center: { x: 0, y: 0 },
    width: 8,
    height: 8,
    availableZ: [0, 1],
    portPoints: [
      {
        connectionName: "conn00",
        rootConnectionName: "root00",
        x: -4,
        y: -1,
        z: 0,
      },
      {
        connectionName: "conn00",
        rootConnectionName: "root00",
        x: 4,
        y: 1,
        z: 0,
      },
      {
        connectionName: "conn01",
        rootConnectionName: "root01",
        x: -4,
        y: 1,
        z: 1,
      },
      {
        connectionName: "conn01",
        rootConnectionName: "root01",
        x: 4,
        y: -1,
        z: 1,
      },
    ],
  }

  const routes: HighDensityIntraNodeRoute[] = [
    {
      connectionName: "conn00",
      rootConnectionName: "root00",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      vias: [],
      route: [
        { x: -4, y: -1, z: 0 },
        { x: -1, y: 2, z: 0 },
        { x: 1, y: -2, z: 0 },
        { x: 4, y: 1, z: 0 },
      ],
    },
    {
      connectionName: "conn01",
      rootConnectionName: "root01",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      vias: [],
      route: [
        { x: -4, y: 1, z: 1 },
        { x: -1, y: -2, z: 1 },
        { x: 1, y: 2, z: 1 },
        { x: 4, y: -1, z: 1 },
      ],
    },
  ]

  const improvedRoutes = runForceDirectedRouteReflow(
    nodeWithPortPoints,
    routes,
    20,
  )
  const bounds = {
    minX: nodeWithPortPoints.center.x - nodeWithPortPoints.width / 2,
    maxX: nodeWithPortPoints.center.x + nodeWithPortPoints.width / 2,
    minY: nodeWithPortPoints.center.y - nodeWithPortPoints.height / 2,
    maxY: nodeWithPortPoints.center.y + nodeWithPortPoints.height / 2,
  }

  for (const route of improvedRoutes) {
    for (const point of route.route) {
      expect(point.x).toBeGreaterThanOrEqual(bounds.minX)
      expect(point.x).toBeLessThanOrEqual(bounds.maxX)
      expect(point.y).toBeGreaterThanOrEqual(bounds.minY)
      expect(point.y).toBeLessThanOrEqual(bounds.maxY)
    }
  }
})
