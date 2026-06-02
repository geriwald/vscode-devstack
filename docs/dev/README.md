# Dev configs

VS Code's `.vscode/` is gitignored, so the debug launch configs live here as
templates. Copy them into your local `.vscode/`:

```bash
cp docs/dev/launch.json.example .vscode/launch.json
cp docs/dev/tasks.json.example  .vscode/tasks.json
```

## Debug terminal capture

The **Run Extension (DEBUG terminal capture)** launch config:

- enables the proposed `onDidWriteTerminalData` API
  (`--enable-proposed-api=geriwald.devstack`),
- opens `fixtures/python-venv/` as the workspace,
- sets `DEVSTACK_DEBUG=1`.

With it, the **DevStack Debug** output channel dumps every byte written to a
spawned terminal, timestamped from terminal creation — revealing exactly what
the Python extension injects (text? `Ctrl+C`?) and when, relative to our command.

See `docs/specs/2026-05-31-venv-startup-delay-design.md`.
