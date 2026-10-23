import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { prepareLeadPDFPreview } from '@/lib/lead-attachment-preview';

const pdf = '%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n';
test('PDF preview fixes the MIME for valid PDF and octet-stream input', async () => {
  for (const type of ['application/pdf', 'application/octet-stream', '']) {
    const output = await prepareLeadPDFPreview(new Blob([pdf], { type }));
    assert.equal(output.type, 'application/pdf');
    assert.equal(await output.text(), pdf);
  }
});
test('an HTML/SVG masquerading as PDF is rejected even with a PDF prefix', async () => {
  for (const type of ['text/html', 'image/svg+xml']) {
    await assert.rejects(prepareLeadPDFPreview(new Blob([pdf], { type })), /invalid_pdf_type/);
  }
  for (const text of ['%PDF-<p>inert</p>', '%PDF-1.7\n<html>inert</html>', 'empty']) {
    await assert.rejects(prepareLeadPDFPreview(new Blob([text])), /invalid_pdf/);
  }
});
