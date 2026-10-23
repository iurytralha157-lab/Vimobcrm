'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useUploadLeadAttachment } from '@/hooks/use-lead-attachments';
import { uploadLeadFiles } from '@/lib/lead-edit-session';
import { FORM_WIZARD_PRIMARY_BUTTON_CLASS_NAME, FORM_WIZARD_SECONDARY_BUTTON_CLASS_NAME } from '@/config/form-wizard';

export function LeadAttachmentRecovery({ leadId, files, canUpload, onFinish, onRunningChange }: {
  leadId: string;
  files: File[];
  canUpload: boolean;
  onFinish: () => void;
  onRunningChange: (running: boolean) => void;
}) {
  const [pending, setPending] = useState(files);
  const [running, setRunning] = useState(false);
  const active = useRef(true);
  const runningRef = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const upload = useUploadLeadAttachment();
  const retry = async () => {
    if (runningRef.current || !canUpload || !active.current) return;
    runningRef.current = true;
    setRunning(true);
    onRunningChange(true);
    try {
      const failed = await uploadLeadFiles(pending, (file) => {
        if (!active.current) return Promise.reject(new Error('Operation closed'));
        return upload.mutateAsync({ leadId, file });
      });
      if (!active.current) return;
      setPending(failed);
      if (failed.length === 0) onFinish();
    } finally {
      runningRef.current = false;
      if (active.current) { setRunning(false); onRunningChange(false); }
    }
  };
  return <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-6" role="status">
    <p className="text-sm">O contato foi salvo. {pending.length} documento(s) continuam pendentes.</p>
    {!canUpload && <p className="text-sm text-[var(--app-text-secondary)]">Você não possui permissão para anexar documentos a este contato. Solicite ao responsável que os anexe.</p>}
    <ul className="space-y-2 text-sm">{pending.map((file, index) => <li key={index} className="break-all">{file.name}</li>)}</ul>
    <div className="flex flex-wrap justify-end gap-2">
      <Button variant="outline" className={FORM_WIZARD_SECONDARY_BUTTON_CLASS_NAME} disabled={running} onClick={onFinish}>Concluir sem os documentos pendentes</Button>
      {canUpload && <Button className={FORM_WIZARD_PRIMARY_BUTTON_CLASS_NAME} disabled={running || pending.length === 0} onClick={() => void retry()}>{running ? 'Enviando...' : 'Reenviar documentos pendentes'}</Button>}
    </div>
  </div>;
}
