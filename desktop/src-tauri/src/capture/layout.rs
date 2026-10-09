// LMU's shared-memory layout, built from the game's own header at run time.
//
// The header is S397's and this repo is public, so the struct layout is never
// written down here. A copied offset list would also go stale on the next
// game update. Only the subset of C++ the header uses is understood. Anything
// else in a struct we need is an error, so a header change stops the recorder
// instead of misreading memory.

use regex::Regex;
use sha2::{Digest, Sha256};
use std::collections::HashMap;

#[derive(Debug)]
pub struct LayoutError(pub String);

impl std::fmt::Display for LayoutError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

pub type LayoutResult<T> = Result<T, LayoutError>;

fn err(msg: impl Into<String>) -> LayoutError {
    LayoutError(msg.into())
}

/// Windows x64 (LLP64): long is 32 bits. (size, natural alignment)
fn scalar(name: &str) -> Option<(usize, usize)> {
    Some(match name {
        "double" | "double_t" => (8, 8),
        "float" | "float_t" => (4, 4),
        "bool" | "int8_t" | "uint8_t" | "char" | "signed char" | "unsigned char" => (1, 1),
        "int16_t" | "uint16_t" | "short" | "signed short" | "unsigned short" => (2, 2),
        "int32_t" | "uint32_t" | "int" | "long" | "unsigned int" | "unsigned long" => (4, 4),
        "int64_t" | "uint64_t" | "long long" | "unsigned long long" | "size_t" => (8, 8),
        "HWND" => (8, 8),
        _ => return None,
    })
}

const MAX_PATH: i64 = 260;
/// MSVC's default packing when no pragma is in force.
const DEFAULT_PACK: usize = 8;

#[derive(Clone, Debug)]
pub struct Field {
    pub name: String,
    pub offset: usize,
    pub size: usize,
    pub align: usize,
}

#[derive(Clone, Debug)]
pub struct Struct {
    pub size: usize,
    pub align: usize,
    pub fields: Vec<Field>,
}

#[derive(Clone, Debug)]
struct Ty {
    size: usize,
    align: usize,
}

struct Header {
    /// name -> (pack in force at the definition, body)
    structs: HashMap<String, (Option<usize>, String)>,
    /// name -> (size, align, member -> value)
    enums: HashMap<String, (usize, usize, HashMap<String, Option<i64>>)>,
}

impl Header {
    fn parse(text: &str) -> LayoutResult<Self> {
        let text = strip_comments(text);
        let token = Regex::new(
            r"#pragma\s+pack\s*\(\s*(push\s*,\s*(\d+)|pop)\s*\)|\b(struct|enum(?:\s+class)?)\s+(\w+)\s*(?::\s*([\w\s]+?))?\s*\{",
        )
        .expect("pragma regex");
        let mut structs = HashMap::new();
        let mut enums = HashMap::new();
        let mut pack_stack: Vec<Option<usize>> = Vec::new();
        let mut pack: Option<usize> = None;
        let mut pos = 0;
        while let Some(m) = token.find_at(&text, pos) {
            let caps = token.captures_at(&text, pos).unwrap();
            if caps.get(1).is_some() {
                let kind = caps.get(1).unwrap().as_str();
                if kind.starts_with("push") {
                    pack_stack.push(pack);
                    pack = Some(caps.get(2).unwrap().as_str().parse().unwrap_or(DEFAULT_PACK));
                } else {
                    pack = pack_stack.pop().flatten();
                }
                pos = m.end();
                continue;
            }
            let kind = caps.get(3).unwrap().as_str();
            let name = caps.get(4).unwrap().as_str().to_string();
            let base = caps.get(5).map(|c| c.as_str().to_string());
            let open = m.end() - 1;
            let body = block(&text, open)?;
            pos = open + 1 + body.len() + 1;
            if kind.starts_with("enum") {
                let (size, align) = enum_type(base.as_deref());
                enums.insert(name, (size, align, enum_values(&body)));
            } else if base.as_deref().is_some_and(|b| b.trim().starts_with("public")) {
                // Derived structs are not in the shared memory.
            } else if !structs.contains_key(&name) {
                structs.insert(name, (pack, body));
            }
        }
        Ok(Header { structs, enums })
    }

    fn constant(&self, expr: &str) -> LayoutResult<usize> {
        let expr = expr.trim();
        if let Ok(n) = expr.parse::<usize>() {
            if expr.chars().all(|c| c.is_ascii_digit()) {
                return Ok(n);
            }
        }
        if expr == "MAX_PATH" {
            return Ok(MAX_PATH as usize);
        }
        let member = expr.rsplit("::").next().unwrap_or(expr);
        for (_, _, values) in self.enums.values() {
            if let Some(Some(v)) = values.get(member) {
                return Ok(*v as usize);
            }
        }
        Err(err(format!("unknown array size {expr:?}")))
    }
}

fn enum_type(base: Option<&str>) -> (usize, usize) {
    let name = base.map(|b| b.split_whitespace().collect::<Vec<_>>().join(" "));
    scalar(name.as_deref().unwrap_or("int")).unwrap_or((4, 4))
}

fn enum_values(body: &str) -> HashMap<String, Option<i64>> {
    let mut values = HashMap::new();
    let mut next = 0_i64;
    for part in body.split(',') {
        let part = part.trim();
        if part.is_empty() {
            continue;
        }
        let (name, value) = part.split_once('=').map(|(n, v)| (n, v.trim())).unwrap_or((part, ""));
        let name = name.trim();
        if value.is_empty() {
            values.insert(name.to_string(), Some(next));
            next += 1;
        } else if let Some(Some(v)) = values.get(value) {
            next = *v;
            values.insert(name.to_string(), Some(next));
            next += 1;
        } else if let Ok(v) = parse_int(value) {
            next = v;
            values.insert(name.to_string(), Some(next));
            next += 1;
        } else {
            // An expression. Fine unless an array size needs this member.
            values.insert(name.to_string(), None);
        }
    }
    values
}

fn parse_int(value: &str) -> Result<i64, ()> {
    if let Some(hex) = value.strip_prefix("0x").or_else(|| value.strip_prefix("0X")) {
        return i64::from_str_radix(hex, 16).map_err(|_| ());
    }
    value.parse().map_err(|_| ())
}

fn strip_comments(text: &str) -> String {
    let block = Regex::new(r"/\*.*?\*/").expect("block comment");
    let line = Regex::new(r"//[^\n]*").expect("line comment");
    line.replace_all(&block.replace_all(text, " "), "").into_owned()
}

fn block(text: &str, open_at: usize) -> LayoutResult<String> {
    let bytes = text.as_bytes();
    let mut depth = 0_i32;
    for i in open_at..bytes.len() {
        match bytes[i] {
            b'{' => depth += 1,
            b'}' => {
                depth -= 1;
                if depth == 0 {
                    return Ok(text[open_at + 1..i].to_string());
                }
            }
            _ => {}
        }
    }
    Err(err("unbalanced braces"))
}

fn top_level_statements(body: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut depth = 0_i32;
    let mut start = 0;
    for (i, ch) in body.char_indices() {
        match ch {
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                // An inline method body ends without a semicolon.
                if depth == 0 {
                    let stmt = body[start..=i].trim();
                    if !stmt.is_empty() {
                        out.push(stmt.to_string());
                    }
                    start = i + ch.len_utf8();
                }
            }
            ';' if depth == 0 => {
                let stmt = body[start..i].trim();
                if !stmt.is_empty() {
                    out.push(stmt.to_string());
                }
                start = i + 1;
            }
            _ => {}
        }
    }
    out
}

pub struct Layout {
    pub hash: String,
    pub size: usize,
    pub max_vehicles: usize,
    pub offsets: HashMap<String, usize>,
    header: Header,
    built: HashMap<String, Struct>,
}

impl Layout {
    pub fn parse(header_text: &str) -> LayoutResult<Self> {
        let header = Header::parse(header_text)?;
        let mut hash = Sha256::new();
        hash.update(header_text.as_bytes());
        let digest = hash.finalize();
        let hash = digest.iter().take(8).map(|b| format!("{b:02x}")).collect();
        let mut layout = Layout {
            hash,
            size: 0,
            max_vehicles: 0,
            offsets: HashMap::new(),
            header,
            built: HashMap::new(),
        };
        let root = layout.struct_named("SharedMemoryObjectOut")?.clone();
        let telem_data = layout.struct_named("SharedMemoryTelemetryData")?.clone();
        let scoring_data = layout.struct_named("SharedMemoryScoringData")?.clone();
        let generic = layout.struct_named("SharedMemoryGeneric")?.clone();
        let vehicle = layout.struct_named("VehicleScoringInfoV01")?.clone();
        // Touch the structs the recorder reads, so a missing one fails here.
        layout.struct_named("TelemInfoV01")?;
        layout.struct_named("ScoringInfoV01")?;
        let field = |s: &Struct, name: &str| -> LayoutResult<usize> {
            s.fields
                .iter()
                .find(|f| f.name == name)
                .map(|f| f.offset)
                .ok_or_else(|| err(format!("missing field {name}")))
        };
        let scoring = field(&root, "scoring")?;
        let telemetry = field(&root, "telemetry")?;
        let veh_size = vehicle.size;
        let veh_array = scoring_data
            .fields
            .iter()
            .find(|f| f.name == "vehScoringInfo")
            .ok_or_else(|| err("missing vehScoringInfo"))?;
        layout.max_vehicles = veh_array.size / veh_size;
        layout.size = root.size;
        layout.offsets.insert(
            "gameVersion".into(),
            field(&root, "generic")? + field(&generic, "gameVersion")?,
        );
        layout.offsets.insert(
            "scoringInfo".into(),
            scoring + field(&scoring_data, "scoringInfo")?,
        );
        layout.offsets.insert(
            "vehScoringInfo".into(),
            scoring + field(&scoring_data, "vehScoringInfo")?,
        );
        layout.offsets.insert(
            "activeVehicles".into(),
            telemetry + field(&telem_data, "activeVehicles")?,
        );
        layout.offsets.insert(
            "playerVehicleIdx".into(),
            telemetry + field(&telem_data, "playerVehicleIdx")?,
        );
        layout.offsets.insert(
            "playerHasVehicle".into(),
            telemetry + field(&telem_data, "playerHasVehicle")?,
        );
        layout.offsets.insert(
            "telemInfo".into(),
            telemetry + field(&telem_data, "telemInfo")?,
        );
        Ok(layout)
    }

    pub fn struct_named(&mut self, name: &str) -> LayoutResult<&Struct> {
        if self.built.contains_key(name) {
            return Ok(&self.built[name]);
        }
        let built = if name == "TelemVect3" {
            self.vect3()?
        } else {
            let (pack, body) = self
                .header
                .structs
                .get(name)
                .cloned()
                .ok_or_else(|| err(format!("struct {name} not in the header")))?;
            // Reserve the name so a struct that contains itself fails closed.
            self.built.insert(
                name.to_string(),
                Struct { size: 0, align: 1, fields: Vec::new() },
            );
            let mut fields = Vec::new();
            for stmt in top_level_statements(&body) {
                fields.extend(self.fields(name, &stmt, pack)?);
            }
            let pack_n = pack.unwrap_or(DEFAULT_PACK);
            let mut offset = 0;
            let mut align = 1;
            let mut laid = Vec::new();
            for (fname, ty) in fields {
                let use_align = ty.align.min(pack_n).max(1);
                offset = align_up(offset, use_align);
                laid.push(Field {
                    name: fname,
                    offset,
                    size: ty.size,
                    align: use_align,
                });
                offset += ty.size;
                align = align.max(use_align);
            }
            Struct {
                size: align_up(offset, align),
                align,
                fields: laid,
            }
        };
        self.built.insert(name.to_string(), built);
        Ok(&self.built[name])
    }

    fn vect3(&self) -> LayoutResult<Struct> {
        let (pack, body) = self
            .header
            .structs
            .get("TelemVect3")
            .cloned()
            .unwrap_or((None, String::new()));
        if !Regex::new(r"double\s+x\s*,\s*y\s*,\s*z\s*;")
            .expect("vect3")
            .is_match(&body)
        {
            return Err(err("TelemVect3 is no longer three doubles"));
        }
        let pack_n = pack.unwrap_or(DEFAULT_PACK);
        let align = 8.min(pack_n);
        let mut fields = Vec::new();
        for (i, name) in ["x", "y", "z"].iter().enumerate() {
            fields.push(Field {
                name: (*name).into(),
                offset: i * 8,
                size: 8,
                align,
            });
        }
        Ok(Struct { size: 24, align, fields })
    }

    fn fields(&mut self, owner: &str, stmt: &str, pack: Option<usize>) -> LayoutResult<Vec<(String, Ty)>> {
        if stmt.contains('(') || stmt.starts_with("static") || stmt.starts_with("typedef") || stmt.starts_with("friend")
        {
            return Ok(Vec::new());
        }
        let flat = stmt.split_whitespace().collect::<Vec<_>>().join(" ");
        let decl = Regex::new(
            r"^(?P<type>[\w: ]+?)\s*(?P<ptr>\*?)\s*(?P<names>\w+(?:\s*\[[^\]]+\])*(?:\s*,\s*\*?\s*\w+(?:\s*\[[^\]]+\])*)*)$",
        )
        .expect("decl");
        let caps = decl
            .captures(&flat)
            .ok_or_else(|| err(format!("{owner}: cannot read {stmt:?}")))?;
        let base = self.ty(owner, caps.name("type").unwrap().as_str().trim(), caps.name("ptr").unwrap().as_str() == "*", pack)?;
        let mut out = Vec::new();
        for part in caps.name("names").unwrap().as_str().split(',') {
            let part = part.trim();
            let pointer = part.starts_with('*');
            let name = Regex::new(r"^\*?\s*(\w+)")
                .unwrap()
                .captures(part)
                .ok_or_else(|| err(format!("{owner}: cannot read {part:?}")))?
                .get(1)
                .unwrap()
                .as_str()
                .to_string();
            let mut ty = if pointer {
                Ty { size: 8, align: 8 }
            } else {
                base.clone()
            };
            let sizes: Vec<&str> = Regex::new(r"\[([^\]]+)\]")
                .unwrap()
                .captures_iter(part)
                .map(|c| c.get(1).unwrap().as_str())
                .collect();
            for size in sizes.into_iter().rev() {
                let n = self.header.constant(size)?;
                let align = ty.align;
                ty = Ty { size: ty.size * n, align };
            }
            out.push((name, ty));
        }
        Ok(out)
    }

    fn ty(&mut self, owner: &str, name: &str, pointer: bool, pack: Option<usize>) -> LayoutResult<Ty> {
        if pointer {
            return Ok(Ty { size: 8, align: 8 });
        }
        let name = name
            .trim()
            .trim_start_matches("struct ")
            .trim_start_matches("enum ")
            .trim_start_matches("const ")
            .trim();
        if let Some((size, align)) = scalar(name) {
            return Ok(Ty { size, align });
        }
        if let Some((size, align, _)) = self.header.enums.get(name).cloned() {
            return Ok(Ty { size, align });
        }
        if self.header.structs.contains_key(name) || name == "TelemVect3" {
            let s = self.struct_named(name)?.clone();
            let _ = pack;
            return Ok(Ty { size: s.size, align: s.align });
        }
        Err(err(format!("{owner}: unknown type {name:?}")))
    }
}

fn align_up(offset: usize, align: usize) -> usize {
    if align <= 1 {
        return offset;
    }
    (offset + align - 1) & !(align - 1)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> Layout {
        Layout::parse(include_str!("../../../../tools/capture/tests/fixture.hpp")).unwrap()
    }

    #[test]
    fn fixture_matches_layout_py() {
        let lay = fixture();
        let oracle: serde_json::Value =
            serde_json::from_str(include_str!("fixture_layout.json")).unwrap();
        assert_eq!(lay.hash, oracle["hash"].as_str().unwrap());
        assert_eq!(lay.size, oracle["size"].as_u64().unwrap() as usize);
        assert_eq!(lay.max_vehicles, oracle["maxVehicles"].as_u64().unwrap() as usize);
        for (key, value) in oracle["offsets"].as_object().unwrap() {
            assert_eq!(
                lay.offsets.get(key).copied(),
                Some(value.as_u64().unwrap() as usize),
                "{key}"
            );
        }
        let mut lay = lay;
        let wheel = lay.struct_named("TelemWheelV01").unwrap();
        assert_eq!(wheel.size, 64);
        assert_eq!(wheel.fields[0].align, 4);
        let telem = lay.struct_named("TelemInfoV01").unwrap().clone();
        let names: Vec<&str> = telem.fields.iter().map(|f| f.name.as_str()).collect();
        assert_eq!(
            &names[names.len() - 7..],
            ["mVehicleClass", "mABSActive", "mTCActive", "mVehicleModel", "mFrontTireCompoundName", "mRearTireCompoundName", "mWheel"]
        );
        let class = telem.fields.iter().find(|f| f.name == "mVehicleClass").unwrap();
        assert_eq!(class.size, 1);
        let wheel_field = telem.fields.iter().find(|f| f.name == "mWheel").unwrap();
        assert_eq!(wheel_field.offset % 4, 0);
        let generic = lay.struct_named("SharedMemoryGeneric").unwrap();
        assert_eq!(generic.size, 16);
        // SharedMemoryScoringData is after pack(pop): size_t aligns to 8.
        let scoring = lay.struct_named("SharedMemoryScoringData").unwrap().clone();
        let stream = scoring.fields.iter().find(|f| f.name == "scoringStreamSize").unwrap();
        assert_eq!(stream.offset % 8, 0);
        let telem_info = lay.offsets["telemInfo"];
        let telemetry = lay
            .struct_named("SharedMemoryObjectOut")
            .unwrap()
            .fields
            .iter()
            .find(|f| f.name == "telemetry")
            .unwrap()
            .offset;
        assert_eq!(telem_info, telemetry + 4);
    }

    #[test]
    fn unknown_type_stops_the_recorder() {
        match Layout::parse(
            "struct TelemInfoV01 { mystery_t mX; }; struct SharedMemoryObjectOut { TelemInfoV01 t; };",
        ) {
            Err(e) => assert!(e.0.contains("unknown type"), "{e}"),
            Ok(_) => panic!("a type the parser does not know must stop the recorder"),
        }
    }

    #[test]
    fn hash_follows_the_text() {
        let a = fixture();
        let b = Layout::parse(&format!(
            "{}\n",
            include_str!("../../../../tools/capture/tests/fixture.hpp")
        ))
        .unwrap();
        assert_ne!(a.hash, b.hash);
    }
}
