import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';

const read = (name) =>
  JSON.parse(
    readFileSync(new URL(`../docs/presets/${name}`, import.meta.url), 'utf8'),
  );
const schema = read('manifest.schema.json');
const ajv = new Ajv2020({ strict: true, allErrors: true });
const validate = ajv.compile(schema);
const pure = () => read('examples/pure-edited.json');
const mixed = () => read('examples/mixed-delay.json');

function rejects(change, fixture = pure()) {
  change(fixture);
  assert.equal(validate(fixture), false, 'Invalid manifest shape was accepted');
}

test('preset schema is a valid strict draft 2020-12 schema', () => {
  assert.equal(ajv.validateSchema(schema), true);
});

test('all three documentation manifests satisfy shape validation only', () => {
  for (const name of ['pure-edited', 'mixed-delay', 'compatible-copy']) {
    assert.equal(
      validate(read(`examples/${name}.json`)),
      true,
      JSON.stringify(validate.errors),
    );
  }
});

test('manifest cannot assert eligibility or change its version/namespace', () => {
  rejects((value) => (value.tone3000Compatible = true));
  rejects((value) => (value.formatVersion = 2));
  rejects((value) => (value.format = 'tone3000'));
  rejects((value) => (value.tone3000.instances[0].params = { pitch: 3 }));
});

test('resource metadata rejects unsafe paths and malformed integrity fields', () => {
  for (const path of ['../tone', '/tone', 'C:\\tone', 'a/../tone', 'a//tone'])
    rejects((value) => (value.resources[0].path = path));
  rejects((value) => (value.resources[0].sha256 = 'not-a-hash'));
  rejects((value) => (value.resources[0].bytes = 0));
  rejects((value) => (value.resources[0].bytes = 268435457));
});

test('host shape rejects ambiguous nodes, bad ports and nonnumeric controls', () => {
  rejects(
    (value) => (value.oxidal.graph.nodes[1].kind = 'unregistered'),
    mixed(),
  );
  rejects((value) => (value.oxidal.graph.edges[0].to.port = -1), mixed());
  rejects((value) => (value.oxidal.lv2[0].controls.mix = '25%'), mixed());
  rejects((value) => (value.oxidal.recall.tails = 'best-effort'), mixed());
});

test('extension keys are namespaced and required capability IDs are unique', () => {
  rejects((value) => (value.extensions.unscoped = {}));
  rejects(
    (value) =>
      (value.requiredExtensions = ['urn:example:future', 'urn:example:future']),
  );
});
