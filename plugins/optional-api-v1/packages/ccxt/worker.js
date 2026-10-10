import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
export async function execute(payload, context) {
  const selected = JSON.parse(
    await readFile(join(context.directory, "selection.json")),
  );
  context.signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(
      selected.python,
      ["-I", "-B", fileURLToPath(new URL("./bridge.py", import.meta.url))],
      { cwd: context.directory, stdio: ["pipe", "pipe", "pipe"] },
    );
    let out = "",
      err = "",
      bytes = 0,
      aborted = false,
      timer;
    const abort = () => {
      if (aborted) return;
      aborted = true;
      child.kill("SIGTERM");
      timer = setTimeout(() => child.kill("SIGKILL"), 2000);
      timer.unref?.();
    };
    context.signal?.addEventListener("abort", abort, { once: true });
    if (context.signal?.aborted) abort();
    const cleanup = () => {
      clearTimeout(timer);
      context.signal?.removeEventListener("abort", abort);
    };
    child.stdout.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > 8 * 1024 * 1024) abort();
      else out += chunk;
    });
    child.stderr.on("data", (chunk) => {
      err = (err + chunk).slice(-1500);
    });
    child.on("error", (error) => {
      cleanup();
      reject(error);
    });
    child.stdin.on("error", () => {});
    child.on("close", (code) => {
      cleanup();
      if (aborted)
        return reject(
          Object.assign(
            Error("Public request canceled or output budget exceeded"),
            { code: "ABORTED" },
          ),
        );
      if (code !== 0)
        return reject(
          Object.assign(
            Error(
              "Public exchange request failed: " +
                err.replace(
                  /(https?:\/\/)[^\s/@]+(?::[^\s/@]*)?@/g,
                  "$1[redacted]@",
                ),
            ),
            { code: "SOURCE_UNAVAILABLE" },
          ),
        );
      try {
        resolve(JSON.parse(out));
      } catch (error) {
        reject(error);
      }
    });
    child.stdin.end(JSON.stringify(payload));
  });
}
