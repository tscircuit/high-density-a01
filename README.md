# @tscircuit/high-density-a01

A high density zero-obstacle solver

This is a @tscircuit/solver-utils BaseSolver-compatible solver with the following
properties:

- Multi-layer
- Grid-based
- Supports High Density Types from tscircuit-autorouter
- Rip'n'Replace with History (@tscircuit/hypergraph-inspired)
- Via Penalty and Trace Penalty Map

<p align="center">
  <img src="https://github.com/user-attachments/assets/4463e513-b231-456d-953d-a15c3d9ae376" width="320" />
</p>

## Usage

```tsx
const solver = new HighDensitySolverA01({
  nodeWithPortPoints,
  cellSizeMm: 0.05,
  viaDiameter: 0.3,
  maxCellCount: 200_000, // optional safety limit; fail during setup if exceeded
  stepMultiplier: 4, // optional, each solver step runs 4 internal steps

  // optional hyperparameters to control algorithm
  // Unit of penalty is ~mm
  hyperParameters: {
    shuffleSeed: 0,
    ripCost: 10,
    ripTracePenalty: 0.5,
    ripViaPenalty: 0.75,
    viaBaseCost: 0.1,
  },

  // Optional functions to generate initial penalty map
  // initialPenaltyFn: ({ x, y, px, py, row, col }) => ...
})

solver.solve()
```

## How it works

We form a grid based on the parameters `cellSizeMm`

We compute the initial penalty map from the `initialPenaltyFn`, this function
sets an additional cost of traversal for a cell. This function accepts `x`,`y`
which represent the "real coordinates", as well as `px`/`py` which are `[0,1]`
representing the fraction of the coordinate within the problem bounds.

We shuffle the trace order based on the shuffle seed.

We run a basic A\* solver for each path from the `start` to the `end`.
When we explore, we consider both used and unused
cells via the `usedCell` structure. The `usedCell` structure contains 0 or 1
depending on whether or not a cell has been used by either a trace or via. When
we explore, we explore in 8 directions as well as creating a via. A via enables
exploring to any other layer. When a cell is used, we add the `ripCost` to
the exploration of that path. A path that rips the same trace will only incur
the `ripCost` once, so we must track for each path what traces have been ripped.

When we reach the `end` of a path, we then mark that route as `solved` and apply
the used cells to the `usedCell` structure. Note that vias occupy more cells
based on the `viaDiameter`. We then see if we needed to rip any traces. When we
rip a trace, we remove it from the `usedCell` structure, remove it from the
`solvedConnections` list and add it back to the `unsolvedConnections` queue.
