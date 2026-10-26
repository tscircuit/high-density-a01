import { createHash } from "node:crypto"
import { HighDensitySolverA01 } from "../../lib/HighDensitySolverA01/HighDensitySolverA01"
import { viaOccupantCacheNode } from "./via-occupant-cache-node"

export type A01SearchTrace = {
  traceHash: string
  outputHash: string
  iterations: number
  queuedNodes: number
  poppedNodes: number
  searchCount: number
  ripEvents: number
  solved: boolean
  failed: boolean
  error: string | null
}

export function getA01SearchTrace(
  Solver: typeof HighDensitySolverA01,
  shuffleSeed: number,
  stepMultiplier: number,
): A01SearchTrace {
  const solver = new Solver({
    nodeWithPortPoints: structuredClone(viaOccupantCacheNode),
    cellSizeMm: 0.1,
    viaDiameter: 0.3,
    traceThickness: 0.1,
    traceMargin: 0.1,
    stepMultiplier,
    hyperParameters: { shuffleSeed },
  })
  solver.setup()
  const trace = createHash("sha256")
  let queuedNodes = 0
  let poppedNodes = 0
  let searchCount = 0
  const heap = solver["heap"]
  const push = heap.push.bind(heap)
  const pop = heap.pop.bind(heap)
  const nextStamp = solver["nextStamp"].bind(solver)
  solver["nextStamp"] = (): void => {
    searchCount++
    nextStamp()
  }
  heap.push = (f: number, seq: number, id: number): void => {
    const node = solver["nodePool"][id]!
    const rippedIds: number[] = []
    for (let ripped = node.ripped; ripped; ripped = ripped.prev) {
      rippedIds.push(ripped.id)
    }
    trace.update(JSON.stringify([
      "queue", f, seq, id, node.z, node.row, node.col, node.g,
      node.parentIdx, rippedIds,
    ]))
    queuedNodes++
    push(f, seq, id)
  }
  heap.pop = (): number => {
    const id = pop()
    trace.update(JSON.stringify(["pop", id]))
    poppedNodes++
    return id
  }
  while (!solver.solved && !solver.failed) {
    solver.step()
    trace.update(JSON.stringify([
      "step", solver.iterations, solver.solved, solver.failed, solver.error,
      solver["activeConnId"], solver["searchIterations"], solver["seqCounter"],
      solver["ripCount"], solver["totalRipEvents"],
    ]))
  }
  return {
    traceHash: trace.digest("hex"),
    outputHash: createHash("sha256")
      .update(JSON.stringify(solver.getOutput()))
      .digest("hex"),
    iterations: solver.iterations,
    queuedNodes,
    poppedNodes,
    searchCount,
    ripEvents: solver["totalRipEvents"],
    solved: solver.solved,
    failed: solver.failed,
    error: solver.error,
  }
}
