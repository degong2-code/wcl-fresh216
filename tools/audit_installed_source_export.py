#!/usr/bin/env python3
"""Offline, READ-ONLY Apps Script export vs historical source fingerprints.

Usage:
  python tools/audit_installed_source_export.py --export /path/to/export.zip
  python tools/audit_installed_source_export.py --export /path/to/clasp-directory

The JSON receipt deliberately contains NO file paths, script IDs, raw source,
actor names, account data or secrets. It CANNOT prove the provided export
matches the live TEST Apps Script installation: independent export provenance
and source-owner confirmation remain necessary.
"""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import stat
import sys
import zipfile

REFERENCE = Path(__file__).resolve().parents[1] / "migration" / "source-manifest.json"
MAX_FILES = 250
MAX_INDIVIDUAL_BYTES = 5 * 1024 * 1024
MAX_TOTAL_BYTES = 20 * 1024 * 1024

def _is_secret_filename(rel):
    bits = [v.lower() for v in PurePosixPath(rel).parts]
    return any(
        name in {".clasp.json", ".clasprc.json", ".env", "credentials.json",
                 "token.json", "service-account.json"}
        or name.startswith(".env.")
        for name in bits
    )

def _safe_members_from_zip(source):
    with zipfile.ZipFile(source) as archive:
        names = set()
        cumulative = 0
        if len(archive.infolist()) > MAX_FILES:
            raise ValueError("EXPORT_FILE_COUNT_LIMIT")
        for entry in archive.infolist():
            if entry.is_dir():
                continue
            parts = PurePosixPath(entry.filename)
            if (parts.is_absolute() or ".." in parts.parts or
                "\\" in entry.filename or "\0" in entry.filename or
                entry.filename in names):
                raise ValueError("EXPORT_UNSAFE_MEMBER_NAME")
            names.add(entry.filename)
            mode = (entry.external_attr >> 16) & 0xFFFF
            if stat.S_ISLNK(mode):
                raise ValueError("EXPORT_SYMLINK_NOT_ALLOWED")
            if _is_secret_filename(entry.filename):
                raise ValueError("EXPORT_HAS_CREDENTIAL_FILE")
            if entry.file_size > MAX_INDIVIDUAL_BYTES:
                raise ValueError("EXPORT_INDIVIDUAL_SIZE_LIMIT")
            cumulative += entry.file_size
            if cumulative > MAX_TOTAL_BYTES:
                raise ValueError("EXPORT_TOTAL_SIZE_LIMIT")
            yield entry.filename, archive.read(entry)

def _safe_members_from_dir(source):
    paths = sorted(p for p in source.rglob("*") if p.is_file() or p.is_symlink())
    if len(paths) > MAX_FILES:
        raise ValueError("EXPORT_FILE_COUNT_LIMIT")
    cumulative = 0
    for p in paths:
        if p.is_symlink():
            raise ValueError("EXPORT_SYMLINK_NOT_ALLOWED")
        relative = p.relative_to(source).as_posix()
        if _is_secret_filename(relative):
            raise ValueError("EXPORT_HAS_CREDENTIAL_FILE")
        length = p.stat().st_size
        if length > MAX_INDIVIDUAL_BYTES:
            raise ValueError("EXPORT_INDIVIDUAL_SIZE_LIMIT")
        cumulative += length
        if cumulative > MAX_TOTAL_BYTES:
            raise ValueError("EXPORT_TOTAL_SIZE_LIMIT")
        yield relative, p.read_bytes()

def audit(source, manifest=REFERENCE):
    manifest_data = json.loads(Path(manifest).read_text(encoding="utf-8"))
    known = manifest_data["source_package_sha256"]
    if not isinstance(known, dict) or not all(
        isinstance(v, str) and len(v) == 64 for v in known.values()
    ):
        raise ValueError("INVALID_HISTORICAL_MANIFEST")
    source = Path(source)
    if not source.exists():
        raise ValueError("EXPORT_NOT_FOUND")
    if source.is_file():
        if not zipfile.is_zipfile(source):
            raise ValueError("EXPORT_REQUIRES_ZIP_OR_DIRECTORY")
        iterator = _safe_members_from_zip(source)
        source_kind = "zip"
    elif source.is_dir():
        iterator = _safe_members_from_dir(source)
        source_kind = "directory"
    else:
        raise ValueError("EXPORT_NOT_SUPPORTED")
    files, scripts, manifest_count = 0, [], 0
    for name, data in iterator:
        files += 1
        suffix = PurePosixPath(name).suffix.lower()
        if PurePosixPath(name).name == "appsscript.json":
            manifest_count += 1
            try:
                obj = json.loads(data.decode("utf-8"))
            except (UnicodeDecodeError, ValueError):
                raise ValueError("APPS_SCRIPT_MANIFEST_INVALID") from None
            if not isinstance(obj, dict):
                raise ValueError("APPS_SCRIPT_MANIFEST_INVALID")
        if suffix in {".gs", ".js"}:
            scripts.append(hashlib.sha256(data).hexdigest())
    if manifest_count != 1:
        raise ValueError("APPS_SCRIPT_MANIFEST_MISSING_OR_DUPLICATE")
    if not scripts:
        raise ValueError("EXPORT_SCRIPT_SOURCE_MISSING")
    observed = set(scripts)
    matches = {key: ref in observed for key, ref in sorted(known.items())}
    return {
        "receipt_type": "READ_ONLY_SOURCE_FINGERPRINT_AUDIT",
        "export_kind": source_kind,
        "files_examined": files,
        "script_modules": len(scripts),
        "unique_source_hashes": len(observed),
        "historical_sha256_matches": matches,
        "historical_exact_match_count": sum(matches.values()),
        "historical_reference_count": len(matches),
        "historical_full_match": all(matches.values()),
        "installed_source_verified": False,
        "production_ready": False,
        "legacy_tests_executed": False,
        "wcl_graphql_requests": 0,
        "google_sheets_writes": 0,
        "private_paths_or_source_emitted": False,
        "note": "Fingerprint comparison only; independent confirmation of installed TEST source required."
    }

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--export",required=True,help="clasp source folder or exported ZIP")
    parser.add_argument("--manifest",default=str(REFERENCE),
                        help="local historical reference manifest")
    args = parser.parse_args()
    try:
        result = audit(args.export,args.manifest)
        print(json.dumps(result,sort_keys=True,ensure_ascii=False))
        return 0
    except (ValueError,PermissionError,OSError,KeyError,zipfile.BadZipFile,
            zipfile.LargeZipFile) as err:
        # Only explicit error CODES may leave the script, never OS errors
        # that might embed private paths.
        code = str(err)
        if not code.startswith(("EXPORT_","APPS_SCRIPT_","INVALID_HISTORICAL_")):
            code = "EXPORT_AUDIT_FAILED"
        print(json.dumps({"status":"BLOCKED","reason":code,
                          "installed_source_verified":False,
                          "wcl_graphql_requests":0,
                          "google_sheets_writes":0}),file=sys.stdout)
        return 2

if __name__ == "__main__":
    raise SystemExit(main())
