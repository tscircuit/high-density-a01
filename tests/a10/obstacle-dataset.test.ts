import { expect, setDefaultTimeout, test } from "bun:test"
import { a10ObstacleDataset } from "../../fixtures/dataset-a10/a10-obstacle-dataset"
import { HighDensitySolverA10 } from "../../lib"
import type {
  HighDensityRoutePoint,
  SimpleRouteJsonRectObstacle,
} from "../../lib"

setDefaultTimeout(120_000)

function layerMatches(
  obstacle: SimpleRouteJsonRectObstacle,
  z: number,
  layerCount: number,
) {
  if (!obstacle.layers || obstacle.layers.length === 0) return true
  return obstacle.layers.some((rawLayerName) => {
    const layerName = rawLayerName.toLowerCase()
    if (layerName === "top" || layerName === "f.cu") return z === 0
    if (layerName === "bottom" || layerName === "b.cu") {
      return z === layerCount - 1
    }
    const numericLayer = Number(layerName)
    return Number.isFinite(numericLayer) && numericLayer === z
  })
}

function pointInsideInflatedObstacle(
  point: HighDensityRoutePoint,
  obstacle: SimpleRouteJsonRectObstacle,
  obstacleMargin: number,
) {
  const theta = -((obstacle.ccwRotationDegrees ?? 0) * Math.PI) / 180
  const dx = point.x - obstacle.center.x
  const dy = point.y - obstacle.center.y
  const localX = dx * Math.cos(theta) - dy * Math.sin(theta)
  const localY = dx * Math.sin(theta) + dy * Math.cos(theta)

  return (
    Math.abs(localX) <= obstacle.width / 2 + obstacleMargin &&
    Math.abs(localY) <= obstacle.height / 2 + obstacleMargin
  )
}

test("A10 obstacle dataset contains 50 deterministic obstacle samples", () => {
  expect(a10ObstacleDataset).toHaveLength(50)
  expect(
    new Set(a10ObstacleDataset.map((sample) => sample.nodeSizeMm)),
  ).toEqual(new Set([5, 10, 20]))

  let edgeOverlapCount = 0
  for (const sample of a10ObstacleDataset) {
    expect(sample.obstacleMargin).toBe(0.15)
    expect(sample.obstacles.length).toBeGreaterThanOrEqual(1)
    expect(sample.obstacles.length).toBeLessThanOrEqual(4)
    for (const obstacle of sample.obstacles) {
      const edge = sample.nodeSizeMm / 2
      const halfWidth = obstacle.width / 2
      const halfHeight = obstacle.height / 2
      if (
        Math.abs(obstacle.center.x) + halfWidth > edge ||
        Math.abs(obstacle.center.y) + halfHeight > edge
      ) {
        edgeOverlapCount += 1
      }
    }
  }
  expect(edgeOverlapCount).toBeGreaterThan(0)
})

test("A10 detours around a rect obstacle on the direct route", () => {
  const obstacle: SimpleRouteJsonRectObstacle = {
    type: "rect",
    layers: ["top", "bottom"],
    center: { x: 0, y: 0 },
    width: 1,
    height: 1,
    connectedTo: [],
  }
  const solver = new HighDensitySolverA10({
    nodeWithPortPoints: {
      capacityMeshNodeId: "a10_direct_obstacle",
      center: { x: 0, y: 0 },
      width: 5,
      height: 5,
      availableZ: [0, 1],
      portPoints: [
        { connectionName: "trace_0", x: -2.5, y: 0, z: 0 },
        { connectionName: "trace_0", x: 2.5, y: 0, z: 0 },
      ],
    },
    obstacles: [obstacle],
    obstacleMargin: 0.15,
    cellSizeMm: 0.5,
    traceThickness: 0.1,
    traceMargin: 0.15,
    viaDiameter: 0.3,
    viaMinDistFromBorder: 0.15,
  })

  solver.solve()

  expect(solver.failed).toBeFalse()
  const route = solver.getOutput()[0]
  expect(route).toBeDefined()
  expect(route!.route.some((point) => Math.abs(point.y) > 0.75)).toBeTrue()
  for (const point of route!.route) {
    expect(pointInsideInflatedObstacle(point, obstacle, 0.15)).toBeFalse()
  }
})

test("A10 solves the obstacle dataset without routing through obstacles", () => {
  for (const sample of a10ObstacleDataset) {
    const solver = new HighDensitySolverA10({
      nodeWithPortPoints: sample.nodeWithPortPoints,
      obstacles: sample.obstacles,
      obstacleMargin: sample.obstacleMargin,
      cellSizeMm: 0.5,
      traceThickness: 0.1,
      traceMargin: 0.15,
      viaDiameter: 0.3,
      viaMinDistFromBorder: 0.15,
      effort: 2,
    })
    solver.MAX_ITERATIONS = 2_000_000
    solver.solve()

    expect(
      solver.failed,
      `${sample.sampleId} failed after ${solver.iterations} iterations: ${solver.error}`,
    ).toBeFalse()
    expect(solver.solved, `${sample.sampleId} did not solve`).toBeTrue()

    const routes = solver.getOutput()
    const layerCount = sample.nodeWithPortPoints.availableZ?.length ?? 2
    for (const route of routes) {
      for (const point of route.route) {
        for (const obstacle of sample.obstacles) {
          if (!layerMatches(obstacle, point.z, layerCount)) continue
          expect(
            pointInsideInflatedObstacle(point, obstacle, sample.obstacleMargin),
            `${sample.sampleId} ${route.connectionName} point (${point.x}, ${point.y}, z=${point.z}) overlaps obstacle ${JSON.stringify(
              obstacle,
            )}`,
          ).toBeFalse()
        }
      }
      for (const via of route.vias) {
        for (const obstacle of sample.obstacles) {
          expect(
            pointInsideInflatedObstacle(
              { ...via, z: 0 },
              obstacle,
              sample.obstacleMargin,
            ),
            `${sample.sampleId} ${route.connectionName} via (${via.x}, ${via.y}) overlaps obstacle ${JSON.stringify(
              obstacle,
            )}`,
          ).toBeFalse()
        }
      }
    }
  }
})
