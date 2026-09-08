// Integer-cell pool compared with the frozen C37 f64 representation.
use super::*;
use std::panic::{catch_unwind, AssertUnwindSafe};
include!("cell_u32_reference.rs");
macro_rules! both {
    ($a:ident, $b:ident, $k:ident, $body:block) => {{
        {
            let $k = &mut $a;
            $body
        }
        {
            let $k = &mut $b;
            $body
        }
    }};
}

fn assert_same(a: &Kernel, b: &ReferenceKernel) {
    macro_rules! same {
        ($($field:ident),* $(,)?) => {$(assert_eq!(&a.$field, &b.$field, stringify!($field));)*};
    }
    same!(
        rows,
        cols,
        layers,
        plane,
        used,
        ports,
        diagonals,
        roots,
        offset_dr,
        offset_dc,
        offset_flat,
        scan_radius,
        stamp,
        visited,
        h_stamp,
        via_stamp,
        via_cache,
        via_scratch,
        goal,
        result_rips,
        state
    );
    fn bits(values: &[f64]) -> Vec<u64> {
        values.iter().map(|value| value.to_bits()).collect()
    }
    for (left, right) in [
        (&a.penalty, &b.penalty),
        (&a.config, &b.config),
        (&a.h_value, &b.h_value),
        (&a.result_cells, &b.result_cells),
    ] {
        assert_eq!(bits(left), bits(right));
    }
    assert_eq!(
        bits(&[
            a.cell_size,
            a.via_base,
            a.rip_cost,
            a.rip_trace,
            a.rip_via,
            a.greedy,
            a.penalty_cap
        ]),
        bits(&[
            b.cell_size,
            b.via_base,
            b.rip_cost,
            b.rip_trace,
            b.rip_via,
            b.greedy,
            b.penalty_cap
        ])
    );
    assert_eq!(
        a.heap
            .entries
            .iter()
            .map(|x| (x.f.to_bits(), x.id))
            .collect::<Vec<_>>(),
        b.heap
            .entries
            .iter()
            .map(|x| (x.f.to_bits(), x.id))
            .collect::<Vec<_>>()
    );
    assert_eq!(
        a.pool
            .nodes
            .iter()
            .map(|x| ((x.cell as f64).to_bits(), x.g.to_bits(), x.parent, x.ripped))
            .collect::<Vec<_>>(),
        b.pool
            .nodes
            .iter()
            .map(|x| (x.cell.to_bits(), x.g.to_bits(), x.parent, x.ripped))
            .collect::<Vec<_>>()
    );
    assert_eq!(
        a.rips.iter().map(|x| (x.id, x.prev)).collect::<Vec<_>>(),
        b.rips.iter().map(|x| (x.id, x.prev)).collect::<Vec<_>>()
    );
    assert_eq!(
        (
            a.heap.entries.capacity(),
            a.pool.nodes.capacity(),
            a.rips.capacity()
        ),
        (
            b.heap.entries.capacity(),
            b.pool.nodes.capacity(),
            b.rips.capacity()
        )
    );
}

fn fixture(layers: usize) -> Kernel {
    let mut k = Kernel::new(10, 11, layers, 3, 5);
    k.config.copy_from_slice(&[
        0.0,
        1.0,
        1.0,
        (layers - 1) as f64,
        8.0,
        9.0,
        0.0,
        1.0,
        8.0,
        1.0,
        9.0,
    ]);
    k.offset_dr.copy_from_slice(&[0, -1, 1]);
    k.offset_dc.copy_from_slice(&[0, 0, 0]);
    k.roots[4] = 1;
    for i in 0..k.used.len() {
        if i % 17 == 0 {
            k.used[i] = (i % 4 + 1) as i32;
        }
        if i % 53 == 0 {
            k.ports[i] = 1;
        }
    }
    for i in (0..k.diagonals.len()).step_by(43) {
        k.diagonals[i] = 2;
    }
    for (i, penalty) in k.penalty.iter_mut().enumerate() {
        *penalty = (i % 5) as f64 * 0.125;
    }
    k.set_costs(0.1, 0.3, 0.7, 0.1, 0.2, 1.1, 20.0);
    k.begin(1);
    k
}
fn reference_fixture(layers: usize) -> ReferenceKernel {
    let mut k = ReferenceKernel::new(10, 11, layers, 3, 5);
    k.config.copy_from_slice(&[
        0.0,
        1.0,
        1.0,
        (layers - 1) as f64,
        8.0,
        9.0,
        0.0,
        1.0,
        8.0,
        1.0,
        9.0,
    ]);
    k.offset_dr.copy_from_slice(&[0, -1, 1]);
    k.offset_dc.copy_from_slice(&[0, 0, 0]);
    k.roots[4] = 1;
    for i in 0..k.used.len() {
        if i % 17 == 0 {
            k.used[i] = (i % 4 + 1) as i32;
        }
        if i % 53 == 0 {
            k.ports[i] = 1;
        }
    }
    for i in (0..k.diagonals.len()).step_by(43) {
        k.diagonals[i] = 2;
    }
    for (i, penalty) in k.penalty.iter_mut().enumerate() {
        *penalty = (i % 5) as f64 * 0.125;
    }
    k.set_costs(0.1, 0.3, 0.7, 0.1, 0.2, 1.1, 20.0);
    k.begin(1);
    k
}

#[test]
fn integer_cell_matches_frozen_search_state_through_growth_and_cost_changes() {
    let mut boundaries = 0;
    let mut completed = 0;
    for layers in [2, 4, 6] {
        for unusual in [false, true] {
            let (mut actual, mut reference) = (fixture(layers), reference_fixture(layers));
            for search in 0..3 {
                if search > 0 {
                    both!(actual, reference, k, {
                        k.used[13] = search;
                        k.roots[2] = search as u8;
                        k.begin(if search == 2 { 1 } else { 2 });
                    });
                }
                for quantum in 0..120 {
                    if unusual && quantum == 3 {
                        both!(actual, reference, k, {
                            k.set_costs(
                                -0.0,
                                f64::INFINITY,
                                0.0,
                                f64::NAN,
                                0.0,
                                f64::INFINITY,
                                f64::INFINITY,
                            );
                        });
                    }
                    let limit = [0, 1, 2, 7, 100][quantum % 5];
                    let n = actual.advance_many(limit);
                    assert_eq!(n, reference.advance_many(limit));
                    assert_same(&actual, &reference);
                    boundaries += 1;
                    completed += n;
                    if n == 0 {
                        let status = actual.advance();
                        assert_eq!(status, reference.advance());
                        assert_same(&actual, &reference);
                        if status != 0 {
                            actual.collect_goal();
                            reference.collect_goal();
                            assert_same(&actual, &reference);
                            break;
                        }
                    }
                }
            }
        }
    }
    assert!(boundaries > 100);
    assert!(completed > 1000);
}

fn corrupt(kind: usize) -> Kernel {
    let mut k = Kernel::new(3, 3, 2, 0, 2);
    k.stamp = 1;
    k.config[3] = 1.0;
    k.config[4] = 2.0;
    k.config[5] = 2.0;
    k.set_costs(0.1, 0.3, 0.7, 0.1, 0.2, 1.1, 20.0);
    let id = k.pool.push(0, 0.0, -1, -1);
    k.heap.push(0.0, id);
    let other = k.pool.push(1, 0.0, -1, -1);
    k.heap.push(1.0, other);
    match kind {
        0 => k.heap.entries[0].id = u32::MAX, // Trap before heap mutation.
        1 => k.pool.nodes[0].cell = 100,      // Visited bounds trap after pop.
        2 => k.plane = 0,                     // Decode trap after pop and visited store.
        3 => {
            // A goal's malformed visited index traps before pop.
            k.config[3] = 11.0;
            k.config[4] = 0.0;
            k.config[5] = 1.0;
            k.pool.nodes[0].cell = 100;
        }
        4 => {
            // A rip-chain trap occurs inside expansion after visited store.
            k.pool.nodes[0].ripped = i32::MAX;
            k.used[1] = 1;
        }
        _ => unreachable!(),
    }
    k.state[0] = 2;
    k
}
fn reference_corrupt(kind: usize) -> ReferenceKernel {
    let mut k = ReferenceKernel::new(3, 3, 2, 0, 2);
    k.stamp = 1;
    k.config[3] = 1.0;
    k.config[4] = 2.0;
    k.config[5] = 2.0;
    k.set_costs(0.1, 0.3, 0.7, 0.1, 0.2, 1.1, 20.0);
    let id = k.pool.push(0, 0.0, -1, -1);
    k.heap.push(0.0, id);
    let other = k.pool.push(1, 0.0, -1, -1);
    k.heap.push(1.0, other);
    match kind {
        0 => k.heap.entries[0].id = u32::MAX, // Trap before heap mutation.
        1 => k.pool.nodes[0].cell = 100.0,    // Visited bounds trap after pop.
        2 => k.plane = 0,                     // Decode trap after pop and visited store.
        3 => {
            // A goal's malformed visited index traps before pop.
            k.config[3] = 11.0;
            k.config[4] = 0.0;
            k.config[5] = 1.0;
            k.pool.nodes[0].cell = 100.0;
        }
        4 => {
            // A rip-chain trap occurs inside expansion after visited store.
            k.pool.nodes[0].ripped = i32::MAX;
            k.used[1] = 1;
        }
        _ => unreachable!(),
    }
    k.state[0] = 2;
    k
}

#[test]
fn integer_cell_preserves_full_partial_state_at_each_trap_boundary() {
    for kind in 0..5 {
        let (mut actual, mut reference) = (corrupt(kind), reference_corrupt(kind));
        assert!(catch_unwind(AssertUnwindSafe(|| actual.advance_many(100))).is_err());
        assert!(catch_unwind(AssertUnwindSafe(|| reference.advance_many(100))).is_err());
        assert_same(&actual, &reference);
        assert_eq!(&actual.state[3..5], &[1, 0]);
        assert_eq!(actual.state[0], 2);
        assert_eq!(
            actual.heap.entries.len(),
            if kind == 0 || kind == 3 { 2 } else { 1 }
        );
        assert_eq!(
            actual.visited[0],
            if kind == 2 || kind == 4 { 1 } else { 0 }
        );
    }
}

#[test]
fn integer_cell_boundaries_keep_f64_result_abi_and_pool_layout() {
    assert_eq!(
        std::mem::size_of::<SearchNode>(),
        std::mem::size_of::<ReferenceSearchNode>()
    );
    assert_eq!(
        std::mem::align_of::<SearchNode>(),
        std::mem::align_of::<ReferenceSearchNode>()
    );
    assert_eq!(std::mem::size_of::<SearchNode>(), 24);
    assert_eq!(std::mem::size_of::<HeapEntry>(), 16);
    let mut actual = Kernel::new(1, 1, 1, 0, 1);
    let mut reference = ReferenceKernel::new(1, 1, 1, 0, 1);
    let cells = [
        0usize,
        65_535,
        65_536,
        1_048_575,
        1_048_576,
        2_147_483_647,
        2_147_483_648,
        u32::MAX as usize,
    ];
    // Eligibility boundary and the full wasm32 integer domain, without an
    // enormous grid allocation. Goal collection only reads the parent chain.
    let mut parent = -1;
    for i in 0..4096 {
        let cell = cells[i % cells.len()];
        let cost = [0.0, -0.0, f64::INFINITY, f64::NAN][i % 4];
        let id = actual.pool.push(cell, cost, parent, -1);
        assert_eq!(id, reference.pool.push(cell, cost, parent, -1));
        assert_eq!(actual.pool.nodes[id as usize].cell as usize, cell);
        parent = id as i32;
    }
    actual.goal = parent;
    reference.goal = parent;
    actual.collect_goal();
    reference.collect_goal();
    assert_same(&actual, &reference);
    for (i, cell) in actual.result_cells.iter().enumerate() {
        assert_eq!(*cell, cells[i % cells.len()] as f64);
    }
    actual.clear();
    reference.clear();
    assert_same(&actual, &reference);
}
