// iRacing's live telemetry (the SDK's memory-mapped file), read without the SDK.
//
// The header and the variable table are the SDK's own self-describing format:
// every variable carries its name, type, offset and count, so no per-variable
// offset is written down here. A frame is kept only when the buffer it was
// copied from was not rewritten during the copy (the buffer's tick count is
// read again after the copy), the SDK's own rule; the game's lock and events
// are never touched.
//
// Pure over a `View`, so the fake-memory tests need no sim.

use crate::capture::frame::View;

const HEADER_LEN: usize = 112;
/// Offset of `varBuf[0]` in the header; each slot is 16 bytes.
const BUF_TABLE: usize = 48;
const BUF_SLOT: usize = 16;
const MAX_BUFS: usize = 4;
const VAR_HEADER_LEN: usize = 144;
const MAX_VARS: usize = 4096;
/// The biggest frame we accept: the real one is a few KB; a header that says
/// more is not iRacing's.
const MAX_BUF_LEN: usize = 1 << 20;
const MAX_SESSION_INFO: usize = 4 << 20;
const TRIES: usize = 3;
/// `irsdk_StatusField::irsdk_stConnected`.
const ST_CONNECTED: i32 = 1;

fn i32_at(raw: &[u8], offset: usize) -> Option<i32> {
    let bytes: [u8; 4] = raw.get(offset..offset.checked_add(4)?)?.try_into().ok()?;
    Some(i32::from_le_bytes(bytes))
}

#[derive(Debug, Clone, PartialEq)]
pub struct Header {
    pub status: i32,
    pub tick_rate: i32,
    pub session_info_update: i32,
    pub session_info_len: usize,
    pub session_info_offset: usize,
    pub num_vars: usize,
    pub var_header_offset: usize,
    pub num_bufs: usize,
    pub buf_len: usize,
}

impl Header {
    pub fn connected(&self) -> bool {
        self.status & ST_CONNECTED != 0
    }

    /// None for anything that is not a plausible iRacing header, including the
    /// zero-filled map the sim leaves until a car is on track.
    pub fn parse(raw: &[u8]) -> Option<Header> {
        let ver = i32_at(raw, 0)?;
        let num_vars = i32_at(raw, 24)?;
        let num_bufs = i32_at(raw, 32)?;
        let buf_len = i32_at(raw, 36)?;
        if ver <= 0 || num_vars <= 0 || num_bufs <= 0 || buf_len <= 0 {
            return None;
        }
        let (num_vars, num_bufs, buf_len) =
            (num_vars as usize, num_bufs as usize, buf_len as usize);
        if num_vars > MAX_VARS || num_bufs > MAX_BUFS || buf_len > MAX_BUF_LEN {
            return None;
        }
        let session_info_len = i32_at(raw, 16)?;
        let session_info_offset = i32_at(raw, 20)?;
        let var_header_offset = i32_at(raw, 28)?;
        if session_info_len < 0
            || session_info_offset < 0
            || var_header_offset < 0
            || session_info_len as usize > MAX_SESSION_INFO
        {
            return None;
        }
        Some(Header {
            status: i32_at(raw, 4)?,
            tick_rate: i32_at(raw, 8)?,
            session_info_update: i32_at(raw, 12)?,
            session_info_len: session_info_len as usize,
            session_info_offset: session_info_offset as usize,
            num_vars,
            var_header_offset: var_header_offset as usize,
            num_bufs,
            buf_len,
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Char,
    Bool,
    Int,
    BitField,
    Float,
    Double,
}

impl Kind {
    fn of(code: i32) -> Option<Kind> {
        Some(match code {
            0 => Kind::Char,
            1 => Kind::Bool,
            2 => Kind::Int,
            3 => Kind::BitField,
            4 => Kind::Float,
            5 => Kind::Double,
            _ => return None,
        })
    }

    pub fn size(self) -> usize {
        match self {
            Kind::Char | Kind::Bool => 1,
            Kind::Int | Kind::BitField | Kind::Float => 4,
            Kind::Double => 8,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Var {
    pub name: String,
    pub kind: Kind,
    /// Offset inside one buffer.
    pub offset: usize,
    /// Array length: 1 for a scalar, 64 or so for the CarIdx arrays.
    pub count: usize,
}

fn nul_text(raw: &[u8]) -> String {
    let end = raw.iter().position(|b| *b == 0).unwrap_or(raw.len());
    String::from_utf8_lossy(&raw[..end]).into_owned()
}

/// The variable table. A variable the table lists but whose bytes would run
/// past a buffer is dropped, so a later read cannot go out of range.
pub fn parse_vars(raw: &[u8], header: &Header) -> Vec<Var> {
    let mut vars = Vec::with_capacity(header.num_vars);
    for i in 0..header.num_vars {
        let at = i * VAR_HEADER_LEN;
        let Some(entry) = raw.get(at..at + VAR_HEADER_LEN) else {
            break;
        };
        let (Some(code), Some(offset), Some(count)) =
            (i32_at(entry, 0), i32_at(entry, 4), i32_at(entry, 8))
        else {
            continue;
        };
        let Some(kind) = Kind::of(code) else { continue };
        if offset < 0 || count <= 0 {
            continue;
        }
        let (offset, count) = (offset as usize, count as usize);
        match count
            .checked_mul(kind.size())
            .and_then(|n| offset.checked_add(n))
        {
            Some(end) if end <= header.buf_len => {}
            _ => continue,
        }
        let name = nul_text(&entry[16..48]);
        if name.is_empty() {
            continue;
        }
        vars.push(Var {
            name,
            kind,
            offset,
            count,
        });
    }
    vars
}

/// One consistent copy of the telemetry buffer.
#[derive(Debug, Clone, PartialEq)]
pub struct Frame {
    pub tick: i32,
    pub data: Vec<u8>,
}

impl Frame {
    pub fn f32(&self, var: &Var, index: usize) -> Option<f32> {
        if var.kind != Kind::Float || index >= var.count {
            return None;
        }
        let at = var.offset + index * 4;
        Some(f32::from_le_bytes(
            self.data.get(at..at + 4)?.try_into().ok()?,
        ))
    }

    pub fn f64(&self, var: &Var, index: usize) -> Option<f64> {
        if var.kind != Kind::Double || index >= var.count {
            return None;
        }
        let at = var.offset + index * 8;
        Some(f64::from_le_bytes(
            self.data.get(at..at + 8)?.try_into().ok()?,
        ))
    }

    /// Int and bit-field variables.
    pub fn i32(&self, var: &Var, index: usize) -> Option<i32> {
        if !matches!(var.kind, Kind::Int | Kind::BitField) || index >= var.count {
            return None;
        }
        i32_at(&self.data, var.offset + index * 4)
    }

    pub fn bool(&self, var: &Var, index: usize) -> Option<bool> {
        if var.kind != Kind::Bool || index >= var.count {
            return None;
        }
        Some(*self.data.get(var.offset + index)? != 0)
    }
}

/// What the sim's map says it holds: the header and the variable table.
pub struct Reader {
    pub header: Header,
    pub vars: Vec<Var>,
}

impl Reader {
    /// None until the sim is connected and has published its table (the map is
    /// zero-filled for a while, and a header read mid-update does not parse).
    pub fn open<V: View>(view: &mut V) -> Option<Reader> {
        let header = Header::parse(&view.read(0, HEADER_LEN)?)?;
        if !header.connected() {
            return None;
        }
        let table = view.read(header.var_header_offset, header.num_vars * VAR_HEADER_LEN)?;
        let vars = parse_vars(&table, &header);
        if vars.is_empty() {
            return None;
        }
        Some(Reader { header, vars })
    }

    /// Still the same sim: connected, with the table's size and the buffer's
    /// unchanged. A restarted sim that published a different table fails this,
    /// and so does a map that went zero when the sim exited.
    pub fn alive<V: View>(&self, view: &mut V) -> bool {
        let Some(raw) = view.read(0, HEADER_LEN) else {
            return false;
        };
        Header::parse(&raw).is_some_and(|h| {
            h.connected() && h.num_vars == self.header.num_vars && h.buf_len == self.header.buf_len
        })
    }

    pub fn var(&self, name: &str) -> Option<&Var> {
        self.vars.iter().find(|v| v.name == name)
    }

    /// The newest buffer, copied, when it was not rewritten during the copy and
    /// its tick is not `after`. None means "nothing new", not an error.
    ///
    /// The sim rotates up to four buffers; the newest is the one with the
    /// greatest tick count. After the copy that slot's tick is read again: a
    /// change means the sim reused the buffer under us, and the copy is thrown
    /// away.
    pub fn frame<V: View>(&self, view: &mut V, after: Option<i32>) -> Option<Frame> {
        for _ in 0..TRIES {
            let table = view.read(BUF_TABLE, self.header.num_bufs * BUF_SLOT)?;
            let mut best: Option<(usize, i32, usize)> = None;
            for slot in 0..self.header.num_bufs {
                let tick = i32_at(&table, slot * BUF_SLOT)?;
                let offset = i32_at(&table, slot * BUF_SLOT + 4)?;
                if offset < 0 {
                    continue;
                }
                if best.map_or(true, |(_, t, _)| tick > t) {
                    best = Some((slot, tick, offset as usize));
                }
            }
            let (slot, tick, offset) = best?;
            if after == Some(tick) {
                return None;
            }
            let data = view.read(offset, self.header.buf_len)?;
            let again = view.read(BUF_TABLE + slot * BUF_SLOT, 4)?;
            if i32_at(&again, 0)? == tick {
                return Some(Frame { tick, data });
            }
        }
        None
    }

    /// The session-info text when the sim has changed it since `seen` (the
    /// header's update counter), with the counter it was read at; None when
    /// unchanged or when the copy tore (the counter moved during it).
    pub fn session_info<V: View>(&self, view: &mut V, seen: Option<i32>) -> Option<(i32, String)> {
        for _ in 0..TRIES {
            let head = Header::parse(&view.read(0, HEADER_LEN)?)?;
            if seen == Some(head.session_info_update) {
                return None;
            }
            let raw = view.read(head.session_info_offset, head.session_info_len)?;
            let after = Header::parse(&view.read(0, HEADER_LEN)?)?;
            if after.session_info_update == head.session_info_update {
                return Some((head.session_info_update, decode_cp1252(&raw)));
            }
        }
        None
    }
}

/// The session info is Windows-1252 text, not UTF-8 (driver and team names
/// carry accents), and runs to a NUL.
pub fn decode_cp1252(raw: &[u8]) -> String {
    // 0x80 to 0x9F differ from Latin-1; the five undefined ones become U+FFFD.
    const HIGH: [char; 32] = [
        '\u{20AC}', '\u{FFFD}', '\u{201A}', '\u{0192}', '\u{201E}', '\u{2026}', '\u{2020}',
        '\u{2021}', '\u{02C6}', '\u{2030}', '\u{0160}', '\u{2039}', '\u{0152}', '\u{FFFD}',
        '\u{017D}', '\u{FFFD}', '\u{FFFD}', '\u{2018}', '\u{2019}', '\u{201C}', '\u{201D}',
        '\u{2022}', '\u{2013}', '\u{2014}', '\u{02DC}', '\u{2122}', '\u{0161}', '\u{203A}',
        '\u{0153}', '\u{FFFD}', '\u{017E}', '\u{0178}',
    ];
    let end = raw.iter().position(|b| *b == 0).unwrap_or(raw.len());
    raw[..end]
        .iter()
        .map(|b| match *b {
            0x80..=0x9F => HIGH[(*b - 0x80) as usize],
            other => other as char,
        })
        .collect()
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    /// A fake map. `on_read` runs before each read, so a test can rewrite the
    /// memory mid-copy, as the sim does.
    pub struct Fake {
        pub mem: Vec<u8>,
        pub reads: usize,
        pub on_read: Option<Box<dyn FnMut(usize, &mut Vec<u8>)>>,
    }

    impl View for Fake {
        fn read(&mut self, offset: usize, len: usize) -> Option<Vec<u8>> {
            self.reads += 1;
            let n = self.reads;
            if let Some(hook) = self.on_read.as_mut() {
                hook(n, &mut self.mem);
            }
            self.mem
                .get(offset..offset.checked_add(len)?)
                .map(|s| s.to_vec())
        }
    }

    pub fn put(mem: &mut [u8], at: usize, v: i32) {
        mem[at..at + 4].copy_from_slice(&v.to_le_bytes());
    }

    const VARS_AT: usize = 112;
    const BUF_LEN: usize = 64;
    const INFO_AT: usize = VARS_AT + 3 * VAR_HEADER_LEN;
    const BUF0: usize = 1024;

    fn var(mem: &mut [u8], i: usize, code: i32, offset: i32, count: i32, name: &str) {
        let at = VARS_AT + i * VAR_HEADER_LEN;
        put(mem, at, code);
        put(mem, at + 4, offset);
        put(mem, at + 8, count);
        mem[at + 16..at + 16 + name.len()].copy_from_slice(name.as_bytes());
    }

    /// A connected sim with three variables (Speed f32 at 0, Lap i32 at 4,
    /// CarIdxLapDistPct f32[8] at 8) and three buffers.
    pub fn sim(ticks: [i32; 3]) -> Vec<u8> {
        let mut m = vec![0u8; BUF0 + 3 * BUF_LEN];
        put(&mut m, 0, 2); // ver
        put(&mut m, 4, ST_CONNECTED);
        put(&mut m, 8, 60);
        put(&mut m, 12, 7); // session info update
        put(&mut m, 16, 0); // len set by tests that use it
        put(&mut m, 20, INFO_AT as i32);
        put(&mut m, 24, 3);
        put(&mut m, 28, VARS_AT as i32);
        put(&mut m, 32, 3);
        put(&mut m, 36, BUF_LEN as i32);
        var(&mut m, 0, 4, 0, 1, "Speed");
        var(&mut m, 1, 2, 4, 1, "Lap");
        var(&mut m, 2, 4, 8, 8, "CarIdxLapDistPct");
        for (slot, tick) in ticks.iter().enumerate() {
            put(&mut m, BUF_TABLE + slot * BUF_SLOT, *tick);
            put(
                &mut m,
                BUF_TABLE + slot * BUF_SLOT + 4,
                (BUF0 + slot * BUF_LEN) as i32,
            );
            // Each buffer: Speed = tick, Lap = tick * 10.
            let at = BUF0 + slot * BUF_LEN;
            m[at..at + 4].copy_from_slice(&(*tick as f32).to_le_bytes());
            put(&mut m, at + 4, *tick * 10);
        }
        m
    }

    fn fake(mem: Vec<u8>) -> Fake {
        Fake {
            mem,
            reads: 0,
            on_read: None,
        }
    }

    #[test]
    fn alive_notices_a_zero_map_a_disconnect_and_a_different_table() {
        let mut view = fake(sim([1, 2, 3]));
        let r = Reader::open(&mut view).unwrap();
        assert!(r.alive(&mut view));
        let mut different = sim([1, 2, 3]);
        put(&mut different, 36, 128);
        assert!(!r.alive(&mut fake(different)));
        let mut off = sim([1, 2, 3]);
        put(&mut off, 4, 0);
        assert!(!r.alive(&mut fake(off)));
        assert!(!r.alive(&mut fake(vec![0u8; 4096])));
    }

    #[test]
    fn a_zero_filled_map_is_not_a_sim() {
        let mut view = fake(vec![0u8; 4096]);
        assert!(Reader::open(&mut view).is_none());
    }

    #[test]
    fn a_header_that_is_not_connected_is_not_opened() {
        let mut mem = sim([1, 2, 3]);
        put(&mut mem, 4, 0);
        assert!(Reader::open(&mut fake(mem)).is_none());
    }

    #[test]
    fn implausible_headers_are_refused() {
        for (at, value) in [(24, 100_000), (32, 9), (36, 1 << 30), (28, -1)] {
            let mut mem = sim([1, 2, 3]);
            put(&mut mem, at, value);
            assert!(Reader::open(&mut fake(mem)).is_none(), "{at}={value}");
        }
    }

    #[test]
    fn reads_the_variable_table_by_name() {
        let r = Reader::open(&mut fake(sim([1, 2, 3]))).expect("opens");
        assert_eq!(r.header.tick_rate, 60);
        assert_eq!(r.vars.len(), 3);
        let arr = r.var("CarIdxLapDistPct").unwrap();
        assert_eq!((arr.kind, arr.offset, arr.count), (Kind::Float, 8, 8));
        assert!(r.var("Nope").is_none());
    }

    #[test]
    fn a_variable_that_runs_past_the_buffer_is_dropped() {
        let mut mem = sim([1, 2, 3]);
        put(&mut mem, VARS_AT + 2 * VAR_HEADER_LEN + 8, 100); // 100 floats at 8
        let r = Reader::open(&mut fake(mem)).unwrap();
        assert!(r.var("CarIdxLapDistPct").is_none());
        assert!(r.var("Speed").is_some());
    }

    #[test]
    fn takes_the_newest_of_the_rotating_buffers() {
        let mut view = fake(sim([10, 12, 11]));
        let r = Reader::open(&mut view).unwrap();
        let f = r.frame(&mut view, None).expect("a frame");
        assert_eq!(f.tick, 12);
        assert_eq!(f.f32(r.var("Speed").unwrap(), 0), Some(12.0));
        assert_eq!(f.i32(r.var("Lap").unwrap(), 0), Some(120));
    }

    #[test]
    fn an_unchanged_tick_is_nothing_new() {
        let mut view = fake(sim([10, 12, 11]));
        let r = Reader::open(&mut view).unwrap();
        assert!(r.frame(&mut view, Some(12)).is_none());
        assert!(r.frame(&mut view, Some(11)).is_some());
    }

    #[test]
    fn a_buffer_rewritten_during_the_copy_is_retried() {
        let mut view = fake(sim([10, 12, 11]));
        let r = Reader::open(&mut view).unwrap();
        let start = view.reads;
        // The sim reuses slot 1 (the newest) right after our first copy of it:
        // reads are table, buffer, tick re-check; change the tick before the
        // re-check, once.
        view.on_read = Some(Box::new(move |n, mem| {
            if n == start + 3 {
                put(mem, BUF_TABLE + BUF_SLOT, 14);
                let at = BUF0 + BUF_LEN;
                mem[at..at + 4].copy_from_slice(&14f32.to_le_bytes());
            }
        }));
        let f = r.frame(&mut view, None).expect("the retry succeeds");
        assert_eq!(f.tick, 14);
        assert_eq!(f.f32(r.var("Speed").unwrap(), 0), Some(14.0));
    }

    #[test]
    fn a_buffer_that_keeps_changing_gives_nothing() {
        let mut view = fake(sim([10, 12, 11]));
        let r = Reader::open(&mut view).unwrap();
        let mut tick = 100;
        view.on_read = Some(Box::new(move |n, mem| {
            if n % 3 == 0 {
                tick += 1;
                put(mem, BUF_TABLE + BUF_SLOT, tick);
            }
        }));
        view.reads = 0;
        assert!(r.frame(&mut view, None).is_none());
    }

    #[test]
    fn array_variables_read_by_index_and_out_of_range_is_none() {
        let mut view = fake(sim([1, 2, 3]));
        let r = Reader::open(&mut view).unwrap();
        let mut f = r.frame(&mut view, None).unwrap();
        let arr = r.var("CarIdxLapDistPct").unwrap();
        let at = arr.offset + 3 * 4;
        f.data[at..at + 4].copy_from_slice(&0.25f32.to_le_bytes());
        assert_eq!(f.f32(arr, 3), Some(0.25));
        assert_eq!(f.f32(arr, 8), None);
        assert_eq!(f.i32(arr, 0), None, "a float is not an int");
    }

    #[test]
    fn session_info_decodes_windows_1252_and_reports_a_change_once() {
        let mut mem = sim([1, 2, 3]);
        // "Ren\xE9: Team \x96 A" : e-acute and an en dash in CP-1252.
        let text: &[u8] = b"Ren\xE9: Team \x96 A\0";
        mem.resize(INFO_AT + 64, 0);
        mem[INFO_AT..INFO_AT + text.len()].copy_from_slice(text);
        put(&mut mem, 16, text.len() as i32);
        let mut view = fake(mem);
        let r = Reader::open(&mut view).unwrap();
        let (n, s) = r.session_info(&mut view, None).expect("first read");
        assert_eq!(n, 7);
        assert_eq!(s, "Ren\u{e9}: Team \u{2013} A");
        assert!(r.session_info(&mut view, Some(7)).is_none(), "unchanged");
    }

    #[test]
    fn session_info_torn_by_an_update_is_retried() {
        let mut mem = sim([1, 2, 3]);
        let text: &[u8] = b"A: 1\0";
        mem.resize(INFO_AT + 64, 0);
        mem[INFO_AT..INFO_AT + text.len()].copy_from_slice(text);
        put(&mut mem, 16, text.len() as i32);
        let mut view = fake(mem);
        let r = Reader::open(&mut view).unwrap();
        let start = view.reads;
        // Header read, text read, header re-read: bump the counter before the
        // re-read, once.
        view.on_read = Some(Box::new(move |n, mem| {
            if n == start + 3 {
                put(mem, 12, 8);
            }
        }));
        let (n, _) = r.session_info(&mut view, None).expect("the retry succeeds");
        assert_eq!(n, 8);
    }

    /// Reads the real sim, which must be running with a car on track:
    /// `cargo test live_iracing -- --ignored --nocapture`. Prints what it saw.
    #[cfg(windows)]
    #[test]
    #[ignore]
    fn live_iracing() {
        let mut view = crate::capture::win::open_iracing().expect("iRacing is running");
        let r = Reader::open(&mut view).expect("connected, with a variable table");
        println!(
            "tick rate {} Hz, {} variables, {} buffers of {} bytes",
            r.header.tick_rate,
            r.vars.len(),
            r.header.num_bufs,
            r.header.buf_len
        );
        let first = r.frame(&mut view, None).expect("a frame");
        std::thread::sleep(std::time::Duration::from_millis(500));
        let second = r.frame(&mut view, Some(first.tick)).expect("a newer frame");
        println!(
            "ticks {} then {} (about {} per second)",
            first.tick,
            second.tick,
            (second.tick - first.tick) * 2
        );
        assert!(second.tick > first.tick);
        for name in ["Speed", "Lap", "LapDistPct", "SessionTime", "OnPitRoad"] {
            let v = r
                .var(name)
                .unwrap_or_else(|| panic!("{name} is in the table"));
            let shown = match v.kind {
                Kind::Float => second.f32(v, 0).map(|x| x.to_string()),
                Kind::Double => second.f64(v, 0).map(|x| x.to_string()),
                Kind::Int | Kind::BitField => second.i32(v, 0).map(|x| x.to_string()),
                Kind::Bool => second.bool(v, 0).map(|x| x.to_string()),
                Kind::Char => None,
            };
            println!("{name} = {shown:?}");
        }
        if let Some(arr) = r.var("CarIdxLapDistPct") {
            let on_track = (0..arr.count)
                .filter_map(|i| second.f32(arr, i))
                .filter(|p| *p > 0.0 && *p <= 1.0)
                .count();
            println!(
                "CarIdxLapDistPct: {} slots, {} cars in the world",
                arr.count, on_track
            );
        }
        let (n, text) = r.session_info(&mut view, None).expect("session info");
        println!("session info update {n}, {} chars", text.chars().count());
    }
}
