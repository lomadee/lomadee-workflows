const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const { resolveWorkingDirectory } = require('./paths');

/**
 * Regra WF-CI-01 / WF-CI-02: o CI remove --fix, recusa --write e, se
 * max_warnings for >= 0, grava --max-warnings no eslint ou no next lint.
 * quality.yml e org-quality.yml usam esta função. Não duplique o regex.
 * @param {string} lintScript
 * @param {number} maxWarnings
 */
function buildLintCommand(lintScript, maxWarnings) {
  let cmd = lintScript
    .replace(/(^|\s)--fix(?:=true)?(?=\s|$)/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();

  if (cmd === '') {
    return { ok: false, message: 'O script lint ficou vazio depois de remover --fix.' };
  }

  if (maxWarnings >= 0) {
    const hasEslint = /(^|\s)eslint(?=\s|$)/.test(cmd);
    const hasNextLint = /(^|\s)next\s+lint(?=\s|$)/.test(cmd);
    if (hasEslint === hasNextLint) {
      return {
        ok: false,
        message: 'max_warnings exige um comando eslint ou next lint identificável no script lint.',
      };
    }
    cmd = cmd
      .replace(/(^|\s)--max-warnings(?:=|\s+)\d+/g, '$1')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
    if (hasEslint) {
      cmd = cmd.replace(/(^|\s)eslint(?=\s|$)/g, `$1eslint --max-warnings=${maxWarnings}`);
    } else {
      cmd = cmd.replace(/(^|\s)next(\s+)lint(?=\s|$)/g, `$1next$2lint --max-warnings=${maxWarnings}`);
    }
  }

  if (/(^|\s)--(?:fix|write)(?:=|\s|$)/.test(cmd)) {
    return {
      ok: false,
      message: 'O script lint ainda altera arquivo (--fix ou --write). O CI só aceita verificação.',
    };
  }

  return { ok: true, command: cmd };
}

function parseMaxWarnings(raw) {
  const maxRaw = String(raw == null ? '' : raw).trim();
  if (!/^-?\d+$/.test(maxRaw)) {
    return { ok: false, message: `max_warnings precisa ser um inteiro. Recebido: ${maxRaw}` };
  }
  const maxWarnings = Number(maxRaw);
  if (maxWarnings < -1) {
    return { ok: false, message: 'max_warnings mínimo é -1 (sem teto).' };
  }
  return { ok: true, maxWarnings };
}

function runShell(command, cwd) {
  return spawnSync(command, {
    cwd,
    shell: '/bin/bash',
    stdio: 'inherit',
    env: {
      ...process.env,
      PATH: `${cwd}/node_modules/.bin:${process.env.PATH}`,
      GITHUB_TOKEN: '',
      NODE_AUTH_TOKEN: '',
      NPM_TOKEN: '',
      YARN_NPM_AUTH_TOKEN: '',
      GH_TOKEN: '',
      GH_TOKEN_SECRET: '',
    },
  });
}

function finishCommand(result, interruptedMessage) {
  if (result.status === null) return { ok: false, message: interruptedMessage };
  return { ok: true, status: result.status };
}

/**
 * @param {string} root
 * @param {string} rawDir
 * @param {string} maxRaw
 */
function runLint(root, rawDir, maxRaw) {
  const resolved = resolveWorkingDirectory(root, rawDir);
  if (!resolved.ok) return resolved;

  const max = parseMaxWarnings(maxRaw);
  if (!max.ok) return max;

  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(resolved.dir, 'package.json'), 'utf8'));
  } catch {
    return { ok: false, message: `package.json inválido em ${resolved.raw}` };
  }

  const lint = pkg.scripts && pkg.scripts.lint;
  if (typeof lint !== 'string' || lint.trim() === '') {
    return {
      ok: false,
      message: 'package.json não tem o script "lint". O CI não instala o ESLint por conta própria.',
    };
  }

  const built = buildLintCommand(lint, max.maxWarnings);
  if (!built.ok) return built;

  console.log(`Lint sem --fix: ${built.command}`);
  return finishCommand(runShell(built.command, resolved.dir), 'O lint não terminou normalmente.');
}

module.exports = { buildLintCommand, parseMaxWarnings, runLint, runShell, finishCommand };
