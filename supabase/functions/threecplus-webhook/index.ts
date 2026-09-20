import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  readSupabaseSecretKeyEnvironment,
  selectSupabaseAdminSecretKey,
} from "../_shared/supabase-secret-keys.ts";
import { privateWorkerRequestHeaders } from "../_shared/private-worker-auth.ts";

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
    const secretEnvironment = readSupabaseSecretKeyEnvironment();
    const supabaseAdminKey = selectSupabaseAdminSecretKey(secretEnvironment);
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

    if (!supabaseUrl || !supabaseAdminKey) {
      console.error('ThreeCPlus webhook Supabase configuration unavailable');
      return new Response(JSON.stringify({ error: 'Worker configuration unavailable' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseAdminKey);
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

    // Resolve a lead only when the normalized phone identifies exactly one
    // card in the organization. Queue-scoped identity deliberately permits
    // multiple cards with the same phone, so choosing the first row would
    // attach calls and first-response metrics to an arbitrary queue.
    let leadId: string | null = null;
    let existingCallFound = false;
    const phoneToSearch = payload.direction === 'outbound' ? payload.phone_to : payload.phone_from;

    // Once a call exists, its lead/user attribution is an immutable snapshot.
    // A later callback must never be rebound by looking at the phone again:
    // queue-scoped identity can legitimately make the same phone resolve to a
    // different (or newly unambiguous) card after the call started.
    if (!['call.initiated', 'call.started'].includes(event_type)) {
      const { data: existingCall, error: existingCallError } = await supabase
        .from('telephony_calls')
        .select('lead_id, user_id')
        .eq('organization_id', organizationId)
        .eq('external_call_id', call_id)
        .maybeSingle();

      if (existingCallError) throw existingCallError;
      if (existingCall) {
        existingCallFound = true;
        leadId = existingCall.lead_id || null;
        userId = existingCall.user_id || userId;
      }
    }

    if (!existingCallFound && phoneToSearch) {
      const { data: leads, error: leadLookupError } = await supabase.rpc(
        'find_lead_by_normalized_phone',
        {
          p_organization_id: organizationId,
          p_phone: phoneToSearch,
        },
      );

      if (leadLookupError) {
        const isAmbiguous = leadLookupError.code === '23505'
          && leadLookupError.message?.includes('whatsapp_lead_phone_ambiguous');
        if (!isAmbiguous) throw leadLookupError;
        console.warn('Lead phone is ambiguous; telephony event remains unlinked', {
          event_type,
          call_id,
          organization_id: organizationId,
        });
      } else if (Array.isArray(leads) && leads.length === 1) {
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
          .eq('organization_id', organizationId)
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
          .eq('organization_id', organizationId)
          .eq('external_call_id', call_id);

        if (updateError) {
          console.error('Error updating call:', updateError);
          throw updateError;
        }

        // Trigger first response calculation if we have a lead
        if (leadId && userId) {
          try {
            const firstResponseResult = await fetch(
              `${supabaseUrl}/functions/v1/calculate-first-response`,
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  ...privateWorkerRequestHeaders(supabaseAdminKey),
                },
                body: JSON.stringify({
                  lead_id: leadId,
                  actor_user_id: userId,
                  channel: 'phone',
                  is_automation: false,
                  organization_id: organizationId,
                }),
              },
            );
            if (!firstResponseResult.ok) {
              throw new Error('First-response calculation was not accepted');
            }
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
          .eq('organization_id', organizationId)
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
          .eq('organization_id', organizationId)
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
