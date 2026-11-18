import { ESLint } from 'eslint';
import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('../apps/web/', import.meta.url));
const eslint = new ESLint({ cwd, fix: true });
const filePath = `${cwd}src/import-order-fixture.ts`;

test('the web ESLint config groups packages, shared libraries and local modules', async () => {
  const source = `import { local } from './local';
import { Button } from '@oxidal/design-system/components/button';
import { useState, useEffect, useRef } from 'react';
export const keep = [local, Button, useState, useEffect, useRef];\n`;
  const [result] = await eslint.lintText(source, { filePath });
  assert.match(
    result.output,
    /import \{ useEffect,\s*useRef,\s*useState \} from 'react';\n\nimport \{ Button \} from '@oxidal\/design-system\/components\/button';\n\nimport \{ local \} from '\.\/local';/,
  );
  const [again] = await eslint.lintText(result.output, { filePath });
  assert.equal(
    again.output,
    undefined,
    'a second autofix must leave the source unchanged',
  );
  assert.equal(again.errorCount, 0);
});

test('named values and type imports sort without losing comments or CSS order', async () => {
  const source = `import './z.css';
import './a.css';
import { SelectValue, Select, SelectTrigger, SelectItem, SelectContent } from '@oxidal/design-system/components/select';
// Keep the type with its source.
import type { Zebra, Alpha } from './types';
export const controls = [SelectValue, Select, SelectTrigger, SelectItem, SelectContent];
export type Both = Zebra & Alpha;\n`;
  const [result] = await eslint.lintText(source, { filePath });
  const output = result.output;
  assert.match(
    output,
    /\{ Select,\s*SelectContent,\s*SelectItem,\s*SelectTrigger,\s*SelectValue \}/,
  );
  assert.match(
    output,
    /\/\/ Keep the type with its source\.\nimport type \{ Alpha,\s*Zebra \}/,
  );
  assert.ok(output.indexOf("'./z.css'") < output.indexOf("'./a.css'"));
  assert.equal(result.errorCount, 0);
});

test('an import below a declaration is rejected instead of leaving split groups', async () => {
  const [result] = await eslint.lintText(
    "export const value = 1;\nimport 'react';\n",
    { filePath },
  );
  assert.ok(
    result.messages.some(
      (message) => message.ruleId === 'no-restricted-syntax',
    ),
  );
});

test('each workspace has an explicit parser root when configs share a process', async () => {
  for (const [directory, file] of [
    ['../apps/web/', 'src/import-order-fixture.ts'],
    ['../apps/storybook/', 'baseline/import-order-fixture.tsx'],
    ['../packages/ui/', 'src/import-order-fixture.tsx'],
  ]) {
    const cwd = fileURLToPath(new URL(directory, import.meta.url));
    const client = new ESLint({ cwd, fix: true });
    const [result] = await client.lintText('export const value = 1;\n', {
      filePath: `${cwd}${file}`,
    });
    assert.equal(
      result.errorCount,
      0,
      `${directory}: ${JSON.stringify(result.messages)}`,
    );
  }
});
