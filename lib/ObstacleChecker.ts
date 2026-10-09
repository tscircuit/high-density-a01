import { segmentToBoxMinDistance } from "@tscircuit/math-utils"
import Flatbush from "flatbush"

export type HighDensityObstacle = {
  center: { x: number; y: number }
  width: number
  height: number
  zLayers: number[]
  connectedTo: string[]
  ccwRotationDegrees?: number
}

export type ObstacleConnectivityMap = {
  areIdsConnected(a: string, b: string): boolean
}

type RoutePoint = { x: number; y: number; z: number }

/** Fixed copper cannot be ripped up by the grid search. */
export class ObstacleChecker {
  private foreignByConnection = new Map<string, Set<number>>()
  private index: Flatbush

  constructor(
    private obstacles: HighDensityObstacle[],
    private connMap?: ObstacleConnectivityMap,
  ) {
    this.index = new Flatbush(obstacles.length)
    for (const obstacle of obstacles) {
      const angle = ((obstacle.ccwRotationDegrees ?? 0) * Math.PI) / 180
      const halfWidth =
        (Math.abs(Math.cos(angle)) * obstacle.width +
          Math.abs(Math.sin(angle)) * obstacle.height) /
        2
      const halfHeight =
        (Math.abs(Math.sin(angle)) * obstacle.width +
          Math.abs(Math.cos(angle)) * obstacle.height) /
        2
      this.index.add(
        obstacle.center.x - halfWidth,
        obstacle.center.y - halfHeight,
        obstacle.center.x + halfWidth,
        obstacle.center.y + halfHeight,
      )
    }
    this.index.finish()
  }

  isRouteBlocked(
    points: RoutePoint[],
    connectionName: string,
    rootConnectionName: string,
    traceClearance: number,
    viaClearance: number,
  ): boolean {
    return points.some((end, index) => {
      const start = points[Math.max(0, index - 1)]!
      return this.isBlocked(
        start,
        end,
        connectionName,
        rootConnectionName,
        start.z === end.z ? traceClearance : viaClearance,
      )
    })
  }

  isBlocked(
    start: RoutePoint,
    end: RoutePoint,
    connectionName: string,
    rootConnectionName: string,
    clearance: number,
  ): boolean {
    let obstacles = this.foreignByConnection.get(connectionName)
    if (!obstacles) {
      obstacles = new Set(
        this.obstacles.flatMap((obstacle, index) =>
          obstacle.connectedTo.some(
            (id) =>
              id === connectionName ||
              id === rootConnectionName ||
              this.connMap?.areIdsConnected(connectionName, id) ||
              this.connMap?.areIdsConnected(rootConnectionName, id),
          )
            ? []
            : [index],
        ),
      )
      this.foreignByConnection.set(connectionName, obstacles)
    }

    const nearby = this.index.search(
      Math.min(start.x, end.x) - clearance,
      Math.min(start.y, end.y) - clearance,
      Math.max(start.x, end.x) + clearance,
      Math.max(start.y, end.y) + clearance,
    )
    for (const index of nearby) {
      if (!obstacles.has(index)) continue
      const obstacle = this.obstacles[index]!
      if (
        !obstacle.zLayers.some(
          (z) => z >= Math.min(start.z, end.z) && z <= Math.max(start.z, end.z),
        )
      )
        continue
      const angle = (-(obstacle.ccwRotationDegrees ?? 0) * Math.PI) / 180
      const cos = Math.cos(angle)
      const sin = Math.sin(angle)
      const sx = start.x - obstacle.center.x
      const sy = start.y - obstacle.center.y
      const ex = end.x - obstacle.center.x
      const ey = end.y - obstacle.center.y
      const distance = segmentToBoxMinDistance(
        { x: sx * cos - sy * sin, y: sx * sin + sy * cos },
        { x: ex * cos - ey * sin, y: ex * sin + ey * cos },
        {
          center: { x: 0, y: 0 },
          width: obstacle.width,
          height: obstacle.height,
        },
      )
      if (distance < clearance - 1e-9) return true
    }
    return false
  }
}
