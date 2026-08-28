begin;

do $$
begin
  if (
    select count(*)
    from public.help_articles
    where lower(slug) in (
      'como-criar-um-lead-no-pipeline',
      'como-criar-e-editar-um-agendamento',
      'como-criar-uma-automacao',
      'como-conectar-o-whatsapp',
      'como-convidar-um-usuario'
    )
  ) <> 5 then
    raise exception 'Expected the five curated screenshot articles before calibrating annotations';
  end if;
end
$$;

update public.help_articles
set steps = jsonb_set(
  jsonb_set(
    steps,
    '{0,imageCaption}',
    to_jsonb('O formulário separa contato, perfil, interesse e gestão antes de salvar o lead.'::text),
    false
  ),
  '{0,annotations}',
  '[{"x":96,"y":4,"label":"1","title":"Feche o formulário sem salvar"},{"x":50,"y":25,"label":"2","title":"Comece pelos dados essenciais do contato"}]'::jsonb,
  false
)
where lower(slug) = 'como-criar-um-lead-no-pipeline';

update public.help_articles
set steps = jsonb_set(
  jsonb_set(
    steps,
    '{0,imageCaption}',
    to_jsonb('O painel reúne título, tipo, período, responsáveis, visibilidade e vínculo com o lead.'::text),
    false
  ),
  '{0,annotations}',
  '[{"x":76,"y":5,"label":"1","title":"Escolha o tipo da atividade"},{"x":75,"y":94,"label":"2","title":"Revise os dados e adicione o compromisso"}]'::jsonb,
  false
)
where lower(slug) = 'como-criar-e-editar-um-agendamento';

update public.help_articles
set steps = jsonb_set(
  jsonb_set(
    steps,
    '{0,imageCaption}',
    to_jsonb('O construtor mostra gatilho, blocos disponíveis, conexões e ações de simular e salvar.'::text),
    false
  ),
  '{0,annotations}',
  '[{"x":93,"y":4,"label":"1","title":"Salve depois de revisar e simular"},{"x":10,"y":19,"label":"2","title":"Arraste os blocos para montar o fluxo"}]'::jsonb,
  false
)
where lower(slug) = 'como-criar-uma-automacao';

update public.help_articles
set steps = jsonb_set(
  jsonb_set(
    steps,
    '{0,imageCaption}',
    to_jsonb('Use Conectar para abrir o fluxo e acompanhe o status atual da integração.'::text),
    false
  ),
  '{0,annotations}',
  '[{"x":50,"y":82,"label":"1","title":"Abra o fluxo de conexão"},{"x":83,"y":12,"label":"2","title":"Confira o status atual"}]'::jsonb,
  false
)
where lower(slug) = 'como-conectar-o-whatsapp';

update public.help_articles
set steps = jsonb_set(
  jsonb_set(
    steps,
    '{0,imageCaption}',
    to_jsonb('Informe o e-mail, escolha a função inicial e envie o convite sem compartilhar senhas.'::text),
    false
  ),
  '{0,annotations}',
  '[{"x":50,"y":18,"label":"1","title":"Informe e-mail e função"},{"x":86,"y":39,"label":"2","title":"Envie o convite"}]'::jsonb,
  false
)
where lower(slug) = 'como-convidar-um-usuario';

commit;
