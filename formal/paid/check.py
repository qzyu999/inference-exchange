"""Model-check PaidPath.tla and its negative controls with TLC.

Usage: python formal/paid/check.py /path/to/tla2tools.jar

The base model must pass with each interrupted-stream policy. Each mutation
removes one guard from a disposable copy and TLC must report the named
property as violated. A mutation that passes means the property is vacuous.
"""

import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
SPEC = (HERE / "PaidPath.tla").read_text()
CFG = (HERE / "PaidPath.cfg").read_text()

POLICY = "BillInterrupted == FALSE"

# (name, text to replace, replacement, property TLC must report)
UNCERTAIN = "  /\\ uncertain' = uncertain \\cup Owed(r)\n"
SEND = ("  /\\ IF procState = \"none\"\n"
        "     THEN /\\ procState' = IF ok THEN \"succeeded\" ELSE \"failed\"\n"
        "          /\\ procMoved' = IF ok THEN 1 ELSE 0\n")
SEND_NO_KEY = ("  /\\ IF TRUE\n"
               "     THEN /\\ procState' = IF ok THEN \"succeeded\" ELSE \"failed\"\n"
               "          /\\ procMoved' = procMoved + (IF ok THEN 1 ELSE 0)\n")
RESTART_KEEP = "  /\\ local' = \"offline\"\n  /\\ UNCHANGED <<proc, audit, wallet, sent, books>>"
RESTART_LOSE = ("  /\\ local' = \"offline\"\n  /\\ outbox' = \"none\"\n"
                "  /\\ UNCHANGED <<procState, procMoved, audit, wallet, sent, books>>")
MUTATIONS = [
    ("processor call without idempotency key", SEND, SEND_NO_KEY, "RefundExactlyOnce"),
    ("processor called before the intent is durable",
     "SendRefund(ok) ==\n  /\\ outbox = \"queued\"", "SendRefund(ok) ==\n  /\\ outbox # \"done\"",
     "ProcessorEffectHasIntent"),
    ("outbox kept in memory", RESTART_KEEP, RESTART_LOSE, "RefundResolves"),
    ("hosted fallback without consent",
     "  /\\ (rt = \"hosted\" => r \\in HostedConsent)\n", "",
     "NoHostedWithoutConsent"),
    ("dispatch to a paused node",
     "  /\\ (req[r].route = \"local\" => local = \"available\")\n", "",
     "PausedIdle"),
    ("pause without drain",
     "IF slots[\"local\"] = 0 THEN \"paused\" ELSE \"draining\"", "\"paused\"",
     "PausedIdle"),
    ("hosted charge credits a provider",
     "IF req[r].route = \"local\" THEN charge - Fee(charge) ELSE 0",
     "charge - Fee(charge)",
     "EarningsOnlyFromLocal"),
    ("hosted failure leaves no reconciliation item",
     "IF req[r].route = \"hosted\" THEN {<<r, req[r].attempt>>} ELSE {}", "{}",
     "HostedCostTracked"),
    ("reserve without funds check",
     "  /\\ Available >= HoldOf[rt]\n", "",
     "NoOverspend"),
    ("resize without funds check",
     "     IN /\\ sf + pf >= HoldOf[rt]\n        /\\ req'", "     IN /\\ req'",
     "NoOverspend"),
    ("refund draws on sponsored credit",
     "  /\\ PaidFree >= RefundAmount", "  /\\ Available >= RefundAmount",
     "NoOverspend"),
    ("stale attempt accepted",
     "  /\\ req[r].attempt = a\n  /\\ <<r, a, from>>", "  /\\ <<r, a, from>>",
     "OnlyActiveAttemptSettles"),
    ("frame from a foreign provider accepted",
     "  /\\ <<r, a, from>> \\in sent\n", "  /\\ \\E x \\in Routes : <<r, a, x>> \\in sent\n",
     "OnlyActiveAttemptSettles"),
    ("duplicate completion settles again",
     "  /\\ req[r].phase \\in Upstream\n  /\\ req[r].attempt = a",
     "  /\\ req[r].phase \\in Upstream \\cup {\"charged\"}\n  /\\ req[r].attempt = a",
     "TerminalStable"),
    ("reported usage not capped by the hold",
     "         charge == Min(billable, hold)", "         charge == billable",
     "ChargeWithinAuthorization"),
    ("failure keeps the slot",
     UNCERTAIN + "  /\\ slots' = [slots EXCEPT ![req[r].route] = @ - 1]\n",
     UNCERTAIN + "  /\\ UNCHANGED slots\n",
     "SlotsExact"),
    ("dispatch ignores capacity",
     "  /\\ slots[req[r].route] < CapOf[req[r].route]\n", "",
     "SlotsWithinCap"),
    ("no reconciliation worker",
     "  /\\ \\A k \\in Keys : WF_vars(Reconcile(k))\n", "",
     "UncertainResolved"),
    ("no request deadline",
     "  /\\ \\A r \\in Requests : WF_vars(Expire(r))\n", "",
     "RequestsFinish"),
]


TEMPORAL = {"TerminalStable", "RequestsFinish", "UncertainResolved", "RefundResolves"}


def only(prop: str) -> str:
    """A config that checks one property, so a violation is attributable."""
    kind = "PROPERTIES" if prop in TEMPORAL else "INVARIANTS"
    head = "\n".join(line for line in CFG.splitlines()
                     if not line.startswith(("INVARIANTS", "PROPERTIES")))
    return f"{head}\n{kind} {prop}\n"


def run_tlc(jar: str, spec: str, workdir: Path, cfg: str = CFG) -> str:
    (workdir / "PaidPath.tla").write_text(spec)
    (workdir / "PaidPath.cfg").write_text(cfg)
    proc = subprocess.run(
        ["java", "-XX:+UseParallelGC", "-cp", jar, "tlc2.TLC", "-workers", "auto",
         "-metadir", str(workdir / "states"), "PaidPath.tla"],
        cwd=workdir, capture_output=True, text=True,
    )
    return proc.stdout + proc.stderr


def violated(output: str, prop: str) -> bool:
    pattern = rf"(?:Invariant|Action property|Temporal property) {prop} (?:is|was) violated"
    if re.search(pattern, output):
        return True
    # Some TLC paths do not name the property; the config checks only one.
    return prop in TEMPORAL and "Temporal properties were violated" in output


def main() -> int:
    jar = str(Path(sys.argv[1]).resolve())
    failures = 0
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        for policy in ("FALSE", "TRUE"):
            out = run_tlc(jar, SPEC.replace(POLICY, f"BillInterrupted == {policy}"), work)
            ok = "Model checking completed. No error has been found." in out
            states = re.findall(r"^(\d+) states generated, (\d+) distinct states found", out, re.M)
            print(f"{'PASS' if ok else 'FAIL'} base model, BillInterrupted={policy}, "
                  f"{states[-1][1] if states else '?'} distinct states")
            if not ok:
                print(out[-3000:])
                failures += 1
            shutil.rmtree(work / "states", ignore_errors=True)

        for name, old, new, expected in MUTATIONS:
            if SPEC.count(old) != 1:
                print(f"FAIL {name}: guard text not found exactly once")
                failures += 1
                continue
            out = run_tlc(jar, SPEC.replace(old, new), work, only(expected))
            ok = violated(out, expected)
            print(f"{'PASS' if ok else 'FAIL'} control '{name}': TLC "
                  f"{'found' if ok else 'did not find'} a {expected} counterexample")
            if not ok:
                print(out[-3000:])
                failures += 1
            shutil.rmtree(work / "states", ignore_errors=True)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
