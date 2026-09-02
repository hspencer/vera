import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { userInfo } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '../..');
const PORT = 4173;

const portableRoot = process.env['PORTABLE_EXECUTABLE_DIR'];
const localRoot = process.platform === 'win32'
  ? process.env['LOCALAPPDATA']
  : undefined;
const dataRoot = portableRoot === undefined
  ? join(localRoot ?? app.getPath('userData'), localRoot === undefined ? 'data' : 'Vera')
  : join(portableRoot, 'VeraData');

// En Windows la memoria no debe viajar por AppData/Roaming. El programa se
// reemplaza; los datos viven en LocalAppData o junto al ejecutable portable.
app.setPath('userData', dataRoot);

const databasePath = join(dataRoot, 'data', 'vera.sqlite');
const objectsRoot = join(dataRoot, 'objects');
const webRoot = app.isPackaged ? join(process.resourcesPath, 'web') : join(ROOT, 'packages/web/dist');
const setupPage = join(HERE, 'setup.html');
const preload = join(HERE, 'preload.cjs');

if (app.isPackaged) {
  process.env['VERA_SCHEMA'] = join(process.resourcesPath, 'schema.sql');
  process.env['VERA_P5_RUNTIME'] = join(process.resourcesPath, 'p5.min.js');
}

let running: { close(): Promise<void> } | null = null;
let window: BrowserWindow | null = null;

const databaseExists = (): boolean => existsSync(databasePath) && statSync(databasePath).size > 0;

async function startVera(): Promise<void> {
  if (running === null) {
    const { listen } = await import('../../server/src/server.ts');
    mkdirSync(dirname(databasePath), { recursive: true });
    mkdirSync(objectsRoot, { recursive: true });
    running = listen({
      port: PORT,
      host: '127.0.0.1',
      databasePath,
      objectsRoot,
      webRoot,
    });
  }
  await window?.loadURL(`http://127.0.0.1:${PORT}`);
}

function createWindow(): void {
  window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 720,
    minHeight: 560,
    title: 'Vera',
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });

  if (databaseExists()) void startVera();
  else void window.loadFile(setupPage);
}

ipcMain.handle('vera:initialize', async (_event, rawName: unknown) => {
  if (typeof rawName !== 'string' || rawName.trim().length < 2) {
    throw new Error('Escribe el nombre con que firmarás esta memoria.');
  }
  if (databaseExists()) throw new Error('Esta memoria ya fue inicializada.');
  const name = rawName.trim();
  const { initializeStarterMemory } = await import('../../server/src/starter-memory.ts');
  initializeStarterMemory({
    databasePath,
    owner: { id: `participant:${randomUUID()}`, name },
  });
  await startVera();
  return { ok: true };
});

ipcMain.handle('vera:system-name', () => userInfo().username);

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  void running?.close();
  running = null;
});
