import type {
  HighDensityIntraNodeRoute,
  HighDensityRoutePoint,
  NodeWithPortPoints,
  PortPoint,
} from "../types"

export type Side = "left" | "right" | "top" | "bottom"

export type RectBounds = {
  minX: number
  maxX: number
  minY: number
  maxY: number
  width: number
  height: number
  center: { x: number; y: number }
}

export type SpreadAnchor = {
  key: string
  side: Side
  representative: PortPoint
  members: PortPoint[]
}

export type A08SpreadAssignment = {
  anchorKey: string
  side: Side
  original: HighDensityRoutePoint
  assigned: HighDensityRoutePoint
}

export type A08BreakoutRoute = {
  anchorKey: string
  side: Side
  connectionName: string
  rootConnectionName?: string
  original: HighDensityRoutePoint
  assigned: HighDensityRoutePoint
  route: HighDensityRoutePoint[]
}

export type A08BreakoutSolverOutput = {
  innerRect: RectBounds
  innerNodeWithPortPoints: NodeWithPortPoints
  assignments: A08SpreadAssignment[]
  breakoutRoutes: A08BreakoutRoute[]
}

export const SIDE_ORDER: Side[] = ["left", "right", "bottom", "top"]
export const EPSILON = 1e-9
export const POINT_EPSILON = 1e-6

export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

export function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t
}

export function getNodeBounds(
  nodeWithPortPoints: Pick<NodeWithPortPoints, "center" | "width" | "height">,
): RectBounds {
  const minX = nodeWithPortPoints.center.x - nodeWithPortPoints.width / 2
  const maxX = nodeWithPortPoints.center.x + nodeWithPortPoints.width / 2
  const minY = nodeWithPortPoints.center.y - nodeWithPortPoints.height / 2
  const maxY = nodeWithPortPoints.center.y + nodeWithPortPoints.height / 2

  return {
    minX,
    maxX,
    minY,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
    center: {
      x: (minX + maxX) / 2,
      y: (minY + maxY) / 2,
    },
  }
}

export function rectFromBounds(bounds: {
  minX: number
  maxX: number
  minY: number
  maxY: number
}): RectBounds {
  return {
    ...bounds,
    width: bounds.maxX - bounds.minX,
    height: bounds.maxY - bounds.minY,
    center: {
      x: (bounds.minX + bounds.maxX) / 2,
      y: (bounds.minY + bounds.maxY) / 2,
    },
  }
}

export function pointToRectDistance(
  point: { x: number; y: number },
  rect: Pick<RectBounds, "minX" | "maxX" | "minY" | "maxY">,
) {
  const dx =
    point.x < rect.minX
      ? rect.minX - point.x
      : point.x > rect.maxX
        ? point.x - rect.maxX
        : 0
  const dy =
    point.y < rect.minY
      ? rect.minY - point.y
      : point.y > rect.maxY
        ? point.y - rect.maxY
        : 0
  return Math.hypot(dx, dy)
}

export function chooseSide(
  portPoint: Pick<PortPoint, "x" | "y">,
  outerBounds: RectBounds,
): Side {
  const candidates: Array<[Side, number]> = [
    ["left", Math.abs(portPoint.x - outerBounds.minX)],
    ["right", Math.abs(portPoint.x - outerBounds.maxX)],
    ["bottom", Math.abs(portPoint.y - outerBounds.minY)],
    ["top", Math.abs(portPoint.y - outerBounds.maxY)],
  ]
  candidates.sort(
    (a, b) =>
      a[1] - b[1] || SIDE_ORDER.indexOf(a[0]) - SIDE_ORDER.indexOf(b[0]),
  )
  return candidates[0]![0]
}

export function getAnchorKey(portPoint: PortPoint) {
  const rootNetName =
    portPoint.rootConnectionName ??
    portPoint.connectionName.replace(/_mst\d+$/, "")
  const baseKey =
    portPoint.portPointId ??
    `${portPoint.z}:${portPoint.x.toFixed(6)}:${portPoint.y.toFixed(6)}`
  return `${baseKey}|${rootNetName}`
}

export function getSortCoordinate(
  side: Side,
  portPoint: Pick<PortPoint, "x" | "y">,
) {
  return side === "left" || side === "right" ? portPoint.y : portPoint.x
}

export function getPopulatedSides(nodeWithPortPoints: NodeWithPortPoints) {
  const outerBounds = getNodeBounds(nodeWithPortPoints)
  const populatedSides = new Set<Side>()

  for (const portPoint of nodeWithPortPoints.portPoints) {
    if (Math.abs(portPoint.x - outerBounds.minX) <= POINT_EPSILON) {
      populatedSides.add("left")
    }
    if (Math.abs(portPoint.x - outerBounds.maxX) <= POINT_EPSILON) {
      populatedSides.add("right")
    }
    if (Math.abs(portPoint.y - outerBounds.minY) <= POINT_EPSILON) {
      populatedSides.add("bottom")
    }
    if (Math.abs(portPoint.y - outerBounds.maxY) <= POINT_EPSILON) {
      populatedSides.add("top")
    }
  }

  return populatedSides
}

export function pickExactSideInsetRect(
  nodeWithPortPoints: NodeWithPortPoints,
  marginMm: number,
) {
  const outerBounds = getNodeBounds(nodeWithPortPoints)
  const populatedSides = getPopulatedSides(nodeWithPortPoints)
  const candidate = rectFromBounds({
    minX: outerBounds.minX + (populatedSides.has("left") ? marginMm : 0),
    maxX: outerBounds.maxX - (populatedSides.has("right") ? marginMm : 0),
    minY: outerBounds.minY + (populatedSides.has("bottom") ? marginMm : 0),
    maxY: outerBounds.maxY - (populatedSides.has("top") ? marginMm : 0),
  })

  if (candidate.width <= EPSILON || candidate.height <= EPSILON) return null

  for (const portPoint of nodeWithPortPoints.portPoints) {
    if (pointToRectDistance(portPoint, candidate) + POINT_EPSILON < marginMm) {
      return null
    }
  }

  return candidate
}

export function buildSpreadAnchors(nodeWithPortPoints: NodeWithPortPoints) {
  const outerBounds = getNodeBounds(nodeWithPortPoints)
  const anchorsByKey = new Map<string, SpreadAnchor>()

  for (const portPoint of nodeWithPortPoints.portPoints) {
    const key = getAnchorKey(portPoint)
    if (!anchorsByKey.has(key)) {
      anchorsByKey.set(key, {
        key,
        side: chooseSide(portPoint, outerBounds),
        representative: portPoint,
        members: [],
      })
    }
    anchorsByKey.get(key)!.members.push(portPoint)
  }

  return [...anchorsByKey.values()]
}

export function sortAnchorsForSide(side: Side, anchors: SpreadAnchor[]) {
  return anchors
    .filter((anchor) => anchor.side === side)
    .sort((anchorA, anchorB) => {
      const coordinateDelta =
        getSortCoordinate(side, anchorA.representative) -
        getSortCoordinate(side, anchorB.representative)
      if (Math.abs(coordinateDelta) > POINT_EPSILON) return coordinateDelta
      const zDelta = anchorA.representative.z - anchorB.representative.z
      if (zDelta !== 0) return zDelta
      return anchorA.key.localeCompare(anchorB.key)
    })
}

export function samePoint(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
) {
  return (
    Math.abs(a.x - b.x) <= POINT_EPSILON &&
    Math.abs(a.y - b.y) <= POINT_EPSILON &&
    a.z === b.z
  )
}

export function addPointIfDistinct(
  route: Array<{ x: number; y: number; z: number }>,
  point: { x: number; y: number; z: number },
) {
  const last = route[route.length - 1]
  if (last && samePoint(last, point)) return
  route.push(point)
}

function getConnectionPointKey(
  connectionName: string,
  point: HighDensityRoutePoint,
) {
  return `${connectionName}|${point.z}|${point.x.toFixed(6)}|${point.y.toFixed(6)}`
}

export function combineBreakoutAndInnerRoutes(params: {
  originalNodeWithPortPoints: NodeWithPortPoints
  breakoutOutput: A08BreakoutSolverOutput | null | undefined
  innerRoutes: HighDensityIntraNodeRoute[]
}) {
  const { breakoutOutput, innerRoutes } = params
  if (!breakoutOutput) return innerRoutes

  const breakoutRouteByAssignedPoint = new Map(
    breakoutOutput.breakoutRoutes.map((route) => [
      getConnectionPointKey(route.connectionName, route.assigned),
      route,
    ]),
  )

  return innerRoutes.map((innerRoute) => {
    const firstInnerPoint = innerRoute.route[0]
    const lastInnerPoint = innerRoute.route[innerRoute.route.length - 1]
    const firstBreakoutRoute = firstInnerPoint
      ? breakoutRouteByAssignedPoint.get(
          getConnectionPointKey(innerRoute.connectionName, firstInnerPoint),
        )
      : undefined
    const lastBreakoutRoute = lastInnerPoint
      ? breakoutRouteByAssignedPoint.get(
          getConnectionPointKey(innerRoute.connectionName, lastInnerPoint),
        )
      : undefined

    const combinedRoute: HighDensityRoutePoint[] = []

    if (firstBreakoutRoute) {
      for (const point of firstBreakoutRoute.route) {
        addPointIfDistinct(combinedRoute, point)
      }
    } else if (firstInnerPoint) {
      addPointIfDistinct(combinedRoute, firstInnerPoint)
    }

    for (const point of innerRoute.route) {
      addPointIfDistinct(combinedRoute, point)
    }

    if (lastBreakoutRoute) {
      for (const point of [...lastBreakoutRoute.route].reverse()) {
        addPointIfDistinct(combinedRoute, point)
      }
    } else if (lastInnerPoint) {
      addPointIfDistinct(combinedRoute, lastInnerPoint)
    }

    return {
      ...innerRoute,
      rootConnectionName:
        firstBreakoutRoute?.rootConnectionName ??
        lastBreakoutRoute?.rootConnectionName ??
        innerRoute.rootConnectionName,
      route: combinedRoute,
    }
  })
}
