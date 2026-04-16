/**
 * Builds the Flask backend with PyInstaller for production.
 * Run: npm run build:python
 * Output: dist/flask-backend.exe (one-file executable)
 */

const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const root = __dirname;
const distDir = path.join(root, 'dist');

// Prefer venv Python (where pip install put PyInstaller); fallback to system python
const venvPython = path.join(root, 'venv', 'Scripts', 'python.exe');
const pythonExe = fs.existsSync(venvPython) ? venvPython : 'python';

// Ensure dist exists
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

// Run PyInstaller via Python module (works when pyinstaller.exe not in PATH)
const result = spawnSync(pythonExe, [
  '-m', 'PyInstaller',
  '--clean',
  '--noconfirm',
  '--distpath', distDir,
  'flask-backend.spec',
], {
  cwd: root,
  stdio: 'inherit',
  shell: true,
});

if (result.status !== 0) {
  console.error('\n[build-python] PyInstaller failed. Ensure:');
  console.error('  1. Python is installed and in PATH');
  console.error('  2. pip install pyinstaller -r requirements.txt');
  process.exit(1);
}

const exePath = path.join(distDir, 'flask-backend.exe');
if (!fs.existsSync(exePath)) {
  console.error('[build-python] Expected output not found:', exePath);
  process.exit(1);
}

console.log('\n[build-python] Success:', exePath);
