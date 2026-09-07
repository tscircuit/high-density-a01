import type { PortPoint } from "./types"

export function getPhysicalPortPairKey(
  pair: readonly [PortPoint, PortPoint],
  rootConnectionName: string,
): string {
  const endpoints = pair.map(({ x, y, z }) => JSON.stringify([x, y, z])).sort()
  return JSON.stringify([rootConnectionName, endpoints])
}
