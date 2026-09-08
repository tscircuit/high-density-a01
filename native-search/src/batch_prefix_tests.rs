// Frozen advance and batch algorithms from 8e363ef, compared with all mutable state.
use super::*;
use std::panic::{catch_unwind, AssertUnwindSafe};

impl Kernel {
    fn reference_advance(&mut self) -> u32 {
        if self.heap.entries.is_empty() {
            return 2;
        }
        let id = self.heap.pop() as usize;
        let cell = self.pool.nodes[id].cell as usize;
        if self.visited[cell] == self.stamp {
            return 0;
        }
        self.visited[cell] = self.stamp;
        let z = cell / self.plane;
        let in_plane = cell - z * self.plane;
        let row = in_plane / self.cols;
        let col = in_plane - row * self.cols;
        let g = self.pool.nodes[id].g;
        let ripped = self.pool.nodes[id].ripped;
        if z == self.config[3] as usize
            && row == self.config[4] as usize
            && col == self.config[5] as usize
        {
            self.goal = id as i32;
            return 1;
        }
        for d in 0..8 {
            let nr = row as i32 + DR[d];
            let nc = col as i32 + DC[d];
            if nr < 0 || nc < 0 || nr >= self.rows as i32 || nc >= self.cols as i32 {
                continue;
            }
            let nr = nr as usize;
            let nc = nc as usize;
            let next = (z * self.rows + nr) * self.cols + nc;
            if self.visited[next] == self.stamp {
                continue;
            }
            let (cost, list) = self.move_cost(z, row, col, z, nr, nc, ripped);
            if cost < 0.0 {
                continue;
            }
            let g2 = g + cost;
            let f2 = g2 + self.weighted_h(next, z, nr, nc);
            let id2 = self.pool.push(next, g2, id as i32, list);
            self.heap.push(f2, id2);
        }
        if row as f64 >= self.config[7]
            && row as f64 <= self.config[8]
            && col as f64 >= self.config[9]
            && col as f64 <= self.config[10]
        {
            for nz in 0..self.layers {
                if nz == z {
                    continue;
                }
                let next = (nz * self.rows + row) * self.cols + col;
                if self.visited[next] == self.stamp {
                    continue;
                }
                let (cost, list) = self.move_cost(z, row, col, nz, row, col, ripped);
                if cost < 0.0 {
                    continue;
                }
                let g2 = g + cost;
                let f2 = g2 + self.weighted_h(next, nz, row, col);
                let id2 = self.pool.push(next, g2, id as i32, list);
                self.heap.push(f2, id2);
            }
        }
        0
    }

    fn reference_advance_many(&mut self, limit: u32) -> u32 {
        self.state[3] = 0;
        self.state[4] = 0;
        let goal_cell = ((self.config[3] as usize * self.rows + self.config[4] as usize)
            * self.cols
            + self.config[5] as usize) as f64;
        for _ in 0..limit {
            if self.heap.entries.is_empty() {
                break;
            }
            // Publish the attempt before any possibly trapping indexed read.
            // state[0] remains the last COMPLETED pop's public heap length.
            self.publish_batch_state(3, self.state[4] + 1);
            let next = self.heap.entries[0].id as usize;
            let cell = self.pool.nodes[next].cell;
            if cell == goal_cell && self.visited[cell as usize] != self.stamp {
                self.publish_batch_state(3, self.state[4]);
                break;
            }
            let status = self.reference_advance();
            assert_eq!(status, 0, "batch must stop before terminal pops");
            self.publish_batch_state(0, self.heap.entries.len() as u32);
            self.publish_batch_state(4, self.state[4] + 1);
        }
        self.state[4]
    }
}

fn assert_same(a: &Kernel, b: &Kernel) {
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
            .map(|x| (x.cell.to_bits(), x.g.to_bits(), x.parent, x.ripped))
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

#[test]
fn batch_prefix_matches_frozen_search_state_through_growth_and_cost_changes() {
    let mut boundaries = 0;
    let mut completed = 0;
    for layers in [2, 4, 6] {
        for unusual in [false, true] {
            let (mut actual, mut reference) = (fixture(layers), fixture(layers));
            for search in 0..3 {
                if search > 0 {
                    for k in [&mut actual, &mut reference] {
                        k.used[13] = search;
                        k.roots[2] = search as u8;
                        k.begin(if search == 2 { 1 } else { 2 });
                    }
                }
                for quantum in 0..120 {
                    if unusual && quantum == 3 {
                        for k in [&mut actual, &mut reference] {
                            k.set_costs(
                                -0.0,
                                f64::INFINITY,
                                0.0,
                                f64::NAN,
                                0.0,
                                f64::INFINITY,
                                f64::INFINITY,
                            );
                        }
                    }
                    let limit = [0, 1, 2, 7, 100][quantum % 5];
                    let n = actual.advance_many(limit);
                    assert_eq!(n, reference.reference_advance_many(limit));
                    assert_same(&actual, &reference);
                    boundaries += 1;
                    completed += n;
                    if n == 0 {
                        let status = actual.advance();
                        assert_eq!(status, reference.reference_advance());
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
fn batch_prefix_preserves_full_partial_state_at_each_trap_boundary() {
    for kind in 0..5 {
        let (mut actual, mut reference) = (corrupt(kind), corrupt(kind));
        assert!(catch_unwind(AssertUnwindSafe(|| actual.advance_many(100))).is_err());
        assert!(catch_unwind(AssertUnwindSafe(|| reference.reference_advance_many(100))).is_err());
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
