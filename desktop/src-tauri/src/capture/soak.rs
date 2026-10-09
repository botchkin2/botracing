// A fake game for the recorder, to measure what it costs: CPU of the recorder
// thread and the process's memory over a long run. He races in VR, so the
// target is under 2% of one core and flat memory.
//
//   LMU_SHM_HEADER_DIR=<the install's SharedMemoryInterface> SOAK_SECS=600 \
//     cargo test --release soak -- --ignored --nocapture
//
// The fake game rewrites a player frame every 10 ms (100 Hz) and a scoring
// update every 200 ms (5 Hz) with 30 cars. The telemetry slot is filled with
// pseudo-random bytes so zstd cannot squeeze it: the pessimistic case.

use crate::capture::frame::View;
use crate::capture::layout::Layout;
use crate::capture::probe::offset_of;
use crate::capture::recorder::{Recorder, Source};
use crate::capture::runner::{drive, header_dir, load_layout, Line};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use windows_sys::Win32::Foundation::FILETIME;
use windows_sys::Win32::System::ProcessStatus::{GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS};
use windows_sys::Win32::System::Threading::{GetCurrentProcess, GetCurrentThread, GetThreadTimes};

const CARS: usize = 30;

#[derive(Clone)]
struct Mem(Arc<Mutex<Vec<u8>>>);

impl View for Mem {
    fn read(&mut self, offset: usize, len: usize) -> Option<Vec<u8>> {
        self.0
            .lock()
            .unwrap()
            .get(offset..offset.checked_add(len)?)
            .map(<[u8]>::to_vec)
    }
}

struct Fake(Mem);

impl Source for Fake {
    type V = Mem;
    fn game_running(&mut self) -> bool {
        true
    }
    fn open(&mut self) -> Result<Mem, String> {
        Ok(self.0.clone())
    }
}

fn ft(t: FILETIME) -> f64 {
    ((t.dwHighDateTime as u64) << 32 | t.dwLowDateTime as u64) as f64 / 1e7
}

fn thread_cpu_s() -> f64 {
    let zero = FILETIME {
        dwLowDateTime: 0,
        dwHighDateTime: 0,
    };
    let (mut c, mut e, mut k, mut u) = (zero, zero, zero, zero);
    // SAFETY: out-pointers are valid locals; the pseudo handle is always valid.
    unsafe { GetThreadTimes(GetCurrentThread(), &mut c, &mut e, &mut k, &mut u) };
    ft(k) + ft(u)
}

fn working_set_mb() -> f64 {
    // SAFETY: the struct is zeroed with its size set, as the API requires.
    let mut counters: PROCESS_MEMORY_COUNTERS = unsafe { std::mem::zeroed() };
    counters.cb = std::mem::size_of::<PROCESS_MEMORY_COUNTERS>() as u32;
    unsafe { GetProcessMemoryInfo(GetCurrentProcess(), &mut counters, counters.cb) };
    counters.WorkingSetSize as f64 / 1e6
}

fn put(mem: &mut [u8], at: usize, bytes: &[u8]) {
    mem[at..at + bytes.len()].copy_from_slice(bytes);
}

struct Offsets {
    s_track: usize,
    s_session: usize,
    s_n: usize,
    s_et: usize,
    v_base: usize,
    v_size: usize,
    v_name: usize,
    v_id: usize,
    has: usize,
    active: usize,
    slot: usize,
    t_track: usize,
    t_name: usize,
    t_et: usize,
    t_temps: Vec<usize>,
    /// Velocity, position and gear: kept sane under the noise so the checks pass.
    t_calm: Vec<usize>,
    t_gear: usize,
    t_size: usize,
}

fn offsets(l: &Layout) -> Offsets {
    let s = |p: &str| l.offsets["scoringInfo"] + offset_of(l, "ScoringInfoV01", p).unwrap();
    let v = |p: &str| offset_of(l, "VehicleScoringInfoV01", p).unwrap();
    let t = |p: &str| l.offsets["telemInfo"] + offset_of(l, "TelemInfoV01", p).unwrap();
    let mut t_temps = Vec::new();
    for w in 0..4 {
        for k in 0..3 {
            t_temps.push(t(&format!("mWheel.{w}.mTemperature.{k}")));
        }
        t_temps.push(t(&format!("mWheel.{w}.mTireCarcassTemperature")));
        t_temps.push(t(&format!("mWheel.{w}.mBrakeTemp")));
    }
    Offsets {
        s_track: s("mTrackName"),
        s_session: s("mSession"),
        s_n: s("mNumVehicles"),
        s_et: s("mCurrentET"),
        v_base: l.offsets["vehScoringInfo"],
        v_size: l.veh_size,
        v_name: v("mVehicleName"),
        v_id: v("mID"),
        has: l.offsets["playerHasVehicle"],
        active: l.offsets["activeVehicles"],
        slot: l.offsets["telemInfo"],
        t_track: t("mTrackName"),
        t_name: t("mVehicleName"),
        t_et: l.offsets["telemInfo"] + l.telem_et,
        t_temps,
        t_calm: ["mLocalVel", "mPos"]
            .iter()
            .flat_map(|v| ["x", "y", "z"].map(|a| t(&format!("{v}.{a}"))))
            .collect(),
        t_gear: t("mGear"),
        t_size: l.telem_size,
    }
}

#[test]
#[ignore = "a long run: set SOAK_SECS (default 600) and LMU_SHM_HEADER_DIR; cargo test --release soak -- --ignored --nocapture"]
fn soak_the_recorder_against_a_fake_game() {
    let layout = if header_dir().join("InternalsPlugin.hpp").is_file() {
        load_layout(&header_dir()).unwrap()
    } else {
        Layout::parse(include_str!("../../../../tools/capture/tests/fixture.hpp")).unwrap()
    };
    let o = offsets(&layout);
    let secs: u64 = std::env::var("SOAK_SECS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(600);
    let mem = Mem(Arc::new(Mutex::new(vec![0u8; layout.size])));
    {
        let mut m = mem.0.lock().unwrap();
        put(&mut m, o.s_track, b"Soak Raceway\0");
        put(&mut m, o.s_session, &10_i32.to_le_bytes());
        put(&mut m, o.s_n, &(CARS as i32).to_le_bytes());
        for i in 0..CARS {
            let base = o.v_base + i * o.v_size;
            put(&mut m, base + o.v_name, format!("Car #{i}\0").as_bytes());
            put(&mut m, base + o.v_id, &(i as i32).to_le_bytes());
        }
        put(&mut m, o.has, &[1]);
        put(&mut m, o.active, &[1]);
        put(&mut m, o.t_track, b"Soak Raceway\0");
        put(&mut m, o.t_name, b"Car #0\0");
    }

    let stop = Arc::new(AtomicBool::new(false));
    // Frames the fake game wrote, to compare with the rows on disk.
    let (player_written, scoring_written) =
        (Arc::new(AtomicU64::new(0)), Arc::new(AtomicU64::new(0)));
    // SOAK_LOAD=n keeps n threads busy at normal priority beside the recorder.
    let burners: Vec<_> = if let Some(n) = std::env::var("SOAK_LOAD")
        .ok()
        .and_then(|v| v.parse::<usize>().ok())
    {
        (0..n)
            .map(|_| {
                let stop = stop.clone();
                std::thread::spawn(move || {
                    let mut x = 1u64;
                    while !stop.load(Ordering::Relaxed) {
                        x = x
                            .wrapping_mul(6364136223846793005)
                            .wrapping_add(1442695040888963407);
                        std::hint::black_box(x);
                    }
                })
            })
            .collect()
    } else {
        Vec::new()
    };
    let feeder = {
        let (mem, stop) = (mem.clone(), stop.clone());
        let (player_written, scoring_written) = (player_written.clone(), scoring_written.clone());
        let o = offsets(&layout);
        std::thread::spawn(move || {
            let mut seed = 0x9E37_79B9_7F4A_7C15_u64;
            let mut rnd = move || {
                seed ^= seed << 13;
                seed ^= seed >> 7;
                seed ^= seed << 17;
                seed
            };
            let start = Instant::now();
            let (mut next_player, mut next_scoring) = (start, start);
            while !stop.load(Ordering::SeqCst) {
                let now = Instant::now();
                let et = now.duration_since(start).as_secs_f64();
                let mut m = mem.0.lock().unwrap();
                if now >= next_player {
                    // The slot's noise first, then the fields the checks read.
                    for chunk in m[o.slot..o.slot + o.t_size].chunks_mut(8) {
                        let r = rnd().to_le_bytes();
                        chunk.copy_from_slice(&r[..chunk.len()]);
                    }
                    put(&mut m, o.t_track, b"Soak Raceway\0");
                    put(&mut m, o.t_name, b"Car #0\0");
                    put(&mut m, o.t_et, &et.to_le_bytes());
                    for at in &o.t_temps {
                        put(&mut m, *at, &350.0_f64.to_le_bytes());
                    }
                    for at in &o.t_calm {
                        put(&mut m, *at, &1.0_f64.to_le_bytes());
                    }
                    put(&mut m, o.t_gear, &3_i32.to_le_bytes());
                    next_player += Duration::from_millis(10);
                    player_written.fetch_add(1, Ordering::Relaxed);
                }
                if now >= next_scoring {
                    put(&mut m, o.s_et, &et.to_le_bytes());
                    next_scoring += Duration::from_millis(200);
                    scoring_written.fetch_add(1, Ordering::Relaxed);
                }
                drop(m);
                std::thread::sleep(Duration::from_millis(1));
            }
        })
    };

    let root = std::env::temp_dir().join(format!("botracing-soak-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    let line = Arc::new(Mutex::new(Line::Starting));
    let cpu = Arc::new(Mutex::new((0.0_f64, 0.0_f64)));
    let rec_thread = {
        let (stop, line, cpu, root, layout_dir) = (
            stop.clone(),
            line.clone(),
            cpu.clone(),
            root.clone(),
            header_dir(),
        );
        let mem = mem.clone();
        std::thread::spawn(move || {
            crate::capture::win::lower_priority();
            let layout = if layout_dir.join("InternalsPlugin.hpp").is_file() {
                load_layout(&layout_dir).unwrap()
            } else {
                Layout::parse(include_str!("../../../../tools/capture/tests/fixture.hpp")).unwrap()
            };
            let mut rec = Recorder::new(layout, root, Fake(mem), 60_000).unwrap();
            let (cpu0, t0) = (thread_cpu_s(), Instant::now());
            drive(&mut rec, &stop, &line);
            *cpu.lock().unwrap() = (thread_cpu_s() - cpu0, t0.elapsed().as_secs_f64());
        })
    };

    let start = Instant::now();
    let base_mb = working_set_mb();
    let mut samples = vec![base_mb];
    while start.elapsed() < Duration::from_secs(secs) {
        std::thread::sleep(Duration::from_secs(60.min(secs)));
        samples.push(working_set_mb());
        eprintln!(
            "{:>4} s  working set {:.1} MB  line: {}",
            start.elapsed().as_secs(),
            samples.last().unwrap(),
            crate::capture::runner::line(&line.lock().unwrap())
        );
    }
    stop.store(true, Ordering::SeqCst);
    rec_thread.join().unwrap();
    feeder.join().unwrap();
    for b in burners {
        b.join().unwrap();
    }

    let (cpu_s, wall_s) = *cpu.lock().unwrap();
    let pct = 100.0 * cpu_s / wall_s;
    let bytes = crate::capture::store::dir_bytes(&root);
    eprintln!("recorder thread CPU {cpu_s:.1} s over {wall_s:.0} s = {pct:.2}% of one core");
    eprintln!("working set MB per minute: {samples:.1?}");
    eprintln!(
        "on disk {:.1} MB ({:.1} MB per minute)",
        bytes as f64 / 1e6,
        bytes as f64 / 1e6 / (wall_s / 60.0)
    );
    // Completeness: rows on disk against frames the fake game wrote. A recorder
    // that sleeps through frames is cheap and wrong; this is what catches it.
    let rows = |kind: &str| -> u64 {
        let duck =
            std::env::var("BOTRACING_DUCKDB").expect("set BOTRACING_DUCKDB for the row count");
        let glob = format!("{}/*/{kind}-*.parquet", root.display()).replace('\\', "/");
        let out = std::process::Command::new(duck)
            .args([
                ":memory:",
                "-csv",
                "-noheader",
                "-c",
                &format!("SELECT count(*) FROM read_parquet('{glob}')"),
            ])
            .output()
            .unwrap();
        String::from_utf8_lossy(&out.stdout)
            .trim()
            .parse()
            .unwrap_or(0)
    };
    let (p_rows, f_rows) = (rows("player"), rows("field"));
    let (p_sent, f_sent) = (
        player_written.load(Ordering::Relaxed),
        scoring_written.load(Ordering::Relaxed) * CARS as u64,
    );
    let (p_pct, f_pct) = (
        100.0 * p_rows as f64 / p_sent as f64,
        100.0 * f_rows as f64 / f_sent as f64,
    );
    eprintln!("player rows {p_rows} of {p_sent} written = {p_pct:.2}%");
    eprintln!("field rows {f_rows} of {f_sent} written = {f_pct:.2}%");
    // SOAK_KEEP=1 leaves the folder, to read it with the uploader's own code.
    if std::env::var_os("SOAK_KEEP").is_some() {
        eprintln!("kept {}", root.display());
    } else {
        let _ = std::fs::remove_dir_all(&root);
    }
    assert!(pct < 2.0, "{pct:.2}% of one core");
    assert!(
        p_pct >= 99.0 && f_pct >= 99.0,
        "frames lost: player {p_pct:.2}%, field {f_pct:.2}%"
    );
}
