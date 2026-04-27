module.exports = {
  app: {
    getPath: jest.fn(() => '/tmp/sauna-plex-test'),
    on: jest.fn(),
  },
  ipcMain: { handle: jest.fn() },
  BrowserWindow: jest.fn(),
  Tray: jest.fn(),
  nativeImage: { createFromPath: jest.fn() },
  screen: { getAllDisplays: jest.fn(() => []) },
};
