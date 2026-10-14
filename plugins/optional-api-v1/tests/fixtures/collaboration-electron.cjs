const { app, BrowserWindow } = require('electron');
app.setPath('userData', process.env.SESAME_COLLABORATION_TEST_PROFILE);
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.whenReady().then(async () => {
  const window = new BrowserWindow({
    show: false, width: 1280, height: 820,
    webPreferences: { offscreen: true, backgroundThrottling: false, contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  await window.loadURL('about:blank');
});
app.on('window-all-closed', () => app.quit());
