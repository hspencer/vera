import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('veraSetup', {
  initialize: (name: string) => ipcRenderer.invoke('vera:initialize', name),
  systemName: () => ipcRenderer.invoke('vera:system-name'),
});
