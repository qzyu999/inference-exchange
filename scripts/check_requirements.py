"""Check that docs/requirements/*.md agree with the test suite.

Rules:
- Each requirement ID is unique.
- Status is one of: implemented, partial, not-implemented, withdrawn.
- implemented: "Verified by" lists at least one test, and each test exists.
- partial / not-implemented: "Issue" is set.
- Any test listed in "Verified by" must exist, whatever the status.

Run: python scripts/check_requirements.py
"""

import ast
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REQ_DIR = ROOT / "docs" / "requirements"
STATUSES = {"implemented", "partial", "not-implemented", "withdrawn"}
HEADING = re.compile(r"^### ([A-Z]+-\d{3}): (.+)$")
FIELD = re.compile(r"^- (Status|Verified by|Issue|Principle): (.+)$")


def parse(path: Path) -> list[dict]:
    reqs, cur = [], None
    for lineno, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if m := HEADING.match(line):
            cur = {"id": m.group(1), "file": path.name, "line": lineno}
            reqs.append(cur)
        elif cur and (m := FIELD.match(line)):
            cur[m.group(1)] = m.group(2).strip()
    return reqs


def test_names(test_file: Path) -> set[str]:
    """All test identifiers in a file, as 'func', 'Class', and 'Class::method'."""
    tree = ast.parse(test_file.read_text(encoding="utf-8"))
    names = set()
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            names.add(node.name)
        elif isinstance(node, ast.ClassDef):
            names.add(node.name)
            for item in node.body:
                if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    names.add(f"{node.name}::{item.name}")
    return names


def check() -> list[str]:
    errors, seen, cache = [], {}, {}
    reqs = [r for f in sorted(REQ_DIR.glob("*.md")) if f.name != "README.md" for r in parse(f)]
    for r in reqs:
        where = f"{r['file']}:{r['line']} {r['id']}"
        if r["id"] in seen:
            errors.append(f"{where}: duplicate ID (first at {seen[r['id']]})")
        seen[r["id"]] = where

        status = r.get("Status", "")
        if status not in STATUSES:
            errors.append(f"{where}: bad or missing Status '{status}'")
            continue

        tests = [t.strip() for t in r.get("Verified by", "").split(",") if t.strip() and t.strip() != "none"]
        if status == "implemented" and not tests:
            errors.append(f"{where}: implemented but no test in 'Verified by'")
        if status in ("partial", "not-implemented") and not r.get("Issue"):
            errors.append(f"{where}: {status} needs an 'Issue'")

        for ref in tests:
            file_part, _, name = ref.partition("::")
            path = ROOT / file_part
            if not path.is_file():
                errors.append(f"{where}: test file not found: {file_part}")
                continue
            if name:
                names = cache.setdefault(path, test_names(path))
                if name not in names:
                    errors.append(f"{where}: test not found: {ref}")
    print(f"Checked {len(reqs)} requirements in {REQ_DIR.relative_to(ROOT)}")
    return errors


if __name__ == "__main__":
    problems = check()
    for p in problems:
        print(f"ERROR {p}")
    sys.exit(1 if problems else 0)
