import { GenericSolverDebugger } from "@tscircuit/solver-utils/react"
import { useEffect, useState } from "react"
import { HighDensitySolverA13 } from "../../lib"
import node from "./cmn_4__sub_2_0.json"

export default function A13NegotiatedCongestion() {
  const [solver] = useState(() => {
    const solver = new HighDensitySolverA13({
      nodeWithPortPoints: node,
      cellSizeMm: 0.1,
      stepMultiplier: 1000,
      viaDiameter: 0.3,
      traceThickness: 0.1,
      traceMargin: 0.1,
      viaMinDistFromBorder: 0.15,
    })
    solver.setup()
    return solver
  })
  const describe = () =>
    `${solver.failed ? "Failed" : solver.solved ? "Solved" : solver.phase} · ${solver.routedCount}/${solver.connections.length} ${solver.solved ? "validated" : "provisional"} routes · round ${solver.round} · ${solver.conflictCount} conflicted routes · ${solver.routingIterations.toLocaleString()} search expansions · ${solver.rerouteCount} reroutes${solver.failed ? ` · ${solver.error}` : ""}`
  const [status, setStatus] = useState(describe)
  useEffect(() => {
    const timer = setInterval(() => setStatus(describe()), 100)
    return () => clearInterval(timer)
  }, [solver])
  return (
    <div style={{ padding: 16, background: "white" }}>
      <h2>A13 · SRJ18 sample 2 · cmn_4__sub_2_0 · 1×</h2>
      <p>
        Negotiated congestion at the original 12.7425 × 10.6167 mm bounds. Keep
        provisional routes, increase the cost of contested space, and reroute
        conflicting connections individually.
      </p>
      <p>
        All 26 routes must pass geometry and clearance checks before this solver
        reports success. Amber markers show conflicts from the most recent
        negotiation round. Click Animate to watch.
      </p>
      <div
        role="status"
        style={{
          padding: "8px 12px",
          background: "#eff6ff",
          fontFamily: "monospace",
          marginBottom: 8,
        }}
      >
        {status}
      </div>
      <GenericSolverDebugger solver={solver} />
    </div>
  )
}
