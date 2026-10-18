import { ESLint } from 'eslint';

const eslint = new ESLint({
  overrideConfigFile: '/workspace/recover/work/a11y.config.mjs',
  cwd: '/workspace/recover/work',
});

const results = await eslint.lintFiles([
  'app/**/*.tsx',
  'components/**/*.tsx',
  'features/**/*.tsx',
  'core/**/*.tsx',
  'lib/**/*.tsx',
]);

let n = 0;
const byRule = {};
for (const r of results) {
  for (const m of r.messages) {
    if (!m.ruleId) continue;
    n += 1;
    byRule[m.ruleId] = (byRule[m.ruleId] || 0) + 1;
    console.log(`${r.filePath.replace('/workspace/recover/work/', '')}:${m.line}  ${m.ruleId}  ${m.message.slice(0, 70)}`);
  }
}
console.error('TOTAL', n, JSON.stringify(byRule));
