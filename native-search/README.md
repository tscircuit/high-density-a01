# Exact A01 search kernel

`HighDensitySolverA01` accepts `useNativeSearch: true` to use this optional f64
WebAssembly kernel for an active connection's A* search. The default is `false`.
TypeScript still selects connections, counts iterations, enforces search and rip
budgets, marks cells, finalizes routes, and produces output. Each public search
step consumes the same single heap pop, including duplicate entries, as the
JavaScript implementation. `stepMultiplier` continues to control the number of
those steps in a public call.

The embedded byte asset needs no fetch or asynchronous initialization. A module
is compiled lazily and each solver lazily creates its own instance. If module
compilation or instantiation is unavailable (including CSP restrictions), the
connection uses JavaScript from its first step. `nativeSearchActive` reports the
current backend; `nativeSearchSteps` counts actual kernel steps cumulatively.
The instance reference is released when the solver terminates. Visualization
copies visited stamps on demand and `openSet.length` preserves the JavaScript
heap's observable size, including leftover entries after a successful search.

## Supported inputs and mutation

Backend selection happens before each connection. Native search requires a
positive integer grid with at most 1,048,576 layer cells, in-bounds integer
endpoints, finite nonnegative initial penalties and costs, and footprint offsets
whose flat arithmetic fits signed 32-bit integers. Empty via zones are supported.
Unsupported inputs use the existing JavaScript search.

The opt-in backend assumes grid dimensions, fixed port ownership, and ordered
via footprint offsets remain fixed for the solver. Occupancy, diagonal ownership,
penalties, endpoint coordinates, and root-overlap data are snapshotted at the
beginning of each connection and must remain fixed during that search, as with
the existing private per-search caches. TypeScript updates them between searches.

Ordinary writes to the public numeric cost fields, `cellSizeMm`, and `penaltyCap`
between steps remain live; existing cached heuristic entries retain their earlier
values exactly as in JavaScript. Public budget controls remain in TypeScript.
Overridden private heuristic/move/via-occupant hooks and accessor-valued cost
fields select JavaScript before the search. Installing such hooks/accessors or
reflectively changing the snapshotted geometry during an active native search is
outside this opt-in contract.

## Rebuilding

Install the pinned toolchain and target, then regenerate the checked-in asset:

```sh
rustup toolchain install 1.93.1 --profile minimal --target wasm32-unknown-unknown
bun scripts/build-native-search.ts
```

The script uses `cargo +1.93.1 --locked`, release optimization, and a 64 KiB
native stack. The crate has no external dependencies. CI rebuilds the asset and
rejects source/binary drift. Runtime consumers only need the files under `lib`;
Rust is needed solely to change or verify the kernel.
