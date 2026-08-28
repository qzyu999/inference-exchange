/**
 * OCIP Hardening Module
 *
 * Call ocip_harden() at the very start of main(), before loading any model
 * or processing any data. This applies kernel-level protections that prevent
 * the machine operator from observing process memory.
 *
 * Protections applied:
 * 1. PT_DENY_ATTACH — permanently blocks ptrace (debuggers) for this process
 * 2. RLIMIT_CORE = 0 — prevents core dumps containing memory
 * 3. SIP verification — refuses to run if System Integrity Protection is off
 *
 * After calling this:
 * - lldb/dtrace/Instruments cannot attach
 * - task_for_pid() from other processes is denied (Hardened Runtime)
 * - No memory can be read externally without a kernel exploit
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <errno.h>
#include <sys/types.h>
#include <sys/ptrace.h>
#include <sys/resource.h>

#ifdef __APPLE__

static int check_sip_enabled(void) {
    FILE *fp = popen("/usr/bin/csrutil status 2>&1", "r");
    if (!fp) return 0;

    char buf[256];
    int enabled = 0;

    while (fgets(buf, sizeof(buf), fp)) {
        if (strstr(buf, "enabled")) {
            enabled = 1;
            break;
        }
    }
    pclose(fp);
    return enabled;
}

int ocip_harden(void) {
    fprintf(stderr, "[OCIP] Applying security hardening...\n");

    /* 1. Block debugger attachment (permanent for process lifetime) */
    if (ptrace(PT_DENY_ATTACH, 0, NULL, 0) == -1) {
        if (errno != EPERM) {
            /* EPERM means already set — that's fine */
            fprintf(stderr, "[OCIP] ERROR: ptrace(PT_DENY_ATTACH) failed: %s\n", strerror(errno));
            return -1;
        }
    }
    fprintf(stderr, "[OCIP] ✓ Debugger attachment blocked (PT_DENY_ATTACH)\n");

    /* 2. Disable core dumps */
    struct rlimit rl = {0, 0};
    if (setrlimit(RLIMIT_CORE, &rl) == -1) {
        fprintf(stderr, "[OCIP] WARNING: Could not disable core dumps: %s\n", strerror(errno));
        /* Non-fatal — continue anyway */
    } else {
        fprintf(stderr, "[OCIP] ✓ Core dumps disabled\n");
    }

    /* 3. Verify SIP is enabled */
    if (!check_sip_enabled()) {
        fprintf(stderr, "[OCIP] ERROR: System Integrity Protection is NOT enabled.\n");
        fprintf(stderr, "[OCIP] Refusing to run. Enable SIP in Recovery Mode.\n");
        return -1;
    }
    fprintf(stderr, "[OCIP] ✓ SIP verified enabled\n");

    fprintf(stderr, "[OCIP] Hardening complete. Process is protected.\n");
    return 0;
}

#else
/* Non-macOS: no-op (hardening is platform-specific) */
int ocip_harden(void) {
    fprintf(stderr, "[OCIP] WARNING: Hardening not available on this platform\n");
    return 0;
}
#endif
