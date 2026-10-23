export type ContactExportPage<T> = {
  data: T[];
  total: number;
  page: number;
  limit: number;
  exportVersion?: string;
};

type ExportPageQuery = { page: number; limit: number; expectedExportVersion?: string };

const CHANGED_MESSAGE = 'A lista de contatos mudou durante a exportação. Tente novamente para gerar um arquivo completo.';

export async function collectContactExportPages<T extends { id: string }>({
  fetchPage,
  signal,
  onProgress,
}: {
  fetchPage: (query: ExportPageQuery, signal?: AbortSignal) => Promise<ContactExportPage<T>>;
  signal?: AbortSignal;
  onProgress?: (progress: { processed: number; total: number | null }) => void;
}) {
  const limit = 500;
  const contacts: T[] = [];
  const ids = new Set<string>();
  let version: string | undefined;
  let total: number | undefined;
  let page = 1;

  const checkPage = (result: ContactExportPage<T>, requestedPage: number, requestedLimit: number) => {
    if (!result.exportVersion || !Number.isSafeInteger(result.total) || result.total < 0
      || result.page !== requestedPage || result.limit !== requestedLimit) {
      throw new Error('Não foi possível confirmar a integridade da exportação. Atualize a página e tente novamente.');
    }
    if (version !== undefined && (result.exportVersion !== version || result.total !== total)) {
      throw new Error(CHANGED_MESSAGE);
    }
    version = result.exportVersion;
    total = result.total;
  };

  onProgress?.({ processed: 0, total: null });
  while (page <= 10_000) {
    signal?.throwIfAborted();
    const result = await fetchPage({ page, limit, expectedExportVersion: version }, signal);
    signal?.throwIfAborted();
    checkPage(result, page, limit);
    for (const contact of result.data) {
      if (ids.has(contact.id)) throw new Error(CHANGED_MESSAGE);
      ids.add(contact.id);
      contacts.push(contact);
    }
    onProgress?.({ processed: contacts.length, total: result.total });
    if (contacts.length === result.total) break;
    if (contacts.length > result.total || result.data.length !== limit) throw new Error(CHANGED_MESSAGE);
    page += 1;
  }
  if (contacts.length !== total) throw new Error(CHANGED_MESSAGE);

  return {
    contacts,
    // This detects changes between page reads and during file generation; it is
    // a final version check, not a transaction spanning the browser download.
    verifyVersion: async () => {
      signal?.throwIfAborted();
      const result = await fetchPage({ page: 1, limit: 1, expectedExportVersion: version }, signal);
      signal?.throwIfAborted();
      checkPage(result, 1, 1);
    },
  };
}

export async function prepareContactExportDownload<T>(
  generate: () => Promise<T>,
  beforeDownload?: () => Promise<void>,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const file = await generate();
  signal?.throwIfAborted();
  await beforeDownload?.();
  signal?.throwIfAborted();
  return file;
}
