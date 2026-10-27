export type ContactExportFile = {
  blob: Blob;
  filename: string;
};

export type ContactExportDownload = {
  href: string;
  filename: string;
  dispose: () => void;
};

export function createContactExportDownload(file: ContactExportFile): ContactExportDownload {
  const href = URL.createObjectURL(file.blob);
  let disposed = false;

  return {
    href,
    filename: file.filename,
    dispose() {
      if (disposed) return;
      disposed = true;
      URL.revokeObjectURL(href);
    },
  };
}
