import {
  type HighDensityIntraNodeRoute,
  type NodeWithPortPoints,
} from "../types"
import {
  HighDensitySolverA01,
  type HighDensitySolverA01Props,
} from "../HighDensitySolverA01/HighDensitySolverA01"

type DualGridTransform = {
  xMin: number
  xMax: number
  yMin: number
  yMax: number
  thickness: number
  scale: number
  innerWarpedWidth: number
  innerWarpedHeight: number
}

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value))

const createDualGridTransform = (
  node: NodeWithPortPoints,
  outerGridCellSize: number,
  outerGridCellThickness: number,
  innerGridCellSize: number,
): DualGridTransform => {
  const xMin = node.center.x - node.width / 2
  const xMax = node.center.x + node.width / 2
  const yMin = node.center.y - node.height / 2
  const yMax = node.center.y + node.height / 2

  const maxThickness = Math.min(node.width / 2, node.height / 2)
  const desiredThickness = outerGridCellSize * outerGridCellThickness
  const thickness = clamp(desiredThickness, 0, maxThickness)

  const innerWidth = Math.max(0, node.width - 2 * thickness)
  const innerHeight = Math.max(0, node.height - 2 * thickness)

  const scale = clamp(outerGridCellSize / innerGridCellSize, 0.01, 1)

  return {
    xMin,
    xMax,
    yMin,
    yMax,
    thickness,
    scale,
    innerWarpedWidth: innerWidth * scale,
    innerWarpedHeight: innerHeight * scale,
  }
}

const warpCoordinate = (
  value: number,
  min: number,
  max: number,
  thickness: number,
  innerWarpedSize: number,
  scale: number,
): number => {
  const innerMin = min + thickness
  const innerMax = max - thickness

  if (value <= innerMin) return value - min
  if (value >= innerMax) {
    return thickness + innerWarpedSize + (value - innerMax)
  }

  return thickness + (value - innerMin) * scale
}

const unwarpCoordinate = (
  warped: number,
  min: number,
  max: number,
  thickness: number,
  innerWarpedSize: number,
  scale: number,
): number => {
  const innerMin = min + thickness
  const innerMax = max - thickness

  if (warped <= thickness) return min + warped
  if (warped >= thickness + innerWarpedSize) {
    return innerMax + (warped - (thickness + innerWarpedSize))
  }

  return innerMin + (warped - thickness) / scale
}

const warpNodeWithPortPoints = (
  node: NodeWithPortPoints,
  transform: DualGridTransform,
): NodeWithPortPoints => {
  const warpedWidth = 2 * transform.thickness + transform.innerWarpedWidth
  const warpedHeight = 2 * transform.thickness + transform.innerWarpedHeight

  const warpedCenter = {
    x: transform.xMin + warpedWidth / 2,
    y: transform.yMin + warpedHeight / 2,
  }

  return {
    ...node,
    center: warpedCenter,
    width: warpedWidth,
    height: warpedHeight,
    portPoints: node.portPoints.map((portPoint) => ({
      ...portPoint,
      x:
        transform.xMin +
        warpCoordinate(
          portPoint.x,
          transform.xMin,
          transform.xMax,
          transform.thickness,
          transform.innerWarpedWidth,
          transform.scale,
        ),
      y:
        transform.yMin +
        warpCoordinate(
          portPoint.y,
          transform.yMin,
          transform.yMax,
          transform.thickness,
          transform.innerWarpedHeight,
          transform.scale,
        ),
    })),
  }
}

export interface HighDensitySolverA02Props
  extends Omit<HighDensitySolverA01Props, "cellSizeMm"> {
  outerGridCellSize: number
  outerGridCellThickness: number
  innerGridCellSize: number
}

export class HighDensitySolverA02 extends HighDensitySolverA01 {
  private dualGridTransform: DualGridTransform

  constructor(props: HighDensitySolverA02Props) {
    const dualGridTransform = createDualGridTransform(
      props.nodeWithPortPoints,
      props.outerGridCellSize,
      props.outerGridCellThickness,
      props.innerGridCellSize,
    )

    const warpedNodeWithPortPoints = warpNodeWithPortPoints(
      props.nodeWithPortPoints,
      dualGridTransform,
    )

    super({
      ...props,
      cellSizeMm: props.outerGridCellSize,
      nodeWithPortPoints: warpedNodeWithPortPoints,
    })

    this.dualGridTransform = dualGridTransform
  }

  override getOutput(): HighDensityIntraNodeRoute[] {
    const output = super.getOutput()

    return output.map((route) => ({
      ...route,
      route: route.route.map((point) => ({
        ...point,
        x: unwarpCoordinate(
          point.x - this.dualGridTransform.xMin,
          this.dualGridTransform.xMin,
          this.dualGridTransform.xMax,
          this.dualGridTransform.thickness,
          this.dualGridTransform.innerWarpedWidth,
          this.dualGridTransform.scale,
        ),
        y: unwarpCoordinate(
          point.y - this.dualGridTransform.yMin,
          this.dualGridTransform.yMin,
          this.dualGridTransform.yMax,
          this.dualGridTransform.thickness,
          this.dualGridTransform.innerWarpedHeight,
          this.dualGridTransform.scale,
        ),
      })),
      vias: route.vias.map((via) => ({
        x: unwarpCoordinate(
          via.x - this.dualGridTransform.xMin,
          this.dualGridTransform.xMin,
          this.dualGridTransform.xMax,
          this.dualGridTransform.thickness,
          this.dualGridTransform.innerWarpedWidth,
          this.dualGridTransform.scale,
        ),
        y: unwarpCoordinate(
          via.y - this.dualGridTransform.yMin,
          this.dualGridTransform.yMin,
          this.dualGridTransform.yMax,
          this.dualGridTransform.thickness,
          this.dualGridTransform.innerWarpedHeight,
          this.dualGridTransform.scale,
        ),
      })),
    }))
  }
}
