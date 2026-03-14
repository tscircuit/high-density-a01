import type { HighDensityIntraNodeRoute } from "../../lib/types"

interface Point {
  x: number
  y: number
}

interface Intersection {
  trace1: string
  trace2: string
  z: number
  point: Point
  type: "crossing" | "shared_point"
  seg1?: [Point, Point]
  seg2?: [Point, Point]
}

interface SegmentOnLayer {
  z: number
  a: Point
  b: Point
}

export interface RouteGeometryViolation {
  trace1: string
  trace2: string
  type:
    | "crossing"
    | "shared_point"
    | "trace_clearance"
    | "via_trace_clearance"
    | "via_via_clearance"
  z: number | null
  distance: number
  requiredDistance: number
  point?: Point
  point2?: Point
  seg1?: [Point, Point]
  seg2?: [Point, Point]
}

const EPSILON = 1e-9
const POINT_TOLERANCE = 0.01
const CLEARANCE_TOLERANCE = 1e-6

/**
 * Compute the cross product of vectors (b-a) and (c-a)
 */
function cross(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
}

/**
 * Check if two line segments (p1,p2) and (p3,p4) properly intersect
 * (cross each other, not just touch at endpoints).
 * Returns the intersection point if they cross, null otherwise.
 */
function segmentsIntersect(
  p1: Point,
  p2: Point,
  p3: Point,
  p4: Point,
): Point | null {
  const d1 = cross(p3, p4, p1)
  const d2 = cross(p3, p4, p2)
  const d3 = cross(p1, p2, p3)
  const d4 = cross(p1, p2, p4)

  // Standard crossing: segments straddle each other
  if (
    ((d1 > EPSILON && d2 < -EPSILON) || (d1 < -EPSILON && d2 > EPSILON)) &&
    ((d3 > EPSILON && d4 < -EPSILON) || (d3 < -EPSILON && d4 > EPSILON))
  ) {
    const t = d1 / (d1 - d2)
    return {
      x: p1.x + t * (p2.x - p1.x),
      y: p1.y + t * (p2.y - p1.y),
    }
  }

  return null
}

/**
 * Extract segments on a specific z-layer from a route.
 */
function getSegmentsOnLayer(
  route: HighDensityIntraNodeRoute,
  z: number,
): Array<[Point, Point]> {
  const segments: Array<[Point, Point]> = []
  for (let i = 0; i < route.route.length - 1; i++) {
    const a = route.route[i]!
    const b = route.route[i + 1]!
    if (a.z === z && b.z === z) {
      segments.push([
        { x: a.x, y: a.y },
        { x: b.x, y: b.y },
      ])
    }
  }
  return segments
}

/**
 * Extract route points on a specific z-layer.
 */
function getPointsOnLayer(
  route: HighDensityIntraNodeRoute,
  z: number,
): Point[] {
  return route.route
    .filter((pt) => pt.z === z)
    .map((pt) => ({ x: pt.x, y: pt.y }))
}

function getAllSegments(route: HighDensityIntraNodeRoute): SegmentOnLayer[] {
  const segments: SegmentOnLayer[] = []
  for (let i = 0; i < route.route.length - 1; i++) {
    const a = route.route[i]!
    const b = route.route[i + 1]!
    if (a.z !== b.z) continue
    segments.push({
      z: a.z,
      a: { x: a.x, y: a.y },
      b: { x: b.x, y: b.y },
    })
  }
  return segments
}

function dot(ax: number, ay: number, bx: number, by: number): number {
  return ax * bx + ay * by
}

function pointDistance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function pointToSegmentDistance(p: Point, a: Point, b: Point): number {
  const abx = b.x - a.x
  const aby = b.y - a.y
  const abLenSq = abx * abx + aby * aby
  if (abLenSq <= EPSILON) return pointDistance(p, a)

  const apx = p.x - a.x
  const apy = p.y - a.y
  const t = Math.max(0, Math.min(1, dot(apx, apy, abx, aby) / abLenSq))
  const qx = a.x + abx * t
  const qy = a.y + aby * t
  return Math.hypot(p.x - qx, p.y - qy)
}

function segmentDistance(a1: Point, a2: Point, b1: Point, b2: Point): number {
  if (segmentsIntersect(a1, a2, b1, b2)) return 0
  return Math.min(
    pointToSegmentDistance(a1, b1, b2),
    pointToSegmentDistance(a2, b1, b2),
    pointToSegmentDistance(b1, a1, a2),
    pointToSegmentDistance(b2, a1, a2),
  )
}

function toRootNetName(route: HighDensityIntraNodeRoute): string {
  return (
    route.rootConnectionName ?? route.connectionName.replace(/_mst\d+$/, "")
  )
}

function pushViolation(
  out: RouteGeometryViolation[],
  violation: RouteGeometryViolation,
) {
  out.push(violation)
}

/**
 * Validates that no two routes on the same layer have intersecting or
 * overlapping segments/points. Checks both geometric crossings and
 * shared route points (which indicate traces occupying the same grid cell).
 */
export function findSameLayerIntersections(
  routes: HighDensityIntraNodeRoute[],
): Intersection[] {
  const intersections: Intersection[] = []

  const zLayers = new Set<number>()
  for (const route of routes) {
    for (const pt of route.route) {
      zLayers.add(pt.z)
    }
  }

  for (const z of zLayers) {
    for (let i = 0; i < routes.length; i++) {
      const route1 = routes[i]!
      const pts1 = getPointsOnLayer(route1, z)
      const segs1 = getSegmentsOnLayer(route1, z)

      for (let j = i + 1; j < routes.length; j++) {
        const route2 = routes[j]!

        // Skip same-net segments (they legitimately share endpoints)
        const net1 = route1.connectionName.replace(/_mst\d+$/, "")
        const net2 = route2.connectionName.replace(/_mst\d+$/, "")
        if (net1 === net2) continue

        const pts2 = getPointsOnLayer(route2, z)
        const segs2 = getSegmentsOnLayer(route2, z)

        // Check for shared route points (same grid cell on same layer)
        const seen = new Set<string>()
        for (const p1 of pts1) {
          for (const p2 of pts2) {
            if (
              Math.abs(p1.x - p2.x) < POINT_TOLERANCE &&
              Math.abs(p1.y - p2.y) < POINT_TOLERANCE
            ) {
              const key = `${p1.x.toFixed(2)},${p1.y.toFixed(2)}`
              if (seen.has(key)) continue
              seen.add(key)
              intersections.push({
                trace1: route1.connectionName,
                trace2: route2.connectionName,
                z,
                point: p1,
                type: "shared_point",
              })
            }
          }
        }

        // Check for segment crossings
        for (const [a1, a2] of segs1) {
          for (const [b1, b2] of segs2) {
            const pt = segmentsIntersect(a1, a2, b1, b2)
            if (pt) {
              intersections.push({
                trace1: route1.connectionName,
                trace2: route2.connectionName,
                z,
                point: pt,
                type: "crossing",
                seg1: [a1, a2],
                seg2: [b1, b2],
              })
            }
          }
        }
      }
    }
  }

  return intersections
}

/**
 * Validates physical route geometry for different nets, including:
 * - same-layer crossings/shared points
 * - same-layer trace-to-trace clearance using trace widths
 * - via-to-via clearance using via diameters
 * - via-to-trace clearance using via/trace diameters
 */
export function findRouteGeometryViolations(
  routes: HighDensityIntraNodeRoute[],
): RouteGeometryViolation[] {
  const violations: RouteGeometryViolation[] = findSameLayerIntersections(
    routes,
  ).map((ix) => ({
    trace1: ix.trace1,
    trace2: ix.trace2,
    type: ix.type,
    z: ix.z,
    point: ix.point,
    seg1: ix.seg1,
    seg2: ix.seg2,
    distance: 0,
    requiredDistance: 0,
  }))

  const routeInfo = routes.map((route) => {
    const segments = getAllSegments(route)
    const zLayers = new Set<number>()
    const pointsByLayer = new Map<number, Point[]>()
    const segmentsByLayer = new Map<number, SegmentOnLayer[]>()

    for (const pt of route.route) {
      zLayers.add(pt.z)
      const points = pointsByLayer.get(pt.z) ?? []
      points.push({ x: pt.x, y: pt.y })
      pointsByLayer.set(pt.z, points)
    }

    for (const segment of segments) {
      const layerSegments = segmentsByLayer.get(segment.z) ?? []
      layerSegments.push(segment)
      segmentsByLayer.set(segment.z, layerSegments)
    }

    return {
      route,
      rootNet: toRootNetName(route),
      pointsByLayer,
      segmentsByLayer,
      segments,
      vias: route.vias.map((via) => ({ x: via.x, y: via.y })),
      traceRadius: route.traceThickness / 2,
      viaRadius: route.viaDiameter / 2,
      zLayers,
    }
  })

  for (let i = 0; i < routeInfo.length; i++) {
    const route1 = routeInfo[i]!
    for (let j = i + 1; j < routeInfo.length; j++) {
      const route2 = routeInfo[j]!
      if (route1.rootNet === route2.rootNet) continue

      const sharedLayers = new Set<number>([
        ...route1.zLayers.values(),
        ...route2.zLayers.values(),
      ])
      for (const z of sharedLayers) {
        const segs1 = route1.segmentsByLayer.get(z) ?? []
        const segs2 = route2.segmentsByLayer.get(z) ?? []
        const points1 = route1.pointsByLayer.get(z) ?? []
        const points2 = route2.pointsByLayer.get(z) ?? []
        const traceClearance = route1.traceRadius + route2.traceRadius

        for (const seg1 of segs1) {
          for (const seg2 of segs2) {
            const distance = segmentDistance(seg1.a, seg1.b, seg2.a, seg2.b)
            if (distance + CLEARANCE_TOLERANCE >= traceClearance) continue
            pushViolation(violations, {
              trace1: route1.route.connectionName,
              trace2: route2.route.connectionName,
              type:
                distance <= POINT_TOLERANCE
                  ? "shared_point"
                  : "trace_clearance",
              z,
              distance,
              requiredDistance: traceClearance,
              seg1: [seg1.a, seg1.b],
              seg2: [seg2.a, seg2.b],
            })
          }
        }

        for (const p1 of points1) {
          for (const p2 of points2) {
            const distance = pointDistance(p1, p2)
            if (distance + CLEARANCE_TOLERANCE >= traceClearance) continue
            pushViolation(violations, {
              trace1: route1.route.connectionName,
              trace2: route2.route.connectionName,
              type:
                distance <= POINT_TOLERANCE
                  ? "shared_point"
                  : "trace_clearance",
              z,
              distance,
              requiredDistance: traceClearance,
              point: p1,
              point2: p2,
            })
          }
        }
      }

      const viaToViaClearance = route1.viaRadius + route2.viaRadius
      for (const via1 of route1.vias) {
        for (const via2 of route2.vias) {
          const distance = pointDistance(via1, via2)
          if (distance + CLEARANCE_TOLERANCE >= viaToViaClearance) continue
          pushViolation(violations, {
            trace1: route1.route.connectionName,
            trace2: route2.route.connectionName,
            type: "via_via_clearance",
            z: null,
            distance,
            requiredDistance: viaToViaClearance,
            point: via1,
            point2: via2,
          })
        }
      }

      for (const via1 of route1.vias) {
        const requiredDistance = route1.viaRadius + route2.traceRadius
        for (const seg2 of route2.segments) {
          const distance = pointToSegmentDistance(via1, seg2.a, seg2.b)
          if (distance + CLEARANCE_TOLERANCE >= requiredDistance) continue
          pushViolation(violations, {
            trace1: route1.route.connectionName,
            trace2: route2.route.connectionName,
            type: "via_trace_clearance",
            z: seg2.z,
            distance,
            requiredDistance,
            point: via1,
            seg2: [seg2.a, seg2.b],
          })
        }
      }

      for (const via2 of route2.vias) {
        const requiredDistance = route2.viaRadius + route1.traceRadius
        for (const seg1 of route1.segments) {
          const distance = pointToSegmentDistance(via2, seg1.a, seg1.b)
          if (distance + CLEARANCE_TOLERANCE >= requiredDistance) continue
          pushViolation(violations, {
            trace1: route1.route.connectionName,
            trace2: route2.route.connectionName,
            type: "via_trace_clearance",
            z: seg1.z,
            distance,
            requiredDistance,
            point: via2,
            seg1: [seg1.a, seg1.b],
          })
        }
      }
    }
  }

  return violations
}

export function validateRouteGeometry(
  routes: HighDensityIntraNodeRoute[],
): void {
  const violations = findRouteGeometryViolations(routes)
  if (violations.length === 0) return

  const details = violations
    .slice(0, 20)
    .map((violation) => {
      const zPart = violation.z === null ? "z=all" : `z=${violation.z}`
      return `  ${violation.trace1} x ${violation.trace2} [${violation.type}] ${zPart} dist=${violation.distance.toFixed(3)} req=${violation.requiredDistance.toFixed(3)}`
    })
    .join("\n")
  throw new Error(
    `Found ${violations.length} route geometry violation(s):\n${details}`,
  )
}

/**
 * Asserts that no two routes intersect on the same layer.
 * Throws an error with details if intersections are found.
 */
export function validateNoIntersections(
  routes: HighDensityIntraNodeRoute[],
): void {
  const intersections = findSameLayerIntersections(routes)
  if (intersections.length > 0) {
    const details = intersections
      .map(
        (ix) =>
          `  ${ix.trace1} x ${ix.trace2} on z=${ix.z} [${ix.type}] at (${ix.point.x.toFixed(3)}, ${ix.point.y.toFixed(3)})`,
      )
      .join("\n")
    throw new Error(
      `Found ${intersections.length} same-layer intersection(s):\n${details}`,
    )
  }
}
