const fs = require('fs');

function writeOutputs(pairs) {
  const lines = Object.entries(pairs)
    .map(([key, value]) => `${key}=${value == null ? '' : value}`)
    .join('\n');
  const file = process.env.GITHUB_OUTPUT;
  if (file) {
    fs.appendFileSync(file, `${lines}\n`);
  }
}

function writeSummary(markdown) {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file || markdown.trim() === '') return;
  fs.appendFileSync(file, `${markdown.trim()}\n`);
}

module.exports = { writeOutputs, writeSummary };
