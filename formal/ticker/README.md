# Snapshot publication and synchronization model

Run TLC 1.8.0 with Java 17 or newer:

```
java -cp /path/to/tla2tools.jar tlc2.TLC -workers 2 Snapshot.tla
```

Use the adjacent Snapshot.cfg. CI pins the release and SHA-256 digest.

Stage/Finish/Publish model an unpublished work product and one atomic Git commit.
Download may return any older generation. Validate stands for digest and full
schema validation of that immutable payload. Persist is successful atomic disk
replacement. Install exposes only persisted data. Crash reloads the disk image.
Failure leaves state unchanged. The high-water mark records the greatest durable
generation ever installed. NoRollback checks the disk against that mark.

Invariants: TypeOK, PublishedComplete, CacheComplete, DiskComplete, NoRollback,
and DurableBeforeVisible. The finite bound is three generations. There is no
fairness assumption and no liveness claim. A successful run does not verify real
network responses, prices, permissions, Python code, or hardware durability.

Refinement tests are in tests/test_ticker_catalog.py. A useful negative control
removes the downloaded > disk guard from Persist. TLC must find a rollback.
Run this mutation in a temporary directory; do not change the checked-in model.
