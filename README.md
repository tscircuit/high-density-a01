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

The package exports the solver classes directly:

```ts
import {
  HighDensitySolverA03,
  HighDensitySolverA05,
} from "@tscircuit/high-density-a01"
```

### A03

Use `HighDensitySolverA03` for the baseline high-density solver:

```ts
const solver = new HighDensitySolverA03({
  nodeWithPortPoints,
  highResolutionCellSize: 0.1,
  highResolutionCellThickness: 8,
  lowResolutionCellSize: 0.4,
  traceThickness: 0.1,
  traceMargin: 0.15,
  viaDiameter: 0.3,
  viaMinDistFromBorder: 0.15,
  maxCellCount: 200_000,
  stepMultiplier: 4,

  hyperParameters: {
    shuffleSeed: 0,
    ripCost: 8,
    ripTracePenalty: 0.5,
    ripViaPenalty: 0.75,
    viaBaseCost: 0.1,
    greedyMultiplier: 1.5,
  },

  // Optional initial penalty map
  // initialPenaltyFn: ({ x, y, px, py, row, col, region }) => ...
})

solver.solve()
const routes = solver.getOutput()
```

### A05

Use `HighDensitySolverA05` when you want A03-style routing plus route
normalization and force-directed reflow after each solved route:

```ts
const solver = new HighDensitySolverA05({
  nodeWithPortPoints,
  highResolutionCellSize: 0.1,
  highResolutionCellThickness: 8,
  lowResolutionCellSize: 0.4,
  traceThickness: 0.1,
  traceMargin: 0.15,
  viaDiameter: 0.3,
  viaMinDistFromBorder: 0.15,

  // A05 defaults
  postRouteSegmentCount: 16,
  postRouteForceDirectedSteps: 20,

  // Initial border-avoidance bias
  borderPenaltyStrength: 0.25,
  borderPenaltyFalloff: 0.12,
})

solver.solve()
const routes = solver.getOutput()
```

Notes:

- `HighDensitySolverA05` uses the same routing hyperparameters as A03 by default.
- `postRouteSegmentCount` counts vias toward the total segment budget.
- The default A05 initial penalty map discourages routing too close to the node
  border. Set `borderPenaltyStrength: 0` to disable that bias.
- Providing `initialPenaltyFn` overrides the built-in A05 border penalty.
- The output routes preserve the exact user-provided endpoints.

## How it works

For A03/A05, we form a two-resolution grid using
`highResolutionCellSize`, `highResolutionCellThickness`, and
`lowResolutionCellSize`.

We compute the initial penalty map from `initialPenaltyFn`. This function sets
an additional cost of traversal for a cell. It receives `x`/`y` in board
coordinates, and `px`/`py` in `[0,1]` relative to the node bounds.

We shuffle the trace order based on the shuffle seed.

We run an A\* search for each path from the `start` to the `end`. During
exploration, we consider both used and unused cells. Used cells incur rip costs
and trace/via penalties, while vias allow moving between any available layers.
A path that rips the same trace only pays `ripCost` once, so the search tracks
which traces have already been ripped along that candidate path.

When we reach the `end` of a path, we mark that route as solved and apply its
occupied cells to the congestion structure. Vias occupy more cells based on
`viaDiameter`. If a solved route displaced other routes, those routes are ripped
out and added back to the unsolved queue.

For A05, after each solved route we:

1. Normalize all solved routes to a fixed total segment count.
2. Run a force-directed reflow pass over the solved route set.
3. Rebuild occupancy from the updated geometry before routing the next trace.

This creates additional room for later routes at the cost of extra per-route
work.

## Benchmarks

Useful benchmark commands:

```sh
bun run scripts/run-dataset02-benchmark-a03.ts --concurrency=4
bun run scripts/run-dataset02-benchmark-a05.ts --concurrency=4
```

A05 tuning examples:

```sh
bun run scripts/run-dataset02-benchmark-a05.ts --concurrency=4 --border-penalty-strength=0.25 --border-penalty-falloff=0.12
bun run scripts/run-dataset02-benchmark-a05.ts --concurrency=4 --rip-cost=8 --greedy-multiplier=1.5
```

## high-density-a02

The high-density-a02 solver is a variant that uses an inner and outer grid to reduce the number of cells
while still allowing high density edges

![a02](https://private-user-images.githubusercontent.com/1910070/563350353-45e8fbc3-a666-4927-a200-8bac665c2ee1.png?jwt=eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJnaXRodWIuY29tIiwiYXVkIjoicmF3LmdpdGh1YnVzZXJjb250ZW50LmNvbSIsImtleSI6ImtleTUiLCJleHAiOjE3NzM0NDQ0ODMsIm5iZiI6MTc3MzQ0NDE4MywicGF0aCI6Ii8xOTEwMDcwLzU2MzM1MDM1My00NWU4ZmJjMy1hNjY2LTQ5MjctYTIwMC04YmFjNjY1YzJlZTEucG5nP1gtQW16LUFsZ29yaXRobT1BV1M0LUhNQUMtU0hBMjU2JlgtQW16LUNyZWRlbnRpYWw9QUtJQVZDT0RZTFNBNTNQUUs0WkElMkYyMDI2MDMxMyUyRnVzLWVhc3QtMSUyRnMzJTJGYXdzNF9yZXF1ZXN0JlgtQW16LURhdGU9MjAyNjAzMTNUMjMyMzAzWiZYLUFtei1FeHBpcmVzPTMwMCZYLUFtei1TaWduYXR1cmU9YzQwMmI4MzhjZTA0YzZhNDhmZmZhMTNlNDYwNTU4ODI2NDAxM2ZhYjgyNDk2MmY4NTAwYjQ1NjY5Y2MwMzczNCZYLUFtei1TaWduZWRIZWFkZXJzPWhvc3QifQ.EcpBaVzRhqRLgmRwX50ekIZ6_O9PD427VvrwnYV4sVY)
