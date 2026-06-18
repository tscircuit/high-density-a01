import type { NodeWithPortPoints, SimpleRouteJsonRectObstacle } from "../../lib"

export type A10ObstacleDatasetSample = {
  sampleId: string
  nodeSizeMm: 5 | 10 | 20
  obstacleMargin: 0.15
  nodeWithPortPoints: NodeWithPortPoints
  obstacles: SimpleRouteJsonRectObstacle[]
}

function createRng(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0xffffffff
  }
}

function rounded(value: number) {
  return Math.round(value * 1000) / 1000
}

function createPortPoints(size: number) {
  const edge = size / 2
  return [
    {
      connectionName: "trace_left_right_lower",
      x: -edge,
      y: -size * 0.32,
      z: 0,
    },
    {
      connectionName: "trace_left_right_lower",
      x: edge,
      y: -size * 0.32,
      z: 0,
    },
  ].map((port) => ({
    ...port,
    x: rounded(port.x),
    y: rounded(port.y),
  }))
}

export function createA10ObstacleDataset(): A10ObstacleDatasetSample[] {
  const rng = createRng(0xa10)
  const nodeSizes = [5, 10, 20] as const
  const samples: A10ObstacleDatasetSample[] = []

  for (let sampleIndex = 0; sampleIndex < 50; sampleIndex++) {
    const nodeSizeMm = nodeSizes[sampleIndex % nodeSizes.length]!
    const edge = nodeSizeMm / 2
    const obstacleCount = 1 + Math.floor(rng() * 4)
    const obstacles: SimpleRouteJsonRectObstacle[] = []

    for (
      let obstacleIndex = 0;
      obstacleIndex < obstacleCount;
      obstacleIndex++
    ) {
      const overlapsEdge = (sampleIndex + obstacleIndex) % 6 === 0
      const width = nodeSizeMm * (0.11 + rng() * 0.08)
      const height = nodeSizeMm * (0.1 + rng() * 0.09)
      let cx = (rng() - 0.5) * nodeSizeMm * 0.28
      let cy = (rng() - 0.5) * nodeSizeMm * 0.28

      if (overlapsEdge) {
        if (rng() < 0.5) {
          cx = (rng() < 0.5 ? -1 : 1) * (edge - width * 0.35)
          cy = (rng() - 0.5) * nodeSizeMm * 0.25
        } else {
          cx = (rng() - 0.5) * nodeSizeMm * 0.25
          cy = (rng() < 0.5 ? -1 : 1) * (edge - height * 0.35)
        }
      }

      const layerRoll = rng()
      const layers =
        layerRoll < 0.33
          ? ["top"]
          : layerRoll < 0.66
            ? ["bottom"]
            : ["top", "bottom"]

      obstacles.push({
        type: "rect",
        layers,
        center: { x: rounded(cx), y: rounded(cy) },
        width: rounded(width),
        height: rounded(height),
        connectedTo: [],
      })
    }

    samples.push({
      sampleId: `a10_obstacle_${String(sampleIndex + 1).padStart(3, "0")}`,
      nodeSizeMm,
      obstacleMargin: 0.15,
      nodeWithPortPoints: {
        capacityMeshNodeId: `a10_obstacle_${String(sampleIndex + 1).padStart(
          3,
          "0",
        )}`,
        center: { x: 0, y: 0 },
        width: nodeSizeMm,
        height: nodeSizeMm,
        availableZ: [0, 1],
        portPoints: createPortPoints(nodeSizeMm),
      },
      obstacles,
    })
  }

  return samples
}

export const a10ObstacleDataset = createA10ObstacleDataset()
