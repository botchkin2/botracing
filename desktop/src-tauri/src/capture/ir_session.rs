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

fn int(value: &str) -> i64 {
    value.trim().parse().unwrap_or(0)
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
    // The sessions list: (SessionNum, SessionType) pairs, resolved at the end
    // against CurrentSessionNum.
    let mut sessions: Vec<(i64, String)> = Vec::new();
    let mut current_session = 0;
    let mut in_sessions = false;
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
                _ => "",
            };
            in_sessions = false;
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
                _ => {}
            },
            "session" => {
                if indent == 1 && key == "CurrentSessionNum" {
                    current_session = int(value);
                } else if indent == 1 && key == "Sessions" {
                    in_sessions = true;
                } else if in_sessions && key == "SessionNum" && item.is_some() {
                    sessions.push((int(value), String::new()));
                } else if in_sessions && key == "SessionType" {
                    if let Some(last) = sessions.last_mut() {
                        last.1 = value.to_string();
                    }
                }
            }
            "driver" => {
                if indent == 1 && key == "DriverCarIdx" {
                    meta.player_idx = int(value);
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
    meta.session_type = sessions
        .iter()
        .find(|(n, _)| *n == current_session)
        .map(|(_, t)| t.clone())
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
                    "carName": d.car_name,
                    "carPath": d.car_path,
                    "isPlayer": d.car_idx == self.player_idx,
                })
            })
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

    const TEXT: &str = "---\nWeekendInfo:\n TrackName: roadatlanta\n TrackID: 127\n TrackLength: 4.06 km\n TrackDisplayName: Road Atlanta\n TrackConfigName: Full Course\n SeriesID: 447\n SubSessionID: 88284244\n WeekendOptions:\n  NumStarters: 3\nSessionInfo:\n CurrentSessionNum: 1\n Sessions:\n - SessionNum: 0\n   SessionType: Practice\n   SessionName: PRACTICE\n - SessionNum: 1\n   SessionType: Race\n   SessionName: RACE\nDriverInfo:\n DriverCarIdx: 2\n Drivers:\n - CarIdx: 0\n   UserName: Ren\u{e9}e Dupont\n   TeamName: Team: Les \u{c9}toiles\n   CustID: 111\n   UserID: 222\n   CarNumber: \"7\"\n   CarClassID: 11\n   CarClassShortName: GT3\n   CarScreenName: BMW M4 GT3\n   CarPath: bmwm4gt3\n   IsSpectator: 0\n - CarIdx: 1\n   UserName: Pace Car\n   CarNumber: \"0\"\n   CarIsPaceCar: 1\n   IsSpectator: 0\n - CarIdx: 2\n   UserName: Botkin Q\n   CustID: 333\n   CarNumber: \"12\"\n   CarClassID: 11\n   CarClassShortName: GT3\n   CarScreenName: Ford Mustang GT3\n   CarPath: fordmustanggt3\n   IsSpectator: 0\n - CarIdx: 3\n   UserName: Watcher\n   CarNumber: \"99\"\n   IsSpectator: 1\n...\n";

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
        for secret in ["Dupont", "toiles", "Botkin", "Watcher", "111", "222", "333", "UserName", "CustID", "TeamName"] {
            assert!(!text.contains(secret), "{secret} reached the output: {text}");
        }
        assert!(text.contains("Ford Mustang GT3"));
        assert!(text.contains("\"isPlayer\":true"));
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
}
