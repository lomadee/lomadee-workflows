const path = require('path');

const WORKING_DIRECTORY_PATTERN = /^[A-Za-z0-9._@/-]+$/;

/**
 * @param {string} root
 * @param {string | undefined | null} raw
 */
function resolveWorkingDirectory(root, raw) {
  const value = raw == null || String(raw).trim() === '' ? '.' : String(raw);
  if (
    value.includes('\0') ||
    !WORKING_DIRECTORY_PATTERN.test(value) ||
    value.split('/').includes('..')
  ) {
    return { ok: false, message: `working_directory inválido: ${value}` };
  }

  const dir = path.resolve(root, value);
  const rel = path.relative(root, dir);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return { ok: false, message: 'working_directory precisa ficar dentro do repositório.' };
  }

  return { ok: true, dir, rel, raw: value };
}

function toPosix(value) {
  return value.split(path.sep).join('/');
}

module.exports = { resolveWorkingDirectory, toPosix };
