"""Synthetic-only tests for private Google Sheets XLSX extraction without cloud access."""
import importlib.util
import io
import json
import os
import subprocess
import tempfile
import unittest
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
EXTRACTOR = ROOT / "tools" / "private-sheet-audit.py"
N = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
P = "http://schemas.openxmlformats.org/package/2006/relationships"

def column(index):
    s = ""
    while index:
        index, r = divmod(index - 1, 26)
        s = chr(65 + r) + s
    return s

def make_xml(rows, formula=False):
    sheet = ET.Element("{%s}worksheet" % N)
    data = ET.SubElement(sheet, "{%s}sheetData" % N)
    for row_idx, vals in rows.items():
        row = ET.SubElement(data, "{%s}row" % N, {"r":str(row_idx)})
        for j, val in enumerate(vals, 1):
            if val in ("", None):
                continue
            ref = column(j) + str(row_idx)
            if formula and j == 1:
                cell = ET.SubElement(row, "{%s}c" % N, {"r":ref})
                ET.SubElement(cell, "{%s}f" % N).text = "1+1"
            elif isinstance(val, (float, int)) and not isinstance(val, bool):
                cell = ET.SubElement(row, "{%s}c" % N, {"r":ref})
                ET.SubElement(cell, "{%s}v" % N).text = str(val)
            else:
                cell = ET.SubElement(row, "{%s}c" % N, {"r":ref,"t":"inlineStr"})
                is_ = ET.SubElement(cell, "{%s}is" % N)
                ET.SubElement(is_, "{%s}t" % N).text = str(val)
    return ET.tostring(sheet, encoding="utf-8", xml_declaration=True)

def sample_xlsx(file, status="COMMITTED", formula=False, missing_sheet=False):
    names = [
        "영웅_DPS지표_V5_P12_1_TEST",
        "__WCL35_EVIDENCE_TEST",
        "__WCL43_G3_RANK_SNAPSHOTS"
    ]
    scope = "12.1|1|2026-10-08|2026-10-12|4"
    snap = {"version":1, "scope":scope,"runId":"RUN_TEST_1234",
            "key":"PRIVATE|PLAYER|JOB","rawRowNumber":4}
    g3 = [status,snap["runId"],scope,snap["key"],4,"F"*64,
          1,""] + [json.dumps(snap)] + [""]*23
    proof = [snap["key"],scope,"0"*64,"0"*64,
             "[null]","[]","PARTIAL",0,100,""]
    raw = ["PRIVATE","PLAYER","JOB"] + [""]*22
    content = [{4:raw},{2:proof},{2:g3}]
    if missing_sheet:
        names.pop()
        content.pop()
    wb = ET.Element("{%s}workbook" % N)
    sheets = ET.SubElement(wb, "{%s}sheets" % N)
    rels = ET.Element("{%s}Relationships" % P)
    for i, name in enumerate(names,1):
        ET.SubElement(sheets,"{%s}sheet" % N,
                      {"name":name,"sheetId":str(i),"{%s}id" % R:"rId"+str(i)})
        ET.SubElement(rels,"{%s}Relationship" % P,
                      {"Id":"rId"+str(i),
                       "Type":"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet",
                       "Target":"worksheets/sheet%d.xml" % i})
    with zipfile.ZipFile(file,"w",compression=zipfile.ZIP_DEFLATED) as z:
        z.writestr("xl/workbook.xml",ET.tostring(wb))
        z.writestr("xl/_rels/workbook.xml.rels",ET.tostring(rels))
        for i, rows in enumerate(content,1):
            z.writestr("xl/worksheets/sheet%d.xml"%i,
                       make_xml(rows,formula=(formula and i==1)))

def run_extract(file):
    return subprocess.run(["python3",str(EXTRACTOR),str(file)],
                          capture_output=True,text=True,check=False)

class PrivateSheetTest(unittest.TestCase):
    def test_committed_entry_is_read_without_identity_in_logs(self):
        with tempfile.TemporaryDirectory() as tmp:
            f=Path(tmp)/"private.xlsx"
            sample_xlsx(f)
            x=run_extract(f)
            self.assertEqual(x.returncode,0, x.stderr)
            obj=json.loads(x.stdout)
            self.assertEqual(len(obj["records"]),1)
            self.assertEqual(obj["records"][0]["g3StorageRow"][0],"COMMITTED")
            self.assertEqual(obj["records"][0]["snapshot"]["runId"],"RUN_TEST_1234")
            self.assertEqual(obj["sourceCounts"]["proofRowsPresent"],1)
            self.assertEqual(obj["sourceCounts"]["proofRowsMissing"],215)
            self.assertNotIn("PRIVATE",x.stderr)
            self.assertEqual(list(Path(tmp).iterdir()),[f])

    def test_uncommitted_proof_is_explicitly_counted_and_not_exported(self):
        with tempfile.TemporaryDirectory() as tmp:
            f=Path(tmp)/"private.xlsx"
            sample_xlsx(f,status="STAGED")
            x=run_extract(f)
            self.assertEqual(x.returncode,0,x.stderr)
            obj=json.loads(x.stdout)
            self.assertEqual(obj["records"],[])
            self.assertEqual(obj["sourceCounts"]["missingCommitForProof"],1)
            audit=subprocess.run(["node",str(ROOT/"tools"/"audit-private-evidence.mjs"),"-"],
                  input=x.stdout,text=True,capture_output=True,check=False)
            self.assertEqual(audit.returncode,1)
            summary=json.loads(audit.stdout)
            self.assertEqual(summary["status"],"REQUIRES_REVIEW")
            self.assertNotIn("PRIVATE",audit.stdout+audit.stderr)

    def test_formula_cell_is_rejected_without_value_echo(self):
        with tempfile.TemporaryDirectory() as tmp:
            f=Path(tmp)/"private.xlsx"
            sample_xlsx(f,formula=True)
            x=run_extract(f)
            self.assertNotEqual(x.returncode,0)
            self.assertEqual(x.stderr.strip(),"PRIVATE_XLSX_FORMULA")
            self.assertEqual(x.stdout,"")

    def test_missing_hidden_sheet_is_not_silently_ignored(self):
        with tempfile.TemporaryDirectory() as tmp:
            f=Path(tmp)/"private.xlsx"
            sample_xlsx(f,missing_sheet=True)
            x=run_extract(f)
            self.assertNotEqual(x.returncode,0)
            self.assertEqual(x.stderr.strip(),"PRIVATE_XLSX_TAB_MISSING")

if __name__=="__main__":
    unittest.main()
