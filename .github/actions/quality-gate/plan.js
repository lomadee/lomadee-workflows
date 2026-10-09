const fs = require('fs');
const path = require('path');

const { detectPackageManager, readPackageJson } = require('./detect');
const { resolveNodeVersion } = require('./node-version');
const { resolveWorkingDirectory } = require('./paths');

/** Igual a `name` do workflow e a `name` do job em org-quality.yml. */
const CHECK_NAME = 'Org quality / Org lint and typecheck';
const REUSABLE_QUALITY_MARKER = 'lomadee/lomadee-workflows/.github/workflows/quality.yml';
const CONFIG_RELATIVE_PATH = '.github/quality.json';
const ALLOWED_CONFIG_KEYS = new Set(['working_directory', 'max_warnings']);

function scriptText(pkg, name) {
  if (pkg.scripts == null || typeof pkg.scripts !== 'object') return '';
  const value = pkg.scripts[name];
  if (typeof value !== 'string') return '';
  return value.trim();
}

function callsReusableQuality(root) {
  const dir = path.join(root, '.github', 'workflows');
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return false;

  return fs.readdirSync(dir, { withFileTypes: true }).some((entry) => {
    if (!entry.isFile() || !/\.ya?ml$/i.test(entry.name)) return false;
    const text = fs.readFileSync(path.join(dir, entry.name), 'utf8');
    return text.includes(REUSABLE_QUALITY_MARKER);
  });
}

function readConfig(root) {
  const file = path.join(root, CONFIG_RELATIVE_PATH);
  if (!fs.existsSync(file)) {
    return { ok: true, present: false, workingDirectory: '.', maxWarnings: -1 };
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return { ok: false, message: '.github/quality.json não é JSON válido.' };
  }
  if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, message: '.github/quality.json precisa ser um objeto.' };
  }

  const unknown = Object.keys(parsed).filter((key) => !ALLOWED_CONFIG_KEYS.has(key));
  if (unknown.length > 0) {
    return { ok: false, message: `.github/quality.json tem chaves desconhecidas: ${unknown.join(', ')}.` };
  }

  let workingDirectory = '.';
  if (Object.prototype.hasOwnProperty.call(parsed, 'working_directory')) {
    if (typeof parsed.working_directory !== 'string' || parsed.working_directory.trim() === '') {
      return {
        ok: false,
        message: 'working_directory em .github/quality.json precisa ser um caminho não vazio.',
      };
    }
    workingDirectory = parsed.working_directory;
  }

  let maxWarnings = -1;
  if (Object.prototype.hasOwnProperty.call(parsed, 'max_warnings')) {
    const value = parsed.max_warnings;
    if (typeof value !== 'number' || !Number.isInteger(value) || value < -1) {
      return { ok: false, message: 'max_warnings em .github/quality.json precisa ser um inteiro ≥ -1.' };
    }
    maxWarnings = value;
  }

  return { ok: true, present: true, workingDirectory, maxWarnings };
}

function emptyOutputs(extra) {
  return {
    skip: 'false',
    skip_reason: '',
    manager: '',
    lockfile: '',
    package_json: '',
    package_manager: '',
    yarn_mode: '',
    pm_version: '',
    node_version: '',
    node_version_source: '',
    working_directory: '.',
    max_warnings: '-1',
    run_lint: 'false',
    run_typecheck: 'false',
    ...extra,
  };
}

function skipped(reason, message) {
  const summary = [
    '### Org quality gate',
    '',
    '| | |',
    '|---|---|',
    '| Resultado | Ignorado (sucesso) |',
    `| Motivo | ${message} |`,
    `| Check | \`${CHECK_NAME}\` |`,
    '',
  ].join('\n');
  console.log(`::notice title=Org quality gate::${message}`);
  return {
    ok: true,
    outputs: emptyOutputs({ skip: 'true', skip_reason: reason }),
    summary,
  };
}

function directoryReady(resolved) {
  if (!fs.existsSync(resolved.dir) || !fs.statSync(resolved.dir).isDirectory()) {
    return { ok: false, message: `Diretório não encontrado: ${resolved.raw}` };
  }
  return { ok: true };
}

/**
 * @param {string} root
 */
function planRepository(root) {
  if (callsReusableQuality(root)) {
    return skipped(
      'reusable_quality',
      'Repositório já chama lomadee/lomadee-workflows/.github/workflows/quality.yml. O gate da organização não roda de novo.',
    );
  }

  const config = readConfig(root);
  if (!config.ok) return config;

  const resolved = resolveWorkingDirectory(root, config.workingDirectory);
  if (!resolved.ok) return resolved;
  const directory = directoryReady(resolved);
  if (!directory.ok) return directory;

  const pkgPath = path.join(resolved.dir, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    return skipped('no_package_json', `Sem package.json em "${resolved.raw}".`);
  }

  const parsed = readPackageJson(pkgPath, resolved.raw);
  if (!parsed.ok) return parsed;

  const lint = scriptText(parsed.pkg, 'lint');
  const typecheck = scriptText(parsed.pkg, 'typecheck');
  if (lint === '' && typecheck === '') {
    return skipped(
      'no_lint_or_typecheck_script',
      `package.json em "${resolved.raw}" não tem script lint nem typecheck.`,
    );
  }

  const detected = detectPackageManager(root, resolved.raw);
  if (!detected.ok) return detected;

  const nodeVersion = resolveNodeVersion(root, resolved.dir, parsed.pkg);
  if (!nodeVersion.ok) return nodeVersion;

  const outputs = emptyOutputs({
    ...detected.outputs,
    node_version: nodeVersion.version,
    node_version_source: nodeVersion.source,
    working_directory: resolved.raw,
    max_warnings: String(config.maxWarnings),
    run_lint: lint === '' ? 'false' : 'true',
    run_typecheck: typecheck === '' ? 'false' : 'true',
  });

  const summary = [
    '### Org quality gate',
    '',
    '| | |',
    '|---|---|',
    '| Resultado | Vai executar |',
    `| Diretório | \`${outputs.working_directory}\` |`,
    `| Node | \`${outputs.node_version}\` (${outputs.node_version_source}) |`,
    `| Pacotes | ${outputs.manager} |`,
    `| Lockfile | \`${outputs.lockfile}\` |`,
    `| Lint | ${outputs.run_lint === 'true' ? 'sim' : 'não'} |`,
    `| Typecheck | ${outputs.run_typecheck === 'true' ? 'sim' : 'não'} |`,
    `| max_warnings | ${outputs.max_warnings} |`,
    `| Check | \`${CHECK_NAME}\` |`,
    '',
  ].join('\n');

  return { ok: true, outputs, summary };
}

module.exports = {
  CHECK_NAME,
  REUSABLE_QUALITY_MARKER,
  callsReusableQuality,
  planRepository,
  readConfig,
};
