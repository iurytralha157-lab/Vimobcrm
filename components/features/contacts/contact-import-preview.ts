import { leadCreateInputSchema } from '@/lib/validation/leads';
import { parseContactTags } from '@/lib/contact-tag-transfer';

export interface ImportContactPreviewRow {
  rowNumber: number;
  nome: string;
  telefone?: string;
  email?: string;
  pipeline?: string;
  estagio?: string;
  responsavel?: string;
  tags?: string;
  fonte?: string;
  mensagem?: string;
  status?: string;
  motivo_perda?: string;
  pipeline_id?: string;
  stage_id?: string;
  assigned_user_id?: string;
}

/** Local sample only. Destination, permissions, reentry and distribution remain server decisions. */
export function buildImportContactSample(rows: readonly ImportContactPreviewRow[], limit = 6) {
  return rows.slice(0, Math.max(0, Math.min(20, limit))).map((row) => {
    const tags = parseContactTags(row.tags || '');
    const validation = leadCreateInputSchema.safeParse({
      name: row.nome.trim(),
      phone: row.telefone?.trim() || undefined,
      email: row.email?.trim() || undefined,
    });
    return {
      ...row,
      tagNames: tags.names,
      issues: Array.from(new Set([...(validation.success ? [] : validation.error.issues.map((issue) => issue.message)), ...(tags.error ? [tags.error] : [])])),
    };
  });
}
