import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const hostRoot = process.env.SESAME_HOST_ROOT;
const playwrightEntry = hostRoot && join(hostRoot, 'node_modules/playwright/index.mjs');
const electronRoot = hostRoot && join(hostRoot, 'node_modules/electron/dist');
const executablePath = electronRoot && (process.platform === 'win32' ? join(electronRoot, 'electron.exe')
  : process.platform === 'darwin' ? join(electronRoot, 'Electron.app/Contents/MacOS/Electron') : join(electronRoot, 'electron'));
export const hasElectron = Boolean(playwrightEntry && existsSync(playwrightEntry) && existsSync(executablePath));

export async function launchPage({ viewport = { width: 1280, height: 820 }, touch = false } = {}) {
  const { _electron } = await import(pathToFileURL(playwrightEntry));
  const profile = await mkdtemp(join(tmpdir(), 'sesame-collaboration-electron-'));
  const env = { ...process.env, SESAME_COLLABORATION_TEST_PROFILE: profile };
  delete env.ELECTRON_RUN_AS_NODE;
  let app;
  const close = async () => {
    await app?.close().catch(() => {});
    const root = resolve(tmpdir()), target = resolve(profile);
    if (target.startsWith(root + (process.platform === 'win32' ? '\\' : '/'))) await rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  };
  try {
    app = await _electron.launch({ executablePath, args: [fileURLToPath(new URL('../fixtures/collaboration-electron.cjs', import.meta.url))], env, timeout: 30000 });
    const page = await app.firstWindow();
    await page.setViewportSize(viewport);
    if (touch) {
      const client = await page.context().newCDPSession(page);
      await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    }
    return { page, close };
  } catch (error) { await close(); throw error; }
}
