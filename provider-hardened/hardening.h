#ifndef OCIP_HARDENING_H
#define OCIP_HARDENING_H

/**
 * Apply OCIP security hardening to the current process.
 * Must be called as the FIRST thing in main(), before loading models.
 *
 * Returns 0 on success, -1 on failure (process should exit).
 *
 * On macOS: applies PT_DENY_ATTACH, disables core dumps, verifies SIP.
 * On other platforms: no-op (returns 0).
 */
int ocip_harden(void);

#endif /* OCIP_HARDENING_H */
