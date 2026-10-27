import assert from 'node:assert/strict';
import test from 'node:test';
// @ts-expect-error -- Node's type-stripping runner needs the extension.
import { createContactExportDownload } from './contact-export-download.ts';

test('retains a download URL until its owner disposes it once', () => {
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  const created: Blob[] = [];
  const revoked: string[] = [];
  URL.createObjectURL = (blob) => {
    assert.ok(blob instanceof Blob);
    created.push(blob);
    return `blob:contact-export-${created.length}`;
  };
  URL.revokeObjectURL = (href) => { revoked.push(href); };

  try {
    const file = { blob: new Blob(['Nome\r\nAna']), filename: 'contatos.csv' };
    const first = createContactExportDownload(file);
    const second = createContactExportDownload({ ...file, filename: 'outro.csv' });

    assert.equal(first.href, 'blob:contact-export-1');
    assert.equal(first.filename, file.filename);
    assert.equal(second.filename, 'outro.csv');
    assert.deepEqual(created, [file.blob, file.blob]);
    assert.deepEqual(revoked, []);

    first.dispose();
    first.dispose();
    assert.deepEqual(revoked, [first.href]);
    second.dispose();
    second.dispose();
    assert.deepEqual(revoked, [first.href, second.href]);
  } finally {
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
  }
});
