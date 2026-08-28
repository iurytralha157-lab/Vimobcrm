import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function normalizePhone(phone?: string | null) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('55') && digits.length >= 12) return digits;
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits;
}

function firstName(name?: string | null) {
  const clean = String(name || '').trim();
  if (!clean) return '';
  return clean.split(/\s+/)[0];
}

function cleanText(value?: string | null, limit = 180) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit);
}

async function getLatestQueueIdForLead(supabase: any, leadId: string, fallbackQueueId?: string | null) {
  if (fallbackQueueId) return fallbackQueueId;

  const { data } = await supabase
    .from('assignments_log')
    .select('round_robin_id')
    .eq('lead_id', leadId)
    .not('round_robin_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return data?.round_robin_id || null;
}

async function buildFirstContactInterest(supabase: any, lead: any, organizationId: string) {
  if (lead?.interest_property_id) {
    const { data: property } = await supabase
      .from('properties')
      .select('code, title, tipo_de_imovel, bairro, cidade, quartos, area_util, preco')
      .eq('id', lead.interest_property_id)
      .eq('organization_id', organizationId)
      .maybeSingle();

    if (property) {
      const code = property.code ? ` ${property.code}` : '';
      const type = property.tipo_de_imovel || property.title || 'imovel';
      const area = property.area_util ? `, ${Number(property.area_util)} m2` : '';
      const rooms = property.quartos ? `, ${property.quartos} quartos` : '';
      const region = property.bairro ? ` em ${property.bairro}` : property.cidade ? ` em ${property.cidade}` : '';
      return `pelo ${type}${code}${region}${rooms}${area}`;
    }
  }

  if (lead?.interest_plan_id) {
    const { data: plan } = await supabase
      .from('service_plans')
      .select('name, price')
      .eq('id', lead.interest_plan_id)
      .eq('organization_id', organizationId)
      .maybeSingle();

    if (plan) return `pelo empreendimento ${plan.name}`;
  }

  if (lead?.message) return 'em conversar com a nossa equipe';
  return 'em uma oportunidade';
}

async function getOrganizationAIReady(supabase: any, organizationId: string) {
  const { data: agent } = await supabase
    .from('ai_global_agents')
    .select('id, is_active')
    .eq('slug', 'jenny')
    .eq('is_active', true)
    .maybeSingle();

  if (!agent?.id) return false;

  const { data: setting } = await supabase
    .from('ai_organization_settings')
    .select('is_enabled, mode')
    .eq('organization_id', organizationId)
    .eq('agent_id', agent.id)
    .maybeSingle();

  return !!setting?.is_enabled && setting.mode === 'auto';
}

async function sendAIFirstContactNow(
  supabase: any,
  input: {
    leadId: string;
    organizationId: string;
    roundRobinId?: string | null;
    supabaseUrl: string;
    serviceRoleKey: string;
  },
) {
  const queueId = await getLatestQueueIdForLead(supabase, input.leadId, input.roundRobinId);
  if (!queueId) return { sent: false, reason: 'no_queue' };

  const { data: queue } = await supabase
    .from('round_robins')
    .select('id, name, organization_id, is_active, settings')
    .eq('id', queueId)
    .eq('organization_id', input.organizationId)
    .maybeSingle();

  const settings = queue?.settings && typeof queue.settings === 'object' ? queue.settings : {};
  if (!queue?.is_active || !settings.ai_first_contact_enabled) return { sent: false, reason: 'disabled' };

  const aiReady = await getOrganizationAIReady(supabase, input.organizationId);
  if (!aiReady) return { sent: false, reason: 'ai_not_auto' };

  const sessionId = settings.ai_first_contact_session_id;
  if (!sessionId) return { sent: false, reason: 'missing_session' };

  const { data: duplicateActivity } = await supabase
    .from('activities')
    .select('id')
    .eq('lead_id', input.leadId)
    .eq('type', 'ai_first_contact_sent')
    .limit(1);

  if (duplicateActivity?.length) return { sent: false, reason: 'already_sent' };

  const { data: lead } = await supabase
    .from('leads')
    .select('id, organization_id, name, phone, message, interest_property_id, interest_plan_id, assigned_user_id')
    .eq('id', input.leadId)
    .eq('organization_id', input.organizationId)
    .maybeSingle();

  if (!lead?.phone) return { sent: false, reason: 'missing_phone' };

  const { data: session } = await supabase
    .from('whatsapp_sessions')
    .select('id, organization_id, status')
    .eq('id', sessionId)
    .eq('organization_id', input.organizationId)
    .eq('status', 'connected')
    .maybeSingle();

  if (!session?.id) return { sent: false, reason: 'session_not_connected' };

  const phone = normalizePhone(lead.phone);
  if (!phone) return { sent: false, reason: 'invalid_phone' };

  const remoteJid = `${phone}@s.whatsapp.net`;
  const { data: org } = await supabase
    .from('organizations')
    .select('name')
    .eq('id', input.organizationId)
    .maybeSingle();

  let { data: conversation } = await supabase
    .from('whatsapp_conversations')
    .select('id, session_id, remote_jid, lead_id')
    .eq('organization_id', input.organizationId)
    .eq('lead_id', input.leadId)
    .is('deleted_at', null)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  if (!conversation) {
    const { data: byJid } = await supabase
      .from('whatsapp_conversations')
      .select('id, session_id, remote_jid, lead_id')
      .eq('session_id', session.id)
      .eq('remote_jid', remoteJid)
      .maybeSingle();
    conversation = byJid;
  }

  if (!conversation) {
    const { data: inserted, error: convError } = await supabase
      .from('whatsapp_conversations')
      .insert({
        organization_id: input.organizationId,
        session_id: session.id,
        lead_id: input.leadId,
        remote_jid: remoteJid,
        contact_name: lead.name || null,
        contact_phone: lead.phone || phone,
        unread_count: 0,
        is_group: false,
      })
      .select('id, session_id, remote_jid, lead_id')
      .single();

    if (convError) {
      console.error('[generic-webhook] first contact conversation error:', convError);
      return { sent: false, reason: 'conversation_error' };
    }
    conversation = inserted;
  } else if (!conversation.lead_id) {
    await supabase
      .from('whatsapp_conversations')
      .update({ lead_id: input.leadId, contact_name: lead.name || null, contact_phone: lead.phone || phone })
      .eq('id', conversation.id);
  }

  const name = firstName(lead.name);
  const company = org?.name || 'nossa equipe';
  const interest = await buildFirstContactInterest(supabase, lead, input.organizationId);
  const customQuestion = cleanText(settings.ai_first_contact_prompt, 160);
  const question = customQuestion || 'Me conta rapidinho: voce procura para morar ou investir?';
  const greeting = name ? `Oi, ${name}! Tudo bem?` : 'Oi! Tudo bem?';
  const content = `${greeting} Aqui e a Jhenny da ${company}. Vi que voce se interessou ${interest}. ${question}`;
  const clientMessageId = `jhenny-first-${crypto.randomUUID()}`;
  const now = new Date().toISOString();

  const { error: outboxError } = await supabase.from('outbox_messages').insert({
    conversation_id: conversation.id,
    session_id: conversation.session_id || session.id,
    organization_id: input.organizationId,
    content,
    message_type: 'text',
    status: 'pending',
    created_by: null,
    client_message_id: clientMessageId,
  });

  if (outboxError) {
    console.error('[generic-webhook] first contact outbox error:', outboxError);
    return { sent: false, reason: 'outbox_error' };
  }

  const { error: historyError } = await supabase
    .from('whatsapp_messages')
    .upsert({
      conversation_id: conversation.id,
      session_id: conversation.session_id || session.id,
      organization_id: input.organizationId,
      lead_id: input.leadId,
      message_id: clientMessageId,
      client_message_id: clientMessageId,
      from_me: true,
      content,
      message_type: 'text',
      remote_jid: conversation.remote_jid || remoteJid,
      status: 'pending',
      sent_at: now,
      sender_name: 'Jhenny',
    }, { onConflict: 'session_id,message_id' });

  if (historyError) {
    console.error('[generic-webhook] first contact history error:', historyError);
    return { sent: false, reason: 'history_error' };
  }

  await supabase
    .from('whatsapp_conversations')
    .update({
      last_message: content,
      last_message_at: now,
      unread_count: 0,
      updated_at: now,
    })
    .eq('id', conversation.id);

  await supabase.from('activities').insert({
    lead_id: input.leadId,
    type: 'ai_first_contact_sent',
    content: `Jhenny iniciou o primeiro atendimento pela fila "${queue.name || 'Distribuicao'}"`,
    user_id: null,
    metadata: {
      queue_id: queue.id,
      queue_name: queue.name,
      conversation_id: conversation.id,
      session_id: conversation.session_id || session.id,
      is_automation: true,
    },
  });

  try {
    await fetch(`${input.supabaseUrl}/functions/v1/message-sender`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${input.serviceRoleKey}`,
      },
      body: JSON.stringify({ source: 'ai_first_contact' }),
    });
  } catch (error) {
    console.error('[generic-webhook] first contact message-sender trigger error:', error);
  }

  return { sent: true, conversation_id: conversation.id };
}

async function maybeScheduleAIFirstContact(
  supabase: any,
  input: {
    leadId: string;
    organizationId: string;
    roundRobinId?: string | null;
    supabaseUrl: string;
    serviceRoleKey: string;
  },
) {
  const queueId = await getLatestQueueIdForLead(supabase, input.leadId, input.roundRobinId);
  if (!queueId) return { scheduled: false, reason: 'no_queue' };

  const { data: queue } = await supabase
    .from('round_robins')
    .select('settings')
    .eq('id', queueId)
    .eq('organization_id', input.organizationId)
    .maybeSingle();

  const settings = queue?.settings && typeof queue.settings === 'object' ? queue.settings : {};
  if (!settings.ai_first_contact_enabled) return { scheduled: false, reason: 'disabled' };

  const delayMinutes = Math.max(0, Math.min(5, Number(settings.ai_first_contact_delay_minutes || 0)));
  const task = async () => {
    if (delayMinutes > 0) await sleep(delayMinutes * 60 * 1000);
    const result = await sendAIFirstContactNow(supabase, { ...input, roundRobinId: queueId });
    console.log('[generic-webhook] AI first contact result:', result);
    return result;
  };

  if (delayMinutes > 0 && (globalThis as any).EdgeRuntime?.waitUntil) {
    (globalThis as any).EdgeRuntime.waitUntil(task());
    return { scheduled: true, delayed: true, delay_minutes: delayMinutes };
  }

  return await task();
}

Deno.serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Only accept POST
    if (req.method !== 'POST') {
      return new Response(
        JSON.stringify({ error: 'Method not allowed' }),
        { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get authorization header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ error: 'Missing or invalid authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const token = authHeader.replace('Bearer ', '');

    // Initialize Supabase client with service role
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Find webhook by token
    const { data: webhook, error: webhookError } = await supabase
      .from('webhooks_integrations')
      .select('*, pipeline:pipelines(id, name), team:teams(id, name), stage:stages(id, name)')
      .eq('api_token', token)
      .eq('is_active', true)
      .eq('type', 'incoming')
      .single();

    if (webhookError || !webhook) {
      console.error('Webhook lookup error:', webhookError);
      return new Response(
        JSON.stringify({ error: 'Invalid or inactive webhook token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse request body
    const body = await req.json();
    console.log('Received webhook data:', JSON.stringify(body));

    // Apply field mapping - use default if field_mapping is null, undefined or empty object
    const defaultMapping = {
      name: 'name',
      phone: 'phone',
      email: 'email',
      message: 'message',
      renda_familiar: 'renda_familiar',
      trabalha: 'trabalha',
      profissao: 'profissao',
      faixa_valor_imovel: 'faixa_valor_imovel',
      finalidade_compra: 'finalidade_compra',
      procura_financiamento: 'procura_financiamento',
    };
    
    // Extract interest IDs from field_mapping (these are stored directly, not as field mappings)
    const interestPropertyId = webhook.field_mapping?.interest_property_id || null;
    const interestPlanId = webhook.field_mapping?.interest_plan_id || null;
    
    // Get actual field mapping (filter out interest configs)
    const fieldMapping = Object.fromEntries(
      Object.entries(webhook.field_mapping || {}).filter(
        ([key]) => !key.startsWith('interest_')
      )
    );
    
    const effectiveMapping = Object.keys(fieldMapping).length > 0 ? fieldMapping : defaultMapping;
    
    console.log('Using field mapping:', JSON.stringify(effectiveMapping));
    console.log('Interest property ID:', interestPropertyId);
    console.log('Interest plan ID:', interestPlanId);

    const mappedData: Record<string, any> = {};
    for (const [targetField, sourceField] of Object.entries(effectiveMapping)) {
      const srcField = sourceField as string;
      if (body[srcField] !== undefined) {
        mappedData[targetField] = body[srcField];
      }
    }

    // ===== RESOLVE DYNAMIC PROPERTY/PLAN FROM PAYLOAD =====
    let resolvedPropertyId = interestPropertyId;
    let resolvedPlanId = interestPlanId;
    let valorInteresse = null;
    
    // Check for property_id in payload (can be UUID or code like "AP0004")
    const payloadPropertyId = body.property_id || mappedData.property_id;
    if (payloadPropertyId) {
      console.log('Looking up property by:', payloadPropertyId);
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payloadPropertyId);
      if (isUuid) {
        const { data: prop } = await supabase.from('properties').select('id').eq('id', payloadPropertyId).eq('organization_id', webhook.organization_id).maybeSingle();
        if (prop) resolvedPropertyId = prop.id;
      } else {
        const { data: prop } = await supabase.from('properties').select('id').eq('code', payloadPropertyId).eq('organization_id', webhook.organization_id).maybeSingle();
        if (prop) resolvedPropertyId = prop.id;
      }
    }
    
    // Check for plan_id in payload
    const payloadPlanId = body.plan_id || mappedData.plan_id;
    if (payloadPlanId) {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payloadPlanId);
      if (isUuid) {
        const { data: plan } = await supabase.from('service_plans').select('id').eq('id', payloadPlanId).eq('organization_id', webhook.organization_id).maybeSingle();
        if (plan) resolvedPlanId = plan.id;
      } else {
        const { data: plan } = await supabase.from('service_plans').select('id').eq('code', payloadPlanId).eq('organization_id', webhook.organization_id).maybeSingle();
        if (plan) resolvedPlanId = plan.id;
      }
    }

    if (resolvedPropertyId) {
      const { data: propData } = await supabase.from('properties').select('preco').eq('id', resolvedPropertyId).maybeSingle();
      if (propData?.preco) valorInteresse = propData.preco;
    } else if (resolvedPlanId) {
      const { data: planData } = await supabase.from('service_plans').select('price').eq('id', resolvedPlanId).maybeSingle();
      if (planData?.price) valorInteresse = planData.price;
    }

    if (!mappedData.name) {
      return new Response(
        JSON.stringify({ error: 'Field "name" is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ===== DEDUPLICAÇÃO POR TELEFONE =====
    let existingLead = null;
    if (mappedData.phone) {
      // Normalizar telefone
      const normalizedPhone = mappedData.phone.replace(/\D/g, '');
      const phoneWithoutCountry = normalizedPhone.length >= 12 && normalizedPhone.startsWith('55') 
        ? normalizedPhone.substring(2) 
        : normalizedPhone;
      
      // Buscar leads existentes
      const { data: allLeads } = await supabase
        .from('leads')
        .select('id, phone, stage_id, pipeline_id, assigned_user_id, deal_status')
        .eq('organization_id', webhook.organization_id)
        .not('phone', 'is', null);
      
      // Verificar se algum lead tem telefone que combina
      existingLead = allLeads?.find((l: { id: string; phone: string | null }) => {
        if (!l.phone) return false;
        const leadPhone = l.phone.replace(/\D/g, '');
        const leadPhoneWithoutCountry = leadPhone.length >= 12 && leadPhone.startsWith('55')
          ? leadPhone.substring(2)
          : leadPhone;
        return leadPhoneWithoutCountry === phoneWithoutCountry || leadPhone === normalizedPhone;
      });
    }

    // Se encontrou lead existente, fazer REENTRADA COMPLETA
    if (existingLead) {
      console.log(`Found existing lead by phone: ${existingLead.id}`);
      
      // Guardar dados anteriores para o histórico
      const oldStageId = existingLead.stage_id;
      const oldPipelineId = existingLead.pipeline_id;
      const oldAssigneeId = existingLead.assigned_user_id;
      const oldDealStatus = existingLead.deal_status;
      
      // Verificar configuração de reentrada na fila de distribuição
      // Primeiro, buscar a fila que seria usada para este lead
      const { data: matchingQueue } = await supabase
        .rpc('pick_round_robin_for_lead', { p_lead_id: existingLead.id });
      const matchingQueueId = matchingQueue || null;
      
      let queueReentryBehavior = 'redistribute'; // default
      if (matchingQueueId) {
        const { data: queueData } = await supabase
          .from('round_robins')
          .select('reentry_behavior')
          .eq('id', matchingQueueId)
          .single();
        
        if (queueData?.reentry_behavior) {
          queueReentryBehavior = queueData.reentry_behavior;
        }
      }
      
      console.log(`Queue reentry behavior: ${queueReentryBehavior}`);
      
      // Se a fila está configurada para manter responsável E o lead tinha um responsável
      const shouldKeepAssignee = queueReentryBehavior === 'keep_assignee' && oldAssigneeId;
      
      // Determinar estágio de destino (mesmo lógica de lead novo)
      let targetStageId = webhook.target_stage_id;
      const targetPipelineId = webhook.target_pipeline_id;
      
      if (!targetStageId && targetPipelineId) {
        const { data: firstStage } = await supabase
          .from('stages')
          .select('id')
          .eq('pipeline_id', targetPipelineId)
          .order('position', { ascending: true })
          .limit(1)
          .single();
        
        if (firstStage) {
          targetStageId = firstStage.id;
        }
      }
      
      // Preparar dados de atualização
      const updateData: Record<string, any> = {
        // Dados do formulário
        ...(mappedData.name && mappedData.name !== 'unknown' && { name: mappedData.name }),
        ...(mappedData.email && { email: mappedData.email }),
        ...(mappedData.message && { message: mappedData.message }),
        // Resetar para reprocessamento completo
        stage_id: targetStageId || existingLead.stage_id,
        pipeline_id: targetPipelineId || existingLead.pipeline_id,
        // Manter ou limpar responsável baseado na configuração
        assigned_user_id: shouldKeepAssignee ? oldAssigneeId : null,
        deal_status: 'open', // Resetar status para aberto
        won_at: null,
        lost_at: null,
        lost_reason: null,
        stage_entered_at: new Date().toISOString(),
      };
      
      // Registrar reentrada via RPC
      const { error: reentryError } = await supabase.rpc('register_lead_reentry', {
        p_lead_id: existingLead.id,
        p_org_id: webhook.organization_id,
        p_entry_type: 'webhook_reentry',
        p_source: 'webhook',
        p_property_id: resolvedPropertyId || null,
        p_valor_interesse: valorInteresse || null,
        p_metadata: {
          webhook_id: webhook.id,
          webhook_name: webhook.name,
          new_data: mappedData,
          old_data: {
            stage_id: oldStageId,
            pipeline_id: oldPipelineId,
            assignee_id: oldAssigneeId,
            status: oldDealStatus
          }
        }
      });

      if (reentryError) {
        console.error('Lead reentry RPC error:', reentryError);
        // Fallback update
        await supabase
          .from('leads')
          .update({
            ...(mappedData.name && mappedData.name !== 'unknown' && { name: mappedData.name }),
            ...(mappedData.email && { email: mappedData.email }),
            deal_status: 'open',
            last_entry_at: new Date().toISOString(),
          })
          .eq('id', existingLead.id);
      }
      
      let finalAssigneeId = oldAssigneeId;
      
      if (shouldKeepAssignee) {
        // Lead continua com o responsável anterior
        console.log('Keeping original assignee per queue config:', oldAssigneeId);
      } else {
        // Chamar redistribuição via RPC
        console.log('Calling handle_lead_intake for redistribution...');
        const { data: redistributionResult, error: redistributionError } = await supabase
          .rpc('handle_lead_intake', { p_lead_id: existingLead.id });
        
        if (redistributionError) {
          console.error('Redistribution error:', redistributionError);
        }
        
        if (redistributionResult?.assigned_user_id) {
          console.log(`Lead redistributed to: ${redistributionResult.assigned_user_id}`);
          finalAssigneeId = redistributionResult.assigned_user_id;
        } else if (oldAssigneeId) {
          // Se não conseguiu redistribuir, manter o responsável anterior
          console.log('No redistribution available, keeping original assignee:', oldAssigneeId);
          await supabase
            .from('leads')
            .update({ assigned_user_id: oldAssigneeId, assigned_at: new Date().toISOString() })
            .eq('id', existingLead.id);
        }
      }
      
      // Aplicar tags configuradas
      const targetTagIds = webhook.target_tag_ids || [];
      if (targetTagIds.length > 0) {
        for (const tagId of targetTagIds) {
          await supabase
            .from('lead_tags')
            .upsert({ lead_id: existingLead.id, tag_id: tagId }, { onConflict: 'lead_id,tag_id' });
        }
      }
      
      // Atualizar estatísticas do webhook
      await supabase
        .from('webhooks_integrations')
        .update({
          leads_received: (webhook.leads_received || 0) + 1,
          last_lead_at: new Date().toISOString(),
        })
        .eq('id', webhook.id);
      
      console.log('Lead updated (full reentry):', existingLead.id);
      const aiFirstContact = await maybeScheduleAIFirstContact(supabase, {
        leadId: existingLead.id,
        organizationId: webhook.organization_id,
        roundRobinId: matchingQueueId,
        supabaseUrl,
        serviceRoleKey: supabaseKey,
      });
      
      return new Response(
        JSON.stringify({
          success: true,
          lead_id: existingLead.id,
          reentry: true,
          assigned_user_id: finalAssigneeId,
          ai_first_contact: aiFirstContact,
          message: shouldKeepAssignee ? 'Lead reentered - kept original assignee' : 'Lead reentered and redistributed',
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ===== LEAD NOVO =====
    if (!webhook.target_pipeline_id) {
      console.log(`Webhook ${webhook.id} has no target pipeline configured. Skipping lead creation.`);
      return new Response(
        JSON.stringify({ success: true, message: "Webhook not configured with a pipeline, skipping" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create lead (novo - não duplicado)

    const { data: lead, error: leadError } = await supabase
      .from('leads')
      .insert({
        organization_id: webhook.organization_id,
        name: mappedData.name,
        phone: mappedData.phone || null,
        email: mappedData.email || null,
        message: mappedData.message || null,
        pipeline_id: webhook.target_pipeline_id,
        stage_id: webhook.target_stage_id,
        assigned_user_id: null,
        interest_property_id: resolvedPropertyId,
        interest_plan_id: resolvedPlanId,
        valor_interesse: valorInteresse, // Auto-preenchido com preço do imóvel/plano
        source: 'webhook',
        source_webhook_id: webhook.id, // Track which webhook created this lead
      })
      .select('id, pipeline_id, stage_id, assigned_user_id')
      .single();

    if (leadError) {
      console.error('Lead creation error:', leadError);
      return new Response(
        JSON.stringify({ error: 'Failed to create lead', details: leadError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Registrar atividade de criação do lead
    await supabase.from('activities').insert({
      lead_id: lead.id,
      type: 'lead_created',
      content: `Lead criado via webhook "${webhook.name}"`,
      user_id: null,
      metadata: {
        source: 'webhook',
        webhook_id: webhook.id,
        webhook_name: webhook.name,
        pipeline_name: webhook.pipeline?.name,
        stage_name: webhook.stage?.name,
      }
    });

    // ===== SAVE TRACKING DATA TO lead_meta =====
    const trackingData = {
      // Campaign data
      campaign_id: body.campaign_id || null,
      campaign_name: body.campaign_name || null,
      adset_id: body.adset_id || null,
      adset_name: body.adset_name || null,
      ad_id: body.ad_id || null,
      ad_name: body.ad_name || null,
      form_name: body.form_name || null,
      platform: body.platform || null,
      // UTM parameters
      utm_source: body.utm_source || null,
      utm_medium: body.utm_medium || null,
      utm_campaign: body.utm_campaign || null,
      utm_content: body.utm_content || null,
      utm_term: body.utm_term || null,
      // Additional
      contact_notes: body.contact_notes || null,
      source_type: 'webhook',
      raw_payload: body,
    };

    // Only insert if there's any tracking data
    const hasTrackingData = Object.entries(trackingData)
      .filter(([key]) => !['source_type', 'raw_payload'].includes(key))
      .some(([_, value]) => value !== null);

    if (hasTrackingData) {
      const { error: metaError } = await supabase.from('lead_meta').insert({
        lead_id: lead.id,
        ...trackingData,
      });
      
      if (metaError) {
        console.error('Error inserting lead_meta:', metaError);
        // Don't fail the request, just log the error
      } else {
        console.log('Tracking data saved to lead_meta');
      }
    }

    // Apply tags if configured (após lead criado com sucesso)
    const targetTagIds = webhook.target_tag_ids || [];
    if (targetTagIds.length > 0) {
      const leadTags = targetTagIds.map((tagId: string) => ({
        lead_id: lead.id,
        tag_id: tagId,
      }));
      
      await supabase.from('lead_tags').insert(leadTags);
      console.log('Applied tags to lead:', targetTagIds);
    }

    // Update webhook stats
    await supabase
      .from('webhooks_integrations')
      .update({
        leads_received: (webhook.leads_received || 0) + 1,
        last_lead_at: new Date().toISOString(),
      })
      .eq('id', webhook.id);

    console.log('Lead created successfully:', lead.id);

    // ===== BUSCAR DADOS FINAIS PÓS-TRIGGER =====
    // O trigger AFTER INSERT (handle_lead_intake) pode ter atribuído pipeline, stage e responsável
    // Aguardar um pequeno delay para garantir que o trigger executou
    await new Promise(resolve => setTimeout(resolve, 100));
    
    const { data: finalLead } = await supabase
      .from('leads')
      .select('id, pipeline_id, stage_id, assigned_user_id')
      .eq('id', lead.id)
      .single();

    console.log('Final lead data after trigger:', finalLead);
    const aiFirstContact = await maybeScheduleAIFirstContact(supabase, {
      leadId: finalLead?.id || lead.id,
      organizationId: webhook.organization_id,
      supabaseUrl,
      serviceRoleKey: supabaseKey,
    });

    return new Response(
      JSON.stringify({
        success: true,
        lead_id: finalLead?.id || lead.id,
        pipeline_id: finalLead?.pipeline_id || lead.pipeline_id,
        stage_id: finalLead?.stage_id || lead.stage_id,
        assigned_user_id: finalLead?.assigned_user_id || lead.assigned_user_id,
        ai_first_contact: aiFirstContact,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('Webhook error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error?.message || 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
