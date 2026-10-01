import assert from 'node:assert/strict';
import test from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';
import { readFile, readdir } from 'node:fs/promises';
const plugin = new URL('../../codex-plugin/', import.meta.url);
test('portable plugin declares local scoped MCP and focused skill workflows without credentials', async () => {
  const manifest = JSON.parse(await readFile(new URL('plugin.json', plugin), 'utf8'));
  assert.equal(manifest.$schema, 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json');
  const mcp = JSON.parse(await readFile(new URL('mcp.json', plugin), 'utf8'));
  assert.equal(mcp.mcpServers.zeroboard.type, 'stdio'); assert.ok(mcp.mcpServers.zeroboard.args.includes('--plugin'));
  assert.equal(mcp.mcpServers.zeroboard.env, undefined);
  const skills = await readdir(new URL('skills/', plugin)); assert.deepEqual(skills.sort(), ['meeting-actions','standup','triage']);
  const meeting = await readFile(new URL('skills/meeting-actions/SKILL.md', plugin), 'utf8');
  assert.match(meeting, /explicit approval/); assert.match(meeting, /Host tool approval must remain enabled/);
});

test('plugin and MCP manifests validate against pinned portable 1.0.0 schemas', async () => {
  const ajv = new Ajv2020();
  for (const [file, schema] of [['plugin.json','plugin.schema.json'], ['mcp.json','mcp.schema.json']]) {
    const spec = JSON.parse(await readFile(new URL(`schemas/${schema}`, import.meta.url), 'utf8'));
    const validate = ajv.compile(spec);
    assert.equal(validate(JSON.parse(await readFile(new URL(file, plugin), 'utf8'))), true, JSON.stringify(validate.errors));
  }
});
