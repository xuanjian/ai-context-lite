#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const projectRoot = root;
const managedMarker = '<!-- devflow:managed-entry:start -->';
const portableOverrideMarker = 'Do not read or require home-level compatibility files';
const files = [
  path.join(projectRoot, 'AGENTS.md'),
  path.join(projectRoot, 'CLAUDE.md'),
  path.join(projectRoot, 'claude.md'),
  path.join(projectRoot, '.ai-configs', 'claude.md'),
  path.join(projectRoot, '.claude', 'CLAUDE.md'),
  path.join(projectRoot, '.cursor', 'rules', '00-devflow.mdc'),
];

const snapshots = new Map();
for (const file of files) {
  snapshots.set(file, fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null);
}

function restore() {
  for (const [file, content] of snapshots) {
    if (content === null) {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    } else {
      fs.writeFileSync(file, content);
    }
  }
}

function hasExactDirEntry(filePath) {
  return fs.readdirSync(path.dirname(filePath)).includes(path.basename(filePath));
}

try {
  fs.writeFileSync(path.join(projectRoot, 'claude.md'), `# Legacy DevFlow entry\n\n${managedMarker}\n`);

  const result = spawnSync(process.execPath, [
    'scripts/install-ai-context.mjs',
    'sync-projects',
    '--project',
    'devflow',
    '--entries-only',
    '--write',
  ], {
    cwd: root,
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    throw new Error(`sync-projects failed\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
  }

  for (const file of [
    path.join(projectRoot, 'AGENTS.md'),
    path.join(projectRoot, 'CLAUDE.md'),
    path.join(projectRoot, '.ai-configs', 'claude.md'),
    path.join(projectRoot, '.claude', 'CLAUDE.md'),
  ]) {
    if (!fs.existsSync(file)) throw new Error(`expected generated entry file: ${file}`);
    const content = fs.readFileSync(file, 'utf8');
    if (!content.includes('devflow query route "<user request>"')) {
      throw new Error(`generated entry does not point at DevFlow query route: ${file}`);
    }
    if (content.includes('JSON index reading')) {
      throw new Error(`generated entry still references JSON index reading: ${file}`);
    }
    if (!content.includes(portableOverrideMarker)) {
      throw new Error(`generated entry does not contain portable project override: ${file}`);
    }
  }

  const cursorRule = path.join(projectRoot, '.cursor', 'rules', '00-devflow.mdc');
  if (!fs.existsSync(cursorRule)) throw new Error(`expected generated cursor rule: ${cursorRule}`);
  if (!fs.readFileSync(cursorRule, 'utf8').includes(portableOverrideMarker)) {
    throw new Error(`generated cursor rule does not contain portable project override: ${cursorRule}`);
  }

  if (hasExactDirEntry(path.join(projectRoot, 'claude.md'))) {
    throw new Error('expected managed lowercase claude.md to be removed');
  }
} finally {
  restore();
}
