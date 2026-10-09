const { detectPackageManager } = require('./detect');
const { runLint } = require('./lint-command');
const { writeOutputs, writeSummary } = require('./output');
const { planRepository } = require('./plan');
const { runTypecheck } = require('./typecheck');

function fail(message) {
  console.error(`::error::${message}`);
  process.exit(1);
}

function finish(result) {
  if (!result.ok) fail(result.message);
  if (result.outputs) writeOutputs(result.outputs);
  if (result.summary) writeSummary(result.summary);
  if (typeof result.status === 'number') process.exit(result.status);
}

const root = process.env.GITHUB_WORKSPACE || process.cwd();
const mode = process.env.MODE || '';
const workingDirectory = process.env.WORKING_DIRECTORY || '.';

if (mode === 'detect') {
  const detected = detectPackageManager(root, workingDirectory);
  if (!detected.ok) fail(detected.message);
  writeOutputs(detected.outputs);
  console.log(Object.entries(detected.outputs).map(([key, value]) => `${key}=${value}`).join('\n'));
} else if (mode === 'plan') {
  finish(planRepository(root));
} else if (mode === 'lint') {
  finish(runLint(root, workingDirectory, process.env.MAX_WARNINGS));
} else if (mode === 'typecheck') {
  finish(runTypecheck(root, workingDirectory, process.env.PM || ''));
} else {
  fail(`mode inválido: ${mode}`);
}
