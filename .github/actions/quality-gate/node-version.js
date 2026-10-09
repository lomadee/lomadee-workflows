const fs = require('fs');
const path = require('path');

/** Mesmo padrão do input node_version do quality.yml. */
const DEFAULT_NODE_VERSION = '22';

const PINNED_VERSION_PATTERN = /^(?:node|lts\/\*|lts\/[A-Za-z0-9._-]+|v?\d+(?:\.\d+){0,2})$/;

function readVersionFile(filePath) {
  const base = path.basename(filePath);
  const text = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  const line = text
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find((item) => item !== '' && !item.startsWith('#'));
  if (!line) return { ok: false, message: `${base} está vazio.` };

  const value = line.replace(/^['"]|['"]$/g, '');
  if (!PINNED_VERSION_PATTERN.test(value)) {
    return { ok: false, message: `Versão de Node inválida em ${base}: ${value}` };
  }
  return { ok: true, version: value };
}

function firstExistingPin(candidates) {
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate.file)) continue;
    const parsed = readVersionFile(candidate.file);
    if (!parsed.ok) return parsed;
    return { ok: true, version: parsed.version, source: candidate.source };
  }
  return null;
}

function versionFromEngines(pkg) {
  const engines = pkg && pkg.engines && pkg.engines.node;
  if (typeof engines !== 'string' || engines.trim() === '') return null;
  const match = engines.match(/\d+(?:\.\d+){0,2}/);
  if (!match) {
    console.log(
      `::notice title=Org quality gate::engines.node (${engines}) não tem versão numérica. Usando Node ${DEFAULT_NODE_VERSION}.`,
    );
    return null;
  }
  return { ok: true, version: match[0], source: 'engines.node' };
}

/**
 * Ordem: pin do working_directory (.nvmrc, .node-version), pin da raiz,
 * primeiro número de engines.node, depois 22.
 * @param {string} root
 * @param {string} dir
 * @param {object} pkg
 */
function resolveNodeVersion(root, dir, pkg) {
  const candidates = [
    { file: path.join(dir, '.nvmrc'), source: 'working_directory/.nvmrc' },
    { file: path.join(dir, '.node-version'), source: 'working_directory/.node-version' },
  ];
  if (path.resolve(dir) !== path.resolve(root)) {
    candidates.push(
      { file: path.join(root, '.nvmrc'), source: '.nvmrc' },
      { file: path.join(root, '.node-version'), source: '.node-version' },
    );
  }

  const pinned = firstExistingPin(candidates);
  if (pinned) return pinned;

  const fromEngines = versionFromEngines(pkg);
  if (fromEngines) return fromEngines;

  return { ok: true, version: DEFAULT_NODE_VERSION, source: 'default' };
}

module.exports = { DEFAULT_NODE_VERSION, resolveNodeVersion };
