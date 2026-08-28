import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const META_GRAPH_VERSION = Deno.env.get("META_GRAPH_VERSION") || "v25.0";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth check
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const supabaseUser = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY") || "", {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get user's org
    const { data: profile } = await supabaseAdmin
      .from("users")
      .select("organization_id")
      .eq("id", user.id)
      .single();

    if (!profile?.organization_id) {
      return new Response(JSON.stringify({ error: "No organization" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const orgId = profile.organization_id;

    // Get Meta integrations with access tokens
    const { data: integrations } = await supabaseAdmin
      .from("meta_integrations")
      .select("*")
      .eq("organization_id", orgId)
      .eq("is_connected", true);

    if (!integrations || integrations.length === 0) {
      return new Response(JSON.stringify({ error: "No Meta integration connected", campaigns: [] }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const { date_start, date_stop } = body;

    // Use date range or default to last 30 days
    const now = new Date();
    const defaultStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    const defaultStop = now.toISOString().split("T")[0];
    const dateStart = date_start || defaultStart;
    const dateStop = date_stop || defaultStop;

    const allInsights: any[] = [];

    for (const integration of integrations) {
      const accessToken = integration.access_token;
      if (!accessToken) continue;

      let adAccountIds = integration.selected_ad_accounts || [];

      // If no ad accounts selected, try to get the first one available (legacy behavior)
      if (adAccountIds.length === 0) {
        if (integration.ad_account_id) {
          adAccountIds = [integration.ad_account_id];
        } else {
          try {
            const adAccountsRes = await fetch(
              `https://graph.facebook.com/${META_GRAPH_VERSION}/me/adaccounts?fields=id,name,account_id&access_token=${accessToken}`
            );
            const adAccountsData = await adAccountsRes.json();
            
            if (adAccountsData.data && adAccountsData.data.length > 0) {
              const defaultAccountId = adAccountsData.data[0].id; // format: "act_XXXXX"
              adAccountIds = [defaultAccountId];
              
              // Save as the default ad_account_id for backward compatibility
              await supabaseAdmin
                .from("meta_integrations")
                .update({ ad_account_id: defaultAccountId })
                .eq("id", integration.id);
              
              console.log(`Saved default ad_account_id: ${defaultAccountId} for integration ${integration.id}`);
            } else {
              console.warn("No ad accounts found for integration:", integration.id, adAccountsData);
              continue;
            }
          } catch (err) {
            console.error("Error fetching ad accounts:", err);
            continue;
          }
        }
      }

      for (const adAccountId of adAccountIds) {

      // Step 2: Fetch Account Info (Status & Balance)
      try {
        const accountUrl = `https://graph.facebook.com/${META_GRAPH_VERSION}/${adAccountId}?fields=account_status,amount_spent,balance,currency,name&access_token=${accessToken}`;
        const accountRes = await fetch(accountUrl);
        const accountData = await accountRes.json();
        
        if (!accountData.error) {
          console.log(`Account ${adAccountId} status: ${accountData.account_status}`);
          // Update integration with current status
          await supabaseAdmin
            .from("meta_integrations")
            .update({ 
              last_sync_at: new Date().toISOString(),
              last_error: null 
            })
            .eq("id", integration.id);
        }
      } catch (err) {
        console.error("Error fetching account info:", err);
      }

      // Step 3: Fetch campaign insights with Status and Budget
      try {
        const campaignsUrl = `https://graph.facebook.com/${META_GRAPH_VERSION}/${adAccountId}/campaigns?fields=id,name,status,effective_status,objective,daily_budget,lifetime_budget,insights{spend,impressions,reach,actions,cost_per_action_type}&time_range={"since":"${dateStart}","until":"${dateStop}"}&limit=500&access_token=${accessToken}`;
        
        console.log("Fetching campaigns for:", adAccountId);
        const campaignsRes = await fetch(campaignsUrl);
        const campaignsData = await campaignsRes.json();

        if (campaignsData.error) {
          console.error("Meta API error (campaigns):", campaignsData.error);
          continue;
        }

        const campaigns = campaignsData.data || [];
        
        for (const campaign of campaigns) {
          const insight = campaign.insights?.data?.[0] || {};
          const actions = insight.actions || [];
          
          const leadsAction = actions.find((a: any) => a.action_type === "lead" || a.action_type === "onsite_conversion.lead_grouped");
          const convAction = actions.find((a: any) => a.action_type === "messaging_conversations_started" || a.action_type === "onsite_conversion.messaging_conversation_started_7d");
          const leadsCostAction = (insight.cost_per_action_type || []).find((a: any) => a.action_type === "lead" || a.action_type === "onsite_conversion.lead_grouped");
          
          const leadsCount = leadsAction ? parseInt(leadsAction.value) : 0;
          const convCount = convAction ? parseInt(convAction.value) : 0;
          const spend = parseFloat(insight.spend || "0");
          const cpl = leadsCostAction ? parseFloat(leadsCostAction.value) : (leadsCount > 0 ? spend / leadsCount : 0);

          const budget = campaign.daily_budget ? parseFloat(campaign.daily_budget) / 100 : (campaign.lifetime_budget ? parseFloat(campaign.lifetime_budget) / 100 : 0);
          const budgetType = campaign.daily_budget ? 'daily' : (campaign.lifetime_budget ? 'lifetime' : null);

          allInsights.push({
            organization_id: orgId,
            campaign_id: campaign.id,
            campaign_name: campaign.name,
            adset_id: null,
            adset_name: null,
            ad_id: null,
            ad_name: null,
            spend,
            impressions: parseInt(insight.impressions || "0"),
            reach: parseInt(insight.reach || "0"),
            leads_count: leadsCount,
            conversations_count: convCount,
            cpl: Math.round(cpl * 100) / 100,
            status: campaign.effective_status || campaign.status,
            budget,
            budget_type: budgetType,
            objective: campaign.objective,
            date_start: dateStart,
            date_stop: dateStop,
            level: "campaign",
            fetched_at: new Date().toISOString(),
          });
        }

        // Step 4: Fetch adset-level insights
        const adsetsUrl = `https://graph.facebook.com/${META_GRAPH_VERSION}/${adAccountId}/adsets?fields=id,name,status,effective_status,daily_budget,lifetime_budget,insights{spend,impressions,reach,actions,cost_per_action_type}&time_range={"since":"${dateStart}","until":"${dateStop}"}&limit=500&access_token=${accessToken}`;
        
        const adsetsRes = await fetch(adsetsUrl);
        const adsetsData = await adsetsRes.json();

        for (const adset of (adsetsData.data || [])) {
          const insight = adset.insights?.data?.[0] || {};
          const actions = insight.actions || [];
          
          const leadsAction = actions.find((a: any) => a.action_type === "lead" || a.action_type === "onsite_conversion.lead_grouped");
          const convAction = actions.find((a: any) => a.action_type === "messaging_conversations_started" || a.action_type === "onsite_conversion.messaging_conversation_started_7d");
          const leadsCostAction = (insight.cost_per_action_type || []).find((a: any) => a.action_type === "lead" || a.action_type === "onsite_conversion.lead_grouped");
          
          const leadsCount = leadsAction ? parseInt(leadsAction.value) : 0;
          const convCount = convAction ? parseInt(convAction.value) : 0;
          const spend = parseFloat(insight.spend || "0");
          const cpl = leadsCostAction ? parseFloat(leadsCostAction.value) : (leadsCount > 0 ? spend / leadsCount : 0);

          const budget = adset.daily_budget ? parseFloat(adset.daily_budget) / 100 : (adset.lifetime_budget ? parseFloat(adset.lifetime_budget) / 100 : 0);
          const budgetType = adset.daily_budget ? 'daily' : (adset.lifetime_budget ? 'lifetime' : null);

          allInsights.push({
            organization_id: orgId,
            campaign_id: adset.campaign_id, // This will need fetching or use current flow
            campaign_name: null,
            adset_id: adset.id,
            adset_name: adset.name,
            ad_id: null,
            ad_name: null,
            spend,
            impressions: parseInt(insight.impressions || "0"),
            reach: parseInt(insight.reach || "0"),
            leads_count: leadsCount,
            conversations_count: convCount,
            cpl: Math.round(cpl * 100) / 100,
            status: adset.effective_status || adset.status,
            budget,
            budget_type: budgetType,
            date_start: dateStart,
            date_stop: dateStop,
            level: "adset",
            fetched_at: new Date().toISOString(),
          });
        }

        // Step 5: Fetch ad-level insights with status
        const adsUrl = `https://graph.facebook.com/${META_GRAPH_VERSION}/${adAccountId}/ads?fields=id,name,status,effective_status,campaign_id,adset_id,insights{spend,impressions,reach,actions,cost_per_action_type}&time_range={"since":"${dateStart}","until":"${dateStop}"}&limit=500&access_token=${accessToken}`;
        
        const adsRes = await fetch(adsUrl);
        const adsData = await adsRes.json();

        // Process all ads in parallel to avoid 150s timeout
        const adPromises = (adsData.data || []).map(async (adData: any) => {
          const insight = adData.insights?.data?.[0] || {};
          const actions = insight.actions || [];
          
          const leadsAction = actions.find((a: any) => a.action_type === "lead" || a.action_type === "onsite_conversion.lead_grouped");
          const convAction = actions.find((a: any) => a.action_type === "messaging_conversations_started" || a.action_type === "onsite_conversion.messaging_conversation_started_7d");
          const leadsCostAction = (insight.cost_per_action_type || []).find((a: any) => a.action_type === "lead" || a.action_type === "onsite_conversion.lead_grouped");
          
          const leadsCount = leadsAction ? parseInt(leadsAction.value) : 0;
          const convCount = convAction ? parseInt(convAction.value) : 0;
          const spend = parseFloat(insight.spend || "0");
          const cpl = leadsCostAction ? parseFloat(leadsCostAction.value) : (leadsCount > 0 ? spend / leadsCount : 0);

          // Fetch creative in parallel (only if ad had activity to save API calls)
          let creativeUrl = null;
          let creativeVideoUrl = null;
          if (spend > 0 || leadsCount > 0 || (insight.impressions && parseInt(insight.impressions) > 0)) {
            try {
              const adCreativeRes = await fetch(
                `https://graph.facebook.com/${META_GRAPH_VERSION}/${adData.id}?fields=creative{effective_image_url,thumbnail_url,video_id}&access_token=${accessToken}`
              );
              const adCreativeData = await adCreativeRes.json();
              
              if (adCreativeData.creative) {
                creativeUrl = adCreativeData.creative.effective_image_url || adCreativeData.creative.thumbnail_url;
                
                if (adCreativeData.creative.video_id) {
                  const videoRes = await fetch(
                    `https://graph.facebook.com/${META_GRAPH_VERSION}/${adCreativeData.creative.video_id}?fields=source&access_token=${accessToken}`
                  );
                  const videoData = await videoRes.json();
                  creativeVideoUrl = videoData.source || null;
                }
              }
            } catch (err) {
              console.warn("Error fetching creative for ad:", adData.id, err);
            }
          }

          return {
            organization_id: orgId,
            campaign_id: adData.campaign_id,
            campaign_name: null,
            adset_id: adData.adset_id,
            adset_name: null,
            ad_id: adData.id,
            ad_name: adData.name,
            creative_url: creativeUrl,
            creative_video_url: creativeVideoUrl,
            spend,
            impressions: parseInt(insight.impressions || "0"),
            reach: parseInt(insight.reach || "0"),
            leads_count: leadsCount,
            conversations_count: convCount,
            cpl: Math.round(cpl * 100) / 100,
            status: adData.effective_status || adData.status,
            date_start: dateStart,
            date_stop: dateStop,
            level: "ad",
            fetched_at: new Date().toISOString(),
          };
        });

        // Process in batches of 10 to avoid overwhelming Meta API
        const batchSize = 10;
        for (let i = 0; i < adPromises.length; i += batchSize) {
          const batch = adPromises.slice(i, i + batchSize);
          const results = await Promise.all(batch);
          allInsights.push(...results);
        }
      } catch (err) {
        console.error("Error fetching insights:", err);
      }
    } // End of adAccountId loop
  } // End of integrations loop

    // Step 6: Upsert all insights into cache
    if (allInsights.length > 0) {
      const { error: upsertError } = await supabaseAdmin
        .from("meta_campaign_insights")
        .upsert(allInsights, {
          onConflict: "organization_id,campaign_id,adset_id,ad_id,date_start,date_stop",
          ignoreDuplicates: false,
        });

      if (upsertError) {
        console.error("Upsert error:", upsertError);
      }
    }

    console.log(`Synced ${allInsights.length} insight rows for org ${orgId}`);

    return new Response(
      JSON.stringify({
        success: true,
        synced: allInsights.length,
        date_range: { from: dateStart, to: dateStop },
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("Error:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
