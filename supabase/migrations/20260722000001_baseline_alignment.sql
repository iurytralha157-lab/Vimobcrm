create extension if not exists "pg_net" with schema "public";

drop policy "Public sites can insert validated lead events" on "public"."lead_events";

revoke references on table "public"."ai_routing_rules" from "anon";

revoke trigger on table "public"."ai_routing_rules" from "anon";

revoke truncate on table "public"."ai_routing_rules" from "anon";

revoke references on table "public"."ai_routing_rules" from "authenticated";

revoke trigger on table "public"."ai_routing_rules" from "authenticated";

revoke truncate on table "public"."ai_routing_rules" from "authenticated";

revoke references on table "public"."automation_circuit_breakers" from "anon";

revoke trigger on table "public"."automation_circuit_breakers" from "anon";

revoke truncate on table "public"."automation_circuit_breakers" from "anon";

revoke references on table "public"."automation_circuit_breakers" from "authenticated";

revoke trigger on table "public"."automation_circuit_breakers" from "authenticated";

revoke truncate on table "public"."automation_circuit_breakers" from "authenticated";

revoke references on table "public"."automation_effect_dispatches" from "anon";

revoke trigger on table "public"."automation_effect_dispatches" from "anon";

revoke truncate on table "public"."automation_effect_dispatches" from "anon";

revoke references on table "public"."automation_effect_dispatches" from "authenticated";

revoke trigger on table "public"."automation_effect_dispatches" from "authenticated";

revoke truncate on table "public"."automation_effect_dispatches" from "authenticated";

revoke references on table "public"."automation_event_outbox" from "anon";

revoke trigger on table "public"."automation_event_outbox" from "anon";

revoke truncate on table "public"."automation_event_outbox" from "anon";

revoke references on table "public"."automation_event_outbox" from "authenticated";

revoke trigger on table "public"."automation_event_outbox" from "authenticated";

revoke truncate on table "public"."automation_event_outbox" from "authenticated";

revoke references on table "public"."automation_execution_steps" from "anon";

revoke trigger on table "public"."automation_execution_steps" from "anon";

revoke truncate on table "public"."automation_execution_steps" from "anon";

revoke references on table "public"."automation_execution_steps" from "authenticated";

revoke trigger on table "public"."automation_execution_steps" from "authenticated";

revoke truncate on table "public"."automation_execution_steps" from "authenticated";

revoke references on table "public"."automation_flow_versions" from "anon";

revoke trigger on table "public"."automation_flow_versions" from "anon";

revoke truncate on table "public"."automation_flow_versions" from "anon";

revoke references on table "public"."automation_flow_versions" from "authenticated";

revoke trigger on table "public"."automation_flow_versions" from "authenticated";

revoke truncate on table "public"."automation_flow_versions" from "authenticated";

revoke references on table "public"."automation_message_dispatches" from "anon";

revoke trigger on table "public"."automation_message_dispatches" from "anon";

revoke truncate on table "public"."automation_message_dispatches" from "anon";

revoke references on table "public"."automation_message_dispatches" from "authenticated";

revoke trigger on table "public"."automation_message_dispatches" from "authenticated";

revoke truncate on table "public"."automation_message_dispatches" from "authenticated";

revoke references on table "public"."automation_schedule_state" from "anon";

revoke trigger on table "public"."automation_schedule_state" from "anon";

revoke truncate on table "public"."automation_schedule_state" from "anon";

revoke references on table "public"."automation_schedule_state" from "authenticated";

revoke trigger on table "public"."automation_schedule_state" from "authenticated";

revoke truncate on table "public"."automation_schedule_state" from "authenticated";

revoke references on table "public"."cadence_enrollments" from "anon";

revoke trigger on table "public"."cadence_enrollments" from "anon";

revoke truncate on table "public"."cadence_enrollments" from "anon";

revoke references on table "public"."cadence_enrollments" from "authenticated";

revoke trigger on table "public"."cadence_enrollments" from "authenticated";

revoke truncate on table "public"."cadence_enrollments" from "authenticated";

revoke references on table "public"."chatbot_conversation_state" from "anon";

revoke trigger on table "public"."chatbot_conversation_state" from "anon";

revoke truncate on table "public"."chatbot_conversation_state" from "anon";

revoke references on table "public"."chatbot_conversation_state" from "authenticated";

revoke trigger on table "public"."chatbot_conversation_state" from "authenticated";

revoke truncate on table "public"."chatbot_conversation_state" from "authenticated";

revoke references on table "public"."chatbot_inbound_messages" from "anon";

revoke trigger on table "public"."chatbot_inbound_messages" from "anon";

revoke truncate on table "public"."chatbot_inbound_messages" from "anon";

revoke references on table "public"."chatbot_inbound_messages" from "authenticated";

revoke trigger on table "public"."chatbot_inbound_messages" from "authenticated";

revoke truncate on table "public"."chatbot_inbound_messages" from "authenticated";

revoke references on table "public"."conversation_ai_state" from "anon";

revoke trigger on table "public"."conversation_ai_state" from "anon";

revoke truncate on table "public"."conversation_ai_state" from "anon";

revoke references on table "public"."conversation_ai_state" from "authenticated";

revoke trigger on table "public"."conversation_ai_state" from "authenticated";

revoke truncate on table "public"."conversation_ai_state" from "authenticated";

revoke references on table "public"."edge_rate_limits" from "anon";

revoke trigger on table "public"."edge_rate_limits" from "anon";

revoke truncate on table "public"."edge_rate_limits" from "anon";

revoke references on table "public"."edge_rate_limits" from "authenticated";

revoke trigger on table "public"."edge_rate_limits" from "authenticated";

revoke truncate on table "public"."edge_rate_limits" from "authenticated";

revoke references on table "public"."error_events" from "anon";

revoke trigger on table "public"."error_events" from "anon";

revoke truncate on table "public"."error_events" from "anon";

revoke references on table "public"."error_events" from "authenticated";

revoke trigger on table "public"."error_events" from "authenticated";

revoke truncate on table "public"."error_events" from "authenticated";

revoke references on table "public"."events" from "anon";

revoke trigger on table "public"."events" from "anon";

revoke truncate on table "public"."events" from "anon";

revoke references on table "public"."events" from "authenticated";

revoke trigger on table "public"."events" from "authenticated";

revoke truncate on table "public"."events" from "authenticated";

revoke references on table "public"."gamification_activity_logs" from "anon";

revoke trigger on table "public"."gamification_activity_logs" from "anon";

revoke truncate on table "public"."gamification_activity_logs" from "anon";

revoke references on table "public"."gamification_activity_logs" from "authenticated";

revoke trigger on table "public"."gamification_activity_logs" from "authenticated";

revoke truncate on table "public"."gamification_activity_logs" from "authenticated";

revoke references on table "public"."gamification_activity_logs" from "service_role";

revoke trigger on table "public"."gamification_activity_logs" from "service_role";

revoke truncate on table "public"."gamification_activity_logs" from "service_role";

revoke references on table "public"."gamification_events" from "anon";

revoke trigger on table "public"."gamification_events" from "anon";

revoke truncate on table "public"."gamification_events" from "anon";

revoke references on table "public"."gamification_events" from "authenticated";

revoke trigger on table "public"."gamification_events" from "authenticated";

revoke truncate on table "public"."gamification_events" from "authenticated";

revoke references on table "public"."gamification_events" from "service_role";

revoke trigger on table "public"."gamification_events" from "service_role";

revoke truncate on table "public"."gamification_events" from "service_role";

revoke references on table "public"."gamification_manual_entries" from "anon";

revoke trigger on table "public"."gamification_manual_entries" from "anon";

revoke truncate on table "public"."gamification_manual_entries" from "anon";

revoke references on table "public"."gamification_manual_entries" from "authenticated";

revoke trigger on table "public"."gamification_manual_entries" from "authenticated";

revoke truncate on table "public"."gamification_manual_entries" from "authenticated";

revoke references on table "public"."gamification_manual_entries" from "service_role";

revoke trigger on table "public"."gamification_manual_entries" from "service_role";

revoke truncate on table "public"."gamification_manual_entries" from "service_role";

revoke references on table "public"."gamification_mission_progress" from "anon";

revoke trigger on table "public"."gamification_mission_progress" from "anon";

revoke truncate on table "public"."gamification_mission_progress" from "anon";

revoke references on table "public"."gamification_mission_progress" from "authenticated";

revoke trigger on table "public"."gamification_mission_progress" from "authenticated";

revoke truncate on table "public"."gamification_mission_progress" from "authenticated";

revoke references on table "public"."gamification_mission_progress" from "service_role";

revoke trigger on table "public"."gamification_mission_progress" from "service_role";

revoke truncate on table "public"."gamification_mission_progress" from "service_role";

revoke references on table "public"."gamification_missions" from "anon";

revoke trigger on table "public"."gamification_missions" from "anon";

revoke truncate on table "public"."gamification_missions" from "anon";

revoke references on table "public"."gamification_missions" from "authenticated";

revoke trigger on table "public"."gamification_missions" from "authenticated";

revoke truncate on table "public"."gamification_missions" from "authenticated";

revoke references on table "public"."gamification_missions" from "service_role";

revoke trigger on table "public"."gamification_missions" from "service_role";

revoke truncate on table "public"."gamification_missions" from "service_role";

revoke references on table "public"."gamification_outbox" from "anon";

revoke trigger on table "public"."gamification_outbox" from "anon";

revoke truncate on table "public"."gamification_outbox" from "anon";

revoke references on table "public"."gamification_outbox" from "authenticated";

revoke trigger on table "public"."gamification_outbox" from "authenticated";

revoke truncate on table "public"."gamification_outbox" from "authenticated";

revoke references on table "public"."gamification_outbox" from "service_role";

revoke trigger on table "public"."gamification_outbox" from "service_role";

revoke truncate on table "public"."gamification_outbox" from "service_role";

revoke references on table "public"."gamification_participants" from "anon";

revoke trigger on table "public"."gamification_participants" from "anon";

revoke truncate on table "public"."gamification_participants" from "anon";

revoke references on table "public"."gamification_participants" from "authenticated";

revoke trigger on table "public"."gamification_participants" from "authenticated";

revoke truncate on table "public"."gamification_participants" from "authenticated";

revoke references on table "public"."gamification_participants" from "service_role";

revoke trigger on table "public"."gamification_participants" from "service_role";

revoke truncate on table "public"."gamification_participants" from "service_role";

revoke references on table "public"."gamification_rules" from "anon";

revoke trigger on table "public"."gamification_rules" from "anon";

revoke truncate on table "public"."gamification_rules" from "anon";

revoke references on table "public"."gamification_rules" from "authenticated";

revoke trigger on table "public"."gamification_rules" from "authenticated";

revoke truncate on table "public"."gamification_rules" from "authenticated";

revoke references on table "public"."gamification_rules" from "service_role";

revoke trigger on table "public"."gamification_rules" from "service_role";

revoke truncate on table "public"."gamification_rules" from "service_role";

revoke references on table "public"."gamification_seasons" from "anon";

revoke trigger on table "public"."gamification_seasons" from "anon";

revoke truncate on table "public"."gamification_seasons" from "anon";

revoke references on table "public"."gamification_seasons" from "authenticated";

revoke trigger on table "public"."gamification_seasons" from "authenticated";

revoke truncate on table "public"."gamification_seasons" from "authenticated";

revoke references on table "public"."gamification_seasons" from "service_role";

revoke trigger on table "public"."gamification_seasons" from "service_role";

revoke truncate on table "public"."gamification_seasons" from "service_role";

revoke references on table "public"."imoview_integrations" from "anon";

revoke trigger on table "public"."imoview_integrations" from "anon";

revoke truncate on table "public"."imoview_integrations" from "anon";

revoke references on table "public"."imoview_integrations" from "authenticated";

revoke trigger on table "public"."imoview_integrations" from "authenticated";

revoke truncate on table "public"."imoview_integrations" from "authenticated";

revoke references on table "public"."incident_20260701_pool_redistribution_backup" from "anon";

revoke trigger on table "public"."incident_20260701_pool_redistribution_backup" from "anon";

revoke truncate on table "public"."incident_20260701_pool_redistribution_backup" from "anon";

revoke references on table "public"."incident_20260701_pool_redistribution_backup" from "authenticated";

revoke trigger on table "public"."incident_20260701_pool_redistribution_backup" from "authenticated";

revoke truncate on table "public"."incident_20260701_pool_redistribution_backup" from "authenticated";

revoke references on table "public"."jobs" from "anon";

revoke trigger on table "public"."jobs" from "anon";

revoke truncate on table "public"."jobs" from "anon";

revoke references on table "public"."jobs" from "authenticated";

revoke trigger on table "public"."jobs" from "authenticated";

revoke truncate on table "public"."jobs" from "authenticated";

revoke references on table "public"."lead_action_facts" from "anon";

revoke trigger on table "public"."lead_action_facts" from "anon";

revoke truncate on table "public"."lead_action_facts" from "anon";

revoke references on table "public"."lead_action_facts" from "authenticated";

revoke trigger on table "public"."lead_action_facts" from "authenticated";

revoke truncate on table "public"."lead_action_facts" from "authenticated";

revoke references on table "public"."lead_assignment_cycles" from "anon";

revoke trigger on table "public"."lead_assignment_cycles" from "anon";

revoke truncate on table "public"."lead_assignment_cycles" from "anon";

revoke references on table "public"."lead_assignment_cycles" from "authenticated";

revoke trigger on table "public"."lead_assignment_cycles" from "authenticated";

revoke truncate on table "public"."lead_assignment_cycles" from "authenticated";

revoke references on table "public"."lead_attachments" from "anon";

revoke trigger on table "public"."lead_attachments" from "anon";

revoke truncate on table "public"."lead_attachments" from "anon";

revoke references on table "public"."lead_attachments" from "authenticated";

revoke trigger on table "public"."lead_attachments" from "authenticated";

revoke truncate on table "public"."lead_attachments" from "authenticated";

revoke references on table "public"."lead_attention_events" from "anon";

revoke trigger on table "public"."lead_attention_events" from "anon";

revoke truncate on table "public"."lead_attention_events" from "anon";

revoke references on table "public"."lead_attention_events" from "authenticated";

revoke trigger on table "public"."lead_attention_events" from "authenticated";

revoke truncate on table "public"."lead_attention_events" from "authenticated";

revoke references on table "public"."lead_attention_instances" from "anon";

revoke trigger on table "public"."lead_attention_instances" from "anon";

revoke truncate on table "public"."lead_attention_instances" from "anon";

revoke references on table "public"."lead_attention_instances" from "authenticated";

revoke trigger on table "public"."lead_attention_instances" from "authenticated";

revoke truncate on table "public"."lead_attention_instances" from "authenticated";

revoke references on table "public"."lead_attention_policies" from "anon";

revoke trigger on table "public"."lead_attention_policies" from "anon";

revoke truncate on table "public"."lead_attention_policies" from "anon";

revoke references on table "public"."lead_attention_policies" from "authenticated";

revoke trigger on table "public"."lead_attention_policies" from "authenticated";

revoke truncate on table "public"."lead_attention_policies" from "authenticated";

revoke references on table "public"."lead_events" from "anon";

revoke trigger on table "public"."lead_events" from "anon";

revoke truncate on table "public"."lead_events" from "anon";

revoke references on table "public"."lead_events" from "authenticated";

revoke trigger on table "public"."lead_events" from "authenticated";

revoke truncate on table "public"."lead_events" from "authenticated";

revoke references on table "public"."lead_redistribution_jobs" from "anon";

revoke trigger on table "public"."lead_redistribution_jobs" from "anon";

revoke truncate on table "public"."lead_redistribution_jobs" from "anon";

revoke references on table "public"."lead_redistribution_jobs" from "authenticated";

revoke trigger on table "public"."lead_redistribution_jobs" from "authenticated";

revoke truncate on table "public"."lead_redistribution_jobs" from "authenticated";

revoke references on table "public"."lead_stage_cycles" from "anon";

revoke trigger on table "public"."lead_stage_cycles" from "anon";

revoke truncate on table "public"."lead_stage_cycles" from "anon";

revoke references on table "public"."lead_stage_cycles" from "authenticated";

revoke trigger on table "public"."lead_stage_cycles" from "authenticated";

revoke truncate on table "public"."lead_stage_cycles" from "authenticated";

revoke references on table "public"."media_jobs" from "anon";

revoke trigger on table "public"."media_jobs" from "anon";

revoke truncate on table "public"."media_jobs" from "anon";

revoke references on table "public"."media_jobs" from "authenticated";

revoke trigger on table "public"."media_jobs" from "authenticated";

revoke truncate on table "public"."media_jobs" from "authenticated";

revoke references on table "public"."meta_campaign_insights" from "anon";

revoke trigger on table "public"."meta_campaign_insights" from "anon";

revoke truncate on table "public"."meta_campaign_insights" from "anon";

revoke references on table "public"."meta_campaign_insights" from "authenticated";

revoke trigger on table "public"."meta_campaign_insights" from "authenticated";

revoke truncate on table "public"."meta_campaign_insights" from "authenticated";

revoke references on table "public"."meta_conversations" from "anon";

revoke trigger on table "public"."meta_conversations" from "anon";

revoke truncate on table "public"."meta_conversations" from "anon";

revoke references on table "public"."meta_conversations" from "authenticated";

revoke trigger on table "public"."meta_conversations" from "authenticated";

revoke truncate on table "public"."meta_conversations" from "authenticated";

revoke references on table "public"."meta_integrations" from "anon";

revoke trigger on table "public"."meta_integrations" from "anon";

revoke truncate on table "public"."meta_integrations" from "anon";

revoke references on table "public"."meta_messages" from "anon";

revoke trigger on table "public"."meta_messages" from "anon";

revoke truncate on table "public"."meta_messages" from "anon";

revoke references on table "public"."meta_messages" from "authenticated";

revoke trigger on table "public"."meta_messages" from "authenticated";

revoke truncate on table "public"."meta_messages" from "authenticated";

revoke references on table "public"."meta_oauth_flows" from "anon";

revoke trigger on table "public"."meta_oauth_flows" from "anon";

revoke truncate on table "public"."meta_oauth_flows" from "anon";

revoke references on table "public"."meta_oauth_flows" from "authenticated";

revoke trigger on table "public"."meta_oauth_flows" from "authenticated";

revoke truncate on table "public"."meta_oauth_flows" from "authenticated";

revoke references on table "public"."onboarding_requests" from "anon";

revoke trigger on table "public"."onboarding_requests" from "anon";

revoke truncate on table "public"."onboarding_requests" from "anon";

revoke references on table "public"."onboarding_requests" from "authenticated";

revoke trigger on table "public"."onboarding_requests" from "authenticated";

revoke truncate on table "public"."onboarding_requests" from "authenticated";

revoke references on table "public"."organization_ai_settings" from "anon";

revoke trigger on table "public"."organization_ai_settings" from "anon";

revoke truncate on table "public"."organization_ai_settings" from "anon";

revoke references on table "public"."organization_ai_settings" from "authenticated";

revoke trigger on table "public"."organization_ai_settings" from "authenticated";

revoke truncate on table "public"."organization_ai_settings" from "authenticated";

revoke references on table "public"."organization_api_keys" from "anon";

revoke trigger on table "public"."organization_api_keys" from "anon";

revoke truncate on table "public"."organization_api_keys" from "anon";

revoke references on table "public"."organization_api_keys" from "authenticated";

revoke trigger on table "public"."organization_api_keys" from "authenticated";

revoke truncate on table "public"."organization_api_keys" from "authenticated";

revoke references on table "public"."organization_attention_settings" from "anon";

revoke trigger on table "public"."organization_attention_settings" from "anon";

revoke truncate on table "public"."organization_attention_settings" from "anon";

revoke references on table "public"."organization_attention_settings" from "authenticated";

revoke trigger on table "public"."organization_attention_settings" from "authenticated";

revoke truncate on table "public"."organization_attention_settings" from "authenticated";

revoke references on table "public"."outbox_messages" from "anon";

revoke trigger on table "public"."outbox_messages" from "anon";

revoke truncate on table "public"."outbox_messages" from "anon";

revoke references on table "public"."outbox_messages" from "authenticated";

revoke trigger on table "public"."outbox_messages" from "authenticated";

revoke truncate on table "public"."outbox_messages" from "authenticated";

revoke references on table "public"."portal_import_reports" from "anon";

revoke trigger on table "public"."portal_import_reports" from "anon";

revoke truncate on table "public"."portal_import_reports" from "anon";

revoke references on table "public"."portal_import_reports" from "authenticated";

revoke trigger on table "public"."portal_import_reports" from "authenticated";

revoke truncate on table "public"."portal_import_reports" from "authenticated";

revoke references on table "public"."portal_integrations" from "anon";

revoke trigger on table "public"."portal_integrations" from "anon";

revoke truncate on table "public"."portal_integrations" from "anon";

revoke references on table "public"."portal_integrations" from "authenticated";

revoke trigger on table "public"."portal_integrations" from "authenticated";

revoke truncate on table "public"."portal_integrations" from "authenticated";

revoke references on table "public"."portal_listing_publications" from "anon";

revoke trigger on table "public"."portal_listing_publications" from "anon";

revoke truncate on table "public"."portal_listing_publications" from "anon";

revoke references on table "public"."portal_listing_publications" from "authenticated";

revoke trigger on table "public"."portal_listing_publications" from "authenticated";

revoke truncate on table "public"."portal_listing_publications" from "authenticated";

revoke references on table "public"."portal_webhook_events" from "anon";

revoke trigger on table "public"."portal_webhook_events" from "anon";

revoke truncate on table "public"."portal_webhook_events" from "anon";

revoke references on table "public"."portal_webhook_events" from "authenticated";

revoke trigger on table "public"."portal_webhook_events" from "authenticated";

revoke truncate on table "public"."portal_webhook_events" from "authenticated";

revoke references on table "public"."property_feature_catalog" from "anon";

revoke trigger on table "public"."property_feature_catalog" from "anon";

revoke truncate on table "public"."property_feature_catalog" from "anon";

revoke references on table "public"."property_feature_catalog" from "authenticated";

revoke trigger on table "public"."property_feature_catalog" from "authenticated";

revoke truncate on table "public"."property_feature_catalog" from "authenticated";

revoke references on table "public"."property_proximity_catalog" from "anon";

revoke trigger on table "public"."property_proximity_catalog" from "anon";

revoke truncate on table "public"."property_proximity_catalog" from "anon";

revoke references on table "public"."property_proximity_catalog" from "authenticated";

revoke trigger on table "public"."property_proximity_catalog" from "authenticated";

revoke truncate on table "public"."property_proximity_catalog" from "authenticated";

revoke references on table "public"."push_delivery_events" from "anon";

revoke trigger on table "public"."push_delivery_events" from "anon";

revoke truncate on table "public"."push_delivery_events" from "anon";

revoke references on table "public"."push_delivery_events" from "authenticated";

revoke trigger on table "public"."push_delivery_events" from "authenticated";

revoke truncate on table "public"."push_delivery_events" from "authenticated";

revoke references on table "public"."site_analytics_events" from "anon";

revoke trigger on table "public"."site_analytics_events" from "anon";

revoke truncate on table "public"."site_analytics_events" from "anon";

revoke references on table "public"."site_analytics_events" from "authenticated";

revoke trigger on table "public"."site_analytics_events" from "authenticated";

revoke truncate on table "public"."site_analytics_events" from "authenticated";

revoke references on table "public"."site_lead_submissions" from "anon";

revoke trigger on table "public"."site_lead_submissions" from "anon";

revoke truncate on table "public"."site_lead_submissions" from "anon";

revoke references on table "public"."site_lead_submissions" from "authenticated";

revoke trigger on table "public"."site_lead_submissions" from "authenticated";

revoke truncate on table "public"."site_lead_submissions" from "authenticated";

revoke references on table "public"."subscription_logs" from "anon";

revoke trigger on table "public"."subscription_logs" from "anon";

revoke truncate on table "public"."subscription_logs" from "anon";

revoke references on table "public"."subscription_logs" from "authenticated";

revoke trigger on table "public"."subscription_logs" from "authenticated";

revoke truncate on table "public"."subscription_logs" from "authenticated";

revoke references on table "public"."system_settings" from "anon";

revoke trigger on table "public"."system_settings" from "anon";

revoke truncate on table "public"."system_settings" from "anon";

revoke references on table "public"."system_settings" from "authenticated";

revoke trigger on table "public"."system_settings" from "authenticated";

revoke truncate on table "public"."system_settings" from "authenticated";

revoke references on table "public"."system_settings" from "service_role";

revoke trigger on table "public"."system_settings" from "service_role";

revoke truncate on table "public"."system_settings" from "service_role";

revoke references on table "public"."telephony_calls" from "anon";

revoke trigger on table "public"."telephony_calls" from "anon";

revoke truncate on table "public"."telephony_calls" from "anon";

revoke references on table "public"."telephony_calls" from "authenticated";

revoke trigger on table "public"."telephony_calls" from "authenticated";

revoke truncate on table "public"."telephony_calls" from "authenticated";

revoke references on table "public"."user_activity_sessions" from "anon";

revoke trigger on table "public"."user_activity_sessions" from "anon";

revoke truncate on table "public"."user_activity_sessions" from "anon";

revoke references on table "public"."user_activity_sessions" from "authenticated";

revoke trigger on table "public"."user_activity_sessions" from "authenticated";

revoke truncate on table "public"."user_activity_sessions" from "authenticated";

revoke references on table "public"."user_gamification_stats" from "anon";

revoke trigger on table "public"."user_gamification_stats" from "anon";

revoke truncate on table "public"."user_gamification_stats" from "anon";

revoke references on table "public"."user_gamification_stats" from "authenticated";

revoke trigger on table "public"."user_gamification_stats" from "authenticated";

revoke truncate on table "public"."user_gamification_stats" from "authenticated";

revoke references on table "public"."user_gamification_stats" from "service_role";

revoke trigger on table "public"."user_gamification_stats" from "service_role";

revoke truncate on table "public"."user_gamification_stats" from "service_role";

revoke references on table "public"."user_mission_progress" from "anon";

revoke trigger on table "public"."user_mission_progress" from "anon";

revoke truncate on table "public"."user_mission_progress" from "anon";

revoke references on table "public"."user_mission_progress" from "authenticated";

revoke trigger on table "public"."user_mission_progress" from "authenticated";

revoke truncate on table "public"."user_mission_progress" from "authenticated";

revoke references on table "public"."user_mission_progress" from "service_role";

revoke trigger on table "public"."user_mission_progress" from "service_role";

revoke truncate on table "public"."user_mission_progress" from "service_role";

revoke references on table "public"."user_permission_overrides" from "anon";

revoke trigger on table "public"."user_permission_overrides" from "anon";

revoke truncate on table "public"."user_permission_overrides" from "anon";

revoke references on table "public"."user_permission_overrides" from "authenticated";

revoke trigger on table "public"."user_permission_overrides" from "authenticated";

revoke truncate on table "public"."user_permission_overrides" from "authenticated";

revoke references on table "public"."users" from "anon";

revoke trigger on table "public"."users" from "anon";

revoke truncate on table "public"."users" from "anon";

revoke references on table "public"."users" from "authenticated";

revoke trigger on table "public"."users" from "authenticated";

revoke truncate on table "public"."users" from "authenticated";

revoke references on table "public"."vista_integrations" from "anon";

revoke trigger on table "public"."vista_integrations" from "anon";

revoke truncate on table "public"."vista_integrations" from "anon";

revoke references on table "public"."vista_integrations" from "authenticated";

revoke trigger on table "public"."vista_integrations" from "authenticated";

revoke truncate on table "public"."vista_integrations" from "authenticated";

revoke references on table "public"."whatsapp_chat_labels" from "anon";

revoke trigger on table "public"."whatsapp_chat_labels" from "anon";

revoke truncate on table "public"."whatsapp_chat_labels" from "anon";

revoke references on table "public"."whatsapp_chat_labels" from "authenticated";

revoke trigger on table "public"."whatsapp_chat_labels" from "authenticated";

revoke truncate on table "public"."whatsapp_chat_labels" from "authenticated";

revoke references on table "public"."whatsapp_contact_identity_aliases" from "anon";

revoke trigger on table "public"."whatsapp_contact_identity_aliases" from "anon";

revoke truncate on table "public"."whatsapp_contact_identity_aliases" from "anon";

revoke references on table "public"."whatsapp_contact_identity_aliases" from "authenticated";

revoke trigger on table "public"."whatsapp_contact_identity_aliases" from "authenticated";

revoke truncate on table "public"."whatsapp_contact_identity_aliases" from "authenticated";

revoke references on table "public"."whatsapp_conversations" from "anon";

revoke trigger on table "public"."whatsapp_conversations" from "anon";

revoke truncate on table "public"."whatsapp_conversations" from "anon";

revoke references on table "public"."whatsapp_conversations" from "authenticated";

revoke trigger on table "public"."whatsapp_conversations" from "authenticated";

revoke truncate on table "public"."whatsapp_conversations" from "authenticated";

revoke references on table "public"."whatsapp_groups" from "anon";

revoke trigger on table "public"."whatsapp_groups" from "anon";

revoke truncate on table "public"."whatsapp_groups" from "anon";

revoke references on table "public"."whatsapp_groups" from "authenticated";

revoke trigger on table "public"."whatsapp_groups" from "authenticated";

revoke truncate on table "public"."whatsapp_groups" from "authenticated";

revoke references on table "public"."whatsapp_message_reactions" from "anon";

revoke trigger on table "public"."whatsapp_message_reactions" from "anon";

revoke truncate on table "public"."whatsapp_message_reactions" from "anon";

revoke references on table "public"."whatsapp_message_reactions" from "authenticated";

revoke trigger on table "public"."whatsapp_message_reactions" from "authenticated";

revoke truncate on table "public"."whatsapp_message_reactions" from "authenticated";

revoke references on table "public"."whatsapp_messages" from "anon";

revoke trigger on table "public"."whatsapp_messages" from "anon";

revoke truncate on table "public"."whatsapp_messages" from "anon";

revoke references on table "public"."whatsapp_messages" from "authenticated";

revoke trigger on table "public"."whatsapp_messages" from "authenticated";

revoke truncate on table "public"."whatsapp_messages" from "authenticated";

revoke references on table "public"."whatsapp_outbox" from "anon";

revoke trigger on table "public"."whatsapp_outbox" from "anon";

revoke truncate on table "public"."whatsapp_outbox" from "anon";

revoke references on table "public"."whatsapp_outbox" from "authenticated";

revoke trigger on table "public"."whatsapp_outbox" from "authenticated";

revoke truncate on table "public"."whatsapp_outbox" from "authenticated";

revoke references on table "public"."whatsapp_session_access" from "anon";

revoke trigger on table "public"."whatsapp_session_access" from "anon";

revoke truncate on table "public"."whatsapp_session_access" from "anon";

revoke references on table "public"."whatsapp_session_access" from "authenticated";

revoke trigger on table "public"."whatsapp_session_access" from "authenticated";

revoke truncate on table "public"."whatsapp_session_access" from "authenticated";

revoke references on table "public"."whatsapp_sessions" from "anon";

revoke trigger on table "public"."whatsapp_sessions" from "anon";

revoke truncate on table "public"."whatsapp_sessions" from "anon";

revoke references on table "public"."whatsapp_sessions" from "authenticated";

revoke trigger on table "public"."whatsapp_sessions" from "authenticated";

revoke truncate on table "public"."whatsapp_sessions" from "authenticated";

revoke references on table "public"."whatsapp_webhook_inbox" from "anon";

revoke trigger on table "public"."whatsapp_webhook_inbox" from "anon";

revoke truncate on table "public"."whatsapp_webhook_inbox" from "anon";

revoke references on table "public"."whatsapp_webhook_inbox" from "authenticated";

revoke trigger on table "public"."whatsapp_webhook_inbox" from "authenticated";

revoke truncate on table "public"."whatsapp_webhook_inbox" from "authenticated";

alter table "public"."gamification_missions" drop constraint "gamification_missions_values_canonical_check";

alter table "public"."service_plans" drop constraint "service_plans_category_check";

alter table "public"."gamification_missions" add constraint "gamification_missions_values_canonical_check" CHECK ((((target_count >= 1) AND (target_count <= 1000000)) AND ((bonus_points >= 0) AND (bonus_points <= 1000000)) AND (COALESCE(period, 'season'::text) = ANY (ARRAY['daily'::text, 'weekly'::text, 'monthly'::text, 'season'::text])) AND (target_scope = ANY (ARRAY['organization'::text, 'user'::text])) AND ((target_scope <> 'user'::text) OR (target_user_id IS NOT NULL)))) not valid;

alter table "public"."gamification_missions" validate constraint "gamification_missions_values_canonical_check";

alter table "public"."service_plans" add constraint "service_plans_category_check" CHECK (((category)::text = ANY ((ARRAY['PF'::character varying, 'PJ'::character varying, 'MOVEL'::character varying, 'ADICIONAL'::character varying])::text[]))) not valid;

alter table "public"."service_plans" validate constraint "service_plans_category_check";

-- O pg_dump e o migra não preservam de forma confiável os privilégios padrão.
-- Novos objetos devem continuar fechados até receberem grants explícitos.
alter default privileges for role postgres in schema public
  revoke all on tables from public, anon, authenticated;

alter default privileges for role postgres in schema public
  revoke all on sequences from public, anon, authenticated;

alter default privileges for role postgres in schema public
  revoke all on functions from public, anon, authenticated;


  create policy "Public sites can insert validated lead events"
  on "public"."lead_events"
  as permissive
  for insert
  to anon, authenticated
with check (((organization_id IS NOT NULL) AND (event_type = ANY (ARRAY['pageview'::text, 'favorite'::text, 'form_submit'::text, 'whatsapp_click'::text, 'cta_click'::text])) AND ((length(COALESCE(page_path, ''::text)) >= 1) AND (length(COALESCE(page_path, ''::text)) <= 2048)) AND (length(COALESCE(page_title, ''::text)) <= 500) AND (length(COALESCE(referrer, ''::text)) <= 2048) AND (length(COALESCE(session_id, ''::text)) <= 200) AND (length(COALESCE(utm_source, ''::text)) <= 500) AND (length(COALESCE(utm_medium, ''::text)) <= 500) AND (length(COALESCE(utm_campaign, ''::text)) <= 500) AND (pg_column_size(COALESCE(metadata, '{}'::jsonb)) <= 32768) AND ((COALESCE(screen_width, 0) >= 0) AND (COALESCE(screen_width, 0) <= 100000)) AND ((COALESCE(screen_height, 0) >= 0) AND (COALESCE(screen_height, 0) <= 100000)) AND private.can_track_public_site(organization_id)));
