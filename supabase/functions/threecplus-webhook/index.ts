import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-secret',
};

interface ThreeCPlusEvent {
  event_type: string;
  call_id: string;
  external_id?: string;
  direction?: 'inbound' | 'outbound';
  phone_from?: string;
  phone_to?: string;
  status?: string;
  outcome?: string;
  initiated_at?: string;
  answered_at?: string;
  ended_at?: string;
  duration?: number;
  talk_time?: number;
  recording_url?: string;
  recording_duration?: number;
  agent_id?: string;
  agent_email?: string;
  metadata?: Record<string, unknown>;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const webhookSecret = Deno.env.get('THREECPLUS_WEBHOOK_SECRET');

    // Validate webhook secret if configured
    if (webhookSecret) {
      const providedSecret = req.headers.get('x-webhook-secret');
      if (providedSecret !== webhookSecret) {
        console.error('Invalid webhook secret');
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const payload: ThreeCPlusEvent = await req.json();

    console.log('3C Plus webhook received:', JSON.stringify(payload));

    const { event_type, call_id } = payload;

    if (!call_id) {
      return new Response(JSON.stringify({ error: 'call_id is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Find user by agent email or external ID
    let userId: string | null = null;
    let organizationId: string | null = null;

    if (payload.agent_email) {
      const { data: user } = await supabase
        .from('users')
        .select('id, organization_id')
        .eq('email', payload.agent_email)
        .single();

      if (user) {
        userId = user.id;
        organizationId = user.organization_id;
      }
    }

    if (!organizationId) {
      console.error('Could not determine organization for call');
      return new Response(JSON.stringify({ error: 'Organization not found' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Try to find lead by phone
    let leadId: string | null = null;
    const phoneToSearch = payload.direction === 'outbound' ? payload.phone_to : payload.phone_from;
    
    if (phoneToSearch) {
      const normalizedPhone = phoneToSearch.replace(/\D/g, '');
      const phoneVariants = [
        normalizedPhone,
        normalizedPhone.startsWith('55') ? normalizedPhone.slice(2) : `55${normalizedPhone}`,
      ];

      const { data: leads } = await supabase
        .from('leads')
        .select('id')
        .eq('organization_id', organizationId)
        .or(phoneVariants.map(p => `phone.ilike.%${p}%`).join(','))
        .limit(1);

      if (leads && leads.length > 0) {
        leadId = leads[0].id;
      }
    }

    // Handle different event types
    switch (event_type) {
      case 'call.initiated':
      case 'call.started': {
        const { error: insertError } = await supabase
          .from('telephony_calls')
          .upsert({
            external_call_id: call_id,
            organization_id: organizationId,
            user_id: userId,
            lead_id: leadId,
            direction: payload.direction || 'outbound',
            phone_from: payload.phone_from,
            phone_to: payload.phone_to,
            status: 'initiated',
            initiated_at: payload.initiated_at || new Date().toISOString(),
            metadata: payload.metadata,
          }, {
            onConflict: 'external_call_id',
          });

        if (insertError) {
          console.error('Error inserting call:', insertError);
          throw insertError;
        }
        break;
      }

      case 'call.answered': {
        const { error: updateError } = await supabase
          .from('telephony_calls')
          .update({
            status: 'answered',
            answered_at: payload.answered_at || new Date().toISOString(),
          })
          .eq('external_call_id', call_id);

        if (updateError) {
          console.error('Error updating call:', updateError);
          throw updateError;
        }
        break;
      }

      case 'call.ended':
      case 'call.completed': {
        const updateData: Record<string, unknown> = {
          status: 'ended',
          ended_at: payload.ended_at || new Date().toISOString(),
          duration_seconds: payload.duration,
          talk_time_seconds: payload.talk_time,
          outcome: payload.outcome,
        };

        // If recording is available immediately
        if (payload.recording_url) {
          updateData.recording_url = payload.recording_url;
          updateData.recording_status = 'pending';
          updateData.recording_duration_sec = payload.recording_duration;
        }

        const { error: updateError } = await supabase
          .from('telephony_calls')
          .update(updateData)
          .eq('external_call_id', call_id);

        if (updateError) {
          console.error('Error updating call:', updateError);
          throw updateError;
        }

        // Trigger first response calculation if we have a lead
        if (leadId && userId) {
          try {
            await supabase.functions.invoke('calculate-first-response', {
              body: {
                lead_id: leadId,
                actor_user_id: userId,
                channel: 'phone',
                is_automation: false,
              },
            });
          } catch (err) {
            console.error('Error triggering first response calculation:', err);
          }
        }
        break;
      }

      case 'recording.ready':
      case 'call.recording_ready': {
        const updateData: Record<string, unknown> = {
          recording_status: 'ready',
        };

        if (payload.recording_url) {
          updateData.recording_url = payload.recording_url;
        }
        if (payload.recording_duration) {
          updateData.recording_duration_sec = payload.recording_duration;
        }

        const { error: updateError } = await supabase
          .from('telephony_calls')
          .update(updateData)
          .eq('external_call_id', call_id);

        if (updateError) {
          console.error('Error updating recording status:', updateError);
          throw updateError;
        }
        break;
      }

      case 'recording.failed': {
        const { error: updateError } = await supabase
          .from('telephony_calls')
          .update({
            recording_status: 'failed',
            recording_error: payload.metadata?.error as string || 'Recording failed',
          })
          .eq('external_call_id', call_id);

        if (updateError) {
          console.error('Error updating recording status:', updateError);
          throw updateError;
        }
        break;
      }

      default:
        console.log(`Unhandled event type: ${event_type}`);
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Webhook error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
