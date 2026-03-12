import {
  HighDensitySolverA01,
  type HighDensitySolverA01Props,
} from "../HighDensitySolverA01/HighDensitySolverA01"
import type { HighDensityIntraNodeRoute, NodeWithPortPoints } from "../types"

type TwoGridMapper = {
  mapX: (x: number) => number
  mapY: (y: number) => number
  unmapX: (x: number) => number
  unmapY: (y: number) => number
}

export interface HighDensitySolverA02Props extends HighDensitySolverA01Props {
  outerGridCellSize?: number
  outerGridCellThickness?: number
  innerGridCellSize?: number
}

function createAxisMapper(
  min: number,
  max: number,
  edgeThickness: number,
  compressionScale: number,
): {
  map: (v: number) => number
  unmap: (v: number) => number
} {
  const start = min + edgeThickness
  const end = max - edgeThickness
  const innerWidth = Math.max(0, end - start)
  const compressedWidth = innerWidth * compressionScale

  const map = (v: number): number => {
    if (innerWidth <= 0 || v <= start) return v
    if (v >= end) return start + compressedWidth + (v - end)
    return start + (v - start) * compressionScale
  }

  const unmap = (v: number): number => {
    if (innerWidth <= 0 || v <= start) return v
    const compressedEnd = start + compressedWidth
    if (v >= compressedEnd) return end + (v - compressedEnd)
    return start + (v - start) / compressionScale
  }

  return { map, unmap }
}

function createTwoGridMapper(
  nodeWithPortPoints: NodeWithPortPoints,
  outerGridCellThickness: number,
  outerGridCellSize: number,
  innerGridCellSize: number,
): TwoGridMapper {
  const minX = nodeWithPortPoints.center.x - nodeWithPortPoints.width / 2
  const maxX = nodeWithPortPoints.center.x + nodeWithPortPoints.width / 2
  const minY = nodeWithPortPoints.center.y - nodeWithPortPoints.height / 2
  const maxY = nodeWithPortPoints.center.y + nodeWithPortPoints.height / 2

  const edgeThickness = outerGridCellThickness * outerGridCellSize
  const compressionScale = outerGridCellSize / innerGridCellSize

  const x = createAxisMapper(minX, maxX, edgeThickness, compressionScale)
  const y = createAxisMapper(minY, maxY, edgeThickness, compressionScale)

  return {
    mapX: x.map,
    mapY: y.map,
    unmapX: x.unmap,
    unmapY: y.unmap,
  }
}

function mapNodeWithPortPoints(
  nodeWithPortPoints: NodeWithPortPoints,
  mapper: TwoGridMapper,
): NodeWithPortPoints {
  const minX = nodeWithPortPoints.center.x - nodeWithPortPoints.width / 2
  const maxX = nodeWithPortPoints.center.x + nodeWithPortPoints.width / 2
  const minY = nodeWithPortPoints.center.y - nodeWithPortPoints.height / 2
  const maxY = nodeWithPortPoints.center.y + nodeWithPortPoints.height / 2

  const mappedMinX = mapper.mapX(minX)
  const mappedMaxX = mapper.mapX(maxX)
  const mappedMinY = mapper.mapY(minY)
  const mappedMaxY = mapper.mapY(maxY)

  return {
    ...nodeWithPortPoints,
    center: {
      x: (mappedMinX + mappedMaxX) / 2,
      y: (mappedMinY + mappedMaxY) / 2,
    },
    width: mappedMaxX - mappedMinX,
    height: mappedMaxY - mappedMinY,
    portPoints: nodeWithPortPoints.portPoints.map((pp) => ({
      ...pp,
      x: mapper.mapX(pp.x),
      y: mapper.mapY(pp.y),
    })),
  }
}

export class HighDensitySolverA02 extends HighDensitySolverA01 {
  private mapper: TwoGridMapper
  private outputTraceThickness: number
  private outputViaDiameter: number

  constructor(props: HighDensitySolverA02Props) {
    const outerGridCellSize = props.outerGridCellSize ?? 0.1
    const outerGridCellThickness = props.outerGridCellThickness ?? 1
    const innerGridCellSize = props.innerGridCellSize ?? 0.4
    const compressionScale = outerGridCellSize / innerGridCellSize

    const mapper = createTwoGridMapper(
      props.nodeWithPortPoints,
      outerGridCellThickness,
      outerGridCellSize,
      innerGridCellSize,
    )

    const initialPenaltyFn = props.initialPenaltyFn

    const a01Props: HighDensitySolverA01Props = {
      ...props,
      cellSizeMm: outerGridCellSize,
      traceThickness: (props.traceThickness ?? 0.1) * compressionScale,
      traceMargin: (props.traceMargin ?? 0.15) * compressionScale,
      viaDiameter: props.viaDiameter * compressionScale,
      viaMinDistFromBorder:
        (props.viaMinDistFromBorder ?? 0.15) * compressionScale,
      nodeWithPortPoints: mapNodeWithPortPoints(
        props.nodeWithPortPoints,
        mapper,
      ),
      initialPenaltyFn: initialPenaltyFn
        ? ({ x, y, px, py, row, col }) =>
            initialPenaltyFn({
              x: mapper.unmapX(x),
              y: mapper.unmapY(y),
              px: mapper.unmapX(px),
              py: mapper.unmapY(py),
              row,
              col,
            })
        : undefined,
    }

    super(a01Props)
    this.mapper = mapper
    this.outputTraceThickness = props.traceThickness ?? 0.1
    this.outputViaDiameter = props.viaDiameter
  }

  override getOutput(): HighDensityIntraNodeRoute[] {
    const mappedRoutes = super.getOutput()

    return mappedRoutes.map((route) => ({
      ...route,
      traceThickness: this.outputTraceThickness,
      viaDiameter: this.outputViaDiameter,
      route: route.route.map((p) => ({
        ...p,
        x: this.mapper.unmapX(p.x),
        y: this.mapper.unmapY(p.y),
      })),
      vias: route.vias.map((v) => ({
        x: this.mapper.unmapX(v.x),
        y: this.mapper.unmapY(v.y),
      })),
    }))
  }
}
