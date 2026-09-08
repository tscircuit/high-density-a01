use super::*;
use std::panic::{catch_unwind, AssertUnwindSafe};

#[derive(Default, Debug, PartialEq)]
struct Calls {
    values: Vec<(u8, u64, u64)>,
    fail_at: Option<usize>,
}
impl Host for Calls {
    type Error = &'static str;
    fn hypot(&mut self, dx: f64, dy: f64) -> Result<f64, Self::Error> {
        self.values.push((1, dx.to_bits(), dy.to_bits()));
        if self.fail_at == Some(self.values.len()) {
            return Err("injected host failure");
        }
        Ok(dx.hypot(dy))
    }
    fn footprint(&mut self, cell: i32) -> Result<Vec<i32>, Self::Error> {
        self.values.push((2, cell as u32 as u64, 0));
        if self.fail_at == Some(self.values.len()) {
            return Err("injected host failure");
        }
        Ok(vec![cell])
    }
}
fn kernel(layers: usize) -> Kernel {
    let plane = 5;
    let problem = Problem {
        plane,
        layers,
        x: vec![0.0, 1.0, 2.0, 3.0, 4.0],
        y: vec![0.0; plane],
        offsets: vec![0, 1, 2, 3, 4, 4],
        neighbors: vec![1, 2, 3, 4],
        edge_costs: vec![1.0; 4],
        via_allowed: vec![0; plane],
        owners: vec![-1; plane * layers],
        port_owners: vec![-1; plane * layers],
        shared_offsets: vec![0; plane * layers + 1],
        shared_ids: vec![],
        penalties: vec![0.0; plane],
        root_overlap: vec![1, 0, 0],
    };
    Kernel::new(
        problem,
        Costs {
            via: 1.0,
            rip: 8.0,
            trace_rip: 0.5,
            via_rip: 0.75,
            greedy: 1.5,
            cap: 10.0,
        },
        Search {
            stamp: 1,
            active: 0,
            start_z: 0,
            start_cell: 0,
            end_z: 0,
            end_cell: 4,
        },
        6.0,
    )
    .unwrap()
}
fn same_state(a: &Kernel, b: &Kernel) {
    assert_eq!(
        a.state.words(),
        b.state.words(),
        "all allocated search backing words"
    );
    assert_eq!(
        a.distance_cache.words(a.problem.plane),
        b.distance_cache.words(b.problem.plane)
    );
    assert_eq!(a.batch, b.batch);
}

#[test]
fn unsupported_current_rows_leave_every_search_and_cache_word_untouched() {
    let mutations: Vec<Box<dyn Fn(&mut Kernel)>> = vec![
        Box::new(|k| k.problem.offsets[0] = -1),
        Box::new(|k| k.problem.offsets[0] = 2),
        Box::new(|k| k.problem.offsets[1] = 99),
        Box::new(|k| k.problem.offsets.clear()),
        Box::new(|k| k.problem.neighbors[0] = -1),
        Box::new(|k| k.problem.neighbors[0] = 5),
        Box::new(|k| k.problem.neighbors.clear()),
        Box::new(|k| k.problem.edge_costs.clear()),
        Box::new(|k| k.problem.edge_costs[0] = f32::from_bits(0xffc0_0042)),
        Box::new(|k| k.problem.x[0] = f64::NAN),
        Box::new(|k| k.problem.y[0] = f64::INFINITY),
        Box::new(|k| k.problem.x[1] = f64::NEG_INFINITY),
        Box::new(|k| k.problem.y[1] = f64::NAN),
        Box::new(|k| k.problem.x[4] = f64::INFINITY),
        Box::new(|k| k.problem.y[4] = f64::NAN),
        Box::new(|k| k.problem.x.clear()),
    ];
    for mutate in mutations {
        let mut k = kernel(2);
        mutate(&mut k);
        let before = k.state.words();
        let distance = k.distance_cache.words(k.problem.plane);
        let mut host = Calls::default();
        assert!(!k.next_graph_row_supported());
        assert_eq!(k.advance_many_guarded(&mut host, 7), Ok((0, true)));
        assert_eq!(k.state.words(), before);
        assert_eq!(k.distance_cache.words(k.problem.plane), distance);
        assert_eq!(k.batch, BatchState::default());
        assert!(host.values.is_empty());
    }
}

#[test]
fn later_unsupported_row_preserves_exact_completed_prefix_and_recovery() {
    let mut guarded = kernel(2);
    let mut reference = kernel(2);
    guarded.problem.edge_costs[2] = f32::NAN;
    reference.problem.edge_costs[2] = f32::NAN;
    let mut a = Calls::default();
    let mut b = Calls::default();
    assert_eq!(guarded.advance_many_guarded(&mut a, 9), Ok((2, true)));
    assert_eq!(reference.advance_many(&mut b, 2), Ok(2));
    same_state(&guarded, &reference);
    assert_eq!(a, b);
    guarded.problem.edge_costs[2] = 1.0;
    reference.problem.edge_costs[2] = 1.0;
    assert_eq!(guarded.advance_many_guarded(&mut a, 9), Ok((2, false)));
    assert_eq!(reference.advance_many(&mut b, 9), Ok(2));
    same_state(&guarded, &reference);
    assert_eq!(a, b);
}

#[test]
fn duplicate_goal_and_empty_pops_do_not_consult_unused_graph_rows() {
    for kind in 0..3 {
        let mut guarded = kernel(2);
        if kind == 0 {
            guarded.state.visited[0] = guarded.search.stamp;
        }
        if kind == 1 {
            guarded.state.pool.nodes[0].cell = 4;
        }
        if kind == 2 {
            guarded.state.heap.n = 0;
        }
        let mut reference = Kernel::restore(guarded.problem.clone(), guarded.snapshot()).unwrap();
        guarded.problem.offsets.clear();
        guarded.problem.x.clear();
        reference.problem.offsets.clear();
        reference.problem.x.clear();
        let mut a = Calls::default();
        let mut b = Calls::default();
        assert!(guarded.next_graph_row_supported());
        let result = guarded.advance_many_guarded(&mut a, 7).unwrap();
        assert!(!result.1);
        assert_eq!(result.0, reference.advance_many(&mut b, 7).unwrap());
        same_state(&guarded, &reference);
        assert_eq!(a, b);
    }
}

#[test]
fn supported_infinite_edges_signed_zero_and_host_errors_retain_exact_state() {
    for edge in [0.0, -0.0, f32::INFINITY, f32::NEG_INFINITY, 1.0] {
        for fail_at in [None, Some(1), Some(2), Some(3), Some(5)] {
            let mut guarded = kernel(4);
            guarded.problem.edge_costs.fill(edge);
            guarded.problem.via_allowed.fill(1);
            let mut reference =
                Kernel::restore(guarded.problem.clone(), guarded.snapshot()).unwrap();
            let mut a = Calls {
                fail_at,
                ..Calls::default()
            };
            let mut b = Calls {
                fail_at,
                ..Calls::default()
            };
            let result = guarded.advance_many_guarded(&mut a, 7);
            let expected = reference.advance_many(&mut b, 7);
            assert_eq!(
                result.map(|(n, unsupported)| {
                    assert!(!unsupported);
                    n
                }),
                expected
            );
            same_state(&guarded, &reference);
            assert_eq!(a, b);
        }
    }
}

#[test]
fn private_corrupt_peeks_keep_legacy_traps_and_partial_counters() {
    for corruption in 0..7 {
        let mut guarded = kernel(2);
        match corruption {
            0 => guarded.state.heap.entries[0].id = -1,
            1 => guarded.state.heap.entries[0].id = i32::MAX,
            2 => guarded.state.heap.entries.clear(),
            3 => guarded.state.pool.nodes[0].cell = -1,
            4 => guarded.state.pool.nodes[0].z = -1,
            5 => guarded.state.visited.clear(),
            6 => guarded.state.pool.nodes[0].cell = i32::MAX,
            _ => unreachable!(),
        }
        let mut reference = kernel(2);
        reference.state = guarded.state.clone();
        let mut a = Calls::default();
        let mut b = Calls::default();
        assert!(guarded.next_graph_row_supported());
        let actual = catch_unwind(AssertUnwindSafe(|| guarded.advance_many_guarded(&mut a, 7)));
        let expected = catch_unwind(AssertUnwindSafe(|| reference.advance_many(&mut b, 7)));
        assert!(actual.is_err() && expected.is_err());
        same_state(&guarded, &reference);
        assert_eq!(a, b);
    }
}
