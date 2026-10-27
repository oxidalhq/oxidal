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

test('documentation manifests satisfy shape validation only', () => {
  for (const name of [
    'pure-edited',
    'mixed-delay',
    'compatible-copy',
    'lv2-only',
  ]) {
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

test('format admits resource-budgeted native instances and explicit processing roles', () => {
  const fixture = mixed();
  fixture.tone3000.instances = Array.from({ length: 32 }, (_, i) => ({
    ...fixture.tone3000.instances[0],
    id: `native${i}`,
    processingRole: i % 2 ? 'amp' : 'cab',
  }));
  // Shape only: references/role semantics and DSP admission still need validation.
  assert.equal(validate(fixture), true, JSON.stringify(validate.errors));
  fixture.tone3000.instances[0].processingRole = 'unknown';
  assert.equal(validate(fixture), false);
});

test('empty mono and stereo working rigs need no invented native payload', () => {
  for (const channels of [1, 2]) {
    const fixture = read('examples/lv2-only.json');
    fixture.oxidal.lv2 = [];
    fixture.oxidal.graph.nodes = [
      { id: 'input', kind: 'input', audioInputs: 0, audioOutputs: channels },
      { id: 'output', kind: 'output', audioInputs: channels, audioOutputs: 0 },
    ];
    fixture.oxidal.graph.edges = Array.from(
      { length: channels },
      (_, port) => ({
        from: { node: 'input', port },
        to: { node: 'output', port },
      }),
    );
    assert.equal(validate(fixture), true, JSON.stringify(validate.errors));
  }
});
