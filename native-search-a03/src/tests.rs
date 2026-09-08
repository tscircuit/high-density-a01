use super::*;
use flate2::read::GzDecoder;
use std::io::Read;
use std::path::{Path, PathBuf};

struct Bytes {
    data: Vec<u8>,
    at: usize,
}
impl Bytes {
    fn read(path: &Path) -> Self {
        let mut data = Vec::new();
        GzDecoder::new(std::fs::File::open(path).unwrap())
            .read_to_end(&mut data)
            .unwrap();
        Self { data, at: 0 }
    }
    fn take<const N: usize>(&mut self) -> [u8; N] {
        let value = self.data[self.at..self.at + N].try_into().unwrap();
        self.at += N;
        value
    }
    fn u32(&mut self) -> u32 {
        u32::from_le_bytes(self.take())
    }
    fn i32(&mut self) -> i32 {
        self.u32() as i32
    }
    fn u64(&mut self) -> u64 {
        u64::from_le_bytes(self.take())
    }
    fn f64(&mut self) -> f64 {
        f64::from_bits(self.u64())
    }
    fn ints(&mut self) -> Vec<i32> {
        let n = self.u32();
        (0..n).map(|_| self.i32()).collect()
    }
    fn floats(&mut self) -> Vec<f64> {
        let n = self.u32();
        (0..n).map(|_| self.f64()).collect()
    }
    fn f32s(&mut self) -> Vec<f32> {
        let n = self.u32();
        (0..n).map(|_| f32::from_bits(self.u32())).collect()
    }
    fn bytes(&mut self) -> Vec<u8> {
        let n = self.u32() as usize;
        let out = self.data[self.at..self.at + n].to_vec();
        self.at += n;
        out
    }
    fn delta(&mut self, values: &mut Vec<u64>) {
        let len = self.u32() as usize;
        values.resize(len, 0);
        let changes = self.u32();
        for _ in 0..changes {
            let index = self.u32() as usize;
            values[index] = self.u64();
        }
    }
    fn problem(&mut self) -> Problem {
        Problem {
            plane: self.u32() as usize,
            layers: self.u32() as usize,
            x: self.floats(),
            y: self.floats(),
            offsets: self.ints(),
            neighbors: self.ints(),
            edge_costs: self.f32s(),
            via_allowed: self.bytes(),
            owners: self.ints(),
            port_owners: self.ints(),
            shared_offsets: self.ints(),
            shared_ids: self.ints(),
            penalties: self.floats(),
            root_overlap: self.bytes(),
        }
    }
    fn costs(&mut self) -> Costs {
        Costs {
            via: self.f64(),
            rip: self.f64(),
            trace_rip: self.f64(),
            via_rip: self.f64(),
            greedy: self.f64(),
            cap: self.f64(),
        }
    }
    fn search(&mut self) -> Search {
        Search {
            stamp: self.u32(),
            active: self.i32(),
            start_z: self.i32(),
            start_cell: self.i32(),
            end_z: self.i32(),
            end_cell: self.i32(),
        }
    }
    fn events(&mut self) -> RecordedHost {
        let n = self.u32();
        let mut events = Vec::new();
        for _ in 0..n {
            let kind = self.u32();
            let throws = self.u32() == 1;
            events.push(if kind == 1 {
                Event::Hypot {
                    dx: self.u64(),
                    dy: self.u64(),
                    result: if throws { None } else { Some(self.u64()) },
                }
            } else {
                assert_eq!(kind, 2);
                Event::Footprint {
                    cell: self.i32(),
                    result: if throws { None } else { Some(self.ints()) },
                }
            });
        }
        RecordedHost { events, next: 0 }
    }
}
struct Words<'a> {
    values: &'a [u64],
    at: usize,
}
impl<'a> Words<'a> {
    fn next(&mut self) -> u64 {
        let value = self.values[self.at];
        self.at += 1;
        value
    }
    fn i32(&mut self) -> i32 {
        self.next() as u32 as i32
    }
    fn f64(&mut self) -> f64 {
        f64::from_bits(self.next())
    }
    fn ints(&mut self) -> Vec<i32> {
        let n = self.next();
        (0..n).map(|_| self.i32()).collect()
    }
    fn uints(&mut self) -> Vec<u32> {
        let n = self.next();
        (0..n).map(|_| self.next() as u32).collect()
    }
    fn floats(&mut self) -> Vec<f64> {
        let n = self.next();
        (0..n).map(|_| self.f64()).collect()
    }
    fn lists(&mut self, size: usize) -> OrderedLists {
        let count = self.next();
        let mut out = OrderedLists::new(size);
        for _ in 0..count {
            let key = self.i32();
            let values = self.ints();
            out.insert(key, values);
        }
        out
    }
    fn state(&mut self, plane: usize) -> SearchState {
        assert_eq!(self.next(), 1);
        let heap_n = self.next() as usize;
        let heap_capacity = self.next();
        let heap = Heap {
            n: heap_n,
            entries: (0..heap_capacity)
                .map(|_| HeapEntry {
                    f: self.f64(),
                    id: self.i32(),
                })
                .collect(),
        };
        let pool_n = self.next() as usize;
        let pool_capacity = self.next();
        let pool = Pool {
            n: pool_n,
            nodes: (0..pool_capacity)
                .map(|_| Node {
                    z: self.i32(),
                    cell: self.i32(),
                    g: self.f64(),
                    parent: self.i32(),
                    rip_head: self.i32(),
                    rip_count: self.i32(),
                })
                .collect(),
        };
        let rip_n = self.next() as usize;
        let rip_capacity = self.next();
        let rips = RipChain {
            n: rip_n,
            entries: (0..rip_capacity)
                .map(|_| Rip {
                    owner: self.i32(),
                    prev: self.i32(),
                })
                .collect(),
        };
        let visited = self.uints();
        let visited_flat = self.uints();
        let best_stamp = self.uints();
        let best_g = self.floats();
        let move_cost = self.f64();
        let move_head = self.i32();
        let move_rips = self.f64();
        let via_scratch = self.ints();
        let trace_scratch = self.ints();
        let layer_scratch = self.ints();
        let via_lists = self.lists(plane);
        let footprints = self.lists(plane);
        let layer_count = self.next();
        let mut layer_lists = Vec::new();
        let mut layer_stamps = Vec::new();
        for _ in 0..layer_count {
            layer_stamps.push(self.next() as u32);
            let present = self.next();
            layer_lists.push(if present == 1 {
                Some(self.ints())
            } else {
                assert_eq!(present, 0);
                None
            });
        }
        assert_eq!(self.at, self.values.len());
        SearchState {
            heap,
            pool,
            rips,
            visited,
            visited_flat,
            best_stamp,
            best_g,
            move_cost,
            move_head,
            move_rips,
            via_scratch,
            trace_scratch,
            layer_scratch,
            via_lists,
            footprints,
            layer_lists,
            layer_stamps,
        }
    }
}
#[derive(Debug, Clone)]
enum Event {
    Hypot {
        dx: u64,
        dy: u64,
        result: Option<u64>,
    },
    Footprint {
        cell: i32,
        result: Option<Vec<i32>>,
    },
}
#[derive(Debug, Clone)]
struct RecordedHost {
    events: Vec<Event>,
    next: usize,
}
#[derive(Debug, PartialEq, Eq)]
struct Injected;
impl Host for RecordedHost {
    type Error = Injected;
    fn hypot(&mut self, dx: f64, dy: f64) -> Result<f64, Injected> {
        let event = self
            .events
            .get(self.next)
            .expect("Unexpected additional hypot call");
        self.next += 1;
        match event {
            Event::Hypot {
                dx: expected_x,
                dy: expected_y,
                result,
            } => {
                assert_eq!(dx.to_bits(), *expected_x, "hypot dx at event {}", self.next);
                assert_eq!(dy.to_bits(), *expected_y, "hypot dy at event {}", self.next);
                result.map(f64::from_bits).ok_or(Injected)
            }
            _ => panic!("Expected footprint, got hypot at event {}", self.next),
        }
    }
    fn footprint(&mut self, cell: i32) -> Result<Vec<i32>, Injected> {
        let event = self
            .events
            .get(self.next)
            .expect("Unexpected additional footprint call");
        self.next += 1;
        match event {
            Event::Footprint {
                cell: expected,
                result,
            } => {
                assert_eq!(cell, *expected);
                result.clone().ok_or(Injected)
            }
            _ => panic!("Expected hypot, got footprint at event {}", self.next),
        }
    }
}
fn same_words(kernel: &Kernel, expected: &[u64], label: &str) {
    let actual = kernel.state.words();
    assert_eq!(
        actual.len(),
        expected.len(),
        "{label}: state payload length"
    );
    if let Some((index, (a, b))) = actual
        .iter()
        .zip(expected)
        .enumerate()
        .find(|(_, (a, b))| a != b)
    {
        panic!("{label}: first differing full-state word {index}: actual {a:016x}, expected {b:016x}; heap={},nodes={},rips={}",kernel.state.heap.n,kernel.state.pool.n,kernel.state.rips.n);
    }
}
fn fixtures() -> Vec<PathBuf> {
    let mut paths: Vec<_> =
        std::fs::read_dir(Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures"))
            .unwrap()
            .map(|v| v.unwrap().path())
            .filter(|p| {
                p.to_string_lossy().ends_with(".bin.gz")
                    && !p
                        .file_name()
                        .unwrap()
                        .to_string_lossy()
                        .starts_with("heap-")
            })
            .collect();
    paths.sort();
    assert_eq!(paths.len(), 28);
    paths
}
fn initial(reader: &mut Bytes) -> (Kernel, RecordedHost, Vec<u64>, u32) {
    assert_eq!(&reader.take::<8>(), b"C52A03V2");
    let problem = reader.problem();
    let costs = reader.costs();
    let search = reader.search();
    let start_f = reader.f64();
    let mut expected = Vec::new();
    reader.delta(&mut expected);
    let state = Words {
        values: &expected,
        at: 0,
    }
    .state(problem.plane);
    // Start priority stays the exact TS-computed value; no eager host calls.
    assert_eq!(state.heap.entries[0].f.to_bits(), start_f.to_bits());
    let kernel = Kernel::restore(
        problem,
        Snapshot {
            search,
            costs,
            state,
            batch: BatchState::default(),
        },
    )
    .unwrap();
    same_words(&kernel, &expected, "initial roundtrip");
    let host = reader.events();
    let frames = reader.u32();
    (kernel, host, expected, frames)
}
#[test]
fn every_pop_matches_frozen_c37_full_state_and_lazy_host_order() {
    let mut count = 0;
    for path in fixtures() {
        let mut reader = Bytes::read(&path);
        let (mut kernel, mut host, mut expected, frames) = initial(&mut reader);
        for frame in 0..frames {
            kernel.costs = reader.costs();
            let status = reader.u32();
            let goal = reader.i32();
            let events = reader.u32() as usize;
            reader.delta(&mut expected);
            let result = kernel.advance(&mut host);
            match status {
                0 => assert_eq!(result, Ok(Status::Advanced)),
                1 => assert_eq!(result, Ok(Status::Goal(goal))),
                2 => assert_eq!(result, Ok(Status::Empty)),
                3 => assert_eq!(result, Err(Injected)),
                _ => panic!("bad fixture status"),
            }
            assert_eq!(
                host.next,
                events,
                "{} frame{frame}: host call order/count",
                path.display()
            );
            same_words(
                &kernel,
                &expected,
                &format!("{} frame{frame}", path.display()),
            );
            if frame % 41 == 0 {
                // Complete materialization preserves every backing value and can
                // resume without rebuilding IDs or losing discarded rip nodes.
                kernel = Kernel::restore(kernel.problem.clone(), kernel.snapshot()).unwrap();
                same_words(&kernel, &expected, "materialization roundtrip");
            }
            count += 1;
        }
        assert_eq!(host.next, host.events.len());
        assert_eq!(reader.at, reader.data.len());
    }
    assert!(count > 1000, "Too few captured search boundaries: {count}");
}
#[test]
fn bulk_prefixes_match_c37_including_partial_host_failures() {
    for path in fixtures() {
        let mut reader = Bytes::read(&path);
        let (mut kernel, mut host, mut expected, frames) = initial(&mut reader);
        let mut next = 0;
        while next < frames {
            let count = (frames - next).min(if path.file_name().unwrap() == "live-costs.bin.gz" {
                1
            } else {
                7
            });
            let mut last_status = 0;
            let mut goal = -1;
            let mut events = 0;
            // Capture files end at the first goal/empty/throw. Leave a terminal
            // goal/empty to the ordinary entry, exactly as a supervisor would.
            let checkpoint = reader.at;
            let old_expected = expected.clone();
            let mut consumed = 0;
            for _ in 0..count {
                kernel.costs = reader.costs();
                let status = reader.u32();
                let g = reader.i32();
                let e = reader.u32() as usize;
                reader.delta(&mut expected);
                consumed += 1;
                last_status = status;
                goal = g;
                events = e;
                if status != 0 {
                    break;
                }
            }
            if (last_status == 1 || last_status == 2) && consumed > 1 {
                reader.at = checkpoint;
                expected = old_expected;
                consumed -= 1;
                for _ in 0..consumed {
                    kernel.costs = reader.costs();
                    last_status = reader.u32();
                    goal = reader.i32();
                    events = reader.u32() as usize;
                    reader.delta(&mut expected);
                }
            }
            if last_status == 1 || last_status == 2 {
                assert_eq!(kernel.advance_many(&mut host, 7), Ok(0));
                assert_eq!(kernel.batch, BatchState::default());
                assert_eq!(
                    kernel.advance(&mut host),
                    Ok(if last_status == 1 {
                        Status::Goal(goal)
                    } else {
                        Status::Empty
                    })
                );
            } else {
                let result = kernel.advance_many(&mut host, consumed);
                if last_status == 3 {
                    assert_eq!(result, Err(Injected));
                    assert_eq!(kernel.batch.attempts, consumed);
                    assert_eq!(kernel.batch.completed, consumed - 1);
                } else {
                    assert_eq!(result, Ok(consumed));
                    assert_eq!(
                        kernel.batch,
                        BatchState {
                            attempts: consumed,
                            completed: consumed
                        }
                    );
                }
            }
            assert_eq!(host.next, events, "{} bulk next{next}", path.display());
            same_words(
                &kernel,
                &expected,
                &format!("{} bulk next{next}", path.display()),
            );
            next += consumed;
        }
        assert_eq!(host.next, host.events.len());
        assert_eq!(reader.at, reader.data.len());
    }
}

fn tiny_problem() -> Problem {
    Problem {
        plane: 3,
        layers: 2,
        x: vec![0.0, 1.0, 2.0],
        y: vec![0.0; 3],
        offsets: vec![0, 1, 2, 2],
        neighbors: vec![1, 2],
        edge_costs: vec![1.0; 2],
        via_allowed: vec![0; 3],
        owners: vec![-1; 6],
        port_owners: vec![-1; 6],
        shared_offsets: vec![0; 7],
        shared_ids: vec![],
        penalties: vec![0.0; 3],
        root_overlap: vec![1, 0, 0],
    }
}
fn tiny_search(stamp: u32) -> Search {
    Search {
        stamp,
        active: 0,
        start_z: 0,
        start_cell: 0,
        end_z: 0,
        end_cell: 2,
    }
}
#[test]
fn capability_limits_start_reset_growth_and_numeric_scratch_are_explicit() {
    let p = tiny_problem();
    let costs = Costs {
        via: 0.1,
        rip: 8.0,
        trace_rip: 0.5,
        via_rip: 0.75,
        greedy: 1.5,
        cap: 10.0,
    };
    let mut kernel = Kernel::new(p.clone(), costs, tiny_search(1), 3.0).unwrap();
    assert_eq!(kernel.state.pool.n, 1);
    assert_eq!(kernel.state.best_stamp[0], 1);
    kernel.state.visited.fill(1);
    kernel.state.visited_flat.fill(1);
    kernel.state.best_stamp.fill(1);
    kernel.state.layer_stamps.fill(1);
    kernel.state.footprints.insert(0, vec![0, 1]);
    kernel.state.via_lists.insert(0, vec![1]);
    kernel.begin(tiny_search(2), 3.0, false).unwrap();
    assert_eq!(kernel.state.visited, vec![1; 6]);
    assert!(kernel.state.via_lists.order.is_empty());
    assert_eq!(kernel.state.footprints.order, vec![0]);
    kernel.begin(tiny_search(1), 3.0, true).unwrap();
    assert_eq!(kernel.state.visited, vec![0; 6]);
    assert_eq!(kernel.state.visited_flat, vec![0; 6]);
    assert_eq!(kernel.state.layer_stamps, vec![0; 3]);
    assert_eq!(kernel.state.best_stamp, vec![1, 0, 0, 0, 0, 0]);
    let mut host = RecordedHost {
        events: vec![],
        next: 0,
    };
    kernel.state.move_rips = 123.0;
    kernel.problem.port_owners[1] = 2;
    kernel
        .move_cost(&mut host, 0, 1, false, -1, 7, 1.0)
        .unwrap();
    assert_eq!(kernel.state.move_cost, -1.0);
    assert_eq!(kernel.state.move_head, -1);
    assert_eq!(kernel.state.move_rips, 123.0);
    kernel.problem.port_owners[1] = -1;
    kernel.problem.owners[1] = 1;
    kernel
        .move_cost(&mut host, 0, 1, false, -1, i32::MAX, 1.0)
        .unwrap();
    assert_eq!(kernel.state.move_rips, 2_147_483_648.0);
    assert_eq!(js_to_i32(kernel.state.move_rips), i32::MIN);
    let mut invalid = p.clone();
    invalid.offsets[1] = -1;
    assert_eq!(invalid.validate(), Err("unsupported CSR"));
    invalid = p.clone();
    invalid.neighbors[0] = 3;
    assert_eq!(invalid.validate(), Err("unsupported CSR"));
    for value in [
        f64::from_bits(0xfff8_0000_0000_0001),
        f64::INFINITY,
        f64::NEG_INFINITY,
    ] {
        invalid = p.clone();
        invalid.x[0] = value;
        assert_eq!(invalid.validate(), Err("unsupported nonfinite centers"));
        invalid = p.clone();
        invalid.y[0] = value;
        assert_eq!(invalid.validate(), Err("unsupported nonfinite centers"));
    }
    invalid = p.clone();
    invalid.x[0] = -f64::MAX;
    invalid.x[1] = f64::MAX;
    assert!(invalid.validate().is_ok());
    invalid = p.clone();
    invalid.edge_costs[0] = f32::from_bits(0x7fc0_0001);
    assert_eq!(invalid.validate(), Err("unsupported CSR"));
    invalid.edge_costs[0] = f32::INFINITY;
    assert!(invalid.validate().is_ok());
    invalid.edge_costs[0] = f32::NEG_INFINITY;
    assert!(invalid.validate().is_ok());
    invalid = p.clone();
    invalid.layers = 0;
    assert_eq!(invalid.validate(), Err("unsupported grid dimensions"));
    let before = kernel.state.words();
    assert!(kernel.begin(tiny_search(0), 0.0, false).is_err());
    assert_eq!(before, kernel.state.words());
    for i in 0..4097 {
        let head = kernel.state.rips.append(if i == 0 { -1 } else { i - 1 }, i);
        assert_eq!(head as usize, kernel.state.rips.n - 1);
        kernel.state.pool.push(Node {
            z: 0,
            cell: 0,
            g: i as f64,
            parent: -1,
            rip_head: head,
            rip_count: i,
        });
    }
    assert!(kernel.state.pool.nodes.len() >= 8192);
    assert!(kernel.state.rips.entries.len() >= 8192);
    assert_eq!(js_min(-0.0, 0.0).to_bits(), (-0.0f64).to_bits());
    assert!(js_min(f64::NAN, f64::INFINITY).is_nan());
}

#[test]
fn heap_matches_c37_full_backing_storage_for_every_tie_growth_and_nan_operation() {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/heap-operations.bin.gz");
    let mut reader = Bytes::read(&path);
    assert_eq!(&reader.take::<8>(), b"C52HEAP1");
    let operations = reader.u32();
    let mut heap = Heap::default();
    let mut expected = Vec::new();
    for operation in 0..operations {
        let kind = reader.u32();
        let f = reader.f64();
        let id = reader.i32();
        let popped = reader.i32();
        match kind {
            0 => heap.push(f, id),
            1 => assert_eq!(heap.pop(), popped),
            2 => heap.clear(),
            _ => panic!("bad operation"),
        }
        reader.delta(&mut expected);
        let mut actual = vec![heap.n as u64, heap.entries.len() as u64];
        for entry in &heap.entries {
            actual.extend([entry.f.to_bits(), entry.id as u32 as u64]);
        }
        assert_eq!(actual.len(), expected.len());
        if let Some((index, (a, b))) = actual
            .iter()
            .zip(&expected)
            .enumerate()
            .find(|(_, (a, b))| a != b)
        {
            panic!("heap operation{operation} word{index}: {a:016x} != {b:016x}");
        }
    }
    assert_eq!(operations, 8200);
    assert!(heap.entries.len() >= 4096);
    assert_eq!(reader.at, reader.data.len());
}

struct ExactDistanceHost {
    distances: std::collections::BTreeMap<(u64, u64), f64>,
    footprints: Vec<(i32, Option<Vec<i32>>)>,
    next_footprint: usize,
    hypot_calls: u32,
}
impl ExactDistanceHost {
    fn from_recorded(host: &RecordedHost) -> Self {
        let mut out = Self {
            distances: Default::default(),
            footprints: Vec::new(),
            next_footprint: 0,
            hypot_calls: 0,
        };
        for event in &host.events {
            match event {
                Event::Hypot {
                    dx,
                    dy,
                    result: Some(value),
                } => {
                    if let Some(old) = out.distances.insert((*dx, *dy), f64::from_bits(*value)) {
                        assert_eq!(old.to_bits(), *value);
                    }
                }
                Event::Hypot { result: None, .. } => {
                    panic!("Injected hypot failures use the uncached exact event-order oracle")
                }
                Event::Footprint { cell, result } => out.footprints.push((*cell, result.clone())),
            }
        }
        out
    }
}
impl Host for ExactDistanceHost {
    type Error = Injected;
    fn hypot(&mut self, dx: f64, dy: f64) -> Result<f64, Injected> {
        self.hypot_calls += 1;
        Ok(*self
            .distances
            .get(&(dx.to_bits(), dy.to_bits()))
            .expect("new geometry not in actual JS oracle"))
    }
    fn footprint(&mut self, cell: i32) -> Result<Vec<i32>, Injected> {
        let (expected, result) = &self.footprints[self.next_footprint];
        self.next_footprint += 1;
        assert_eq!(cell, *expected);
        result.clone().ok_or(Injected)
    }
}
#[test]
fn cached_distances_preserve_every_frozen_search_word_and_live_cost_change() {
    let mut hits = 0;
    let mut misses = 0;
    let mut frames_seen = 0;
    for path in fixtures() {
        if path
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("hypot-throw-")
        {
            continue;
        }
        let mut reader = Bytes::read(&path);
        let (mut reference, mut original_host, mut expected, frames) = initial(&mut reader);
        let mut cached = Kernel::restore(reference.problem.clone(), reference.snapshot()).unwrap();
        cached.distance_cache.enabled = true;
        let mut cached_host = ExactDistanceHost::from_recorded(&original_host);
        for frame in 0..frames {
            let costs = reader.costs();
            reference.costs = costs;
            cached.costs = costs;
            let status = reader.u32();
            let _goal = reader.i32();
            let event_count = reader.u32();
            reader.delta(&mut expected);
            let a = reference.advance(&mut original_host);
            let b = cached.advance(&mut cached_host);
            assert_eq!(a, b);
            assert_eq!(a.is_err(), status == 3);
            assert_eq!(original_host.next as u32, event_count);
            same_words(
                &cached,
                &expected,
                &format!("{} cached frame{frame}", path.display()),
            );
            let footprint_count = original_host.events[..original_host.next]
                .iter()
                .filter(|e| matches!(e, Event::Footprint { .. }))
                .count();
            assert_eq!(cached_host.next_footprint, footprint_count);
            frames_seen += 1;
        }
        assert_eq!(cached.distance_cache.misses, cached_host.hypot_calls);
        hits += cached.distance_cache.hits;
        misses += cached.distance_cache.misses;
    }
    assert!(frames_seen > 1500);
    assert!(hits > 1000);
    assert!(misses > 100);
}

#[test]
fn distance_cache_keeps_exact_displacements_fifo_bounds_and_partial_throw_state() {
    struct CountingHost {
        next: f64,
        calls: usize,
        throws: bool,
    }
    impl Host for CountingHost {
        type Error = Injected;
        fn hypot(&mut self, _dx: f64, _dy: f64) -> Result<f64, Injected> {
            self.calls += 1;
            if self.throws {
                Err(Injected)
            } else {
                Ok(self.next)
            }
        }
        fn footprint(&mut self, _: i32) -> Result<Vec<i32>, Injected> {
            unreachable!()
        }
    }
    let mut cache = DistanceCache {
        enabled: true,
        ..Default::default()
    };
    let mut host = CountingHost {
        next: 5.0,
        calls: 0,
        throws: false,
    };
    let distance = |cache: &mut DistanceCache, host: &mut CountingHost, dx, dy| {
        cache.distance(host, 257, 2, 1, dx, dy)
    };
    assert_eq!(distance(&mut cache, &mut host, 3.0, 4.0), Ok(5.0));
    host.next = 99.0;
    assert_eq!(distance(&mut cache, &mut host, 3.0, 4.0), Ok(5.0));
    assert_eq!(host.calls, 1);
    assert_eq!(distance(&mut cache, &mut host, -0.0, 4.0), Ok(99.0));
    host.next = -0.0;
    assert_eq!(
        distance(&mut cache, &mut host, 0.0, 4.0).unwrap().to_bits(),
        (-0.0f64).to_bits()
    );
    host.next = f64::INFINITY;
    assert_eq!(
        distance(&mut cache, &mut host, f64::INFINITY, f64::NAN),
        Ok(f64::INFINITY)
    );
    let before_calls = host.calls;
    assert_eq!(
        distance(
            &mut cache,
            &mut host,
            f64::INFINITY,
            f64::from_bits(0xfff8_0000_0000_0001)
        ),
        Ok(f64::INFINITY)
    );
    assert_eq!(host.calls, before_calls);
    host.throws = true;
    assert_eq!(distance(&mut cache, &mut host, 7.0, 8.0), Err(Injected));
    assert_eq!(cache.tables[&2].dx[1], f64::INFINITY);
    host.throws = false;
    host.next = 123.0;
    assert_eq!(distance(&mut cache, &mut host, 7.0, 8.0), Ok(123.0));
    for goal in 0..257 {
        cache
            .distance(&mut host, 257, goal, 0, goal as f64, 0.0)
            .unwrap();
        assert!(cache.slots <= 65_536);
    }
    assert_eq!(cache.slots, 65_535);
    assert_eq!(cache.tables.len(), 255);
    assert_eq!(cache.order.len(), cache.tables.len());
    assert_eq!(
        cache.slots,
        cache.tables.values().map(|t| t.values.len()).sum()
    );
    assert!(!cache.tables.contains_key(&0));
    assert!(!cache.tables.contains_key(&2));
    let costs = Costs {
        via: 0.1,
        rip: 8.0,
        trace_rip: 0.5,
        via_rip: 0.75,
        greedy: 1.5,
        cap: 10.0,
    };
    let mut kernel = Kernel::new(tiny_problem(), costs, tiny_search(1), 3.0).unwrap();
    kernel.distance_cache.enabled = true;
    host.next = 2.0;
    assert_eq!(kernel.h(&mut host, 0, 0), Ok(2.0));
    kernel.begin(tiny_search(2), 3.0, false).unwrap();
    let before = host.calls;
    kernel.costs.via = 7.0;
    assert_eq!(kernel.h(&mut host, 1, 0), Ok(9.0));
    assert_eq!(host.calls, before);
    kernel.problem.x[0] = 1.0;
    host.next = 1.0;
    assert_eq!(kernel.h(&mut host, 1, 0), Ok(8.0));
    assert_eq!(host.calls, before + 1);
    kernel.distance_cache = DistanceCache::default();
    assert_eq!(kernel.distance_cache.slots, 0);
}

#[test]
fn distance_start_seed_and_additive_export_preserve_fifo_raw_slots_and_invalid_state() {
    let mut cache = DistanceCache {
        enabled: true,
        ..Default::default()
    };
    assert!(cache.seed(
        257,
        7,
        3,
        -0.0,
        f64::NAN,
        f64::from_bits(0x7ff8_0000_0000_0042)
    ));
    let words = cache.words(257);
    assert_eq!(&words[..6], &[1, 257, 257, 1, 7, 257]);
    assert_eq!(words[6 + 3], (-0.0f64).to_bits());
    assert!(f64::from_bits(words[6 + 257 + 3]).is_nan());
    assert_eq!(words[6 + 257 * 2 + 3], 0x7ff8_0000_0000_0042);
    assert_eq!(words[6 + 257 * 3 + 3], 1);
    assert_eq!(cache.hits, 0);
    assert_eq!(cache.misses, 0);
    assert!(cache.seed(
        257,
        7,
        3,
        -0.0,
        f64::NAN,
        f64::from_bits(0x7ff8_0000_0000_0042)
    ));
    assert_eq!(cache.words(257), words);
    for (size, goal, cell) in [(0, 0, 0), (65_537, 0, 0), (257, 257, 0), (257, 0, 257)] {
        assert!(!cache.seed(size, goal, cell, 1.0, 2.0, 3.0));
        assert_eq!(cache.words(257), words);
    }
    for goal in 0..257 {
        assert!(cache.seed(257, goal, 0, goal as f64, 0.0, goal as f64));
    }
    let order: Vec<_> = cache.order.iter().copied().collect();
    assert_eq!(order.len(), 255);
    assert_eq!(&order[..3], &[1, 2, 3]);
    assert_eq!(cache.slots, 65_535);
    let before = cache.words(257);
    assert!(cache.seed(257, 3, 0, 3.0, 0.0, 3.0));
    assert_eq!(cache.words(257), before);
    assert_eq!(DistanceCache::default().words(65_537), [1, 0, 0, 0]);
}
