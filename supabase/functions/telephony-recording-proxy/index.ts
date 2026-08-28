import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // Get auth token from request
    const authHeader = req.headers.get('authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Create client with user's token for RLS
    const supabaseUser = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });

    // Get user info
    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const url = new URL(req.url);
    const callId = url.searchParams.get('call_id');
    const action = url.searchParams.get('action') || 'stream'; // 'stream' or 'signed_url'

    if (!callId) {
      return new Response(JSON.stringify({ error: 'call_id is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Service client for privileged operations
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get user's organization and role
    const { data: userData } = await supabase
      .from('users')
      .select('organization_id, role')
      .eq('id', user.id)
      .single();

    if (!userData) {
      return new Response(JSON.stringify({ error: 'User not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Check if user is admin or super_admin
    const { data: userRoles } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id);

    const isAdmin = userRoles?.some(r => r.role === 'admin' || r.role === 'super_admin') || userData.role === 'admin';

    // Get call record
    const { data: call, error: callError } = await supabase
      .from('telephony_calls')
      .select('*')
      .eq('id', callId)
      .eq('organization_id', userData.organization_id)
      .single();

    if (callError || !call) {
      return new Response(JSON.stringify({ error: 'Call not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Check permissions: admin/gestor OR owner of the call
    const canAccess = isAdmin || call.user_id === user.id;

    if (!canAccess) {
      return new Response(JSON.stringify({ error: 'Permission denied' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Log audit event
    await supabase.from('telephony_recording_audit').insert({
      organization_id: userData.organization_id,
      call_id: callId,
      user_id: user.id,
      action: action === 'signed_url' ? 'generate_signed_url' : 'play_recording',
      ip_address: req.headers.get('x-forwarded-for') || req.headers.get('cf-connecting-ip'),
      user_agent: req.headers.get('user-agent'),
    });

    // If recording is stored in Supabase Storage
    if (call.recording_storage_path) {
      const { data: signedUrl, error: signError } = await supabase.storage
        .from('telephony-recordings')
        .createSignedUrl(call.recording_storage_path, 300); // 5 minutes

      if (signError) {
        console.error('Error creating signed URL:', signError);
        return new Response(JSON.stringify({ error: 'Failed to generate URL' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ 
        url: signedUrl.signedUrl,
        expires_in: 300,
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // If recording is external URL, proxy or return signed info
    if (call.recording_url) {
      if (action === 'stream') {
        // Stream the recording through our proxy
        try {
          const recordingResponse = await fetch(call.recording_url);
          
          if (!recordingResponse.ok) {
            throw new Error(`Failed to fetch recording: ${recordingResponse.status}`);
          }

          const contentType = recordingResponse.headers.get('content-type') || 'audio/mpeg';
          const contentLength = recordingResponse.headers.get('content-length');

          const headers: Record<string, string> = {
            ...corsHeaders,
            'Content-Type': contentType,
            'Cache-Control': 'no-store',
          };

          if (contentLength) {
            headers['Content-Length'] = contentLength;
          }

          return new Response(recordingResponse.body, {
            status: 200,
            headers,
          });
        } catch (error) {
          console.error('Error streaming recording:', error);
          return new Response(JSON.stringify({ error: 'Failed to stream recording' }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      } else {
        // Return the URL with expiration warning
        return new Response(JSON.stringify({ 
          url: call.recording_url,
          warning: 'External URL - may expire',
          recording_expires_at: call.recording_expires_at,
        }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    return new Response(JSON.stringify({ error: 'No recording available' }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Proxy error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
