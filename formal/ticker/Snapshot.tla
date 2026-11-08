----------------------------- MODULE Snapshot -----------------------------
EXTENDS Naturals, FiniteSets
CONSTANT MaxGeneration
VARIABLES staged, complete, published, downloaded, validated, disk, cache, highWater
vars == <<staged, complete, published, downloaded, validated, disk, cache, highWater>>
Init == /\ staged = 0 /\ complete = {} /\ published = 0
        /\ downloaded = 0 /\ validated = FALSE /\ disk = 0 /\ cache = 0 /\ highWater = 0
Stage == /\ staged < MaxGeneration /\ staged' = staged + 1
         /\ UNCHANGED <<complete, published, downloaded, validated, disk, cache, highWater>>
Finish == /\ staged > 0 /\ complete' = complete \cup {staged}
          /\ UNCHANGED <<staged, published, downloaded, validated, disk, cache, highWater>>
Publish == /\ staged \in complete /\ staged > published /\ published' = staged
           /\ UNCHANGED <<staged, complete, downloaded, validated, disk, cache, highWater>>
Download == /\ downloaded' \in 0..published /\ validated' = FALSE
            /\ UNCHANGED <<staged, complete, published, disk, cache, highWater>>
Validate == /\ downloaded \in complete /\ downloaded <= published
            /\ validated' = TRUE
            /\ UNCHANGED <<staged, complete, published, downloaded, disk, cache, highWater>>
Persist == /\ validated /\ downloaded > disk /\ disk' = downloaded
           /\ highWater' = IF downloaded > highWater THEN downloaded ELSE highWater
           /\ UNCHANGED <<staged, complete, published, downloaded, validated, cache>>
Install == /\ cache' = disk
           /\ UNCHANGED <<staged, complete, published, downloaded, validated, disk, highWater>>
Crash == /\ downloaded' = 0 /\ validated' = FALSE /\ cache' = disk
         /\ UNCHANGED <<staged, complete, published, disk, highWater>>
Failure == UNCHANGED vars
Next == Stage \/ Finish \/ Publish \/ Download \/ Validate \/ Persist \/ Install \/ Crash \/ Failure
Spec == Init /\ [][Next]_vars
TypeOK == /\ staged \in 0..MaxGeneration /\ complete \subseteq 1..MaxGeneration
          /\ published \in 0..MaxGeneration /\ downloaded \in 0..MaxGeneration
          /\ disk \in 0..MaxGeneration /\ cache \in 0..MaxGeneration
          /\ validated \in BOOLEAN
PublishedComplete == published = 0 \/ published \in complete
CacheComplete == cache = 0 \/ cache \in complete
DiskComplete == disk = 0 \/ disk \in complete
NoRollback == disk = highWater
DurableBeforeVisible == cache <= disk
=============================================================================
