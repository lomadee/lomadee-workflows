const fs = require('fs');
const path = require('path');

const { resolveWorkingDirectory } = require('./paths');
const { finishCommand, runShell } = require('./lint-command');

function typecheckCommand(pm) {
  if (pm === 'npm') return 'npm run typecheck';
  if (pm === 'yarn') return 'yarn typecheck';
  if (pm === 'pnpm') return 'pnpm run typecheck';
  return '';
}

/**
 * Só o script typecheck. O org gate não cai no fallback tsc --noEmit.
 * @param {string} root
 * @param {string} rawDir
 * @param {string} pm
 */
function runTypecheck(root, rawDir, pm) {
  const resolved = resolveWorkingDirectory(root, rawDir);
  if (!resolved.ok) return resolved;

  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(resolved.dir, 'package.json'), 'utf8'));
  } catch {
    return { ok: false, message: `package.json inválido em ${resolved.raw}` };
  }

  const typecheck = pkg.scripts && pkg.scripts.typecheck;
  if (typeof typecheck !== 'string' || typecheck.trim() === '') {
    return { ok: false, message: 'Não há script "typecheck".' };
  }

  const cmd = typecheckCommand(pm);
  if (cmd === '') {
    return { ok: false, message: `Gerenciador de pacotes desconhecido: ${pm}` };
  }

  console.log(`Typecheck via script: ${typecheck}`);
  return finishCommand(runShell(cmd, resolved.dir), 'O typecheck não terminou normalmente.');
}

module.exports = { runTypecheck };
