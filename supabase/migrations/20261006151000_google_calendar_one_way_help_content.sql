-- Align the seeded Help Center article with the outbound-only calendar contract.
-- Leave customized articles untouched for manual review.
update public.help_articles
set summary = 'Conecte sua conta Google para enviar compromissos criados no Vimob à sua agenda.',
    content = 'A integração fica dentro da Agenda. Usuários autorizados podem conectar ou desconectar a conta Google. Compromissos criados, alterados ou excluídos no Vimob são enviados ao Google Agenda. Eventos criados ou alterados no Google não entram no Vimob.',
    steps = '[
      {"id":"google-1","title":"Abra Google Agenda","body":"Na barra da Agenda, selecione Google Agenda.","actionLabel":"Abrir Agenda","actionHref":"/agenda"},
      {"id":"google-2","title":"Autorize a conta correta","body":"Confira qual conta Google está aberta antes de aceitar o acesso."},
      {"id":"google-3","title":"Teste um compromisso","body":"Depois de conectar, crie ou altere um compromisso de teste no Vimob e confira o resultado no Google Agenda."},
      {"id":"google-4","title":"Teste a exclusão","body":"Exclua o compromisso de teste no Vimob e confirme a remoção do evento vinculado no Google após o processamento."}
    ]'::jsonb,
    last_reviewed_at = now()
where id = '20000000-0000-4000-8000-000000000223'::uuid
  and slug = 'como-conectar-o-google-agenda'
  and summary = 'Autorize sua conta Google, ajuste a sincronização e confirme o estado da conexão.'
  and steps->2->>'title' = 'Ajuste a sincronização'
  and steps->3->>'title' = 'Sincronize e valide';
