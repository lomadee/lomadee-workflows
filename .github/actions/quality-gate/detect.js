const fs = require('fs');
const path = require('path');

const { resolveWorkingDirectory, toPosix } = require('./paths');

const PACKAGE_MANAGER_PATTERN = /^(yarn|pnpm|npm)@\d+\.\d+\.\d+(?:\+[A-Za-z0-9._-]+)?$/;
const LOCKFILES = [
  ['pnpm', 'pnpm-lock.yaml'],
  ['yarn', 'yarn.lock'],
  ['npm', 'package-lock.json'],
];

function readPackageJson(pkgPath, rawLabel) {
  if (!fs.existsSync(pkgPath)) {
    return { ok: false, message: `package.json não encontrado em ${rawLabel}` };
  }
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    if (pkg == null || typeof pkg !== 'object' || Array.isArray(pkg)) {
      return { ok: false, message: `package.json inválido em ${rawLabel}` };
    }
    return { ok: true, pkg };
  } catch {
    return { ok: false, message: `package.json inválido em ${rawLabel}` };
  }
}

function parsePackageManagerField(pkg) {
  if (typeof pkg.packageManager !== 'string' || pkg.packageManager === '') {
    return { ok: true, packageManager: '' };
  }
  if (!PACKAGE_MANAGER_PATTERN.test(pkg.packageManager)) {
    return { ok: false, message: `packageManager inválido: ${pkg.packageManager}` };
  }
  return { ok: true, packageManager: pkg.packageManager.split('+')[0] };
}

function chooseManager(lockCandidates, packageManager, rawLabel) {
  if (lockCandidates.length === 0) {
    return {
      ok: false,
      message: `Nenhum lockfile (pnpm-lock.yaml, yarn.lock ou package-lock.json) em ${rawLabel}`,
    };
  }
  if (lockCandidates.length === 1) {
    const manager = lockCandidates[0][0];
    if (packageManager && !packageManager.startsWith(`${manager}@`)) {
      return {
        ok: false,
        message: `packageManager (${packageManager}) não corresponde ao lockfile ${lockCandidates[0][1]}`,
      };
    }
    return { ok: true, manager };
  }

  const fromField = packageManager.split('@')[0];
  const chosen = lockCandidates.find(([name]) => name === fromField);
  if (!chosen) {
    const names = lockCandidates.map(([, file]) => file).join(', ');
    return {
      ok: false,
      message: `Há mais de um lockfile (${names}) e packageManager não desempata.`,
    };
  }
  console.log(`::warning::Mais de um lockfile; usando ${chosen[0]} por causa de packageManager.`);
  return { ok: true, manager: chosen[0] };
}

function yarnModeOf(dir, manager, packageManager) {
  if (manager !== 'yarn') return '';
  const major = packageManager.startsWith('yarn@')
    ? Number(packageManager.slice('yarn@'.length).split('.')[0])
    : null;
  const berry = fs.existsSync(path.join(dir, '.yarnrc.yml')) || (major !== null && major >= 2);
  return berry ? 'berry' : 'classic';
}

function pnpmVersionOf(dir, manager, packageManager) {
  if (manager !== 'pnpm') return '';
  if (packageManager.startsWith('pnpm@')) return packageManager.slice('pnpm@'.length);
  const text = fs.readFileSync(path.join(dir, 'pnpm-lock.yaml'), 'utf8');
  const found = text.match(/lockfileVersion:\s*['"]?(\d+)/);
  const major = found ? Number(found[1]) : 9;
  if (major <= 5) return '7';
  if (major === 6) return '8';
  return '9';
}

/**
 * Mesma detecção de gerenciador do quality.yml.
 * @param {string} root
 * @param {string} raw
 */
function detectPackageManager(root, raw) {
  const resolved = resolveWorkingDirectory(root, raw);
  if (!resolved.ok) return resolved;
  if (!fs.existsSync(resolved.dir) || !fs.statSync(resolved.dir).isDirectory()) {
    return { ok: false, message: `Diretório não encontrado: ${resolved.raw}` };
  }

  const parsed = readPackageJson(path.join(resolved.dir, 'package.json'), resolved.raw);
  if (!parsed.ok) return parsed;

  const field = parsePackageManagerField(parsed.pkg);
  if (!field.ok) return field;

  const lockCandidates = LOCKFILES.filter(([, file]) => fs.existsSync(path.join(resolved.dir, file)));
  const chosen = chooseManager(lockCandidates, field.packageManager, resolved.raw);
  if (!chosen.ok) return chosen;

  const lock = lockCandidates.find(([name]) => name === chosen.manager);
  if (!lock) return { ok: false, message: `Lockfile não encontrado para ${chosen.manager}.` };
  const prefix = resolved.rel === '' ? '' : `${toPosix(resolved.rel)}/`;
  return {
    ok: true,
    pkg: parsed.pkg,
    dir: resolved.dir,
    raw: resolved.raw,
    rel: resolved.rel,
    outputs: {
      manager: chosen.manager,
      lockfile: `${prefix}${lock[1]}`,
      package_json: `${prefix}package.json`,
      package_manager: field.packageManager,
      yarn_mode: yarnModeOf(resolved.dir, chosen.manager, field.packageManager),
      pm_version: pnpmVersionOf(resolved.dir, chosen.manager, field.packageManager),
    },
  };
}

module.exports = { detectPackageManager, readPackageJson };
