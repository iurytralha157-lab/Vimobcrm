/** Only validated PDF bytes, with a fixed MIME, may enter the CRM preview. */
export async function prepareLeadPDFPreview(blob: Blob): Promise<Blob> {
  const mime = blob.type.split(';', 1)[0].trim().toLowerCase();
  if (mime && mime !== 'application/pdf' && mime !== 'application/octet-stream') {
    throw new Error('attachment_invalid_pdf_type');
  }
  const header = await blob.slice(0, 16).text();
  const tail = await blob.slice(Math.max(0, blob.size - 1024)).text();
  if (!/^%PDF-(?:1\.[0-9]|2\.0)(?:\r\n|\r|\n)/.test(header) || !/%%EOF\s*$/.test(tail)) {
    throw new Error('attachment_invalid_pdf');
  }
  return blob.slice(0, blob.size, 'application/pdf');
}
