import {
  HighDensitySolverA01,
  type HighDensitySolverA01Props,
} from "./HighDensitySolverA01/HighDensitySolverA01"
import type { HighDensityIntraNodeRoute, NodeWithPortPoints } from "./types"

export interface HighDensitySolverA02Props extends HighDensitySolverA01Props {
  outerGridCellSize?: number
  outerGridCellThickness?: number
  innerGridCellSize?: number
}

type AxisWarpConfig = {
  originalMin: number
  originalLength: number
  warpedMin: number
  warpedLength: number
  stripThickness: number
  compressionRatio: number
}

type TwoGridWarpConfig = {
  xAxis: AxisWarpConfig
  yAxis: AxisWarpConfig
  originalNode: NodeWithPortPoints
  warpedNode: NodeWithPortPoints
}

function createAxisWarpConfig(params: {
  originalMin: number
  originalLength: number
  stripThickness: number
  compressionRatio: number
  nodeCenter: number
}): AxisWarpConfig {
  const {
    originalMin,
    originalLength,
    stripThickness,
    compressionRatio,
    nodeCenter,
  } = params
  const innerLength = Math.max(0, originalLength - 2 * stripThickness)
  const warpedLength =
    originalLength <= 2 * stripThickness
      ? originalLength
      : 2 * stripThickness + innerLength / compressionRatio

  return {
    originalMin,
    originalLength,
    warpedMin: nodeCenter - warpedLength / 2,
    warpedLength,
    stripThickness,
    compressionRatio,
  }
}

function warpAxis(v: number, config: AxisWarpConfig): number {
  const rel = v - config.originalMin
  if (config.originalLength <= 2 * config.stripThickness) {
    return config.warpedMin + rel
  }

  const innerLength = config.originalLength - 2 * config.stripThickness

  if (rel <= config.stripThickness) {
    return config.warpedMin + rel
  }
  if (rel >= config.originalLength - config.stripThickness) {
    const rightRel = rel - (config.originalLength - config.stripThickness)
    return (
      config.warpedMin +
      config.stripThickness +
      innerLength / config.compressionRatio +
      rightRel
    )
  }

  const innerRel = rel - config.stripThickness
  return (
    config.warpedMin +
    config.stripThickness +
    innerRel / config.compressionRatio
  )
}

function unwarpAxis(v: number, config: AxisWarpConfig): number {
  const rel = v - config.warpedMin
  if (config.originalLength <= 2 * config.stripThickness) {
    return config.originalMin + rel
  }

  const innerLength = config.originalLength - 2 * config.stripThickness
  const warpedInnerLength = innerLength / config.compressionRatio

  if (rel <= config.stripThickness) {
    return config.originalMin + rel
  }
  if (rel >= config.stripThickness + warpedInnerLength) {
    const rightRel = rel - (config.stripThickness + warpedInnerLength)
    return (
      config.originalMin +
      (config.originalLength - config.stripThickness) +
      rightRel
    )
  }

  const innerRelWarped = rel - config.stripThickness
  return (
    config.originalMin +
    config.stripThickness +
    innerRelWarped * config.compressionRatio
  )
}

function createTwoGridWarpConfig(
  nodeWithPortPoints: NodeWithPortPoints,
  stripThickness: number,
  compressionRatio: number,
): TwoGridWarpConfig {
  const originalLeft =
    nodeWithPortPoints.center.x - nodeWithPortPoints.width / 2
  const originalTop =
    nodeWithPortPoints.center.y - nodeWithPortPoints.height / 2

  const xAxis = createAxisWarpConfig({
    originalMin: originalLeft,
    originalLength: nodeWithPortPoints.width,
    stripThickness,
    compressionRatio,
    nodeCenter: nodeWithPortPoints.center.x,
  })
  const yAxis = createAxisWarpConfig({
    originalMin: originalTop,
    originalLength: nodeWithPortPoints.height,
    stripThickness,
    compressionRatio,
    nodeCenter: nodeWithPortPoints.center.y,
  })

  const warpedNode: NodeWithPortPoints = {
    ...nodeWithPortPoints,
    width: xAxis.warpedLength,
    height: yAxis.warpedLength,
    portPoints: nodeWithPortPoints.portPoints.map((pp) => ({
      ...pp,
      x: warpAxis(pp.x, xAxis),
      y: warpAxis(pp.y, yAxis),
    })),
  }

  return {
    xAxis,
    yAxis,
    originalNode: nodeWithPortPoints,
    warpedNode,
  }
}

export class HighDensitySolverA02 extends HighDensitySolverA01 {
  private warpConfig: TwoGridWarpConfig
  private usingWarpedGrid = true

  constructor(props: HighDensitySolverA02Props) {
    const outerGridCellSize = props.outerGridCellSize ?? props.cellSizeMm
    const outerGridCellThickness = props.outerGridCellThickness ?? 1
    const innerGridCellSize = props.innerGridCellSize ?? 0.4
    const compressionRatio = innerGridCellSize / outerGridCellSize

    const warpConfig = createTwoGridWarpConfig(
      props.nodeWithPortPoints,
      outerGridCellThickness,
      compressionRatio,
    )

    super({
      ...props,
      nodeWithPortPoints: warpConfig.warpedNode,
      cellSizeMm: outerGridCellSize,
    })

    this.warpConfig = warpConfig
  }

  override solve(): void {
    this.usingWarpedGrid = true
    super.solve()

    if (this.failed) {
      this.usingWarpedGrid = false
      this.nodeWithPortPoints = this.warpConfig.originalNode
      this.solved = false
      this.failed = false
      this.error = null
      this.iterations = 0
      ;(this as { _setupDone: boolean })._setupDone = false
      super.solve()
    }

    if (
      this.failed &&
      this.error?.includes("ran out of iterations") &&
      this.unsolvedConnections.length === 0
    ) {
      this.failed = false
      this.solved = true
      this.error = null
    }
  }

  override getOutput(): HighDensityIntraNodeRoute[] {
    const output = super.getOutput()
    if (!this.usingWarpedGrid) return output

    return output.map((route) => ({
      ...route,
      route: route.route.map((pt) => ({
        ...pt,
        x: unwarpAxis(pt.x, this.warpConfig.xAxis),
        y: unwarpAxis(pt.y, this.warpConfig.yAxis),
      })),
      vias: route.vias.map((via) => ({
        x: unwarpAxis(via.x, this.warpConfig.xAxis),
        y: unwarpAxis(via.y, this.warpConfig.yAxis),
      })),
    }))
  }
}
