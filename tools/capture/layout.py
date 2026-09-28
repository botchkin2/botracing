"""LMU's shared memory layout, built from the game's own header at run time.

The header (Support/SharedMemoryInterface/*.hpp in the LMU install) is S397's
and not ours to redistribute, and this repo is public, so the struct layout is
never written down here. Reading it from the install also follows game
updates: a new field moves every offset after it, and a copied layout would
silently read garbage.

Only the subset of C++ the header uses is understood: structs of plain fields,
arrays, pointers, enums with an underlying type, and #pragma pack push/pop.
Anything else in a struct we need raises, so a header change that this parser
cannot follow stops the recorder instead of misreading memory.
"""

import ctypes as C
import hashlib
import re
from pathlib import Path

DEFAULT_HEADER_DIR = Path(
    r"C:\Program Files (x86)\Steam\steamapps\common\Le Mans Ultimate"
    r"\Support\SharedMemoryInterface"
)
HEADER_FILES = ("InternalsPlugin.hpp", "SharedMemoryInterface.hpp")
ROOT = "SharedMemoryObjectOut"

# Windows x64 (LLP64): long is 32 bits.
SCALARS = {
    "double": C.c_double,
    "float": C.c_float,
    "float_t": C.c_float,  # MSVC x64 evaluates float in float
    "double_t": C.c_double,
    "bool": C.c_bool,
    "int8_t": C.c_int8,
    "int16_t": C.c_int16,
    "uint16_t": C.c_uint16,
    "int32_t": C.c_int32,
    "int64_t": C.c_int64,
    "char": C.c_char,
    "signed char": C.c_int8,
    "unsigned char": C.c_uint8,
    "uint8_t": C.c_uint8,
    "short": C.c_int16,
    "signed short": C.c_int16,
    "unsigned short": C.c_uint16,
    "int": C.c_int32,
    "long": C.c_int32,
    "unsigned int": C.c_uint32,
    "unsigned long": C.c_uint32,
    "uint32_t": C.c_uint32,
    "long long": C.c_int64,
    "unsigned long long": C.c_uint64,
    "uint64_t": C.c_uint64,
    "size_t": C.c_uint64,
    "HWND": C.c_void_p,
}
CONSTANTS = {"MAX_PATH": 260}


class LayoutError(Exception):
    pass


def _strip_comments(text):
    text = re.sub(r"/\*.*?\*/", " ", text, flags=re.S)
    return re.sub(r"//[^\n]*", "", text)


def _block(text, open_at):
    """Text between the brace at open_at and its match."""
    depth = 0
    for i in range(open_at, len(text)):
        if text[i] == "{":
            depth += 1
        elif text[i] == "}":
            depth -= 1
            if depth == 0:
                return text[open_at + 1 : i]
    raise LayoutError("unbalanced braces")


def _top_level_statements(body):
    """Statements at depth 0 of a struct body; nested blocks are kept whole."""
    out, depth, start = [], 0, 0
    for i, ch in enumerate(body):
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            # An inline method body ends without a semicolon.
            if depth == 0:
                out.append(body[start : i + 1].strip())
                start = i + 1
        elif ch == ";" and depth == 0:
            out.append(body[start:i].strip())
            start = i + 1
    return [s for s in out if s]


class Header:
    """Struct and enum definitions found in the header text, in file order."""

    def __init__(self, text):
        self.structs = {}  # name -> (pack or None, body)
        self.enums = {}  # name -> (ctype, {member: value})
        pack_stack, pack = [], None
        pos = 0
        token = re.compile(
            r"#pragma\s+pack\s*\(\s*(push\s*,\s*(\d+)|pop)\s*\)"
            r"|\b(struct|enum(?:\s+class)?)\s+(\w+)\s*(?::\s*([\w\s]+?))?\s*\{"
        )
        while m := token.search(text, pos):
            if m.group(1):
                if m.group(1).startswith("push"):
                    pack_stack.append(pack)
                    pack = int(m.group(2))
                else:
                    pack = pack_stack.pop() if pack_stack else None
                pos = m.end()
                continue
            kind, name, base = m.group(3), m.group(4), m.group(5)
            body = _block(text, m.end() - 1)
            pos = m.end() - 1 + len(body) + 2
            if kind.startswith("enum"):
                self.enums[name] = (self._enum_type(base), self._enum_values(body))
            elif base and base.strip().startswith("public"):
                continue  # derived structs are not in the shared memory
            elif name not in self.structs:
                self.structs[name] = (pack, body)

    def _enum_type(self, base):
        return SCALARS.get(" ".join(base.split()) if base else "int", C.c_int32)

    def _enum_values(self, body):
        values, next_value = {}, 0
        for part in body.split(","):
            part = part.strip()
            if not part:
                continue
            name, _, value = part.partition("=")
            value = value.strip()
            if value in values:
                next_value = values[value]
            elif value:
                try:
                    next_value = int(value, 0)
                except ValueError:
                    # An expression; fine unless an array size needs this enum.
                    values[name.strip()] = None
                    continue
            values[name.strip()] = next_value
            next_value += 1
        return values

    def constant(self, expr):
        expr = expr.strip()
        if re.fullmatch(r"\d+", expr):
            return int(expr)
        if expr in CONSTANTS:
            return CONSTANTS[expr]
        member = expr.split("::")[-1]
        for _, values in self.enums.values():
            if values.get(member) is not None:
                return values[member]
        raise LayoutError(f"unknown array size {expr!r}")


_DECL = re.compile(r"^(?P<type>[\w:\s]+?)\s*(?P<ptr>\*?)\s*(?P<names>\w+(?:\s*\[[^\]]+\])*(?:\s*,\s*\*?\s*\w+(?:\s*\[[^\]]+\])*)*)$")


class Layout:
    """ctypes structs for the shared memory, plus where the parts we read sit."""

    def __init__(self, header_text):
        self.header = Header(_strip_comments(header_text))
        self.hash = hashlib.sha256(header_text.encode("utf-8", "replace")).hexdigest()[:16]
        self._built = {}
        self.root = self.struct(ROOT)
        self.telem = self.struct("TelemInfoV01")
        self.vehicle = self.struct("VehicleScoringInfoV01")
        self.scoring = self.struct("ScoringInfoV01")
        o = self.root
        scoring = o.scoring.offset
        telemetry = o.telemetry.offset
        sd, td = self.struct("SharedMemoryScoringData"), self.struct("SharedMemoryTelemetryData")
        self.size = C.sizeof(o)
        self.offsets = {
            "gameVersion": o.generic.offset + self.struct("SharedMemoryGeneric").gameVersion.offset,
            "scoringInfo": scoring + sd.scoringInfo.offset,
            "vehScoringInfo": scoring + sd.vehScoringInfo.offset,
            "activeVehicles": telemetry + td.activeVehicles.offset,
            "playerVehicleIdx": telemetry + td.playerVehicleIdx.offset,
            "playerHasVehicle": telemetry + td.playerHasVehicle.offset,
            "telemInfo": telemetry + td.telemInfo.offset,
        }
        self.max_vehicles = sd.vehScoringInfo.size // C.sizeof(self.vehicle)

    def struct(self, name):
        if name in self._built:
            return self._built[name]
        if name == "TelemVect3":
            cls = self._vect3()
        elif name not in self.header.structs:
            raise LayoutError(f"struct {name} not in the header")
        else:
            pack, body = self.header.structs[name]
            fields = []
            for stmt in _top_level_statements(body):
                fields.extend(self._fields(name, stmt))
            attrs = {"_fields_": fields}
            if pack:
                attrs["_pack_"] = pack
            cls = type(name, (C.Structure,), attrs)
        self._built[name] = cls
        return cls

    def _vect3(self):
        pack, body = self.header.structs.get("TelemVect3", (None, ""))
        if not re.search(r"double\s+x\s*,\s*y\s*,\s*z\s*;", body):
            raise LayoutError("TelemVect3 is no longer three doubles")
        attrs = {"_fields_": [("x", C.c_double), ("y", C.c_double), ("z", C.c_double)]}
        if pack:
            attrs["_pack_"] = pack
        return type("TelemVect3", (C.Structure,), attrs)

    def _fields(self, owner, stmt):
        if "(" in stmt or stmt.startswith(("static", "typedef", "friend")):
            return []  # a method or declaration, not a field
        m = _DECL.match(" ".join(stmt.split()))
        if not m:
            raise LayoutError(f"{owner}: cannot read {stmt!r}")
        base = self._type(owner, m.group("type").strip(), bool(m.group("ptr")))
        out = []
        for part in m.group("names").split(","):
            part = part.strip()
            pointer = part.startswith("*")
            name = re.match(r"\*?\s*(\w+)", part).group(1)
            ctype = C.c_void_p if pointer else base
            for size in reversed(re.findall(r"\[([^\]]+)\]", part)):
                ctype = ctype * self.header.constant(size)
            out.append((name, ctype))
        return out

    def _type(self, owner, name, pointer):
        if pointer:
            return C.c_void_p
        name = re.sub(r"^(struct|enum|const)\s+", "", name)
        if name in SCALARS:
            return SCALARS[name]
        if name in self.header.enums:
            return self.header.enums[name][0]
        if name in self.header.structs or name == "TelemVect3":
            return self.struct(name)
        raise LayoutError(f"{owner}: unknown type {name!r}")


def load(header_dir=DEFAULT_HEADER_DIR):
    """The layout from an LMU install's header files, concatenated in include order."""
    header_dir = Path(header_dir)
    text = ""
    for name in HEADER_FILES:
        path = header_dir / name
        if not path.exists():
            raise LayoutError(f"no {path}")
        text += path.read_text(encoding="utf-8", errors="replace") + "\n"
    return Layout(text)
