import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    console.log('[cleanup-orphan-members] Starting cleanup process...');

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Auth REQUIRED — verify user is super_admin (no optional bypass).
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    const { data: userCheck } = await supabase
      .from('users')
      .select('role')
      .eq('id', user.id)
      .single();
    if (userCheck?.role !== 'super_admin') {
      return new Response(
        JSON.stringify({ error: 'Forbidden - super admin only' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check for dry run mode
    const url = new URL(req.url);
    const dryRun = url.searchParams.get('dry_run') === 'true';

    if (dryRun) {
      console.log('[cleanup-orphan-members] Dry run mode - fetching orphan stats only');
      
      // Fetch orphan team members
      const { data: teamOrphans, error: teamError } = await supabase
        .rpc('find_orphan_team_members');
      
      if (teamError) {
        console.error('[cleanup-orphan-members] Error finding team orphans:', teamError);
        throw teamError;
      }

      // Fetch orphan round-robin members
      const { data: rrOrphans, error: rrError } = await supabase
        .rpc('find_orphan_rr_members');
      
      if (rrError) {
        console.error('[cleanup-orphan-members] Error finding RR orphans:', rrError);
        throw rrError;
      }

      console.log('[cleanup-orphan-members] Dry run result:', {
        team_orphans: teamOrphans?.length || 0,
        rr_orphans: rrOrphans?.length || 0
      });

      return new Response(
        JSON.stringify({
          dry_run: true,
          team_members_orphans: teamOrphans || [],
          round_robin_members_orphans: rrOrphans || [],
          total_team: teamOrphans?.length || 0,
          total_rr: rrOrphans?.length || 0
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Execute cleanup
    console.log('[cleanup-orphan-members] Executing cleanup...');
    const { data: result, error: cleanupError } = await supabase
      .rpc('cleanup_orphan_members');

    if (cleanupError) {
      console.error('[cleanup-orphan-members] Cleanup error:', cleanupError);
      throw cleanupError;
    }

    console.log('[cleanup-orphan-members] Cleanup completed:', result);

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('[cleanup-orphan-members] Error:', error);
    return new Response(
      JSON.stringify({ error: error?.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
