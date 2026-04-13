# DevStack

Auto-detect your project's tech stack and launch dev services from the VS Code activity bar.

![DevStack screenshot](resources/screenshot.png)

## Features

- **Auto-detection** of Next.js, Nuxt, Remix, Astro, Vite, Angular, Go, FastAPI, Django, Flask, Rust, Docker Compose, Makefile, and npm scripts
- **Activity bar panel** with services grouped by role: Frontend, Backend, Database, Infrastructure, Full Stack
- **Inline play/stop buttons** on each service
- **Status indicators**: running (green check) / stopped (empty circle)
- **Managed terminals** — each service runs in a labelled VS Code terminal
- **Config override** via `.devstack.json` at workspace root

## Usage

Open a project. Click the DevStack icon in the activity bar. Click play on any detected service.

### Custom services (optional)

Create `.devstack.json` at the workspace root (or use the gear icon in the DevStack panel):

```json
{
  "services": [
    {
      "name": "My Custom API",
      "role": "backend",
      "command": "./scripts/start-api.sh",
      "cwd": "backend"
    }
  ],
  "disable": ["npm run dev"]
}
```

Valid roles: `frontend`, `backend`, `database`, `infra`, `fullstack`, `other`.

This repo dogfoods its own config: see [.devstack.json](.devstack.json) for a real example — a one-click "Reload Extension" service that repackages the `.vsix` and reinstalls it, so you can iterate on the extension without leaving VS Code.

## Build from source

```bash
npm install
npx tsc -p ./
npx @vscode/vsce package --allow-missing-repository
code --install-extension devstack-0.2.0.vsix
```

## License

MIT
