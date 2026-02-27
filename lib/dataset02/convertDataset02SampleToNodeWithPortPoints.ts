import type { NodeWithPortPoints } from "../types"

export type Dataset02Connection = {
  connectionId: string
  startRegionId: string
  endRegionId: string
}

export type Dataset02Region = {
  regionId: string
  d: {
    bounds: {
      minX: number
      maxX: number
      minY: number
      maxY: number
    }
    center: {
      x: number
      y: number
    }
  }
}

export type Dataset02Sample = {
  config: {
    seed: number
    rows: number
    cols: number
    orientation: "vertical" | "horizontal"
    numCrossings: number
  }
  connections: Dataset02Connection[]
  connectionRegions: Dataset02Region[]
}

type ConvertDataset02SampleOptions = {
  capacityMeshNodeId?: string
  borderPaddingMm?: number
  availableZ?: number[]
}

export const convertDataset02SampleToNodeWithPortPoints = (
  sample: Dataset02Sample,
  options: ConvertDataset02SampleOptions = {},
): NodeWithPortPoints => {
  const borderPaddingMm = options.borderPaddingMm ?? 0
  const availableZ = options.availableZ ?? [0, 1]

  const regionById = new Map(
    sample.connectionRegions.map((region) => [region.regionId, region]),
  )

  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  for (const connection of sample.connections) {
    const startRegion = regionById.get(connection.startRegionId)
    const endRegion = regionById.get(connection.endRegionId)

    if (!startRegion || !endRegion) {
      throw new Error(
        `Missing region for connection ${connection.connectionId}: ${connection.startRegionId} -> ${connection.endRegionId}`,
      )
    }

    minX = Math.min(minX, startRegion.d.center.x, endRegion.d.center.x)
    maxX = Math.max(maxX, startRegion.d.center.x, endRegion.d.center.x)
    minY = Math.min(minY, startRegion.d.center.y, endRegion.d.center.y)
    maxY = Math.max(maxY, startRegion.d.center.y, endRegion.d.center.y)
  }

  const width = maxX - minX + borderPaddingMm * 2
  const height = maxY - minY + borderPaddingMm * 2
  const center = {
    x: (minX + maxX) / 2,
    y: (minY + maxY) / 2,
  }

  const portPoints = sample.connections.flatMap((connection) => {
    const startRegion = regionById.get(connection.startRegionId)
    const endRegion = regionById.get(connection.endRegionId)

    if (!startRegion || !endRegion) {
      throw new Error(
        `Missing region for connection ${connection.connectionId}: ${connection.startRegionId} -> ${connection.endRegionId}`,
      )
    }

    return [
      {
        connectionName: connection.connectionId,
        x: startRegion.d.center.x,
        y: startRegion.d.center.y,
        z: availableZ[0] ?? 0,
      },
      {
        connectionName: connection.connectionId,
        x: endRegion.d.center.x,
        y: endRegion.d.center.y,
        z: availableZ[0] ?? 0,
      },
    ]
  })

  return {
    capacityMeshNodeId:
      options.capacityMeshNodeId ??
      `dataset02-${sample.config.seed}-${sample.config.rows}x${sample.config.cols}`,
    center,
    width,
    height,
    portPoints,
    availableZ,
  }
}
