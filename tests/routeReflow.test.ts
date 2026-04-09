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

test("runForceDirectedRouteReflow pulls vias inward from boundary-heavy routes", () => {
  const nodeWithPortPoints: NodeWithPortPoints = {
    capacityMeshNodeId: "route-reflow-via-center",
    center: { x: 0, y: 0 },
    width: 8,
    height: 8,
    availableZ: [0, 1],
    portPoints: [
      {
        connectionName: "conn00",
        rootConnectionName: "root00",
        x: 4,
        y: 3,
        z: 0,
      },
      {
        connectionName: "conn00",
        rootConnectionName: "root00",
        x: 4,
        y: -3,
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
      vias: [{ x: 3.2, y: 0.4 }],
      route: [
        { x: 4, y: 3, z: 0 },
        { x: 3.2, y: 0.4, z: 0 },
        { x: 3.2, y: 0.4, z: 1 },
        { x: 4, y: -3, z: 1 },
      ],
    },
  ]

  const improvedRoutes = runForceDirectedRouteReflow(
    nodeWithPortPoints,
    routes,
    30,
  )
  const via = improvedRoutes[0]?.vias[0]

  expect(via).toBeDefined()
  expect(via?.x).toBeLessThan(3.05)
  expect(via?.x).toBeLessThan(routes[0]!.vias[0]!.x)
})

test("runForceDirectedRouteReflow relaxes endpoint orthogonal locking near corners", () => {
  const makeSample = (endpointY: number): NodeWithPortPoints => ({
    capacityMeshNodeId: `route-reflow-corner-${endpointY}`,
    center: { x: 0, y: 0 },
    width: 8,
    height: 8,
    availableZ: [0],
    portPoints: [
      {
        connectionName: "conn00",
        rootConnectionName: "root00",
        x: -4,
        y: endpointY,
        z: 0,
      },
      {
        connectionName: "conn00",
        rootConnectionName: "root00",
        x: 4,
        y: 0,
        z: 0,
      },
    ],
  })

  const makeRoute = (endpointY: number): HighDensityIntraNodeRoute => ({
    connectionName: "conn00",
    rootConnectionName: "root00",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    vias: [],
    route: [
      { x: -4, y: endpointY, z: 0 },
      { x: -2.6, y: endpointY + 1.2, z: 0 },
      { x: 0.5, y: 0.8, z: 0 },
      { x: 4, y: 0, z: 0 },
    ],
  })

  const centerEdgeRoute = runForceDirectedRouteReflow(
    makeSample(-2),
    [makeRoute(-2)],
    30,
  )[0]
  const cornerRoute = runForceDirectedRouteReflow(
    makeSample(-3.8),
    [makeRoute(-3.8)],
    30,
  )[0]

  const centerOffset = Math.abs(
    (centerEdgeRoute?.route[1]?.y ?? 0) - (centerEdgeRoute?.route[0]?.y ?? 0),
  )
  const cornerOffset = Math.abs(
    (cornerRoute?.route[1]?.y ?? 0) - (cornerRoute?.route[0]?.y ?? 0),
  )

  expect(centerOffset).toBeLessThan(0.55)
  expect(cornerOffset).toBeGreaterThan(centerOffset + 0.5)
})

test("runForceDirectedRouteReflow steers vias away from bottom-heavy port distributions", () => {
  const nodeWithPortPoints: NodeWithPortPoints = {
    capacityMeshNodeId: "route-reflow-via-gravity-shift",
    center: { x: 0, y: 0 },
    width: 8,
    height: 8,
    availableZ: [0, 1],
    portPoints: [
      {
        connectionName: "conn00",
        rootConnectionName: "root00",
        x: -2.5,
        y: -4,
        z: 0,
      },
      {
        connectionName: "conn00",
        rootConnectionName: "root00",
        x: 2.5,
        y: -4,
        z: 1,
      },
      {
        connectionName: "dummy-left",
        rootConnectionName: "dummy-left",
        x: -3.5,
        y: -4,
        z: 0,
      },
      {
        connectionName: "dummy-right",
        rootConnectionName: "dummy-right",
        x: 3.5,
        y: -4,
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
      vias: [{ x: 0, y: -2.4 }],
      route: [
        { x: -2.5, y: -4, z: 0 },
        { x: 0, y: -2.4, z: 0 },
        { x: 0, y: -2.4, z: 1 },
        { x: 2.5, y: -4, z: 1 },
      ],
    },
  ]

  const improvedRoutes = runForceDirectedRouteReflow(
    nodeWithPortPoints,
    routes,
    30,
  )
  const via = improvedRoutes[0]?.vias[0]

  expect(via).toBeDefined()
  expect(via?.y).toBeGreaterThan(-2.05)
  expect(via?.y).toBeGreaterThan(routes[0]!.vias[0]!.y)
})
