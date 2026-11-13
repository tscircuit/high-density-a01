import { HighDensitySolverA01 } from "../../lib/HighDensitySolverA01/HighDensitySolverA01"
import { viaOccupantCacheNode } from "./via-occupant-cache-node"

export interface A01Heap {
  push(f: number, seq: number, id: number): void
  pop(): number
  clear(): void
  readonly size: number
}

export const createA01Heap = (enableFourAryHeap: boolean): A01Heap => {
  const solver = new HighDensitySolverA01({
    nodeWithPortPoints: structuredClone(viaOccupantCacheNode),
    cellSizeMm: 0.1,
    viaDiameter: 0.3,
    enableFourAryHeap,
  })
  solver.setup()
  return solver["heap"]
}

export const getLogicalA01Heap = (
  heap: A01Heap,
): Array<{ f: number; seq: number; id: number }> => {
  const storage = heap as unknown as {
    f: number[]
    seq: number[]
    id: number[]
    n: number
  }
  return Array.from({ length: storage.n }, (_, index) => ({
    f: storage.f[index]!,
    seq: storage.seq[index]!,
    id: storage.id[index]!,
  })).sort((a, b) => (a.f !== b.f ? (a.f < b.f ? -1 : 1) : a.seq - b.seq))
}
