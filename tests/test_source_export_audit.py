"""Synthetic-only tests for the READ-ONLY Apps Script export source auditor."""
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

SRC = Path(__file__).resolve().parents[1] / "tools" / "audit_installed_source_export.py"
spec = importlib.util.spec_from_file_location("audit_installed_source_export", SRC)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ReadOnlySourceAuditTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.a = b"function mockParent(){return 1;}"
        self.b = b"function mockG413(){return 2;}"
        self.manifest = self.root / "historical-manifest.json"
        self.manifest.write_text(json.dumps({
            "source_package_sha256": {
                "G413_parent": hashlib.sha256(self.a).hexdigest(),
                "G413_core": hashlib.sha256(self.b).hexdigest(),
                "G415": "f" * 64,
                "G425_gated": "e" * 64
            }
        }), encoding="utf-8")

    def _zip(self, filename="export.zip", extra=None):
        path = self.root / filename
        with zipfile.ZipFile(path,"w") as z:
            z.writestr("project/appsscript.json", '{"timeZone":"Etc/UTC"}')
            z.writestr("project/Code.gs", self.a)
            z.writestr("project/Other.gs", self.b)
            for n,v in extra or []:
                z.writestr(n,v)
        return path

    def test_historical_match_receipt_is_only_aggregates_never_installed_parity(self):
        path=self._zip(extra=[("project/More.gs",b"source not in history")])
        r=module.audit(path,self.manifest)
        self.assertEqual(r["historical_exact_match_count"],2)
        self.assertEqual(r["historical_reference_count"],4)
        self.assertEqual(r["script_modules"],3)
        self.assertFalse(r["historical_full_match"])
        self.assertFalse(r["installed_source_verified"])
        self.assertFalse(r["production_ready"])
        self.assertEqual(r["wcl_graphql_requests"],0)
        self.assertEqual(r["google_sheets_writes"],0)
        for text in [str(self.root),"function mockParent","project/Code.gs"]:
            self.assertNotIn(text,json.dumps(r))

    def test_directory_and_zip_source_hashes_are_equivalent(self):
        z=self._zip()
        folder=self.root/"project-dir"
        folder.mkdir()
        (folder/"appsscript.json").write_text("{}",encoding="utf-8")
        (folder/"A.gs").write_bytes(self.a)
        (folder/"B.js").write_bytes(self.b)
        a=module.audit(z,self.manifest)
        b=module.audit(folder,self.manifest)
        self.assertEqual(a["historical_sha256_matches"],b["historical_sha256_matches"])
        self.assertEqual(a["historical_exact_match_count"],b["historical_exact_match_count"])

    def test_reject_secret_filename_without_logging_path_or_data(self):
        for name in [".clasp.json","project/.clasprc.json",
                     "project/.env","project/config/token.json"]:
            with self.subTest(name=name):
                z=self._zip(filename="secret-test.zip",
                            extra=[(name,b"SECRET_VALUE")])
                with self.assertRaisesRegex(ValueError,"EXPORT_HAS_CREDENTIAL_FILE"):
                    module.audit(z,self.manifest)

    def test_manifest_missing_or_invalid_is_rejected(self):
        for extra in [[],[("project/alternate.txt",b"test")]]:
            with self.subTest(extra=bool(extra)):
                zip_path=self.root/"bad.zip"
                with zipfile.ZipFile(zip_path,"w") as z:
                    z.writestr("Code.gs",self.a)
                    for name,data in extra:z.writestr(name,data)
                with self.assertRaisesRegex(ValueError,
                        "APPS_SCRIPT_MANIFEST_MISSING_OR_DUPLICATE"):
                    module.audit(zip_path,self.manifest)
        self._zip(extra=[("project/appsscript.json",b"{}")])
        with self.assertRaisesRegex(ValueError,"EXPORT_UNSAFE_MEMBER_NAME"):
            module.audit(self.root/"export.zip",self.manifest)

    def test_prevent_zip_path_traversal_and_oversized_modules(self):
        zip_path=self._zip(extra=[("../sensitive.txt",b"SECRET")])
        with self.assertRaisesRegex(ValueError,"EXPORT_UNSAFE_MEMBER_NAME"):
            module.audit(zip_path,self.manifest)
        zip_path=self._zip(filename="huge.zip",
                           extra=[("project/heavy.gs",b"x"*(module.MAX_INDIVIDUAL_BYTES+1))])
        with self.assertRaisesRegex(ValueError,"EXPORT_INDIVIDUAL_SIZE_LIMIT"):
            module.audit(zip_path,self.manifest)

    def test_unexpected_export_format_never_claims_installation(self):
        text=self.root/"export-source.gs"
        text.write_bytes(self.a)
        with self.assertRaisesRegex(ValueError,"EXPORT_REQUIRES_ZIP_OR_DIRECTORY"):
            module.audit(text,self.manifest)


if __name__=="__main__":
    unittest.main()
