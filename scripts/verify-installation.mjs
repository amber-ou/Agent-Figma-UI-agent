#!/usr/bin/env node
// Installation check (spec §4.2): Claude Code version, the Figma MCP server entry, the Figma plugin
// version and the project hooks. It cannot list MCP tool names (only the running session can);
// the skill records those from the session into capabilities.json.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectRoot } from './state-store.mjs';

function run(cmd, args) {
  try {
    return { ok: true, out: execFileSync(cmd, args, { encoding: 'utf8', timeout: 60000, shell: process.platform === 'win32', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (err) {
    return { ok: false, out: `${err.stdout || ''}${err.stderr || ''}` || String(err.message) };
  }
}

export function parseMcpList(text) {
  return text.split(/\r?\n/).map(l => l.match(/^(\S[^:]*):\s+(\S+)(?:\s+\((\w+)\))?\s+-\s+(.*)$/)).filter(Boolean)
    .map(m => ({ name: m[1].trim(), url: m[2], transport: m[3] || null, health: m[4].trim() }));
}

export function parsePluginList(text) {
  const plugins = [];
  let cur = null;
  for (const line of text.split(/\r?\n/)) {
    const head = line.match(/^\s*❯\s+(\S+)/);
    if (head) { cur = { name: head[1] }; plugins.push(cur); continue; }
    const kv = line.match(/^\s+(Version|Status):\s+(.*)$/);
    if (cur && kv) cur[kv[1].toLowerCase()] = kv[2].trim();
  }
  return plugins;
}

export function checkHooks(root) {
  const settings = JSON.parse(fs.readFileSync(path.join(root, '.claude', 'settings.json'), 'utf8'));
  const events = ['PreToolUse', 'PostToolUse', 'PostToolUseFailure'];
  return Object.fromEntries(events.map(e => [e, (settings.hooks?.[e] || []).some(h => /figma/.test(h.matcher || '') && h.hooks.some(x => /figma-call\.mjs/.test(x.command)))]));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = projectRoot();
  const version = run('claude', ['--version']);
  const mcp = run('claude', ['mcp', 'list']);
  const plugins = run('claude', ['plugin', 'list']);
  const servers = parseMcpList(mcp.out).filter(s => /figma/i.test(s.name + s.url));
  const figmaPlugin = parsePluginList(plugins.out).find(p => /^figma@/.test(p.name)) || null;
  const report = {
    claudeCodeVersion: version.ok ? version.out.trim().split(/\s+/)[0] : null,
    node: process.version,
    os: process.platform,
    figmaServers: servers,
    figmaPlugin,
    hooks: checkHooks(root),
    skill: fs.existsSync(path.join(root, '.claude', 'skills', 'figma-ui', 'SKILL.md')),
    dependencies: fs.existsSync(path.join(root, 'node_modules', 'ajv')),
    notes: ['MCP tool names are recorded by the skill from the live session (ToolSearch), not by this script.'],
  };
  const problems = [];
  if (!report.claudeCodeVersion) problems.push('claude CLI not found');
  if (!servers.length) problems.push('no Figma MCP server configured (claude mcp add --transport http figma https://mcp.figma.com/mcp)');
  else if (!servers.some(s => /connected/i.test(s.health))) problems.push('Figma MCP server is not connected; run /mcp and authenticate');
  if (Object.values(report.hooks).some(v => !v)) problems.push('project hooks missing from .claude/settings.json');
  if (!report.dependencies) problems.push('dependencies not installed; run npm install');
  report.problems = problems;
  console.log(JSON.stringify(report, null, 2));
  process.exit(problems.length ? 1 : 0);
}
