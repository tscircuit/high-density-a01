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

Install from GitHub:

```sh
bun add git+https://github.com/tscircuit/high-density-a01.git
```

The package exports the solver classes directly:

```ts
import {
  HighDensitySolverA03,
  HighDensitySolverA05,
  HighDensitySolverA11,
  HighDensitySolverA12,
} from "@tscircuit/high-density-a01"
```

### A11

Use `HighDensitySolverA11` for an A01-derived fine-grid solver that retries
dense nodes at their original bounds instead of enlarging the node. It derives
one deterministic grid size from the configured trace and via dimensions; it
does not grow or shrink the input node.

The grid pitch is
`min(0.05, traceThickness / 2, traceMargin / 2, viaDiameter / 6)`. This exposes
narrow routing corridors and via locations that A01's coarser 0.1 mm grid can
alias away, at the cost of more grid cells and A* search work.

```ts
const solver = new HighDensitySolverA11({
  nodeWithPortPoints,
  traceThickness: 0.1,
  traceMargin: 0.15,
  viaDiameter: 0.3,
  viaMinDistFromBorder: 0.15,
})

solver.solve()
if (solver.solved) {
  const routes = solver.getOutput()
}
```

The fine-grid solver checks segment-to-via clearance in output coordinates and
rejects solved outputs that fail exact geometry validation.

At Pipeline 9 copper dimensions, seed 0, and a 100,000-iteration cap, it solves
six of the 27 native-bound problems in
[`tscircuit/dataset-hd30`](https://github.com/tscircuit/dataset-hd30):

| Node | Iterations |
| --- | ---: |
| `sample002-cmn_279` | 303 |
| `sample004-cmn_117` | 2,794 |
| `sample007-cmn_345__sub_0_2` | 245 |
| `sample007-cmn_345__sub_0_0` | 79 |
| `sample008-cmn_447` | 4,884 |
| `sample008-cmn_438` | 1,828 |

All six outputs pass exact route-geometry validation without growing the input
node. They are covered by native-bounds regressions under
`tests/repros/dataset-hd30-a11/`.

### A12

Use `HighDensitySolverA12` when A11's uniform fine grid creates too many search
states. A12 applies the same feature-derived fine pitch to a 16-cell perimeter
band, uses cells four times larger in the middle, and enables diagonal moves on
A03's five-region graph. Set `fineGridCellThickness` to tune the fine perimeter
width for a particular portfolio.

```ts
const solver = new HighDensitySolverA12({
  nodeWithPortPoints,
  traceThickness: 0.1,
  traceMargin: 0.15,
  viaDiameter: 0.3,
  viaMinDistFromBorder: 0.15,
  fineGridCellThickness: 16,
})

solver.solve()
if (solver.solved) {
  const routes = solver.getOutput()
}
```

A12 preserves the exact supplied endpoints and rejects completed routes that
fail exact geometry validation. At Pipeline 9 dimensions, seed 0, and a
100,000-iteration cap, it solves eight native-bound dataset-hd30 problems:

| Node | Iterations |
| --- | ---: |
| `sample003-cmn_70` | 265 |
| `sample004-topology_merge_639` | 14,478 |
| `sample005-cmn_45` | 373 |
| `sample007-cmn_345__sub_0_0` | 49 |
| `sample007-cmn_345__sub_0_2` | 149 |
| `sample008-cmn_251` | 1,067 |
| `sample008-cmn_438` | 38,206 |
| `sample016-cmn_31` | 306 |

Five of these are new beyond A11, giving the two-solver portfolio 11
native-bounds solves.

Together, the A12 graphs allocate 44.1% as many search states as A11 across all
27 dataset-hd30 nodes. On the largest grid, A12 uses 27.5% as many states. The
reduction is concentrated in the larger nodes; narrow nodes whose perimeter
bands meet in the middle remain fully fine-grid.
Because diagonal-edge conflicts are checked by the final geometry gate rather
than repaired during search, A12 is currently best used as a complementary
portfolio stage alongside A11.

### History-aware displacement in A11

A11 increases the cost of displacing a route each time that route has already
been ripped. A fixed `ripCost` does not distinguish a useful first
displacement from repeatedly undoing the same decision, so small dense nodes
can settle into stable rip cycles. The effective A11 cost is
`ripCost * (1 + priorRipCount)`; A01 keeps its original fixed cost.

At Pipeline 9 dimensions, seed 0, and a 100,000-iteration cap, this lets A11
solve `sample004-topology_merge_298` in 3,309 iterations at the original node
bounds. The output passes exact route-geometry validation, the other six A11
HD30 solves are preserved, and the A11/A12 native-bound portfolio increases
from 11 to 12 of the 27 dataset-hd30 nodes.

### Shortest-first initial routing in A11

A11 routes shorter connections before longer ones. On its uniform fine grid,
this keeps local connections from being blocked by longer routes that have
more ways around the node. A01 retains its seeded shuffled order.

At Pipeline 9 dimensions and a 100,000-iteration cap, this lets A11 solve
`sample002-cmn_36` in 95,308 iterations at the original node bounds. The
previous seven A11 HD30 solves are preserved, and the A11/A12 native-bound
portfolio increases from 12 to 13 of the 27 dataset-hd30 nodes.

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
For A11, that one-time candidate-path cost is additionally scaled by how many
earlier committed routes have already displaced the trace.

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
./benchmark.sh --solver A01,A11,A12 --concurrency=4
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
