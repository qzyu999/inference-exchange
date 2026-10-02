"""Every relative .md link in tracked docs (outside archive/) points to a file that exists."""

import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DOCS = ROOT / "docs"
LINK = re.compile(r"\]\(([^)\s]+)\)")


def _tracked_docs() -> list[Path]:
    out = subprocess.run(["git", "ls-files", "docs"], cwd=ROOT, capture_output=True, text=True, check=True).stdout
    return [ROOT / p for p in out.splitlines() if p.endswith(".md")]


def test_relative_doc_links_resolve():
    broken = []
    for md in _tracked_docs():
        if "archive" in md.parts or "figma-screens" in md.parts or not md.exists():
            continue
        for href in LINK.findall(md.read_text(encoding="utf-8")):
            if re.match(r"^[a-z]+:", href) or href.startswith(("#", "/")):
                continue
            target = href.split("#")[0]
            if target and not (md.parent / target).resolve().exists():
                broken.append(f"{md.relative_to(DOCS)} -> {href}")
    assert not broken, "Broken doc links:\n" + "\n".join(broken)
