-- Operational installer for REDE NARDO IMOVEIS LTDA.
-- Campaign automations are installed inactive. The manual test flow is the
-- only active flow and can only be started explicitly for a selected lead.

create or replace function pg_temp.install_pamella_campaign_automation(
  p_name text,
  p_description text,
  p_trigger_type text,
  p_form_id text,
  p_messages text[],
  p_is_active boolean
)
returns uuid
language plpgsql
as $$
declare
  v_organization_id constant uuid := '4251164b-cfb0-402a-a854-ecae79470561';
  pamella_user_id constant uuid := '6b276283-b5e2-4cd4-89b0-3ca23e49196c';
  pamella_session_id constant uuid := 'bcd852e7-8141-4245-bd8f-02a1700fb541';
  pipeline_id constant uuid := '03c0d601-09af-41a4-85ec-f425d66b1bac';
  in_service_stage_id constant uuid := '35d45cd1-a4fa-437e-818e-9c17fa0fa3b9';
  v_automation_id uuid;
  v_flow_version_id uuid;
  live_node_id uuid;
  version_number integer;
  message_count integer := coalesce(array_length(p_messages, 1), 0);
  index integer;
  message_key text;
  wait_key text;
  timeout_key text;
  next_key text;
  node jsonb;
  connection jsonb;
  node_id_map jsonb := '{}'::jsonb;
  nodes jsonb := jsonb_build_array(
    jsonb_build_object(
      'id', 'trigger',
      'type', 'trigger',
      'action_type', null,
      'position', jsonb_build_object('x', 80, 'y', 120),
      'config', case
        when p_trigger_type = 'lead_created' then jsonb_build_object(
          'trigger_type', 'lead_created',
          'source', 'meta',
          'meta_form_id', p_form_id,
          'filter_user_id', null
        )
        else jsonb_build_object('trigger_type', 'manual')
      end
    )
  );
  connections jsonb := '[]'::jsonb;
  v_graph jsonb;
  v_trigger_config jsonb;
begin
  if message_count < 1 then
    raise exception 'campaign automation requires at least one message';
  end if;
  if p_trigger_type not in ('lead_created', 'manual') then
    raise exception 'unsupported campaign trigger type';
  end if;

  v_trigger_config := case
    when p_trigger_type = 'lead_created' then jsonb_build_object(
      'source', 'meta',
      'meta_form_id', p_form_id,
      'filter_user_id', null
    )
    else '{}'::jsonb
  end;

  connections := connections || jsonb_build_array(jsonb_build_object(
    'source', 'trigger',
    'target', 'message_1',
    'source_handle', null,
    'condition_branch', null
  ));

  for index in 1..message_count loop
    message_key := 'message_' || index::text;
    wait_key := 'wait_' || index::text;
    timeout_key := 'timeout_' || index::text;

    nodes := nodes || jsonb_build_array(
      jsonb_build_object(
        'id', message_key,
        'type', 'action',
        'action_type', 'send_whatsapp',
        'position', jsonb_build_object('x', 340 + ((index - 1) * 760), 'y', 120),
        'config', jsonb_build_object(
          'session_id', pamella_session_id,
          'message', p_messages[index],
          'actionType', 'send_whatsapp'
        )
      ),
      jsonb_build_object(
        'id', wait_key,
        'type', 'delay',
        'action_type', null,
        'position', jsonb_build_object('x', 610 + ((index - 1) * 760), 'y', 120),
        'config', jsonb_build_object(
          'delay_type', 'hours',
          'delay_value', 168,
          'stop_on_reply', true,
          'handoff_on_non_text', true,
          'reply_match_mode', 'any_text',
          'expected_reply_keywords', jsonb_build_array(),
          'handoff_on_unmatched_reply', true,
          'handoff_after_message_burst', 3,
          'nodeType', 'delay'
        )
      ),
      jsonb_build_object(
        'id', timeout_key,
        'type', 'action',
        'action_type', 'send_whatsapp',
        'position', jsonb_build_object('x', 880 + ((index - 1) * 760), 'y', 340),
        'config', jsonb_build_object(
          'session_id', pamella_session_id,
          'message', 'Oi {{lead.name}}, sigo por aqui quando você puder continuar. Se preferir, é só responder esta conversa.',
          'actionType', 'send_whatsapp'
        )
      )
    );

    connections := connections
      || jsonb_build_array(
        jsonb_build_object(
          'source', message_key,
          'target', wait_key,
          'source_handle', null,
          'condition_branch', null
        ),
        jsonb_build_object(
          'source', wait_key,
          'target', timeout_key,
          'source_handle', 'no_reply',
          'condition_branch', 'no_reply'
        )
      );

    if index = 1 then
      nodes := nodes || jsonb_build_array(jsonb_build_object(
        'id', 'move_to_in_service',
        'type', 'action',
        'action_type', 'move_lead',
        'position', jsonb_build_object('x', 880, 'y', 40),
        'config', jsonb_build_object(
          'pipeline_id', pipeline_id,
          'stage_id', in_service_stage_id,
          'stage_name', 'EM ATENDIMENTO',
          'actionType', 'move_stage'
        )
      ));
      connections := connections || jsonb_build_array(jsonb_build_object(
        'source', wait_key,
        'target', 'move_to_in_service',
        'source_handle', 'replied',
        'condition_branch', 'replied'
      ));
      if message_count > 1 then
        connections := connections || jsonb_build_array(jsonb_build_object(
          'source', 'move_to_in_service',
          'target', 'message_2',
          'source_handle', null,
          'condition_branch', null
        ));
      end if;
    elsif index < message_count then
      next_key := 'message_' || (index + 1)::text;
      connections := connections || jsonb_build_array(jsonb_build_object(
        'source', wait_key,
        'target', next_key,
        'source_handle', 'replied',
        'condition_branch', 'replied'
      ));
    end if;
  end loop;

  nodes := nodes || jsonb_build_array(jsonb_build_object(
    'id', 'assign_pamella',
    'type', 'action',
    'action_type', 'assign_user',
    'position', jsonb_build_object('x', 1040 + ((message_count - 1) * 760), 'y', 40),
    'config', jsonb_build_object(
      'user_id', pamella_user_id,
      'user_name', 'Pâmella',
      'actionType', 'assign_user'
    )
  ));

  nodes := nodes || jsonb_build_array(jsonb_build_object(
    'id', 'acknowledgement',
    'type', 'action',
    'action_type', 'send_whatsapp',
    'position', jsonb_build_object('x', 1120 + ((message_count - 1) * 760), 'y', 40),
    'config', jsonb_build_object(
      'session_id', pamella_session_id,
      'message', 'Obrigado, {{lead.name}}! Já tenho as informações iniciais. A Pâmella foi notificada e vai seguir com você por aqui.',
      'actionType', 'send_whatsapp'
    )
  ));

  if message_count = 1 then
    connections := connections || jsonb_build_array(jsonb_build_object(
      'source', 'move_to_in_service',
      'target', 'assign_pamella',
      'source_handle', null,
      'condition_branch', null
    ));
  else
    connections := connections || jsonb_build_array(jsonb_build_object(
      'source', 'wait_' || message_count::text,
      'target', 'assign_pamella',
      'source_handle', 'replied',
      'condition_branch', 'replied'
    ));
  end if;

  connections := connections || jsonb_build_array(jsonb_build_object(
    'source', 'assign_pamella',
    'target', 'acknowledgement',
    'source_handle', null,
    'condition_branch', null
  ));

  v_graph := jsonb_build_object(
    'nodes', nodes,
    'connections', connections,
    'settings', jsonb_build_object(
      'owner', 'Pamella',
      'handoff_policy', 'human_or_non_text_or_message_burst',
      'script_source', 'ATENDIMENTO - LANCAMENTO.pdf'
    )
  );

  select a.id
  into v_automation_id
  from public.automations a
  where a.organization_id = v_organization_id
    and a.name = p_name
    and a.deleted_at is null
  order by a.created_at desc
  limit 1
  for update;

  if v_automation_id is null then
    insert into public.automations (
      organization_id, name, description, is_active, trigger_type,
      trigger_config, flow_definition, created_by
    ) values (
      v_organization_id, p_name, p_description, false, p_trigger_type,
      v_trigger_config, v_graph, pamella_user_id
    ) returning id into v_automation_id;
  else
    update public.automations
    set description = p_description,
        is_active = false,
        trigger_type = p_trigger_type,
        trigger_config = v_trigger_config,
        flow_definition = v_graph,
        created_by = coalesce(created_by, pamella_user_id),
        updated_at = now()
    where id = v_automation_id and organization_id = v_organization_id;

    delete from public.automation_connections c where c.automation_id = v_automation_id;
    delete from public.automation_nodes n where n.automation_id = v_automation_id;
  end if;

  for node in select value from jsonb_array_elements(nodes)
  loop
    insert into public.automation_nodes (
      automation_id, node_type, action_type, node_config, position_x, position_y
    ) values (
      v_automation_id,
      node->>'type',
      nullif(node->>'action_type', ''),
      coalesce(node->'config', '{}'::jsonb),
      coalesce((node->'position'->>'x')::numeric, 0),
      coalesce((node->'position'->>'y')::numeric, 0)
    ) returning id into live_node_id;
    node_id_map := jsonb_set(node_id_map, array[node->>'id'], to_jsonb(live_node_id::text), true);
  end loop;

  for connection in select value from jsonb_array_elements(connections)
  loop
    insert into public.automation_connections (
      automation_id, source_node_id, target_node_id, source_handle, condition_branch
    ) values (
      v_automation_id,
      (node_id_map->>(connection->>'source'))::uuid,
      (node_id_map->>(connection->>'target'))::uuid,
      nullif(connection->>'source_handle', ''),
      coalesce(nullif(connection->>'condition_branch', ''), 'default')
    );
  end loop;

  select coalesce(max(fv.version), 0) + 1
  into version_number
  from public.automation_flow_versions fv
  where fv.automation_id = v_automation_id;

  insert into public.automation_flow_versions (
    automation_id, organization_id, version, trigger_type, trigger_config,
    graph, graph_checksum, first_node_key, created_by, published_at, requires_review
  ) values (
    v_automation_id, v_organization_id, version_number, p_trigger_type, v_trigger_config,
    v_graph, md5(v_graph::text), 'message_1', pamella_user_id, now(), false
  ) returning id into v_flow_version_id;

  update public.automations
  set active_flow_version_id = v_flow_version_id,
      is_active = p_is_active,
      updated_at = now()
  where id = v_automation_id and organization_id = v_organization_id;

  return v_automation_id;
end;
$$;

select pg_temp.install_pamella_campaign_automation(
  'ENTENDA COMO FUNCIONA A FAIXA 3 MINHA CASA MINHA VIDA',
  'Pre-atendimento personalizado da campanha Meta Colinas do Lago. Instalado inativo para ativacao apos homologacao no telefone autorizado.',
  'lead_created',
  '1330693785846161',
  array[
    'Olá {{lead.name}}, tudo bem? Aqui é a Pâmella, da Rede Nardo Imóveis. Vi seu interesse no Colinas do Lago. Você está buscando um imóvel para morar ou investir?',
    'Perfeito! O que mais chamou sua atenção no anúncio do Colinas do Lago?',
    'Você pretende comprar agora ou está pesquisando para os próximos meses?',
    'Que bom saber disso. Você gostaria de receber mais detalhes primeiro ou prefere agendar uma visita?'
  ],
  false
);

select pg_temp.install_pamella_campaign_automation(
  'Campanha | Atendimento Raizes Lancamento',
  'Pre-atendimento personalizado da campanha Meta Raizes Lancamento. Instalado inativo para ativacao apos homologacao no telefone autorizado.',
  'lead_created',
  '1279989937281978',
  array[
    'Olá {{lead.name}}, tudo bem? Aqui é a Pâmella, da Rede Nardo Imóveis. Vi seu interesse no lançamento Raízes. O imóvel seria para morar ou investir?',
    'Perfeito! Para eu entender as melhores possibilidades, qual é a renda familiar aproximada?',
    'Você pretende financiar, usar FGTS ou fazer a compra à vista?',
    'Você tem preferência por uma unidade com jardim ou com sacada?',
    'A ideia é comprar agora ou nos próximos meses?',
    'Com esse perfil, uma visita pode ajudar bastante. Para você funciona melhor durante a semana ou no sábado?'
  ],
  false
);

select pg_temp.install_pamella_campaign_automation(
  'Campanha | Atendimento Popo Pronto',
  'Pre-atendimento personalizado da campanha Meta MCMV Popo Pronto. Instalado inativo para ativacao apos homologacao no telefone autorizado.',
  'lead_created',
  '1946305462691780',
  array[
    'Olá {{lead.name}}, tudo bem? Aqui é a Pâmella, da Rede Nardo Imóveis. Vi seu interesse na opção pronta do anúncio Popó pelo Minha Casa Minha Vida. Você quer sair do aluguel, morar com a família ou investir?',
    'Perfeito! Qual é a renda familiar aproximada?',
    'Hoje você trabalha registrado ou como autônomo?',
    'Você tem FGTS ou alguma reserva para usar na entrada?',
    'A ideia é comprar agora ou está se organizando para os próximos meses?',
    'Podemos fazer uma visita rápida para você conhecer melhor. Funciona melhor durante a semana ou no sábado?'
  ],
  false
);

select pg_temp.install_pamella_campaign_automation(
  'Campanha | Atendimento Prontos Rendas',
  'Pre-atendimento personalizado da campanha Meta MCMV Prontos Rendas. Instalado inativo para ativacao apos homologacao no telefone autorizado.',
  'lead_created',
  '1910587779617517',
  array[
    'Olá {{lead.name}}, tudo bem? Aqui é a Pâmella, da Rede Nardo Imóveis. Vi seu interesse na campanha Prontos Rendas pelo Minha Casa Minha Vida. Você quer sair do aluguel, morar com a família ou investir?',
    'Perfeito! Qual é a renda familiar aproximada?',
    'Hoje você trabalha registrado ou como autônomo?',
    'Você tem FGTS ou alguma reserva para usar na entrada?',
    'A ideia é comprar agora ou está se organizando para os próximos meses?',
    'Podemos fazer uma visita rápida para você conhecer melhor. Funciona melhor durante a semana ou no sábado?'
  ],
  false
);

select pg_temp.install_pamella_campaign_automation(
  'TESTE | Atendimento Raizes | Andre 22974063727',
  'Fluxo manual isolado para homologacao no telefone autorizado 22 97406-3727. Nao possui gatilho de novos leads.',
  'manual',
  null,
  array[
    '[TESTE VIMOB] Olá {{lead.name}}, tudo bem? Aqui é a Pâmella, da Rede Nardo Imóveis. Vi seu interesse no lançamento Raízes. O imóvel seria para morar ou investir?',
    '[TESTE VIMOB] Perfeito! Para eu entender as melhores possibilidades, qual é a renda familiar aproximada?',
    '[TESTE VIMOB] Você pretende financiar, usar FGTS ou fazer a compra à vista?'
  ],
  true
);
