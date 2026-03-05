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

const EPSILON = 1e-9
const POINT_TOLERANCE = 0.01

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
