import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readCsv } from './csv.js';

test('handles a BOM, CRLF, multiline fields and escaped quotes', () => {
  const data = readCsv('\uFEFFid,message\r\n1,"hello,\n""desk"""\r\n');
  assert.deepEqual(data.records, [['1', 'hello,\n"desk"']]);
  assert.deepEqual(data.issues, []);
});

test('identifies blank and duplicate headers and wrong-width rows', () => {
  assert.deepEqual(readCsv('id,ID,\na,b\n').issues.map(issue => issue.record), [1, 1, 2]);
});

test('rejects malformed quotes', () => {
  assert.throws(() => readCsv('id\n"unclosed'), /Unclosed quoted field/);
  assert.throws(() => readCsv('id\n"x"y'), /Invalid quotation/);
});
