import { execFile } from "child_process";

export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
}

/**
 * Run a command without a shell (argv array → no injection surface), capturing
 * output. Never rejects: a non-zero exit or a missing binary resolves with the
 * captured streams and a non-zero `code`, so callers branch on `code`.
 */
export function run(cmd: string, args: string[], timeoutMs = 4000): Promise<ExecResult> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      let code = 0;
      if (err) {
        const c = (err as NodeJS.ErrnoException).code;
        code = typeof c === "number" ? c : 1;
      }
      resolve({ stdout: stdout?.toString() ?? "", stderr: stderr?.toString() ?? "", code });
    });
  });
}
