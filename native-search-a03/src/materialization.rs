//! Additive bulk transfer views. Search storage and legacy word oracles stay unchanged.
use super::*;

#[derive(Default)]
pub(crate) struct Materialization {
    pub metadata: Vec<u32>,
    heap_f: Vec<f64>,
    heap_id: Vec<i32>,
    node_z: Vec<i32>,
    node_cell: Vec<i32>,
    node_g: Vec<f64>,
    node_parent: Vec<i32>,
    node_head: Vec<i32>,
    node_count: Vec<i32>,
    rip_owner: Vec<i32>,
    rip_prev: Vec<i32>,
    via_lists: Vec<u32>,
    layer_lists: Vec<u32>,
}

fn span<T>(out: &mut Vec<u32>, values: &[T]) {
    out.extend([values.as_ptr() as u32, values.len() as u32]);
}

impl Materialization {
    pub fn prepare(&mut self, state: &SearchState) {
        macro_rules! copy_field {
            ($destination:ident, $source:expr, $field:ident) => {
                self.$destination.clear();
                self.$destination.extend($source.iter().map(|v| v.$field));
            };
        }
        // Copy every backing entry, including stale values beyond logical length.
        copy_field!(heap_f, state.heap.entries, f);
        copy_field!(heap_id, state.heap.entries, id);
        copy_field!(node_z, state.pool.nodes, z);
        copy_field!(node_cell, state.pool.nodes, cell);
        copy_field!(node_g, state.pool.nodes, g);
        copy_field!(node_parent, state.pool.nodes, parent);
        copy_field!(node_head, state.pool.nodes, rip_head);
        copy_field!(node_count, state.pool.nodes, rip_count);
        copy_field!(rip_owner, state.rips.entries, owner);
        copy_field!(rip_prev, state.rips.entries, prev);

        self.via_lists.clear();
        for &key in &state.via_lists.order {
            let values = state.via_lists.entries[key as usize].as_ref().unwrap();
            self.via_lists.push(key as u32);
            span(&mut self.via_lists, values);
        }
        self.layer_lists.clear();
        for (index, values) in state.layer_lists.iter().enumerate() {
            if let Some(values) = values {
                self.layer_lists.push(index as u32);
                span(&mut self.layer_lists, values);
            }
        }

        let move_cost = state.move_cost.to_bits();
        let move_rips = state.move_rips.to_bits();
        self.metadata.clear();
        self.metadata.extend([
            1,
            state.heap.n as u32,
            state.pool.n as u32,
            state.rips.n as u32,
            state.move_head as u32,
            0,
            move_cost as u32,
            (move_cost >> 32) as u32,
            move_rips as u32,
            (move_rips >> 32) as u32,
        ]);
        span(&mut self.metadata, &self.heap_f);
        span(&mut self.metadata, &self.heap_id);
        span(&mut self.metadata, &self.node_z);
        span(&mut self.metadata, &self.node_cell);
        span(&mut self.metadata, &self.node_g);
        span(&mut self.metadata, &self.node_parent);
        span(&mut self.metadata, &self.node_head);
        span(&mut self.metadata, &self.node_count);
        span(&mut self.metadata, &self.rip_owner);
        span(&mut self.metadata, &self.rip_prev);
        span(&mut self.metadata, &state.visited);
        span(&mut self.metadata, &state.visited_flat);
        span(&mut self.metadata, &state.best_stamp);
        span(&mut self.metadata, &state.best_g);
        span(&mut self.metadata, &state.via_scratch);
        span(&mut self.metadata, &state.trace_scratch);
        span(&mut self.metadata, &state.layer_scratch);
        span(&mut self.metadata, &state.layer_stamps);
        span(&mut self.metadata, &self.via_lists);
        span(&mut self.metadata, &self.layer_lists);
    }
}

impl DistanceCache {
    pub(crate) fn view_words(&self, capacity: usize, out: &mut Vec<u32>) {
        let capacity = if capacity > 0 && capacity <= MAX_LAYER_CACHE_CELLS {
            capacity
        } else {
            0
        };
        out.clear();
        out.extend([
            1,
            capacity as u32,
            self.slots as u32,
            self.order.len() as u32,
        ]);
        for &goal in &self.order {
            let table = &self.tables[&goal];
            out.extend([
                goal as u32,
                table.values.len() as u32,
                table.dx.as_ptr() as u32,
                table.dy.as_ptr() as u32,
                table.values.as_ptr() as u32,
                table.valid.as_ptr() as u32,
            ]);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn materialization_retains_full_raw_backing_and_presence_without_footprints() {
        let mut state = crate::tests::read_fixture_state_for_bulk_test();
        let raw = [0_u64, 1 << 63, 0x7ff0_0000_0000_0042, 0xfff8_0000_0000_1234];
        for (i, bits) in raw.iter().enumerate() {
            state.heap.entries[i].f = f64::from_bits(*bits);
            state.pool.nodes[i].g = f64::from_bits(*bits);
        }
        state.heap.n = 0;
        state.pool.n = 0;
        state.rips.n = 0;
        state.move_cost = f64::from_bits(raw[2]);
        state.move_rips = f64::from_bits(raw[3]);
        state.move_head = -7;
        state.via_lists.clear();
        state.via_lists.insert(1, vec![]);
        state.via_lists.insert(0, vec![3, -1, 3]);
        state.layer_lists = vec![None, Some(vec![]), Some(vec![7, -2])];
        state.layer_stamps = vec![0, 4, 8];
        let before = state.words();
        let mut transfer = Materialization::default();
        transfer.prepare(&state);
        assert_eq!(state.words(), before);
        assert_eq!(transfer.metadata.len(), 50);
        assert_eq!(&transfer.metadata[..6], &[1, 0, 0, 0, (-7_i32) as u32, 0]);
        for (i, bits) in raw.iter().enumerate() {
            assert_eq!(transfer.heap_f[i].to_bits(), *bits);
            assert_eq!(transfer.node_g[i].to_bits(), *bits);
        }
        assert_eq!(transfer.heap_f.len(), state.heap.entries.len());
        assert_eq!(transfer.node_g.len(), state.pool.nodes.len());
        assert_eq!(transfer.rip_owner.len(), state.rips.entries.len());
        assert_eq!(transfer.via_lists.len(), 6);
        assert_eq!((transfer.via_lists[0], transfer.via_lists[2]), (1, 0));
        assert_eq!((transfer.via_lists[3], transfer.via_lists[5]), (0, 3));
        assert_eq!(transfer.layer_lists.len(), 6);
        assert_eq!((transfer.layer_lists[0], transfer.layer_lists[2]), (1, 0));
        assert_eq!((transfer.layer_lists[3], transfer.layer_lists[5]), (2, 2));
        let retained_capacity = transfer.heap_f.capacity();
        state.heap.entries[0].f = 17.5;
        transfer.prepare(&state);
        assert_eq!(transfer.heap_f.capacity(), retained_capacity);
        assert_eq!(transfer.heap_f[0].to_bits(), 17.5_f64.to_bits());
    }
}
