const { app, BrowserWindow } = require('electron');
const path = require('path');

function createWindow() {
    const win = new BrowserWindow({
        width: 600,
        height: 800,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    // For production, we load the built index.html
    win.loadFile(path.join(__dirname, 'dist/index.html'));

    // Open DevTools automatically to see console logs
    win.webContents.openDevTools();

    // No menu bar for a cleaner "app" look
    win.setMenuBarVisibility(false);
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});
