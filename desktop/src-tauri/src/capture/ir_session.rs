// What a recording keeps of iRacing's session text, and nothing else.
//
// The text is Windows-1252 and not strictly valid YAML (unquoted team names
// with colons), so it is read line by line, only for the few keys kept. Driver
// names, team names and member ids (`UserName`, `TeamName`, `CustID`,
// `UserID`, `Initials`, `AbbrevName`, `DriverSetupName`) are never read: the
// field ships with car number, class, car model and an isPlayer flag only,
// like LMU's, and what is not read cannot reach the disk.

use serde_json::{json, Value};

/// iRacing ends the text with a YAML document end line. A copy taken while the
/// sim rewrites it (before the update counter moves) does not have it.
pub fn is_complete(text: &str) -> bool {
    text.trim_end().ends_with("...")
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct Driver {
    pub car_idx: i64,
    pub car_number: String,
    pub class_id: i64,
    pub class_name: String,
    /// `CarClassColor`, "#rrggbb" (the YAML has 0xrrggbb); empty when absent.
    pub class_color: String,
    pub car_name: String,
    pub car_path: String,
    pub spectator: bool,
    pub pace_car: bool,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct SessionMeta {
    pub track_id: i64,
    pub track_name: String,
    pub track_config: String,
    pub track_length_m: f64,
    pub series_id: i64,
    pub sub_session_id: i64,
    pub session_num: i64,
    pub session_type: String,
    pub player_idx: i64,
    pub drivers: Vec<Driver>,
    /// WeekendInfo TrackName: the sim's short name ("sebring international").
    pub track_short: String,
    pub track_skies: String,
    /// The player car's tank (DriverCarFuelMaxLtr) and the share of it this
    /// session allows (DriverCarMaxFuelPct, 0 to 1); 0 when absent.
    pub fuel_max_l: f64,
    pub fuel_max_pct: f64,
    /// SplitTimeInfo: where each sector starts, as a share of the lap, in order.
    pub sector_starts: Vec<f64>,
    pub sessions: Vec<Session>,
}

/// One item of SessionInfo Sessions. `time` is the sim's own text
/// ("2700.0000 sec" or "unlimited").
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Session {
    pub num: i64,
    pub kind: String,
    pub time: String,
}

/// `(indent, text)` with the list dash taken off: " - CarIdx: 3" is
/// (1, "CarIdx: 3") and its continuation lines sit at indent 3.
fn split_indent(line: &str) -> (usize, &str) {
    let indent = line.len() - line.trim_start().len();
    (indent, line.trim_start())
}

fn key_value(text: &str) -> Option<(&str, &str)> {
    let (key, value) = match text.split_once(':') {
        Some((k, v)) => (k.trim(), v.trim()),
        None => return None,
    };
    if key.is_empty() || key.contains(' ') {
        return None;
    }
    let value = value.trim_matches(|c| c == '"' || c == '\'');
    Some((key, value))
}

/// "0xff5888" to "#ff5888"; a short value is padded with zeros ("0x5888" is
/// "#005888"); anything that is not 1 to 6 hex digits is "".
fn hex_colour(value: &str) -> String {
    let digits = value.trim().trim_start_matches("0x").trim_start_matches("0X");
    if (1..=6).contains(&digits.len()) && digits.chars().all(|c| c.is_ascii_hexdigit()) {
        format!("#{:0>6}", digits.to_ascii_lowercase())
    } else {
        String::new()
    }
}

fn int(value: &str) -> i64 {
    value.trim().parse().unwrap_or(0)
}

/// The leading number of "110.000" or "0.500 %"; 0 when there is none.
fn float(value: &str) -> f64 {
    value.split_whitespace().next().and_then(|n| n.parse().ok()).unwrap_or(0.0)
}

fn km_to_m(value: &str) -> f64 {
    value
        .split_whitespace()
        .next()
        .and_then(|n| n.parse::<f64>().ok())
        .map_or(0.0, |km| km * 1000.0)
}

pub fn parse(text: &str) -> SessionMeta {
    let mut meta = SessionMeta::default();
    let mut section = "";
    let mut current_session = 0;
    let mut in_sessions = false;
    let mut in_sectors = false;
    let mut driver: Option<Driver> = None;
    let mut in_drivers = false;

    let push_driver = |d: &mut Option<Driver>, out: &mut Vec<Driver>| {
        if let Some(done) = d.take() {
            out.push(done);
        }
    };

    for line in text.lines() {
        if line.trim().is_empty() || line.starts_with("---") || line.starts_with("...") {
            continue;
        }
        let (indent, body) = split_indent(line);
        if indent == 0 {
            push_driver(&mut driver, &mut meta.drivers);
            section = match body.trim_end_matches(':') {
                "WeekendInfo" => "weekend",
                "SessionInfo" => "session",
                "DriverInfo" => "driver",
                "SplitTimeInfo" => "split",
                _ => "",
            };
            in_sessions = false;
            in_sectors = false;
            in_drivers = false;
            continue;
        }
        let item = body.strip_prefix("- ");
        let content = item.unwrap_or(body);
        let Some((key, value)) = key_value(content) else {
            continue;
        };
        match section {
            "weekend" if indent == 1 => match key {
                "TrackID" => meta.track_id = int(value),
                "TrackDisplayName" => meta.track_name = value.to_string(),
                "TrackConfigName" => meta.track_config = value.to_string(),
                "TrackLength" => meta.track_length_m = km_to_m(value),
                "SeriesID" => meta.series_id = int(value),
                "SubSessionID" => meta.sub_session_id = int(value),
                "TrackName" => meta.track_short = value.to_string(),
                "TrackSkies" => meta.track_skies = value.to_string(),
                _ => {}
            },
            "session" => {
                if indent == 1 && key == "CurrentSessionNum" {
                    current_session = int(value);
                } else if indent == 1 && key == "Sessions" {
                    in_sessions = true;
                } else if in_sessions && indent == 1 && key == "SessionNum" && item.is_some() {
                    meta.sessions.push(Session { num: int(value), ..Session::default() });
                } else if in_sessions && indent == 3 && item.is_none() {
                    // Only the item's own keys: its nested lists (ResultsFastestLap
                    // and the like) sit deeper or start with a dash.
                    if let Some(last) = meta.sessions.last_mut() {
                        match key {
                            "SessionType" => last.kind = value.to_string(),
                            "SessionTime" => last.time = value.to_string(),
                            _ => {}
                        }
                    }
                }
            }
            "split" => {
                if indent == 1 && key == "Sectors" {
                    in_sectors = true;
                } else if in_sectors && indent == 3 && key == "SectorStartPct" {
                    meta.sector_starts.push(float(value));
                }
            }
            "driver" => {
                if indent == 1 && key == "DriverCarIdx" {
                    meta.player_idx = int(value);
                } else if indent == 1 && key == "DriverCarFuelMaxLtr" {
                    meta.fuel_max_l = float(value);
                } else if indent == 1 && key == "DriverCarMaxFuelPct" {
                    meta.fuel_max_pct = float(value);
                } else if indent == 1 && key == "Drivers" {
                    in_drivers = true;
                } else if in_drivers {
                    if key == "CarIdx" && item.is_some() {
                        push_driver(&mut driver, &mut meta.drivers);
                        driver = Some(Driver { car_idx: int(value), ..Driver::default() });
                    } else if let Some(d) = driver.as_mut() {
                        match key {
                            "CarNumber" => d.car_number = value.to_string(),
                            "CarClassID" => d.class_id = int(value),
                            "CarClassShortName" => d.class_name = value.to_string(),
                            "CarClassColor" => d.class_color = hex_colour(value),
                            "CarScreenName" => d.car_name = value.to_string(),
                            "CarPath" => d.car_path = value.to_string(),
                            "IsSpectator" => d.spectator = int(value) != 0,
                            "CarIsPaceCar" => d.pace_car = int(value) != 0,
                            _ => {}
                        }
                    }
                }
            }
            _ => {}
        }
    }
    push_driver(&mut driver, &mut meta.drivers);
    meta.session_num = current_session;
    meta.session_type = meta
        .sessions
        .iter()
        .find(|s| s.num == current_session)
        .map(|s| s.kind.clone())
        .unwrap_or_default();
    meta
}

impl SessionMeta {
    /// The cars worth recording: not the pace car, not a spectator.
    pub fn racing(&self, car_idx: i64) -> bool {
        self.drivers
            .iter()
            .find(|d| d.car_idx == car_idx)
            .map_or(true, |d| !d.pace_car && !d.spectator)
    }

    /// A class's label: its short name, or, when the sim gives none (offline
    /// sessions leave it empty), the model most of its cars drive ("Ford
    /// Mustang GT3"). Never a person's name: cars only.
    pub fn class_label(&self, class_id: i64) -> String {
        let members = || self.drivers.iter().filter(|d| d.class_id == class_id && !d.pace_car && !d.spectator);
        if let Some(named) = members().find(|d| !d.class_name.is_empty()) {
            return named.class_name.clone();
        }
        let mut counts: Vec<(&str, usize)> = Vec::new();
        for d in members().filter(|d| !d.car_name.is_empty()) {
            match counts.iter_mut().find(|(n, _)| *n == d.car_name) {
                Some(c) => c.1 += 1,
                None => counts.push((d.car_name.as_str(), 1)),
            }
        }
        // Most cars wins; the first seen breaks a tie.
        counts
            .iter()
            .fold(None::<&(&str, usize)>, |best, c| match best {
                Some(b) if b.1 >= c.1 => Some(b),
                _ => Some(c),
            })
            .map(|(n, _)| n.to_string())
            .unwrap_or_default()
    }

    /// What goes in meta.json: no names, no ids of people.
    pub fn to_json(&self) -> Value {
        let drivers: Vec<Value> = self
            .drivers
            .iter()
            .filter(|d| !d.pace_car && !d.spectator)
            .map(|d| {
                json!({
                    "carIdx": d.car_idx,
                    "carNumber": d.car_number,
                    "classId": d.class_id,
                    "className": d.class_name,
                    "classLabel": self.class_label(d.class_id),
                    "classColor": d.class_color,
                    "carName": d.car_name,
                    "carPath": d.car_path,
                    "isPlayer": d.car_idx == self.player_idx,
                })
            })
            .collect();
        let sessions: Vec<Value> = self
            .sessions
            .iter()
            .map(|s| json!({"num": s.num, "type": s.kind, "time": s.time}))
            .collect();
        json!({
            "trackId": self.track_id,
            "track": self.track_name,
            "trackConfig": self.track_config,
            "trackLengthM": self.track_length_m,
            "seriesId": self.series_id,
            "subSessionId": self.sub_session_id,
            "sessionNum": self.session_num,
            "sessionType": self.session_type,
            "playerCarIdx": self.player_idx,
            "cars": drivers,
            "trackShort": self.track_short,
            "trackSkies": self.track_skies,
            "fuelMaxL": self.fuel_max_l,
            "fuelMaxPct": self.fuel_max_pct,
            "sectorStarts": self.sector_starts,
            "sessions": sessions,
        })
    }

    /// Identifies one session: SubSessionID is 0 offline (a test drive, an AI
    /// race), so those key on when the recording began instead.
    pub fn key(&self, first_seen_ms: u64) -> String {
        if self.sub_session_id != 0 {
            format!("{}:{}", self.sub_session_id, self.session_num)
        } else {
            format!("local-{first_seen_ms}:{}", self.session_num)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const TEXT: &str = "---\nWeekendInfo:\n TrackName: roadatlanta\n TrackID: 127\n TrackLength: 4.06 km\n TrackDisplayName: Road Atlanta\n TrackConfigName: Full Course\n SeriesID: 447\n SubSessionID: 88284244\n TrackSkies: Partly Cloudy\n WeekendOptions:\n  NumStarters: 3\nSessionInfo:\n CurrentSessionNum: 1\n Sessions:\n - SessionNum: 0\n   SessionLaps: unlimited\n   SessionTime: 2700.0000 sec\n   SessionType: Practice\n   SessionName: PRACTICE\n   ResultsPositions:\n   - Position: 1\n     UserName: Hidden Racer\n     SessionTime: 1.0000 sec\n   ResultsFastestLap:\n   - CarIdx: 255\n     SessionType: Nested\n   - SessionType: Dashed\n - SessionNum: 1\n   SessionTime: unlimited\n   SessionType: Race\n   SessionName: RACE\nDriverInfo:\n DriverCarIdx: 2\n DriverCarFuelMaxLtr: 110.000\n DriverCarMaxFuelPct: 0.500\n Drivers:\n - CarIdx: 0\n   UserName: Ren\u{e9}e Dupont\n   TeamName: Team: Les \u{c9}toiles\n   CustID: 111\n   UserID: 222\n   CarNumber: \"7\"\n   CarClassID: 11\n   CarClassShortName: GT3\n   CarScreenName: BMW M4 GT3\n   CarPath: bmwm4gt3\n   IsSpectator: 0\n - CarIdx: 1\n   UserName: Pace Car\n   CarNumber: \"0\"\n   CarIsPaceCar: 1\n   IsSpectator: 0\n - CarIdx: 2\n   UserName: Botkin Q\n   CustID: 333\n   CarNumber: \"12\"\n   CarClassID: 11\n   CarClassShortName: GT3\n   CarScreenName: Ford Mustang GT3\n   CarPath: fordmustanggt3\n   IsSpectator: 0\n - CarIdx: 3\n   UserName: Watcher\n   CarNumber: \"99\"\n   IsSpectator: 1\nSplitTimeInfo:\n Sectors:\n - SectorNum: 0\n   SectorStartPct: 0.000000\n - SectorNum: 1\n   SectorStartPct: 0.130902\n - SectorNum: 2\n   SectorStartPct: 0.306900\nCarSetup:\n SectorStartPct: 0.9\n...\n";

    #[test]
    fn reads_the_track_session_and_cars() {
        let m = parse(TEXT);
        assert_eq!((m.track_id, m.track_name.as_str()), (127, "Road Atlanta"));
        assert_eq!(m.track_config, "Full Course");
        assert!((m.track_length_m - 4060.0).abs() < 1e-6);
        assert_eq!((m.series_id, m.sub_session_id, m.session_num), (447, 88284244, 1));
        assert_eq!(m.session_type, "Race");
        assert_eq!(m.player_idx, 2);
        assert_eq!(m.drivers.len(), 4);
        assert_eq!(m.drivers[2].car_name, "Ford Mustang GT3");
        assert_eq!(m.drivers[2].car_number, "12");
        assert!(m.drivers[1].pace_car);
        assert!(m.drivers[3].spectator);
    }

    #[test]
    fn what_is_written_has_no_names_or_ids_of_people() {
        let text = parse(TEXT).to_json().to_string();
        for secret in ["Dupont", "toiles", "Botkin", "Watcher", "Hidden", "111", "222", "333", "UserName", "CustID", "TeamName"] {
            assert!(!text.contains(secret), "{secret} reached the output: {text}");
        }
        assert!(text.contains("Ford Mustang GT3"));
        assert!(text.contains("\"isPlayer\":true"));
    }

    #[test]
    fn keeps_track_skies_fuel_sectors_and_the_sessions_list() {
        let m = parse(TEXT);
        assert_eq!(m.track_short, "roadatlanta");
        assert_eq!(m.track_skies, "Partly Cloudy");
        assert_eq!((m.fuel_max_l, m.fuel_max_pct), (110.0, 0.5));
        // CarSetup's own SectorStartPct is not SplitTimeInfo's.
        assert_eq!(m.sector_starts, vec![0.0, 0.130902, 0.3069]);
        // The nested results lists' keys (deeper, or a dashed item) are not
        // the session's own.
        let want = vec![
            Session { num: 0, kind: "Practice".into(), time: "2700.0000 sec".into() },
            Session { num: 1, kind: "Race".into(), time: "unlimited".into() },
        ];
        assert_eq!(m.sessions, want);
        assert_eq!(m.session_type, "Race");
        let json = m.to_json();
        assert_eq!(json["trackShort"], "roadatlanta");
        assert_eq!(json["trackSkies"], "Partly Cloudy");
        assert_eq!(json["fuelMaxL"], 110.0);
        assert_eq!(json["fuelMaxPct"], 0.5);
        assert_eq!(json["sectorStarts"], json!([0.0, 0.130902, 0.3069]));
        assert_eq!(json["sessions"][0], json!({"num": 0, "type": "Practice", "time": "2700.0000 sec"}));
        assert_eq!(json["sessions"][1], json!({"num": 1, "type": "Race", "time": "unlimited"}));
    }

    #[test]
    fn absent_fuel_and_sectors_are_zero_and_empty() {
        let m = parse(OFFLINE);
        assert_eq!((m.fuel_max_l, m.fuel_max_pct), (0.0, 0.0));
        let json = m.to_json();
        assert_eq!(json["sectorStarts"], json!([]));
        assert_eq!(json["sessions"], json!([]));
        assert_eq!(json["trackSkies"], "");
    }

    /// A tool for a parity run, not a check: IR_SESSION_TEXT names a file of
    /// session text as the sim publishes it (Windows-1252), IR_META_OUT where
    /// the meta it gives is written.
    #[test]
    #[ignore]
    fn session_text_to_meta() {
        let input = std::env::var("IR_SESSION_TEXT").expect("IR_SESSION_TEXT");
        let output = std::env::var("IR_META_OUT").expect("IR_META_OUT");
        // Byte to the char of that code point (latin1): the keys kept are
        // ASCII, so this reads them as the live decode_cp1252 does.
        let text: String = std::fs::read(input).unwrap().into_iter().map(char::from).collect();
        let meta = parse(&text).to_json();
        std::fs::write(output, serde_json::to_string_pretty(&meta).unwrap()).unwrap();
    }

    #[test]
    fn pace_car_and_spectators_are_not_racing_cars() {
        let m = parse(TEXT);
        assert!(m.racing(0) && m.racing(2));
        assert!(!m.racing(1) && !m.racing(3));
        assert!(m.racing(40), "a car the text does not list is kept");
        let cars = m.to_json()["cars"].as_array().unwrap().len();
        assert_eq!(cars, 2);
    }

    #[test]
    fn a_half_written_text_is_not_complete() {
        assert!(is_complete(TEXT));
        assert!(!is_complete(&TEXT[..TEXT.len() / 2]));
        assert!(!is_complete(""));
    }

    #[test]
    fn offline_sessions_key_on_the_start_time() {
        let mut m = parse(TEXT);
        assert_eq!(m.key(5), "88284244:1");
        m.sub_session_id = 0;
        assert_eq!(m.key(1000), "local-1000:1");
        m.session_num = 2;
        assert_eq!(m.key(1000), "local-1000:2");
    }

    // Offline sessions leave CarClassShortName empty: the class is then known
    // by its colour and by the model most of its cars drive.
    const OFFLINE: &str = "---
WeekendInfo:
 TrackID: 95
 TrackDisplayName: Sebring
SessionInfo:
 CurrentSessionNum: 0
DriverInfo:
 DriverCarIdx: 0
 Drivers:
 - CarIdx: 0
   UserName: A
   CarClassID: 4011
   CarClassShortName: 
   CarClassColor: 0xff5888
   CarScreenName: Ford Mustang GT3
 - CarIdx: 1
   UserName: B
   CarClassID: 2523
   CarClassShortName: 
   CarClassColor: 0x33ceff
   CarScreenName: Dallara P217 LMP2
 - CarIdx: 2
   UserName: C
   CarClassID: 2523
   CarClassShortName: 
   CarClassColor: 0x33ceff
   CarScreenName: Dallara P217 LMP2
 - CarIdx: 3
   UserName: D
   CarClassID: 2523
   CarClassShortName: 
   CarClassColor: 0x33ceff
   CarScreenName: Oreca 07
 - CarIdx: 4
   UserName: E
   CarClassID: 77
   CarClassShortName: GTP
   CarClassColor: nonsense
   CarScreenName: Cadillac V-Series.R
...
";

    #[test]
    fn a_class_has_a_colour_and_a_label_even_when_the_sim_gives_no_name() {
        let m = parse(OFFLINE);
        assert_eq!(m.drivers[0].class_color, "#ff5888");
        assert_eq!(m.drivers[1].class_color, "#33ceff");
        assert_eq!(m.drivers[4].class_color, "", "not a colour: nothing");
        assert_eq!(hex_colour("0x5888"), "#005888", "short values are padded");
        assert_eq!(hex_colour("0x0"), "#000000");
        assert_eq!(hex_colour("0xff58880"), "", "too long is not a colour");
        // No short name: the model most of the class drives.
        assert_eq!(m.class_label(4011), "Ford Mustang GT3");
        assert_eq!(m.class_label(2523), "Dallara P217 LMP2");
        // A short name wins.
        assert_eq!(m.class_label(77), "GTP");
        assert_eq!(m.class_label(1), "", "an unknown class has no label");
        let json = m.to_json().to_string();
        assert!(json.contains("\"classColor\":\"#33ceff\""), "{json}");
        assert!(json.contains("\"classLabel\":\"Dallara P217 LMP2\""), "{json}");
        // Still no people.
        assert!(!json.contains("UserName"));
    }
}
