# Web debug console

## Implemented restricted console

Settings includes an explicitly enabled, five-minute debug mode. The same authenticated HTTPS and origin restrictions apply as other appliance API calls. It sends commands to a separate `oxidal-debug` service account; the web daemon and root network helper never execute command text.

- The UI shows execution identity and working directory. Each command starts a fresh non-interactive `/bin/sh` with a clean environment, null stdin and no persistent shell history. Do not put credentials in commands: their output is intentionally visible to the authenticated owner.
- One command runs at a time, with a 2 KiB command limit, 8 KiB combined stdout/stderr limit and 30-second deadline. Output streams through bounded buffers and status polling. Cancel targets an exact job identifier; accepted commands are never replayed automatically.
- Closing the browser leaves the accepted command running until completion/deadline. The daemon retains the latest result in memory for reconnect. Disabling debug mode cancels a running job. Mode and output do not persist across daemon restart.
- The runner kills the shell process group and reaps its direct child. After delivery of the terminal result, or a two-second terminal-result timeout, the executor exits; systemd cleans its entire control group before restarting it. This also contains descendants which create a new session. The final result remains in daemon memory.
- The service refuses root, requires its dedicated account and checks Unix peer identity. Its unit has no capabilities, no privilege escalation, read-only system/home protection, private temporary/device namespaces, a 32-task ceiling, 128 MiB memory limit and 20% CPU quota. Scratch working files disappear when the service recycles. Commands cannot alter network settings or install packages; those still require authorized administration.

The existing Rust suite tests output/exit status, output floods, timeout and cancellation. HTTP tests cover disabled/unavailable behavior, strict request parsing and foreign-origin rejection. Playwright covers enable/run/reconnect/cancel and command-storage avoidance. The assembled-image boot suite additionally verifies real service identity and cancellation of a descendant outside the shell process group. A disposable non-systemd container cannot establish the last guarantee on its own.

## Planned full terminal — not implemented

The next prototype revision is intended to provide an interactive web terminal with unprivileged and regular administrator shell options. The regular-shell planning interpretation includes explicit `sudo` through an administrator identity; the current runner cannot do this. The daemon and privileged network helper must remain separate from terminal execution.

- Remove the 30-second runtime deadline and 8 KiB total-output cutoff. Stream without terminating commands at a total-output threshold; keep bounded transport/backpressure and a browser scrollback window to avoid unlimited memory growth.
- Support PTY input, interactive prompts, Ctrl-C, resize and persistent working directory/environment within a session. Define reconnect, explicit close and idle behavior; the current five-minute debug expiry must not silently terminate an active terminal.
- Review the current service recycling and CPU/memory/task quotas for the interactive lifecycle. Removing deadline/output constants alone does not deliver an interactive shell.
- Preserve authenticated access, visible execution identity, no automatic command replay, explicit cleanup and no persisted secrets/history by default.
- Extend existing regression suites for commands longer than 30 seconds, more than 8 KiB output, interactive input, resize, persistent state, reconnect, privilege boundaries and descendant cleanup; qualify the rebuilt image before handoff.

These are requested changes, not available features. The existing image and the implemented behavior above remain unchanged until implementation and qualification are complete.
