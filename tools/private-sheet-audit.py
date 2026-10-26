#!/usr/bin/env python3
"""Read PRIVATE exported Google Sheets XLSX, write JSON only to stdout.

Pipe directly to audit-private-evidence.mjs - (never to Public CI or git).
Python 3 stdlib only; no Google API, network, Sheets mutation or file output.
Failures emit fixed error codes, not source values, report IDs or player names.
"""
import json
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path, PurePosixPath

RAW_NAME = "영웅_DPS지표_V5_P12_1_TEST"
PROOF_NAME = "__WCL35_EVIDENCE_TEST"
G3_NAME = "__WCL43_G3_RANK_SNAPSHOTS"
MAX_FILE = 64 * 1024 * 1024
MAX_UNPACKED = 128 * 1024 * 1024
NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
      "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships"}
REL_NS = "{http://schemas.openxmlformats.org/package/2006/relationships}"
SHEET_NAME = "{%s}name" % NS["m"]
SAFE_CODES = {
    "PRIVATE_XLSX_PATH", "PRIVATE_XLSX_FILE", "PRIVATE_XLSX_SIZE",
    "PRIVATE_XLSX_ARCHIVE", "PRIVATE_XLSX_SCHEMA", "PRIVATE_XLSX_TAB_MISSING",
    "PRIVATE_XLSX_VALUE", "PRIVATE_XLSX_FORMULA", "PRIVATE_XLSX_TOO_LARGE",
    "PRIVATE_PIPE_REQUIRED"
}

class PrivateInputError(Exception):
    pass

def reject(code):
    raise PrivateInputError(code)

def read_member(z, name):
    try:
        item = z.getinfo(name)
        if item.file_size > MAX_UNPACKED:
            reject("PRIVATE_XLSX_TOO_LARGE")
        return z.read(name)
    except KeyError:
        reject("PRIVATE_XLSX_SCHEMA")

def col_index(ref):
    letters = re.match(r"^([A-Z]+)[1-9][0-9]*$", ref or "")
    if not letters:
        reject("PRIVATE_XLSX_SCHEMA")
    number = 0
    for c in letters.group(1):
        number = number * 26 + ord(c) - 64
    return number - 1

def read_strings(z):
    if "xl/sharedStrings.xml" not in z.namelist():
        return []
    root = ET.fromstring(read_member(z, "xl/sharedStrings.xml"))
    return ["".join((t.text or "") for t in si.findall(".//m:t", NS))
            for si in root.findall("m:si", NS)]

def sheet_mapping(z):
    workbook = ET.fromstring(read_member(z, "xl/workbook.xml"))
    rels = ET.fromstring(read_member(z, "xl/_rels/workbook.xml.rels"))
    lookup = {}
    for e in rels:
        target = e.get("Target", "")
        if target.startswith("/"):
            name = target.lstrip("/")
        else:
            name = str(PurePosixPath("xl") / target)
        if ".." in PurePosixPath(name).parts or not name.startswith("xl/"):
            reject("PRIVATE_XLSX_SCHEMA")
        lookup[e.get("Id")] = name
    mapping = {}
    for e in workbook.findall("m:sheets/m:sheet", NS):
        name = e.get("name")
        relation = e.get("{%s}id" % NS["r"])
        if name in (RAW_NAME, PROOF_NAME, G3_NAME):
            if relation not in lookup:
                reject("PRIVATE_XLSX_SCHEMA")
            mapping[name] = lookup[relation]
    if any(n not in mapping for n in (RAW_NAME, PROOF_NAME, G3_NAME)):
        reject("PRIVATE_XLSX_TAB_MISSING")
    return mapping

def read_rows(z, member, strings, start, end, width):
    # Only retain requested 216 rows. Fail closed on unsupported formula cells.
    root = ET.fromstring(read_member(z, member))
    rows = {}
    for row in root.findall("m:sheetData/m:row", NS):
        try:
            num = int(row.get("r", "0"))
        except ValueError:
            reject("PRIVATE_XLSX_SCHEMA")
        if not start <= num <= end:
            continue
        vals = [""] * width
        for cell in row.findall("m:c", NS):
            idx = col_index(cell.get("r"))
            if idx >= width:
                continue
            if cell.find("m:f", NS) is not None:
                reject("PRIVATE_XLSX_FORMULA")
            t = cell.get("t")
            raw = cell.find("m:v", NS)
            if t == "inlineStr":
                val = "".join((x.text or "") for x in cell.findall(".//m:t", NS))
            elif raw is None or raw.text is None:
                val = ""
            elif t == "s":
                try:
                    val = strings[int(raw.text)]
                except (ValueError, IndexError):
                    reject("PRIVATE_XLSX_SCHEMA")
            elif t == "b":
                val = raw.text == "1"
            elif t in ("e",):
                reject("PRIVATE_XLSX_VALUE")
            elif t in ("str", "d"):
                val = raw.text
            else:
                try:
                    n = float(raw.text)
                    if not -1e30 < n < 1e30:
                        reject("PRIVATE_XLSX_VALUE")
                    val = int(n) if n.is_integer() else n
                except ValueError:
                    reject("PRIVATE_XLSX_VALUE")
            vals[idx] = val
        rows[num] = vals
    return rows

def get(rowmap, row, width):
    return rowmap.get(row, [""] * width)

def select_records(raw, proof, g3):
    records = []
    counts = {"sourceRows":216,"proofRowsPresent":0,
              "committedRowsWithProof":0,"missingCommitForProof":0,
              "proofRowsMissing":0}
    for index in range(216):
        pr = get(proof,index + 2,10)
        sr = get(g3,index + 2,32)
        rr = get(raw,index + 4,25)
        if not pr[0]:
            counts["proofRowsMissing"] += 1
            continue
        counts["proofRowsPresent"] += 1
        if sr[0] != "COMMITTED":
            counts["missingCommitForProof"] += 1
            continue
        counts["committedRowsWithProof"] += 1
        n = sr[6]
        if not isinstance(n, int) or n < 1 or n > 24:
            reject("PRIVATE_XLSX_SCHEMA")
        encoded = "".join(str(x) for x in sr[8:8+n])
        try:
            snapshot = json.loads(encoded)
        except (ValueError, TypeError):
            reject("PRIVATE_XLSX_SCHEMA")
        records.append({"snapshot":snapshot,"rawRow":rr,
                        "proofRow":pr,"scopeKey":sr[2],"g3StorageRow":sr})
    return {"records":records, "sourceCounts":counts}

def main():
    if len(sys.argv) != 2 or not Path(sys.argv[1]).is_absolute():
        reject("PRIVATE_XLSX_PATH")
    if sys.stdout.isatty():\n        reject("PRIVATE_PIPE_REQUIRED")\n    file = Path(sys.argv[1])
    if not file.is_file() or file.is_symlink():
        reject("PRIVATE_XLSX_FILE")
    if file.stat().st_size <= 0 or file.stat().st_size > MAX_FILE:
        reject("PRIVATE_XLSX_SIZE")
    try:
        with zipfile.ZipFile(file) as z:
            info = z.infolist()
            if len(info)>3000 or sum(i.file_size for i in info)>MAX_UNPACKED:
                reject("PRIVATE_XLSX_TOO_LARGE")
            mapping = sheet_mapping(z)
            strings = read_strings(z)
            raw = read_rows(z,mapping[RAW_NAME],strings,4,219,25)
            proof = read_rows(z,mapping[PROOF_NAME],strings,2,217,10)
            g3 = read_rows(z,mapping[G3_NAME],strings,2,217,32)
            payload = select_records(raw,proof,g3)
    except (zipfile.BadZipFile, ET.ParseError):
        reject("PRIVATE_XLSX_ARCHIVE")
    sys.stdout.write(json.dumps(payload,ensure_ascii=False,separators=(",",":"))+"\n")

if __name__ == "__main__":
    try:
        main()
    except PrivateInputError as e:
        code = str(e)
        sys.stderr.write((code if code in SAFE_CODES else "PRIVATE_XLSX_SCHEMA")+"\n")
        sys.exit(1)
    except (OSError, ValueError, TypeError):
        sys.stderr.write("PRIVATE_XLSX_SCHEMA\n")
        sys.exit(1)
