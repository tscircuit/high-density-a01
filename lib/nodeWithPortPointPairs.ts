import type { NodeWithPortPoints, PortPoint } from "./types"

export type NodePortPointPair = {
  connectionName: string
  rootConnectionName?: string
  start: PortPoint
  end: PortPoint
}

type IndexedPortPoint = {
  index: number
  portPoint: PortPoint
}

/**
 * Creates a defensive copy of explicit port-point pair ids.
 *
 * @param portPointPairIds Ordered `[startPortPointId, endPortPointId]` tuples
 *   to copy.
 * @returns A new array with cloned tuple entries so callers can mutate the
 *   result without affecting the source node definition.
 */
function clonePortPointPairIds(
  portPointPairIds: [string, string][],
): [string, string][] {
  return portPointPairIds.map(
    ([startPortPointId, endPortPointId]) =>
      [startPortPointId, endPortPointId] as [string, string],
  )
}

/**
 * Filters a node's explicit pair definitions down to the pairs fully contained
 * in a port-point subset.
 *
 * @param nodeWithPortPoints Source of explicit `portPointPairIds`.
 * @param portPoints Candidate subset whose `portPointId` values should be kept.
 * @returns The matching pair ids as cloned tuples, or `undefined` when the node
 *   has no explicit pairs, the subset has no usable ids, or no complete pair is
 *   fully represented in the subset.
 *
 * @note Pair ids are only returned when both endpoints are present in
 *   `portPoints`.
 */
export function getPortPointPairIdsForSubset(
  nodeWithPortPoints: Pick<NodeWithPortPoints, "portPointPairIds">,
  portPoints: Array<Pick<PortPoint, "portPointId">>,
) {
  if (!nodeWithPortPoints.portPointPairIds?.length) return undefined

  const selectedPortPointIds = new Set(
    portPoints.flatMap((portPoint) =>
      portPoint.portPointId ? [portPoint.portPointId] : [],
    ),
  )
  if (selectedPortPointIds.size === 0) return undefined

  const relevantPairIds = nodeWithPortPoints.portPointPairIds.filter(
    ([startPortPointId, endPortPointId]) =>
      selectedPortPointIds.has(startPortPointId) &&
      selectedPortPointIds.has(endPortPointId),
  )

  return relevantPairIds.length > 0
    ? clonePortPointPairIds(relevantPairIds)
    : undefined
}

/**
 * Resolves logical route segments for a node from explicit pair ids when
 * available, then falls back to positional pairing for any remaining endpoints.
 *
 * @param nodeWithPortPoints Node definition containing port points and
 *   optional explicit `portPointPairIds`.
 * @returns Ordered start/end pairs ready for segment construction.
 *   Explicitly declared pairs are returned first. Any unconsumed points are
 *   then paired sequentially by `connectionName` in original array order.
 *
 * @note Fallback pairing preserves backwards compatibility for nodes that do
 *   not provide `portPointPairIds`.
 * @caution Invalid explicit pairs are skipped silently. This includes missing
 *   ids, duplicate `portPointId` values that make an endpoint ambiguous,
 *   self-pairs, and pairs that cross different `connectionName` values.
 * @caution If fallback pairing leaves an odd number of unpaired points for a
 *   connection, the final point is ignored because it cannot form a segment.
 */
export function getNodePortPointPairs(
  nodeWithPortPoints: NodeWithPortPoints,
): NodePortPointPair[] {
  const indexedPortPoints = nodeWithPortPoints.portPoints.map(
    (portPoint, index) => ({ index, portPoint }),
  )
  const indexedPortPointById = new Map<string, IndexedPortPoint | null>()
  const fallbackPortPointsByConnection = new Map<string, IndexedPortPoint[]>()
  const consumedPointIndexes = new Set<number>()
  const pairs: NodePortPointPair[] = []

  for (const indexedPortPoint of indexedPortPoints) {
    const { portPoint } = indexedPortPoint

    if (portPoint.portPointId) {
      if (indexedPortPointById.has(portPoint.portPointId)) {
        indexedPortPointById.set(portPoint.portPointId, null)
      } else {
        indexedPortPointById.set(portPoint.portPointId, indexedPortPoint)
      }
    }

    const existing = fallbackPortPointsByConnection.get(
      portPoint.connectionName,
    )
    if (existing) {
      existing.push(indexedPortPoint)
    } else {
      fallbackPortPointsByConnection.set(portPoint.connectionName, [
        indexedPortPoint,
      ])
    }
  }

  for (const [
    startPortPointId,
    endPortPointId,
  ] of nodeWithPortPoints.portPointPairIds ?? []) {
    const start = indexedPortPointById.get(startPortPointId)
    const end = indexedPortPointById.get(endPortPointId)
    if (!start || !end) continue
    if (start.index === end.index) continue
    if (start.portPoint.connectionName !== end.portPoint.connectionName) {
      continue
    }

    consumedPointIndexes.add(start.index)
    consumedPointIndexes.add(end.index)
    pairs.push({
      connectionName: start.portPoint.connectionName,
      rootConnectionName:
        start.portPoint.rootConnectionName ?? end.portPoint.rootConnectionName,
      start: start.portPoint,
      end: end.portPoint,
    })
  }

  for (const indexedPoints of fallbackPortPointsByConnection.values()) {
    const unpairedPoints = indexedPoints.filter(
      ({ index }) => !consumedPointIndexes.has(index),
    )

    for (let index = 0; index < unpairedPoints.length - 1; index += 1) {
      const start = unpairedPoints[index]!.portPoint
      const end = unpairedPoints[index + 1]!.portPoint
      pairs.push({
        connectionName: start.connectionName,
        rootConnectionName: start.rootConnectionName ?? end.rootConnectionName,
        start,
        end,
      })
    }
  }

  return pairs
}
