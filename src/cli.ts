#!/usr/bin/env node
import * as path from "path";
import { spawn } from "child_process";
import { detectStacks, deduplicateServices } from "./stackDetector";
import { CONFIG_FILENAME, readConfig, loadConfig, mergeServices, loadScripts } from "./core/config";
import { createDashboardServer } from "./server/httpServer";

interface Args {
  root: string;
  port: number;
  open: boolean;
  name?: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { root: process.cwd(), port: 7788, open: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--root" || a === "-r") {
      args.root = path.resolve(argv[++i]);
    } else if (a === "--port" || a === "-p") {
      args.port = parseInt(argv[++i], 10);
    } else if (a === "--open" || a === "-o") {
      args.open = true;
    } else if (a === "--no-open") {
      args.open = false;
    } else if (a === "--name" || a === "-n") {
      args.name = argv[++i];
    } else if (a === "--help" || a === "-h") {
      printHelp();
      process.exit(0);
    }
  }
  return args;
}

function printHelp(): void {
  process.stdout.write(
    `DevStack web dashboard

Usage:
  devstack serve [options]

Options:
  -r, --root <dir>    Project root holding .devstack.json (default: cwd)
  -p, --port <n>      Port to serve the dashboard on (default: 7788)
  -o, --open          Open the dashboard in a browser
  -n, --name <name>   Project display name (default: root dir name)
  -h, --help          Show this help
`
  );
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  if (command !== "serve") {
    printHelp();
    process.exit(command ? 1 : 0);
  }

  const args = parseArgs(rest);

  // Surface an unparseable .devstack.json instead of silently serving nothing.
  try {
    readConfig(path.join(args.root, CONFIG_FILENAME));
  } catch (err) {
    process.stderr.write(`  warning: ${(err as Error).message} — config ignored\n`);
  }

  // Same discovery pipeline as the extension: detect → dedupe → merge config.
  const stacks = detectStacks(args.root);
  const autoServices = deduplicateServices(stacks);
  const config = loadConfig(args.root);
  const services = mergeServices(autoServices, config);
  const scripts = loadScripts(config);

  const projectName = args.name ?? path.basename(args.root);
  const dashboardDir = path.join(__dirname, "..", "media", "dashboard");

  const { start } = createDashboardServer({
    projectRoot: args.root,
    projectName,
    services,
    scripts,
    port: args.port,
    dashboardDir,
  });

  await start();

  const url = `http://localhost:${args.port}`;
  process.stdout.write(
    `\n  DevStack dashboard — ${projectName}\n  ${url}\n  ${services.length} service(s), ${scripts.length} script(s) from ${args.root}\n  Ctrl+C to stop.\n\n`
  );

  if (args.open) {
    spawn("xdg-open", [url], { stdio: "ignore", detached: true }).on("error", () => {
      /* xdg-open absent — ignore */
    }).unref();
  }
}

main().catch((err) => {
  process.stderr.write(`devstack serve failed: ${(err as Error).message}\n`);
  process.exit(1);
});
