const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const skillPath = path.join(root, '.opencode', 'skills', 'job-application-automation', 'SKILL.md');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('job application skill is discoverable with the path-derived OpenCode ID', () => {
  assert.equal(fs.existsSync(skillPath), true, 'project skill must exist at OpenCode discovery path');
  const skill = fs.readFileSync(skillPath, 'utf8');
  const frontmatter = skill.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(frontmatter, 'skill needs YAML frontmatter');
  assert.match(frontmatter[1], /^name:\s*.+$/m);
  assert.match(frontmatter[1], /^description:\s*Use when\b.+$/m);
  assert.match(skill, /# Job Application Automation/);
});

test('skill gates onboarding, provider processing, every field, unknown answers, and submissions', () => {
  const skill = fs.readFileSync(skillPath, 'utf8');
  for (const requirement of [
    'automation/scripts/profile_store.py',
    'automation/scripts/ingest_resume.py',
    'automation/content/local/profile.json',
    'automation/content/local/answer-bank.json',
    'automation/content/local/site-policies.json',
    'configured OpenCode model provider',
    'every visible field',
    'source',
    'ask the user',
    'workAuthorization',
    'sponsorship',
    'criminalHistory',
    'disability',
    'veteranStatus',
    'eeoDemographics',
    'human_handoff',
    'LinkedIn',
    'automation/mcp/inspect-application.js',
    'automation/mcp/start-application.js',
    'automation/mcp/prepare-application.js',
    'automation/mcp/submit-application.js',
    'this exact application',
    'submission_unverified',
  ]) {
    assert.ok(skill.includes(requirement), `skill must include ${requirement}`);
  }
  assert.match(skill, /Do not call `automation\/mcp\/submit-application\.js` until[\s\S]*?explicit approval/i);
});

test('README and AGENTS use current local data and document setup plus provider disclosure', () => {
  const readme = read('README.md');
  const agents = read('AGENTS.md');

  for (const content of [readme, agents]) {
    assert.ok(content.includes('.opencode/skills/job-application-automation/SKILL.md'));
    assert.ok(content.includes('automation/content/local/'));
    assert.ok(!content.includes('automation/profile.example.json'));
    assert.ok(!content.includes('automation/profile.local.json'));
  }

  for (const requirement of [
    'python3 -m venv .venv',
    'pip install -r requirements.txt',
    'profile_store.py init',
    'ingest_resume.py',
    'npm test',
    'npm run test:browser',
    'configured OpenCode model provider',
    'Google Forms',
  ]) {
    assert.ok(readme.includes(requirement), `README must include ${requirement}`);
  }
});

test('old MCP design and plan are clearly marked superseded', () => {
  for (const relativePath of [
    'docs/archive/2026-11-16-job-automation-mcp-design.md',
    'docs/archive/2026-11-16-job-automation-mcp.md',
  ]) {
    const document = read(relativePath);
    assert.match(document.slice(0, 500), /superseded/i, `${relativePath} must be marked superseded at top`);
    assert.ok(document.slice(0, 500).includes('2026-11-16-job-application-ai-loop'));
  }
});

test('onboarding is a hard gate before any application runs', () => {
  const skill = fs.readFileSync(skillPath, 'utf8');
  const readme = read('README.md');
  assert.ok(skill.includes('profile_store.py preflight'));
  assert.match(skill, /Do not start any application until preflight reports `ready`/);
  assert.ok(readme.includes('profile_store.py preflight'));
  assert.ok(readme.includes('Prerequisites: onboarding before any automation'));
});
