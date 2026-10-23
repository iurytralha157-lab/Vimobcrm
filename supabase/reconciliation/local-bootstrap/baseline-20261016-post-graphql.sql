-- Name: FUNCTION graphql("operationName" text, query text, variables jsonb, extensions jsonb); Type: ACL; Schema: graphql_public; Owner: supabase_admin
--

GRANT ALL ON FUNCTION graphql_public.graphql("operationName" text, query text, variables jsonb, extensions jsonb) TO postgres;
GRANT ALL ON FUNCTION graphql_public.graphql("operationName" text, query text, variables jsonb, extensions jsonb) TO anon;
GRANT ALL ON FUNCTION graphql_public.graphql("operationName" text, query text, variables jsonb, extensions jsonb) TO authenticated;
GRANT ALL ON FUNCTION graphql_public.graphql("operationName" text, query text, variables jsonb, extensions jsonb) TO service_role;


--
-- Name: FUNCTION http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer); Type: ACL; Schema: net; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) FROM PUBLIC;
GRANT ALL ON FUNCTION net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) TO supabase_functions_admin;
GRANT ALL ON FUNCTION net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) TO postgres;
GRANT ALL ON FUNCTION net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) TO anon;
GRANT ALL ON FUNCTION net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) TO authenticated;
GRANT ALL ON FUNCTION net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) TO service_role;


--
-- Name: FUNCTION http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer); Type: ACL; Schema: net; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) FROM PUBLIC;
GRANT ALL ON FUNCTION net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) TO supabase_functions_admin;
GRANT ALL ON FUNCTION net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) TO postgres;
GRANT ALL ON FUNCTION net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) TO anon;
GRANT ALL ON FUNCTION net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) TO authenticated;
GRANT ALL ON FUNCTION net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) TO service_role;


--
-- Name: FUNCTION pg_reload_conf(); Type: ACL; Schema: pg_catalog; Owner: supabase_admin
--

GRANT ALL ON FUNCTION pg_catalog.pg_reload_conf() TO postgres WITH GRANT OPTION;


--
-- Name: FUNCTION get_auth(p_usename text); Type: ACL; Schema: pgbouncer; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION pgbouncer.get_auth(p_usename text) FROM PUBLIC;
GRANT ALL ON FUNCTION pgbouncer.get_auth(p_usename text) TO pgbouncer;


--
-- Name: FUNCTION activate_whatsapp_webhook_session_cutover(p_organization_id uuid, p_session_id uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.activate_whatsapp_webhook_session_cutover(p_organization_id uuid, p_session_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION private.activate_whatsapp_webhook_session_cutover(p_organization_id uuid, p_session_id uuid) TO service_role;


--
-- Name: FUNCTION advance_management_queue_child_revision(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.advance_management_queue_child_revision() FROM PUBLIC;


--
-- Name: FUNCTION advance_management_queue_revision(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.advance_management_queue_revision() FROM PUBLIC;


--
-- Name: FUNCTION advance_management_tag_revision(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.advance_management_tag_revision() FROM PUBLIC;


--
-- Name: FUNCTION annotate_legacy_property_offer_price(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.annotate_legacy_property_offer_price() FROM PUBLIC;


--
-- Name: FUNCTION apply_asaas_billing_snapshot(p_organization_id uuid, p_provider_customer_id text, p_provider_subscription_id text, p_provider_subscription_status text, p_latest_payment_status text, p_next_billing_date date, p_observed_at timestamp with time zone, p_source text); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.apply_asaas_billing_snapshot(p_organization_id uuid, p_provider_customer_id text, p_provider_subscription_id text, p_provider_subscription_status text, p_latest_payment_status text, p_next_billing_date date, p_observed_at timestamp with time zone, p_source text) FROM PUBLIC;


--
-- Name: FUNCTION apply_asaas_billing_snapshot_with_payment(p_organization_id uuid, p_provider_customer_id text, p_provider_subscription_id text, p_provider_subscription_status text, p_latest_payment_id text, p_latest_payment_status text, p_latest_payment_amount numeric, p_next_billing_date date, p_observed_at timestamp with time zone, p_source text); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.apply_asaas_billing_snapshot_with_payment(p_organization_id uuid, p_provider_customer_id text, p_provider_subscription_id text, p_provider_subscription_status text, p_latest_payment_id text, p_latest_payment_status text, p_latest_payment_amount numeric, p_next_billing_date date, p_observed_at timestamp with time zone, p_source text) FROM PUBLIC;


--
-- Name: FUNCTION apply_asaas_billing_snapshot_with_payment(p_organization_id uuid, p_provider_customer_id text, p_provider_subscription_id text, p_provider_subscription_status text, p_latest_payment_id text, p_latest_payment_status text, p_latest_payment_amount numeric, p_latest_payment_due_date date, p_next_billing_date date, p_observed_at timestamp with time zone, p_source text); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.apply_asaas_billing_snapshot_with_payment(p_organization_id uuid, p_provider_customer_id text, p_provider_subscription_id text, p_provider_subscription_status text, p_latest_payment_id text, p_latest_payment_status text, p_latest_payment_amount numeric, p_latest_payment_due_date date, p_next_billing_date date, p_observed_at timestamp with time zone, p_source text) FROM PUBLIC;


--
-- Name: FUNCTION apply_lead_action_fact(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.apply_lead_action_fact() FROM PUBLIC;


--
-- Name: FUNCTION apply_notification_delivery_receipt(p_notification_id uuid, p_channel text, p_provider text, p_provider_message_id text, p_provider_status text, p_delivered boolean, p_permanent_failure boolean, p_occurred_at timestamp with time zone); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.apply_notification_delivery_receipt(p_notification_id uuid, p_channel text, p_provider text, p_provider_message_id text, p_provider_status text, p_delivered boolean, p_permanent_failure boolean, p_occurred_at timestamp with time zone) FROM PUBLIC;


--
-- Name: FUNCTION apply_organization_billing_transition(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.apply_organization_billing_transition() FROM PUBLIC;


--
-- Name: FUNCTION apply_property_development_reservation(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.apply_property_development_reservation() FROM PUBLIC;


--
-- Name: FUNCTION apply_property_key_movement(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.apply_property_key_movement() FROM PUBLIC;


--
-- Name: FUNCTION apply_round_robin_auto_tags(p_organization_id uuid, p_round_robin_id uuid, p_lead_id uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.apply_round_robin_auto_tags(p_organization_id uuid, p_round_robin_id uuid, p_lead_id uuid) FROM PUBLIC;


--
-- Name: FUNCTION apply_round_robin_auto_tags_from_log(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.apply_round_robin_auto_tags_from_log() FROM PUBLIC;


--
-- Name: FUNCTION apply_scheduled_billing_plan_change(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.apply_scheduled_billing_plan_change() FROM PUBLIC;


--
-- Name: FUNCTION asaas_organization_status_from_payment(p_current_status text, p_payment_status text); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.asaas_organization_status_from_payment(p_current_status text, p_payment_status text) FROM PUBLIC;


--
-- Name: FUNCTION asaas_payment_status_from_event(p_event_type text, p_payload_status text); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.asaas_payment_status_from_event(p_event_type text, p_payload_status text) FROM PUBLIC;


--
-- Name: FUNCTION asaas_payment_status_precedence(p_status text); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.asaas_payment_status_precedence(p_status text) FROM PUBLIC;


--
-- Name: FUNCTION attention_metadata_is_automated(value jsonb); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.attention_metadata_is_automated(value jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION private.attention_metadata_is_automated(value jsonb) TO service_role;


--
-- Name: FUNCTION audit_jsonb_diff(p_old jsonb, p_new jsonb, p_excluded_columns text[]); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.audit_jsonb_diff(p_old jsonb, p_new jsonb, p_excluded_columns text[]) FROM PUBLIC;
GRANT ALL ON FUNCTION private.audit_jsonb_diff(p_old jsonb, p_new jsonb, p_excluded_columns text[]) TO service_role;


--
-- Name: FUNCTION automation_assign_lead_user(p_organization_id uuid, p_lead_id uuid, p_user_id uuid, p_actor_user_id uuid, p_execution_id uuid, p_node_key text); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.automation_assign_lead_user(p_organization_id uuid, p_lead_id uuid, p_user_id uuid, p_actor_user_id uuid, p_execution_id uuid, p_node_key text) FROM PUBLIC;


--
-- Name: FUNCTION automation_move_lead_stage(p_organization_id uuid, p_lead_id uuid, p_stage_id uuid, p_pipeline_id uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.automation_move_lead_stage(p_organization_id uuid, p_lead_id uuid, p_stage_id uuid, p_pipeline_id uuid) FROM PUBLIC;


--
-- Name: FUNCTION backfill_real_estate_foundation(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.backfill_real_estate_foundation() FROM PUBLIC;


--
-- Name: FUNCTION backfill_unambiguous_pipeline_default_round_robins(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.backfill_unambiguous_pipeline_default_round_robins() FROM PUBLIC;


--
-- Name: FUNCTION billing_card_recurrence_cancel_state(p_organization_id uuid, p_provider_subscription_id text); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.billing_card_recurrence_cancel_state(p_organization_id uuid, p_provider_subscription_id text) FROM PUBLIC;


--
-- Name: FUNCTION billing_card_recurrence_external_reference(p_payment_id uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.billing_card_recurrence_external_reference(p_payment_id uuid) FROM PUBLIC;


--
-- Name: FUNCTION billing_checkout_organization_from_reference(p_external_reference text, p_customer_id text, p_subscription_id text); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.billing_checkout_organization_from_reference(p_external_reference text, p_customer_id text, p_subscription_id text) FROM PUBLIC;


--
-- Name: FUNCTION billing_organization_cleanup_inventory_issue(p_organization_id uuid, p_claim_token uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.billing_organization_cleanup_inventory_issue(p_organization_id uuid, p_claim_token uuid) FROM PUBLIC;


--
-- Name: FUNCTION billing_organization_cleanup_is_active(p_organization_id uuid, p_provider_subscription_id text); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.billing_organization_cleanup_is_active(p_organization_id uuid, p_provider_subscription_id text) FROM PUBLIC;


--
-- Name: FUNCTION billing_organization_has_unmaterialized_provider_payment(p_organization_id uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.billing_organization_has_unmaterialized_provider_payment(p_organization_id uuid) FROM PUBLIC;


--
-- Name: FUNCTION billing_organization_provider_payment_references(p_organization_id uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.billing_organization_provider_payment_references(p_organization_id uuid) FROM PUBLIC;


--
-- Name: FUNCTION billing_payment_checkout_is_actionable(p_status text); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.billing_payment_checkout_is_actionable(p_status text) FROM PUBLIC;


--
-- Name: FUNCTION billing_payment_checkout_is_paid(p_status text); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.billing_payment_checkout_is_paid(p_status text) FROM PUBLIC;


--
-- Name: FUNCTION billing_payment_checkout_is_processing(p_status text); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.billing_payment_checkout_is_processing(p_status text) FROM PUBLIC;


--
-- Name: FUNCTION billing_payment_checkout_is_resolvable(p_payment_id uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.billing_payment_checkout_is_resolvable(p_payment_id uuid) FROM PUBLIC;


--
-- Name: FUNCTION billing_payment_checkout_is_reversal(p_status text); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.billing_payment_checkout_is_reversal(p_status text) FROM PUBLIC;


--
-- Name: FUNCTION billing_payment_checkout_is_terminal(p_status text); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.billing_payment_checkout_is_terminal(p_status text) FROM PUBLIC;


--
-- Name: FUNCTION billing_provider_identity_ownership_issue(p_organization_id uuid, p_provider_customer_id text, p_provider_subscription_id text); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.billing_provider_identity_ownership_issue(p_organization_id uuid, p_provider_customer_id text, p_provider_subscription_id text) FROM PUBLIC;


--
-- Name: FUNCTION billing_provider_payment_delete_is_proven(p_organization_id uuid, p_provider_payment_id text); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.billing_provider_payment_delete_is_proven(p_organization_id uuid, p_provider_payment_id text) FROM PUBLIC;


--
-- Name: FUNCTION billing_subscription_delete_proof_has_live_conflict(p_organization_id uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.billing_subscription_delete_proof_has_live_conflict(p_organization_id uuid) FROM PUBLIC;


--
-- Name: FUNCTION billing_subscription_provider_delete_is_proven(p_organization_id uuid, p_provider_subscription_id text); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.billing_subscription_provider_delete_is_proven(p_organization_id uuid, p_provider_subscription_id text) FROM PUBLIC;


--
-- Name: FUNCTION bind_participant_membership_generation(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.bind_participant_membership_generation() FROM PUBLIC;


--
-- Name: FUNCTION block_notification_delivery(p_delivery_id uuid, p_lease_token uuid, p_dependency_key text, p_error_code text, p_error_message text); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.block_notification_delivery(p_delivery_id uuid, p_lease_token uuid, p_dependency_key text, p_error_code text, p_error_message text) FROM PUBLIC;
GRANT ALL ON FUNCTION private.block_notification_delivery(p_delivery_id uuid, p_lease_token uuid, p_dependency_key text, p_error_code text, p_error_message text) TO service_role;


--
-- Name: FUNCTION broadcast_audit_log_change(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.broadcast_audit_log_change() FROM PUBLIC;
GRANT ALL ON FUNCTION private.broadcast_audit_log_change() TO service_role;


--
-- Name: FUNCTION broadcast_whatsapp_message_change(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.broadcast_whatsapp_message_change() FROM PUBLIC;
GRANT ALL ON FUNCTION private.broadcast_whatsapp_message_change() TO service_role;


--
-- Name: FUNCTION can_access_lead(target_organization_id uuid, assigned_user_id uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.can_access_lead(target_organization_id uuid, assigned_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION private.can_access_lead(target_organization_id uuid, assigned_user_id uuid) TO authenticated;
GRANT ALL ON FUNCTION private.can_access_lead(target_organization_id uuid, assigned_user_id uuid) TO service_role;


--
-- Name: FUNCTION can_access_lead_by_id(p_lead_id uuid, p_user_id uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.can_access_lead_by_id(p_lead_id uuid, p_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION private.can_access_lead_by_id(p_lead_id uuid, p_user_id uuid) TO service_role;
GRANT ALL ON FUNCTION private.can_access_lead_by_id(p_lead_id uuid, p_user_id uuid) TO authenticated;


--
-- Name: FUNCTION can_access_schedule_event(p_event_id uuid, p_require_full_details boolean); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.can_access_schedule_event(p_event_id uuid, p_require_full_details boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION private.can_access_schedule_event(p_event_id uuid, p_require_full_details boolean) TO service_role;
GRANT ALL ON FUNCTION private.can_access_schedule_event(p_event_id uuid, p_require_full_details boolean) TO authenticated;


--
-- Name: FUNCTION can_manage_round_robin_as_leader(p_round_robin_id uuid, p_user_id uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.can_manage_round_robin_as_leader(p_round_robin_id uuid, p_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION private.can_manage_round_robin_as_leader(p_round_robin_id uuid, p_user_id uuid) TO service_role;
GRANT ALL ON FUNCTION private.can_manage_round_robin_as_leader(p_round_robin_id uuid, p_user_id uuid) TO authenticated;


--
-- Name: FUNCTION can_manage_whatsapp_session(p_session_id uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.can_manage_whatsapp_session(p_session_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION private.can_manage_whatsapp_session(p_session_id uuid) TO service_role;


--
-- Name: FUNCTION can_read_lead(target_organization_id uuid, target_assigned_user_id uuid, target_team_id uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.can_read_lead(target_organization_id uuid, target_assigned_user_id uuid, target_team_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION private.can_read_lead(target_organization_id uuid, target_assigned_user_id uuid, target_team_id uuid) TO authenticated;
GRANT ALL ON FUNCTION private.can_read_lead(target_organization_id uuid, target_assigned_user_id uuid, target_team_id uuid) TO service_role;


--
-- Name: FUNCTION can_read_lead_by_id(p_lead_id uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.can_read_lead_by_id(p_lead_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION private.can_read_lead_by_id(p_lead_id uuid) TO authenticated;
GRANT ALL ON FUNCTION private.can_read_lead_by_id(p_lead_id uuid) TO service_role;


--
-- Name: FUNCTION can_read_management_distribution(p_organization_id uuid, p_queue_id uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.can_read_management_distribution(p_organization_id uuid, p_queue_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION private.can_read_management_distribution(p_organization_id uuid, p_queue_id uuid) TO authenticated;


--
-- Name: FUNCTION can_read_management_team(p_organization_id uuid, p_team_id uuid, p_pipeline_id uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.can_read_management_team(p_organization_id uuid, p_team_id uuid, p_pipeline_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION private.can_read_management_team(p_organization_id uuid, p_team_id uuid, p_pipeline_id uuid) TO authenticated;


--
-- Name: FUNCTION can_read_management_team_member(p_organization_id uuid, p_team_id uuid, p_user_id uuid, p_membership_generation bigint, p_is_active boolean); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.can_read_management_team_member(p_organization_id uuid, p_team_id uuid, p_user_id uuid, p_membership_generation bigint, p_is_active boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION private.can_read_management_team_member(p_organization_id uuid, p_team_id uuid, p_user_id uuid, p_membership_generation bigint, p_is_active boolean) TO authenticated;


--
-- Name: FUNCTION can_receive_audit_broadcast(p_topic text); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.can_receive_audit_broadcast(p_topic text) FROM PUBLIC;
GRANT ALL ON FUNCTION private.can_receive_audit_broadcast(p_topic text) TO authenticated;
GRANT ALL ON FUNCTION private.can_receive_audit_broadcast(p_topic text) TO service_role;


--
-- Name: FUNCTION can_receive_whatsapp_broadcast(p_topic text); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.can_receive_whatsapp_broadcast(p_topic text) FROM PUBLIC;
GRANT ALL ON FUNCTION private.can_receive_whatsapp_broadcast(p_topic text) TO authenticated;
GRANT ALL ON FUNCTION private.can_receive_whatsapp_broadcast(p_topic text) TO service_role;


--
-- Name: FUNCTION can_track_public_site(target_organization_id uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.can_track_public_site(target_organization_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION private.can_track_public_site(target_organization_id uuid) TO anon;
GRANT ALL ON FUNCTION private.can_track_public_site(target_organization_id uuid) TO authenticated;
GRANT ALL ON FUNCTION private.can_track_public_site(target_organization_id uuid) TO service_role;


--
-- Name: FUNCTION can_use_organization_presence(p_topic text); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.can_use_organization_presence(p_topic text) FROM PUBLIC;
GRANT ALL ON FUNCTION private.can_use_organization_presence(p_topic text) TO authenticated;
GRANT ALL ON FUNCTION private.can_use_organization_presence(p_topic text) TO service_role;


--
-- Name: FUNCTION can_view_property_owner_record(target_organization_id uuid, target_owner_id uuid, target_created_by uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.can_view_property_owner_record(target_organization_id uuid, target_owner_id uuid, target_created_by uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION private.can_view_property_owner_record(target_organization_id uuid, target_owner_id uuid, target_created_by uuid) TO authenticated;
GRANT ALL ON FUNCTION private.can_view_property_owner_record(target_organization_id uuid, target_owner_id uuid, target_created_by uuid) TO service_role;


--
-- Name: FUNCTION can_view_property_record(target_organization_id uuid, target_created_by uuid, target_responsible_user_id uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.can_view_property_record(target_organization_id uuid, target_created_by uuid, target_responsible_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION private.can_view_property_record(target_organization_id uuid, target_created_by uuid, target_responsible_user_id uuid) TO authenticated;
GRANT ALL ON FUNCTION private.can_view_property_record(target_organization_id uuid, target_created_by uuid, target_responsible_user_id uuid) TO service_role;


--
-- Name: FUNCTION can_view_real_estate_record(target_organization_id uuid, target_property_id uuid, target_property_key_id uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.can_view_real_estate_record(target_organization_id uuid, target_property_id uuid, target_property_key_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION private.can_view_real_estate_record(target_organization_id uuid, target_property_id uuid, target_property_key_id uuid) TO authenticated;
GRANT ALL ON FUNCTION private.can_view_real_estate_record(target_organization_id uuid, target_property_id uuid, target_property_key_id uuid) TO service_role;


--
-- Name: FUNCTION can_view_whatsapp_conversation(p_conversation_id uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.can_view_whatsapp_conversation(p_conversation_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION private.can_view_whatsapp_conversation(p_conversation_id uuid) TO service_role;


--
-- Name: FUNCTION cancel_billing_payment_receipt_delivery(p_notification_id uuid, p_payment_status text); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.cancel_billing_payment_receipt_delivery(p_notification_id uuid, p_payment_status text) FROM PUBLIC;


--
-- Name: FUNCTION cancel_lead_automation_executions(p_organization_id uuid, p_lead_id uuid, p_reason text, p_conversation_id uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.cancel_lead_automation_executions(p_organization_id uuid, p_lead_id uuid, p_reason text, p_conversation_id uuid) FROM PUBLIC;


--
-- Name: FUNCTION canonical_jsonb_sha256(p_value jsonb); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.canonical_jsonb_sha256(p_value jsonb) FROM PUBLIC;


--
-- Name: FUNCTION canonical_jsonb_text(p_value jsonb); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.canonical_jsonb_text(p_value jsonb) FROM PUBLIC;


--
-- Name: FUNCTION canonical_linked_property_status(source_status text); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.canonical_linked_property_status(source_status text) FROM PUBLIC;


--
-- Name: FUNCTION canonical_property_deal_type(p_value text); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.canonical_property_deal_type(p_value text) FROM PUBLIC;
GRANT ALL ON FUNCTION private.canonical_property_deal_type(p_value text) TO service_role;


--
-- Name: FUNCTION capture_activity_attention_fact(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.capture_activity_attention_fact() FROM PUBLIC;


--
-- Name: FUNCTION capture_automation_human_outbound_handoff(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.capture_automation_human_outbound_handoff() FROM PUBLIC;


--
-- Name: FUNCTION capture_automation_inbound_message_event(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.capture_automation_inbound_message_event() FROM PUBLIC;


--
-- Name: FUNCTION capture_automation_lead_events(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.capture_automation_lead_events() FROM PUBLIC;


--
-- Name: FUNCTION capture_automation_tag_event(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.capture_automation_tag_event() FROM PUBLIC;


--
-- Name: FUNCTION capture_lead_cycles(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.capture_lead_cycles() FROM PUBLIC;


--
-- Name: FUNCTION capture_lead_funnel_transition(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.capture_lead_funnel_transition() FROM PUBLIC;


--
-- Name: FUNCTION capture_meta_entry_funnel(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.capture_meta_entry_funnel() FROM PUBLIC;


--
-- Name: FUNCTION capture_property_creation_receipt(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.capture_property_creation_receipt() FROM PUBLIC;


--
-- Name: FUNCTION capture_property_development_reservation_event(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.capture_property_development_reservation_event() FROM PUBLIC;


--
-- Name: FUNCTION capture_property_development_unit_event(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.capture_property_development_unit_event() FROM PUBLIC;


--
-- Name: FUNCTION capture_property_development_unit_price_event(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.capture_property_development_unit_price_event() FROM PUBLIC;


--
-- Name: FUNCTION capture_round_robin_rotation_assignment(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.capture_round_robin_rotation_assignment() FROM PUBLIC;


--
-- Name: FUNCTION capture_simple_stage_inactivity_scope(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.capture_simple_stage_inactivity_scope() FROM PUBLIC;
GRANT ALL ON FUNCTION private.capture_simple_stage_inactivity_scope() TO service_role;


--
-- Name: FUNCTION capture_team_distribution_event(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.capture_team_distribution_event() FROM PUBLIC;


--
-- Name: FUNCTION capture_whatsapp_attention_fact(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.capture_whatsapp_attention_fact() FROM PUBLIC;


--
-- Name: FUNCTION capture_whatsapp_webhook_routing_snapshot(p_organization_id uuid, p_session_id uuid, p_provider_message_id text, p_inbox_event_key text, p_processing_lane text, p_routing_key text, p_binding_eligible boolean, p_identity_aliases text[], p_contact_phone text, p_context_kind text, p_context_proof text, p_managed_message_distribution boolean, p_managed_event_pending boolean, p_managed_event_handled boolean, p_rule_id uuid, p_origin_round_robin_id uuid, p_provider_event_lead_id uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.capture_whatsapp_webhook_routing_snapshot(p_organization_id uuid, p_session_id uuid, p_provider_message_id text, p_inbox_event_key text, p_processing_lane text, p_routing_key text, p_binding_eligible boolean, p_identity_aliases text[], p_contact_phone text, p_context_kind text, p_context_proof text, p_managed_message_distribution boolean, p_managed_event_pending boolean, p_managed_event_handled boolean, p_rule_id uuid, p_origin_round_robin_id uuid, p_provider_event_lead_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION private.capture_whatsapp_webhook_routing_snapshot(p_organization_id uuid, p_session_id uuid, p_provider_message_id text, p_inbox_event_key text, p_processing_lane text, p_routing_key text, p_binding_eligible boolean, p_identity_aliases text[], p_contact_phone text, p_context_kind text, p_context_proof text, p_managed_message_distribution boolean, p_managed_event_pending boolean, p_managed_event_handled boolean, p_rule_id uuid, p_origin_round_robin_id uuid, p_provider_event_lead_id uuid) TO service_role;


--
-- Name: FUNCTION capture_whatsapp_webhook_routing_snapshot_v2(p_organization_id uuid, p_session_id uuid, p_provider_message_id text, p_inbox_event_key text, p_processing_lane text, p_routing_key text, p_binding_eligible boolean, p_identity_aliases text[], p_contact_phone text, p_context_kind text, p_context_proof text, p_managed_message_distribution boolean, p_managed_event_pending boolean, p_managed_event_handled boolean, p_rule_id uuid, p_origin_round_robin_id uuid, p_provider_event_lead_id uuid, p_processing_epoch integer); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.capture_whatsapp_webhook_routing_snapshot_v2(p_organization_id uuid, p_session_id uuid, p_provider_message_id text, p_inbox_event_key text, p_processing_lane text, p_routing_key text, p_binding_eligible boolean, p_identity_aliases text[], p_contact_phone text, p_context_kind text, p_context_proof text, p_managed_message_distribution boolean, p_managed_event_pending boolean, p_managed_event_handled boolean, p_rule_id uuid, p_origin_round_robin_id uuid, p_provider_event_lead_id uuid, p_processing_epoch integer) FROM PUBLIC;
GRANT ALL ON FUNCTION private.capture_whatsapp_webhook_routing_snapshot_v2(p_organization_id uuid, p_session_id uuid, p_provider_message_id text, p_inbox_event_key text, p_processing_lane text, p_routing_key text, p_binding_eligible boolean, p_identity_aliases text[], p_contact_phone text, p_context_kind text, p_context_proof text, p_managed_message_distribution boolean, p_managed_event_pending boolean, p_managed_event_handled boolean, p_rule_id uuid, p_origin_round_robin_id uuid, p_provider_event_lead_id uuid, p_processing_epoch integer) TO service_role;


--
-- Name: FUNCTION cascade_property_city_projection(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.cascade_property_city_projection() FROM PUBLIC;
GRANT ALL ON FUNCTION private.cascade_property_city_projection() TO service_role;


--
-- Name: FUNCTION cascade_property_condominium_projection(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.cascade_property_condominium_projection() FROM PUBLIC;
GRANT ALL ON FUNCTION private.cascade_property_condominium_projection() TO service_role;


--
-- Name: FUNCTION cascade_property_neighborhood_projection(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.cascade_property_neighborhood_projection() FROM PUBLIC;
GRANT ALL ON FUNCTION private.cascade_property_neighborhood_projection() TO service_role;


--
-- Name: FUNCTION check_public_ingress_rate_limit(p_scope text, p_subject_hash text, p_limit integer, p_window_seconds integer, p_now timestamp with time zone); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.check_public_ingress_rate_limit(p_scope text, p_subject_hash text, p_limit integer, p_window_seconds integer, p_now timestamp with time zone) FROM PUBLIC;


--
-- Name: FUNCTION check_queue_pool_owner_invariant(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.check_queue_pool_owner_invariant() FROM PUBLIC;


--
-- Name: FUNCTION claim_notification_deliveries(p_worker_id text, p_batch_size integer, p_lease_for interval, p_channels text[]); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.claim_notification_deliveries(p_worker_id text, p_batch_size integer, p_lease_for interval, p_channels text[]) FROM PUBLIC;
GRANT ALL ON FUNCTION private.claim_notification_deliveries(p_worker_id text, p_batch_size integer, p_lease_for interval, p_channels text[]) TO service_role;


--
-- Name: TABLE property_channel_publication_jobs; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.property_channel_publication_jobs TO service_role;


--
-- Name: FUNCTION claim_property_channel_publication_jobs(p_worker_id text, p_limit integer, p_lease interval); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.claim_property_channel_publication_jobs(p_worker_id text, p_limit integer, p_lease interval) FROM PUBLIC;
GRANT ALL ON FUNCTION private.claim_property_channel_publication_jobs(p_worker_id text, p_limit integer, p_lease interval) TO service_role;


--
-- Name: FUNCTION claim_queue_pool(p_organization_id uuid, p_lead_id uuid, p_actor_id uuid, p_round_robin_id uuid, p_episode_id uuid, p_expected_revision bigint, p_idempotency_key text); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.claim_queue_pool(p_organization_id uuid, p_lead_id uuid, p_actor_id uuid, p_round_robin_id uuid, p_episode_id uuid, p_expected_revision bigint, p_idempotency_key text) FROM PUBLIC;


--
-- Name: FUNCTION claim_queue_pool_before_concurrency_guard(p_organization_id uuid, p_lead_id uuid, p_actor_id uuid, p_round_robin_id uuid, p_episode_id uuid, p_expected_revision bigint, p_idempotency_key text); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.claim_queue_pool_before_concurrency_guard(p_organization_id uuid, p_lead_id uuid, p_actor_id uuid, p_round_robin_id uuid, p_episode_id uuid, p_expected_revision bigint, p_idempotency_key text) FROM PUBLIC;


--
-- Name: FUNCTION claim_whatsapp_avatar_job(p_worker_id text, p_lease interval); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.claim_whatsapp_avatar_job(p_worker_id text, p_lease interval) FROM PUBLIC;


--
-- Name: TABLE media_jobs; Type: ACL; Schema: public; Owner: postgres
--

GRANT INSERT ON TABLE public.media_jobs TO service_role;


--
-- Name: FUNCTION claim_whatsapp_media_job(p_worker_id text, p_lease interval); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.claim_whatsapp_media_job(p_worker_id text, p_lease interval) FROM PUBLIC;


--
-- Name: FUNCTION claim_whatsapp_media_job(p_worker_id text, p_lease interval, p_max_concurrency integer, p_session_ids text[]); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.claim_whatsapp_media_job(p_worker_id text, p_lease interval, p_max_concurrency integer, p_session_ids text[]) FROM PUBLIC;


--
-- Name: FUNCTION claim_whatsapp_media_job(p_worker_id text, p_lease interval, p_max_concurrency integer, p_session_ids uuid[], p_all_sessions boolean); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.claim_whatsapp_media_job(p_worker_id text, p_lease interval, p_max_concurrency integer, p_session_ids uuid[], p_all_sessions boolean) FROM PUBLIC;


--
-- Name: TABLE whatsapp_outbox; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.whatsapp_outbox TO service_role;


--
-- Name: FUNCTION claim_whatsapp_outbox(p_worker_id text, p_limit integer, p_lease interval); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.claim_whatsapp_outbox(p_worker_id text, p_limit integer, p_lease interval) FROM PUBLIC;
GRANT ALL ON FUNCTION private.claim_whatsapp_outbox(p_worker_id text, p_limit integer, p_lease interval) TO service_role;


--
-- Name: FUNCTION claim_whatsapp_sessions_for_supervision(p_claim_token text, p_limit integer, p_minimum_age interval, p_lease interval); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.claim_whatsapp_sessions_for_supervision(p_claim_token text, p_limit integer, p_minimum_age interval, p_lease interval) FROM PUBLIC;


--
-- Name: TABLE whatsapp_unlinked_media_gc; Type: ACL; Schema: private; Owner: postgres
--

GRANT SELECT ON TABLE private.whatsapp_unlinked_media_gc TO service_role;


--
-- Name: FUNCTION claim_whatsapp_unlinked_media_gc(p_worker_id text, p_limit integer, p_lease interval); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.claim_whatsapp_unlinked_media_gc(p_worker_id text, p_limit integer, p_lease interval) FROM PUBLIC;
GRANT ALL ON FUNCTION private.claim_whatsapp_unlinked_media_gc(p_worker_id text, p_limit integer, p_lease interval) TO service_role;


--
-- Name: TABLE whatsapp_webhook_inbox; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.whatsapp_webhook_inbox TO service_role;


--
-- Name: FUNCTION claim_whatsapp_webhook_inbox(p_worker_id text, p_limit integer, p_lease interval); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.claim_whatsapp_webhook_inbox(p_worker_id text, p_limit integer, p_lease interval) FROM PUBLIC;
GRANT ALL ON FUNCTION private.claim_whatsapp_webhook_inbox(p_worker_id text, p_limit integer, p_lease interval) TO service_role;


--
-- Name: FUNCTION cleanup_orphan_round_robin_ticket_sequences(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.cleanup_orphan_round_robin_ticket_sequences() FROM PUBLIC;


--
-- Name: FUNCTION cleanup_public_ingress_rate_limits(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.cleanup_public_ingress_rate_limits() FROM PUBLIC;


--
-- Name: FUNCTION cleanup_queue_runtime_command(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.cleanup_queue_runtime_command() FROM PUBLIC;


--
-- Name: FUNCTION cleanup_whatsapp_webhook_routing_provenance(p_limit integer, p_before timestamp with time zone); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.cleanup_whatsapp_webhook_routing_provenance(p_limit integer, p_before timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION private.cleanup_whatsapp_webhook_routing_provenance(p_limit integer, p_before timestamp with time zone) TO service_role;


--
-- Name: FUNCTION clear_billing_card_recurrence_credential_on_failure(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.clear_billing_card_recurrence_credential_on_failure() FROM PUBLIC;


--
-- Name: FUNCTION clear_membership_grants_on_lifecycle_change(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.clear_membership_grants_on_lifecycle_change() FROM PUBLIC;


--
-- Name: FUNCTION clear_removed_subscription_after_late_payment(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.clear_removed_subscription_after_late_payment() FROM PUBLIC;


--
-- Name: FUNCTION clear_whatsapp_notification_sender_after_admin_loss(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.clear_whatsapp_notification_sender_after_admin_loss() FROM PUBLIC;


--
-- Name: FUNCTION close_whatsapp_bindings_before_lead_delete(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.close_whatsapp_bindings_before_lead_delete() FROM PUBLIC;


--
-- Name: FUNCTION complete_billing_card_recurrence_locked(p_payment_id uuid, p_provider_payment_id text, p_lease_id uuid, p_subscription jsonb, p_require_lease boolean); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.complete_billing_card_recurrence_locked(p_payment_id uuid, p_provider_payment_id text, p_lease_id uuid, p_subscription jsonb, p_require_lease boolean) FROM PUBLIC;


--
-- Name: FUNCTION complete_notification_delivery(p_delivery_id uuid, p_lease_token uuid, p_status text, p_provider text, p_provider_message_id text, p_provider_status text, p_attempt_metadata jsonb, p_occurred_at timestamp with time zone); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.complete_notification_delivery(p_delivery_id uuid, p_lease_token uuid, p_status text, p_provider text, p_provider_message_id text, p_provider_status text, p_attempt_metadata jsonb, p_occurred_at timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION private.complete_notification_delivery(p_delivery_id uuid, p_lease_token uuid, p_status text, p_provider text, p_provider_message_id text, p_provider_status text, p_attempt_metadata jsonb, p_occurred_at timestamp with time zone) TO service_role;


--
-- Name: FUNCTION complete_property_channel_publication_job(p_job_id uuid, p_worker_id text, p_lease_token uuid, p_completed_at timestamp with time zone); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.complete_property_channel_publication_job(p_job_id uuid, p_worker_id text, p_lease_token uuid, p_completed_at timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION private.complete_property_channel_publication_job(p_job_id uuid, p_worker_id text, p_lease_token uuid, p_completed_at timestamp with time zone) TO service_role;


--
-- Name: FUNCTION complete_whatsapp_unlinked_media_gc(p_id uuid, p_worker_id text, p_deleted boolean, p_error text); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.complete_whatsapp_unlinked_media_gc(p_id uuid, p_worker_id text, p_deleted boolean, p_error text) FROM PUBLIC;
GRANT ALL ON FUNCTION private.complete_whatsapp_unlinked_media_gc(p_id uuid, p_worker_id text, p_deleted boolean, p_error text) TO service_role;


--
-- Name: FUNCTION complete_whatsapp_webhook_event(p_event_id uuid, p_worker_id text); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.complete_whatsapp_webhook_event(p_event_id uuid, p_worker_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION private.complete_whatsapp_webhook_event(p_event_id uuid, p_worker_id text) TO service_role;


--
-- Name: FUNCTION confirm_billing_checkout_from_payment(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.confirm_billing_checkout_from_payment() FROM PUBLIC;


--
-- Name: FUNCTION confirm_billing_checkout_intent(p_payment_id text, p_subscription_id text, p_payment_status text, p_paid_amount numeric); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.confirm_billing_checkout_intent(p_payment_id text, p_subscription_id text, p_payment_status text, p_paid_amount numeric) FROM PUBLIC;


--
-- Name: FUNCTION correct_asaas_naive_event_timestamp(p_payload jsonb); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.correct_asaas_naive_event_timestamp(p_payload jsonb) FROM PUBLIC;


--
-- Name: FUNCTION create_billing_payment_receipt_from_payment(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.create_billing_payment_receipt_from_payment() FROM PUBLIC;


--
-- Name: FUNCTION create_round_robin_ticket_sequence(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.create_round_robin_ticket_sequence() FROM PUBLIC;


--
-- Name: FUNCTION create_whatsapp_inbound_attendant_notification(p_organization_id uuid, p_message_id uuid, p_user_id uuid, p_entry_id uuid, p_binding_id uuid, p_grant_id uuid, p_origin_notification_id uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.create_whatsapp_inbound_attendant_notification(p_organization_id uuid, p_message_id uuid, p_user_id uuid, p_entry_id uuid, p_binding_id uuid, p_grant_id uuid, p_origin_notification_id uuid) FROM PUBLIC;


--
-- Name: FUNCTION current_audit_actor_id(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.current_audit_actor_id() FROM PUBLIC;
GRANT ALL ON FUNCTION private.current_audit_actor_id() TO service_role;


--
-- Name: FUNCTION dedupe_whatsapp_meta_creative_activity(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.dedupe_whatsapp_meta_creative_activity() FROM PUBLIC;


--
-- Name: FUNCTION development_unit_property_status(source_status text); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.development_unit_property_status(source_status text) FROM PUBLIC;


--
-- Name: FUNCTION distribute_lead(p_organization_id uuid, p_lead_id uuid, p_idempotency_key text, p_round_robin_id uuid, p_preserve_assignee boolean, p_source text, p_now timestamp with time zone); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.distribute_lead(p_organization_id uuid, p_lead_id uuid, p_idempotency_key text, p_round_robin_id uuid, p_preserve_assignee boolean, p_source text, p_now timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION private.distribute_lead(p_organization_id uuid, p_lead_id uuid, p_idempotency_key text, p_round_robin_id uuid, p_preserve_assignee boolean, p_source text, p_now timestamp with time zone) TO service_role;


--
-- Name: FUNCTION distribute_lead_legacy_before_queue_runtime(p_organization_id uuid, p_lead_id uuid, p_idempotency_key text, p_round_robin_id uuid, p_preserve_assignee boolean, p_source text, p_now timestamp with time zone); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.distribute_lead_legacy_before_queue_runtime(p_organization_id uuid, p_lead_id uuid, p_idempotency_key text, p_round_robin_id uuid, p_preserve_assignee boolean, p_source text, p_now timestamp with time zone) FROM PUBLIC;


--
-- Name: FUNCTION enforce_active_org_member_reference(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.enforce_active_org_member_reference() FROM PUBLIC;


--
-- Name: FUNCTION enforce_core_organization_module_enabled(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.enforce_core_organization_module_enabled() FROM PUBLIC;


--
-- Name: FUNCTION enforce_lead_intake_identity(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.enforce_lead_intake_identity() FROM PUBLIC;


--
-- Name: FUNCTION enforce_portal_tenant_scope(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.enforce_portal_tenant_scope() FROM PUBLIC;


--
-- Name: FUNCTION enforce_property_asset_storage_path(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.enforce_property_asset_storage_path() FROM PUBLIC;


--
-- Name: FUNCTION enforce_property_condominium_location_chain(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.enforce_property_condominium_location_chain() FROM PUBLIC;
GRANT ALL ON FUNCTION private.enforce_property_condominium_location_chain() TO service_role;


--
-- Name: FUNCTION enforce_property_development_tenant_scope(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.enforce_property_development_tenant_scope() FROM PUBLIC;


--
-- Name: FUNCTION enforce_property_location_chain(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.enforce_property_location_chain() FROM PUBLIC;
GRANT ALL ON FUNCTION private.enforce_property_location_chain() TO service_role;


--
-- Name: FUNCTION enforce_property_photo_asset_capacity(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.enforce_property_photo_asset_capacity() FROM PUBLIC;


--
-- Name: FUNCTION enforce_property_publication_actor_scope(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.enforce_property_publication_actor_scope() FROM PUBLIC;


--
-- Name: FUNCTION enforce_property_publication_current_version(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.enforce_property_publication_current_version() FROM PUBLIC;


--
-- Name: FUNCTION enforce_property_publication_revision_monotonic(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.enforce_property_publication_revision_monotonic() FROM PUBLIC;


--
-- Name: FUNCTION enforce_property_user_tenant_scope(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.enforce_property_user_tenant_scope() FROM PUBLIC;


--
-- Name: FUNCTION enforce_provider_property_asset_archive(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.enforce_provider_property_asset_archive() FROM PUBLIC;


--
-- Name: FUNCTION enforce_real_estate_tenant_scope(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.enforce_real_estate_tenant_scope() FROM PUBLIC;


--
-- Name: FUNCTION enforce_tenant_reference(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.enforce_tenant_reference() FROM PUBLIC;


--
-- Name: FUNCTION enforce_whatsapp_conversation_active_binding_consistency(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.enforce_whatsapp_conversation_active_binding_consistency() FROM PUBLIC;


--
-- Name: FUNCTION enforce_whatsapp_conversation_lead_binding(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.enforce_whatsapp_conversation_lead_binding() FROM PUBLIC;


--
-- Name: FUNCTION enforce_whatsapp_media_processing_slot(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.enforce_whatsapp_media_processing_slot() FROM PUBLIC;


--
-- Name: FUNCTION enforce_whatsapp_notification_sender_admin(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.enforce_whatsapp_notification_sender_admin() FROM PUBLIC;


--
-- Name: FUNCTION enforce_whatsapp_quick_reply_owner_limit(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.enforce_whatsapp_quick_reply_owner_limit() FROM PUBLIC;


--
-- Name: FUNCTION enqueue_activity_gamification(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.enqueue_activity_gamification() FROM PUBLIC;


--
-- Name: FUNCTION enqueue_automation_event(target_organization_id uuid, target_event_type text, target_aggregate_type text, target_aggregate_id uuid, target_lead_id uuid, target_conversation_id uuid, target_dedupe_key text, target_payload jsonb, target_available_at timestamp with time zone); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.enqueue_automation_event(target_organization_id uuid, target_event_type text, target_aggregate_type text, target_aggregate_id uuid, target_lead_id uuid, target_conversation_id uuid, target_dedupe_key text, target_payload jsonb, target_available_at timestamp with time zone) FROM PUBLIC;


--
-- Name: FUNCTION enqueue_gamification_outbox(target_organization_id uuid, target_user_id uuid, target_action_type text, target_quantity integer, target_reference_id text, target_source text, target_metadata jsonb); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.enqueue_gamification_outbox(target_organization_id uuid, target_user_id uuid, target_action_type text, target_quantity integer, target_reference_id text, target_source text, target_metadata jsonb) FROM PUBLIC;


--
-- Name: FUNCTION enqueue_inserted_meta_funnel_event(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.enqueue_inserted_meta_funnel_event() FROM PUBLIC;


--
-- Name: FUNCTION enqueue_lead_gamification(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.enqueue_lead_gamification() FROM PUBLIC;


--
-- Name: FUNCTION enqueue_managed_whatsapp_auto_reply_from_entry(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.enqueue_managed_whatsapp_auto_reply_from_entry() FROM PUBLIC;


--
-- Name: FUNCTION enqueue_managed_whatsapp_initial_distribution(p_organization_id uuid, p_round_robin_id uuid, p_lead_id uuid, p_entry_event_id uuid, p_now timestamp with time zone, p_allow_assigned_redistribution boolean); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.enqueue_managed_whatsapp_initial_distribution(p_organization_id uuid, p_round_robin_id uuid, p_lead_id uuid, p_entry_event_id uuid, p_now timestamp with time zone, p_allow_assigned_redistribution boolean) FROM PUBLIC;


--
-- Name: FUNCTION enqueue_meta_crm_funnel_event(p_funnel_event_id uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.enqueue_meta_crm_funnel_event(p_funnel_event_id uuid) FROM PUBLIC;


--
-- Name: FUNCTION enqueue_outgoing_lead_webhooks(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.enqueue_outgoing_lead_webhooks() FROM PUBLIC;


--
-- Name: FUNCTION enqueue_property_gamification(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.enqueue_property_gamification() FROM PUBLIC;


--
-- Name: FUNCTION enqueue_prospecting_report_gamification(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.enqueue_prospecting_report_gamification() FROM PUBLIC;


--
-- Name: FUNCTION enqueue_queue_pool_alert(p_org uuid, p_lead uuid, p_episode uuid, p_revision bigint); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.enqueue_queue_pool_alert(p_org uuid, p_lead uuid, p_episode uuid, p_revision bigint) FROM PUBLIC;


--
-- Name: FUNCTION enqueue_recent_meta_crm_facts(p_organization_id uuid, p_integration_id uuid, p_test_event_code text); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.enqueue_recent_meta_crm_facts(p_organization_id uuid, p_integration_id uuid, p_test_event_code text) FROM PUBLIC;


--
-- Name: FUNCTION enqueue_schedule_gamification(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.enqueue_schedule_gamification() FROM PUBLIC;


--
-- Name: FUNCTION enqueue_whatsapp_avatar_from_message(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.enqueue_whatsapp_avatar_from_message() FROM PUBLIC;


--
-- Name: FUNCTION enqueue_whatsapp_inbound_attendant_push(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.enqueue_whatsapp_inbound_attendant_push() FROM PUBLIC;


--
-- Name: FUNCTION enqueue_whatsapp_message_gamification(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.enqueue_whatsapp_message_gamification() FROM PUBLIC;


--
-- Name: FUNCTION enqueue_whatsapp_outbox(p_organization_id uuid, p_session_id uuid, p_conversation_id uuid, p_message_id uuid, p_client_message_id text, p_recipient_jid text, p_message_type text, p_payload jsonb, p_max_attempts integer); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.enqueue_whatsapp_outbox(p_organization_id uuid, p_session_id uuid, p_conversation_id uuid, p_message_id uuid, p_client_message_id text, p_recipient_jid text, p_message_type text, p_payload jsonb, p_max_attempts integer) FROM PUBLIC;
GRANT ALL ON FUNCTION private.enqueue_whatsapp_outbox(p_organization_id uuid, p_session_id uuid, p_conversation_id uuid, p_message_id uuid, p_client_message_id text, p_recipient_jid text, p_message_type text, p_payload jsonb, p_max_attempts integer) TO service_role;


--
-- Name: FUNCTION enqueue_whatsapp_webhook_event(p_organization_id uuid, p_session_id uuid, p_provider text, p_provider_instance_id text, p_event_key text, p_event_type text, p_payload jsonb, p_max_attempts integer); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.enqueue_whatsapp_webhook_event(p_organization_id uuid, p_session_id uuid, p_provider text, p_provider_instance_id text, p_event_key text, p_event_type text, p_payload jsonb, p_max_attempts integer) FROM PUBLIC;
GRANT ALL ON FUNCTION private.enqueue_whatsapp_webhook_event(p_organization_id uuid, p_session_id uuid, p_provider text, p_provider_instance_id text, p_event_key text, p_event_type text, p_payload jsonb, p_max_attempts integer) TO service_role;


--
-- Name: FUNCTION enroll_round_robin_redistribution(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.enroll_round_robin_redistribution() FROM PUBLIC;


--
-- Name: FUNCTION ensure_billing_payment_receipt_delivery_from_payment(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.ensure_billing_payment_receipt_delivery_from_payment() FROM PUBLIC;
GRANT ALL ON FUNCTION private.ensure_billing_payment_receipt_delivery_from_payment() TO service_role;


--
-- Name: FUNCTION ensure_cadence_default_task(p_enrollment_id uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.ensure_cadence_default_task(p_enrollment_id uuid) FROM PUBLIC;


--
-- Name: FUNCTION ensure_completed_cadence_has_obligation(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.ensure_completed_cadence_has_obligation() FROM PUBLIC;


--
-- Name: FUNCTION ensure_gamification_season_on_module_enable(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.ensure_gamification_season_on_module_enable() FROM PUBLIC;


--
-- Name: FUNCTION ensure_round_robin_ticket_sequence(p_round_robin_id uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.ensure_round_robin_ticket_sequence(p_round_robin_id uuid) FROM PUBLIC;


--
-- Name: FUNCTION ensure_whatsapp_outbox_provider_request_id(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.ensure_whatsapp_outbox_provider_request_id() FROM PUBLIC;


--
-- Name: FUNCTION expire_whatsapp_inbound_push_waiting(p_limit integer); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.expire_whatsapp_inbound_push_waiting(p_limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION private.expire_whatsapp_inbound_push_waiting(p_limit integer) TO service_role;


--
-- Name: FUNCTION fail_property_channel_publication_job(p_job_id uuid, p_worker_id text, p_lease_token uuid, p_error_code text, p_error_message text, p_retry_at timestamp with time zone, p_permanent boolean); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.fail_property_channel_publication_job(p_job_id uuid, p_worker_id text, p_lease_token uuid, p_error_code text, p_error_message text, p_retry_at timestamp with time zone, p_permanent boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION private.fail_property_channel_publication_job(p_job_id uuid, p_worker_id text, p_lease_token uuid, p_error_code text, p_error_message text, p_retry_at timestamp with time zone, p_permanent boolean) TO service_role;


--
-- Name: FUNCTION fail_whatsapp_outbox(p_outbox_id uuid, p_worker_id text, p_error text, p_retry_at timestamp with time zone, p_permanent boolean); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.fail_whatsapp_outbox(p_outbox_id uuid, p_worker_id text, p_error text, p_retry_at timestamp with time zone, p_permanent boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION private.fail_whatsapp_outbox(p_outbox_id uuid, p_worker_id text, p_error text, p_retry_at timestamp with time zone, p_permanent boolean) TO service_role;


--
-- Name: FUNCTION fail_whatsapp_webhook_event(p_event_id uuid, p_worker_id text, p_error text, p_retry_at timestamp with time zone); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.fail_whatsapp_webhook_event(p_event_id uuid, p_worker_id text, p_error text, p_retry_at timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION private.fail_whatsapp_webhook_event(p_event_id uuid, p_worker_id text, p_error text, p_retry_at timestamp with time zone) TO service_role;


--
-- Name: FUNCTION finish_cadence_enrollment(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.finish_cadence_enrollment() FROM PUBLIC;


--
-- Name: FUNCTION finish_whatsapp_avatar_job(p_job_id uuid, p_lease_token uuid, p_outcome text, p_storage_path text, p_provider_avatar_id text, p_error text); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.finish_whatsapp_avatar_job(p_job_id uuid, p_lease_token uuid, p_outcome text, p_storage_path text, p_provider_avatar_id text, p_error text) FROM PUBLIC;


--
-- Name: FUNCTION generate_organization_api_key_impl(p_name text, p_organization_id uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.generate_organization_api_key_impl(p_name text, p_organization_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION private.generate_organization_api_key_impl(p_name text, p_organization_id uuid) TO service_role;


--
-- Name: FUNCTION get_user_led_pipeline_ids(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.get_user_led_pipeline_ids() FROM PUBLIC;
GRANT ALL ON FUNCTION private.get_user_led_pipeline_ids() TO service_role;
GRANT ALL ON FUNCTION private.get_user_led_pipeline_ids() TO authenticated;


--
-- Name: FUNCTION get_user_led_team_ids(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.get_user_led_team_ids() FROM PUBLIC;
GRANT ALL ON FUNCTION private.get_user_led_team_ids() TO service_role;
GRANT ALL ON FUNCTION private.get_user_led_team_ids() TO authenticated;


--
-- Name: FUNCTION get_user_organization_id(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.get_user_organization_id() FROM PUBLIC;
GRANT ALL ON FUNCTION private.get_user_organization_id() TO service_role;
GRANT ALL ON FUNCTION private.get_user_organization_id() TO authenticated;


--
-- Name: FUNCTION get_user_team_ids(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.get_user_team_ids() FROM PUBLIC;
GRANT ALL ON FUNCTION private.get_user_team_ids() TO service_role;
GRANT ALL ON FUNCTION private.get_user_team_ids() TO authenticated;


--
-- Name: FUNCTION google_calendar_cancel_obsolete_jobs(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.google_calendar_cancel_obsolete_jobs() FROM PUBLIC;


--
-- Name: FUNCTION google_calendar_guard_outbound_insert(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.google_calendar_guard_outbound_insert() FROM PUBLIC;


--
-- Name: FUNCTION google_calendar_refresh_connection_status(p_connection_id uuid, p_organization_id uuid, p_owner_user_id uuid, p_synced_at timestamp with time zone); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.google_calendar_refresh_connection_status(p_connection_id uuid, p_organization_id uuid, p_owner_user_id uuid, p_synced_at timestamp with time zone) FROM PUBLIC;


--
-- Name: FUNCTION google_calendar_require_backend(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.google_calendar_require_backend() FROM PUBLIC;


--
-- Name: FUNCTION google_calendar_stamp_credential_revision(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.google_calendar_stamp_credential_revision() FROM PUBLIC;


--
-- Name: FUNCTION google_calendar_validate_oauth_token(p_token jsonb); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.google_calendar_validate_oauth_token(p_token jsonb) FROM PUBLIC;


--
-- Name: FUNCTION guard_active_property_location_references(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.guard_active_property_location_references() FROM PUBLIC;
GRANT ALL ON FUNCTION private.guard_active_property_location_references() TO service_role;


--
-- Name: FUNCTION guard_active_property_owner_assignment(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.guard_active_property_owner_assignment() FROM PUBLIC;
GRANT ALL ON FUNCTION private.guard_active_property_owner_assignment() TO service_role;


--
-- Name: FUNCTION guard_asaas_reconciliation_job_cleanup(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.guard_asaas_reconciliation_job_cleanup() FROM PUBLIC;


--
-- Name: FUNCTION guard_automation_publish_state(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.guard_automation_publish_state() FROM PUBLIC;


--
-- Name: FUNCTION guard_billing_checkout_intent_cleanup(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.guard_billing_checkout_intent_cleanup() FROM PUBLIC;


--
-- Name: FUNCTION guard_billing_cleanup_access_cause(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.guard_billing_cleanup_access_cause() FROM PUBLIC;


--
-- Name: FUNCTION guard_billing_cleanup_resource_ownership(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.guard_billing_cleanup_resource_ownership() FROM PUBLIC;


--
-- Name: FUNCTION guard_billing_organization_reactivation(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.guard_billing_organization_reactivation() FROM PUBLIC;


--
-- Name: FUNCTION guard_billing_payment_cancellation_cleanup(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.guard_billing_payment_cancellation_cleanup() FROM PUBLIC;


--
-- Name: FUNCTION guard_billing_plan_change_card_update(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.guard_billing_plan_change_card_update() FROM PUBLIC;


--
-- Name: FUNCTION guard_card_recurrence_cancel_card_update(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.guard_card_recurrence_cancel_card_update() FROM PUBLIC;


--
-- Name: FUNCTION guard_development_unit_property_deal_type(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.guard_development_unit_property_deal_type() FROM PUBLIC;
GRANT ALL ON FUNCTION private.guard_development_unit_property_deal_type() TO service_role;


--
-- Name: FUNCTION guard_expired_whatsapp_unlinked_message_write(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.guard_expired_whatsapp_unlinked_message_write() FROM PUBLIC;


--
-- Name: FUNCTION guard_lead_clocks(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.guard_lead_clocks() FROM PUBLIC;


--
-- Name: FUNCTION guard_linked_development_property_consistency(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.guard_linked_development_property_consistency() FROM PUBLIC;
GRANT ALL ON FUNCTION private.guard_linked_development_property_consistency() TO service_role;


--
-- Name: FUNCTION guard_live_round_robin_reference(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.guard_live_round_robin_reference() FROM PUBLIC;


--
-- Name: FUNCTION guard_managed_schedule_removal(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.guard_managed_schedule_removal() FROM PUBLIC;


--
-- Name: FUNCTION guard_managed_whatsapp_snapshot_queue(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.guard_managed_whatsapp_snapshot_queue() FROM PUBLIC;


--
-- Name: FUNCTION guard_management_tag_deletion(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.guard_management_tag_deletion() FROM PUBLIC;


--
-- Name: FUNCTION guard_management_tag_references(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.guard_management_tag_references() FROM PUBLIC;


--
-- Name: FUNCTION guard_meta_crm_feedback_backend_write(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.guard_meta_crm_feedback_backend_write() FROM PUBLIC;


--
-- Name: FUNCTION guard_pending_managed_whatsapp_child_mutation(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.guard_pending_managed_whatsapp_child_mutation() FROM PUBLIC;


--
-- Name: FUNCTION guard_property_creation_ledger(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.guard_property_creation_ledger() FROM PUBLIC;


--
-- Name: FUNCTION guard_property_creation_receipt(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.guard_property_creation_receipt() FROM PUBLIC;


--
-- Name: FUNCTION guard_property_development_price_table(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.guard_property_development_price_table() FROM PUBLIC;


--
-- Name: FUNCTION guard_property_development_reservation(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.guard_property_development_reservation() FROM PUBLIC;


--
-- Name: FUNCTION guard_property_development_unit_price(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.guard_property_development_unit_price() FROM PUBLIC;


--
-- Name: FUNCTION guard_property_legacy_location_catalog_mutation(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.guard_property_legacy_location_catalog_mutation() FROM PUBLIC;
GRANT ALL ON FUNCTION private.guard_property_legacy_location_catalog_mutation() TO service_role;


--
-- Name: FUNCTION guard_property_location_deactivation(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.guard_property_location_deactivation() FROM PUBLIC;
GRANT ALL ON FUNCTION private.guard_property_location_deactivation() TO service_role;


--
-- Name: FUNCTION guard_property_owner_deactivation(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.guard_property_owner_deactivation() FROM PUBLIC;
GRANT ALL ON FUNCTION private.guard_property_owner_deactivation() TO service_role;


--
-- Name: FUNCTION guard_property_owner_legacy_rename(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.guard_property_owner_legacy_rename() FROM PUBLIC;
GRANT ALL ON FUNCTION private.guard_property_owner_legacy_rename() TO service_role;


--
-- Name: FUNCTION guard_queue_pool_notification_write(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.guard_queue_pool_notification_write() FROM PUBLIC;


--
-- Name: FUNCTION guard_queue_runtime_capability_write(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.guard_queue_runtime_capability_write() FROM PUBLIC;


--
-- Name: FUNCTION guard_queue_runtime_human_fact_write(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.guard_queue_runtime_human_fact_write() FROM PUBLIC;


--
-- Name: FUNCTION guard_queue_runtime_ownership(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.guard_queue_runtime_ownership() FROM PUBLIC;


--
-- Name: FUNCTION guard_queue_runtime_roster_write(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.guard_queue_runtime_roster_write() FROM PUBLIC;


--
-- Name: FUNCTION guard_round_robin_hard_delete(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.guard_round_robin_hard_delete() FROM PUBLIC;


--
-- Name: FUNCTION guard_round_robin_tombstone_state(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.guard_round_robin_tombstone_state() FROM PUBLIC;


--
-- Name: FUNCTION guard_round_robin_truncate(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.guard_round_robin_truncate() FROM PUBLIC;


--
-- Name: FUNCTION guard_unconfirmed_whatsapp_attendance_marker(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.guard_unconfirmed_whatsapp_attendance_marker() FROM PUBLIC;


--
-- Name: FUNCTION guard_whatsapp_avatar_storage_path_write(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.guard_whatsapp_avatar_storage_path_write() FROM PUBLIC;


--
-- Name: FUNCTION guard_whatsapp_contact_identity_pn(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.guard_whatsapp_contact_identity_pn() FROM PUBLIC;


--
-- Name: FUNCTION guard_whatsapp_conversation_contact_pn(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.guard_whatsapp_conversation_contact_pn() FROM PUBLIC;


--
-- Name: FUNCTION guard_whatsapp_media_job_epoch_insert(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.guard_whatsapp_media_job_epoch_insert() FROM PUBLIC;


--
-- Name: FUNCTION guard_whatsapp_media_job_gc_attach(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.guard_whatsapp_media_job_gc_attach() FROM PUBLIC;


--
-- Name: FUNCTION guard_whatsapp_message_media_gc_attach(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.guard_whatsapp_message_media_gc_attach() FROM PUBLIC;


--
-- Name: FUNCTION guard_whatsapp_observed_unattended(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.guard_whatsapp_observed_unattended() FROM PUBLIC;


--
-- Name: FUNCTION guard_whatsapp_unlinked_message_attribution(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.guard_whatsapp_unlinked_message_attribution() FROM PUBLIC;


--
-- Name: FUNCTION guard_whatsapp_unlinked_retention_columns(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.guard_whatsapp_unlinked_retention_columns() FROM PUBLIC;


--
-- Name: FUNCTION guard_whatsapp_webhook_ignored_tenant(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.guard_whatsapp_webhook_ignored_tenant() FROM PUBLIC;


--
-- Name: FUNCTION guard_whatsapp_webhook_inbox_epoch(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.guard_whatsapp_webhook_inbox_epoch() FROM PUBLIC;


--
-- Name: FUNCTION guard_whatsapp_webhook_legacy_routing_freeze(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.guard_whatsapp_webhook_legacy_routing_freeze() FROM PUBLIC;


--
-- Name: FUNCTION guard_whatsapp_webhook_routing_snapshot_epoch(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.guard_whatsapp_webhook_routing_snapshot_epoch() FROM PUBLIC;


--
-- Name: FUNCTION has_active_lead_read_session(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.has_active_lead_read_session() FROM PUBLIC;
GRANT ALL ON FUNCTION private.has_active_lead_read_session() TO authenticated;


--
-- Name: FUNCTION has_effective_whatsapp_view(target_organization_id uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.has_effective_whatsapp_view(target_organization_id uuid) FROM PUBLIC;


--
-- Name: FUNCTION has_org_role(target_organization_id uuid, allowed_roles text[]); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.has_org_role(target_organization_id uuid, allowed_roles text[]) FROM PUBLIC;
GRANT ALL ON FUNCTION private.has_org_role(target_organization_id uuid, allowed_roles text[]) TO authenticated;
GRANT ALL ON FUNCTION private.has_org_role(target_organization_id uuid, allowed_roles text[]) TO service_role;


--
-- Name: FUNCTION has_permission(target_organization_id uuid, permission_key text); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.has_permission(target_organization_id uuid, permission_key text) FROM PUBLIC;
GRANT ALL ON FUNCTION private.has_permission(target_organization_id uuid, permission_key text) TO authenticated;
GRANT ALL ON FUNCTION private.has_permission(target_organization_id uuid, permission_key text) TO service_role;


--
-- Name: FUNCTION historical_import_effect_counts(p_organization_id uuid, p_lead_ids uuid[], p_entity_ids uuid[]); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.historical_import_effect_counts(p_organization_id uuid, p_lead_ids uuid[], p_entity_ids uuid[]) FROM PUBLIC;


--
-- Name: FUNCTION historical_import_effect_delta(p_before jsonb, p_after jsonb); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.historical_import_effect_delta(p_before jsonb, p_after jsonb) FROM PUBLIC;


--
-- Name: FUNCTION historical_import_effects_suppressed(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.historical_import_effects_suppressed() FROM PUBLIC;
GRANT ALL ON FUNCTION private.historical_import_effects_suppressed() TO authenticated;
GRANT ALL ON FUNCTION private.historical_import_effects_suppressed() TO service_role;


--
-- Name: FUNCTION hydrate_lead_destination_from_intake_queue(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.hydrate_lead_destination_from_intake_queue() FROM PUBLIC;


--
-- Name: FUNCTION imoview_delete_api_key(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.imoview_delete_api_key() FROM PUBLIC;


--
-- Name: FUNCTION imoview_store_api_key(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.imoview_store_api_key() FROM PUBLIC;


--
-- Name: FUNCTION import_historical_lead_batch(p_organization_id uuid, p_actor_user_id uuid, p_batch jsonb); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.import_historical_lead_batch(p_organization_id uuid, p_actor_user_id uuid, p_batch jsonb) FROM PUBLIC;


--
-- Name: FUNCTION increment_billing_ip_card_attempt_limit(p_ip_fingerprint text, p_now timestamp with time zone); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.increment_billing_ip_card_attempt_limit(p_ip_fingerprint text, p_now timestamp with time zone) FROM PUBLIC;


--
-- Name: FUNCTION infer_lead_intake_origin_queue(p_lead_id uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.infer_lead_intake_origin_queue(p_lead_id uuid) FROM PUBLIC;


--
-- Name: FUNCTION invalidate_billing_receipt_delivery_from_payment(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.invalidate_billing_receipt_delivery_from_payment() FROM PUBLIC;


--
-- Name: FUNCTION invoke_google_calendar_worker(p_action text, p_limit integer); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.invoke_google_calendar_worker(p_action text, p_limit integer) FROM PUBLIC;


--
-- Name: FUNCTION is_admin(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.is_admin() FROM PUBLIC;
GRANT ALL ON FUNCTION private.is_admin() TO service_role;
GRANT ALL ON FUNCTION private.is_admin() TO authenticated;


--
-- Name: FUNCTION is_frozen_legacy_whatsapp_ingress(p_inbox_id uuid, p_organization_id uuid, p_session_id uuid, p_event_key text, p_processing_lane text); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.is_frozen_legacy_whatsapp_ingress(p_inbox_id uuid, p_organization_id uuid, p_session_id uuid, p_event_key text, p_processing_lane text) FROM PUBLIC;
GRANT ALL ON FUNCTION private.is_frozen_legacy_whatsapp_ingress(p_inbox_id uuid, p_organization_id uuid, p_session_id uuid, p_event_key text, p_processing_lane text) TO service_role;


--
-- Name: FUNCTION is_org_member(target_organization_id uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.is_org_member(target_organization_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION private.is_org_member(target_organization_id uuid) TO authenticated;
GRANT ALL ON FUNCTION private.is_org_member(target_organization_id uuid) TO service_role;


--
-- Name: FUNCTION is_pipeline_in_led_team(p_pipeline_id uuid, p_user_id uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.is_pipeline_in_led_team(p_pipeline_id uuid, p_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION private.is_pipeline_in_led_team(p_pipeline_id uuid, p_user_id uuid) TO service_role;
GRANT ALL ON FUNCTION private.is_pipeline_in_led_team(p_pipeline_id uuid, p_user_id uuid) TO authenticated;


--
-- Name: FUNCTION is_round_robin_rotation_assignment_reason(p_reason text); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.is_round_robin_rotation_assignment_reason(p_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION private.is_round_robin_rotation_assignment_reason(p_reason text) TO service_role;


--
-- Name: FUNCTION is_schedule_event_assignee(p_event_id uuid, p_user_id uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.is_schedule_event_assignee(p_event_id uuid, p_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION private.is_schedule_event_assignee(p_event_id uuid, p_user_id uuid) TO service_role;


--
-- Name: FUNCTION is_super_admin(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.is_super_admin() FROM PUBLIC;
GRANT ALL ON FUNCTION private.is_super_admin() TO authenticated;
GRANT ALL ON FUNCTION private.is_super_admin() TO service_role;


--
-- Name: FUNCTION is_super_admin_member_bypass(p_user_id uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.is_super_admin_member_bypass(p_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION private.is_super_admin_member_bypass(p_user_id uuid) TO service_role;
GRANT ALL ON FUNCTION private.is_super_admin_member_bypass(p_user_id uuid) TO authenticated;


--
-- Name: FUNCTION is_team_leader(check_user_id uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.is_team_leader(check_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION private.is_team_leader(check_user_id uuid) TO service_role;
GRANT ALL ON FUNCTION private.is_team_leader(check_user_id uuid) TO authenticated;


--
-- Name: FUNCTION is_terminal_whatsapp_lead_resolution_quarantine(p_metadata jsonb, p_from_me boolean, p_provider_message_id text, p_message_id text); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.is_terminal_whatsapp_lead_resolution_quarantine(p_metadata jsonb, p_from_me boolean, p_provider_message_id text, p_message_id text) FROM PUBLIC;


--
-- Name: FUNCTION is_user_in_led_team(p_target_user_id uuid, p_user_id uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.is_user_in_led_team(p_target_user_id uuid, p_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION private.is_user_in_led_team(p_target_user_id uuid, p_user_id uuid) TO service_role;
GRANT ALL ON FUNCTION private.is_user_in_led_team(p_target_user_id uuid, p_user_id uuid) TO authenticated;


--
-- Name: FUNCTION is_user_leader_of_team(p_team_id uuid, p_user_id uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.is_user_leader_of_team(p_team_id uuid, p_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION private.is_user_leader_of_team(p_team_id uuid, p_user_id uuid) TO service_role;
GRANT ALL ON FUNCTION private.is_user_leader_of_team(p_team_id uuid, p_user_id uuid) TO authenticated;


--
-- Name: FUNCTION is_whatsapp_notification_admin(p_organization_id uuid, p_user_id uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.is_whatsapp_notification_admin(p_organization_id uuid, p_user_id uuid) FROM PUBLIC;


--
-- Name: FUNCTION lead_intake_scope_for_external(p_organization_id uuid, p_external_source text, p_external_source_id text); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.lead_intake_scope_for_external(p_organization_id uuid, p_external_source text, p_external_source_id text) FROM PUBLIC;


--
-- Name: FUNCTION lead_intake_scope_for_queue(p_organization_id uuid, p_origin_round_robin_id uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.lead_intake_scope_for_queue(p_organization_id uuid, p_origin_round_robin_id uuid) FROM PUBLIC;


--
-- Name: FUNCTION lead_operational_effects_suppressed(p_organization_id uuid, p_lead_id uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.lead_operational_effects_suppressed(p_organization_id uuid, p_lead_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION private.lead_operational_effects_suppressed(p_organization_id uuid, p_lead_id uuid) TO authenticated;
GRANT ALL ON FUNCTION private.lead_operational_effects_suppressed(p_organization_id uuid, p_lead_id uuid) TO service_role;


--
-- Name: FUNCTION lead_shape_is_valid(target_organization_id uuid, target_assigned_user_id uuid, target_pipeline_id uuid, target_stage_id uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.lead_shape_is_valid(target_organization_id uuid, target_assigned_user_id uuid, target_pipeline_id uuid, target_stage_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION private.lead_shape_is_valid(target_organization_id uuid, target_assigned_user_id uuid, target_pipeline_id uuid, target_stage_id uuid) TO authenticated;
GRANT ALL ON FUNCTION private.lead_shape_is_valid(target_organization_id uuid, target_assigned_user_id uuid, target_pipeline_id uuid, target_stage_id uuid) TO service_role;


--
-- Name: FUNCTION lead_view_all_granted(p_organization_id uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.lead_view_all_granted(p_organization_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION private.lead_view_all_granted(p_organization_id uuid) TO service_role;


--
-- Name: FUNCTION legacy_property_offer_price_metadata(legacy_sale_price numeric, legacy_rental_price numeric); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.legacy_property_offer_price_metadata(legacy_sale_price numeric, legacy_rental_price numeric) FROM PUBLIC;


--
-- Name: FUNCTION lock_asaas_billing_resources(p_payment_id text, p_subscription_id text); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.lock_asaas_billing_resources(p_payment_id text, p_subscription_id text) FROM PUBLIC;


--
-- Name: FUNCTION lock_asaas_cleanup_inventory(p_payment_ids text[], p_subscription_ids text[], p_customer_ids text[]); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.lock_asaas_cleanup_inventory(p_payment_ids text[], p_subscription_ids text[], p_customer_ids text[]) FROM PUBLIC;


--
-- Name: FUNCTION lock_property_legacy_location_assignment_name(p_organization_id uuid, p_kind text, p_name text); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.lock_property_legacy_location_assignment_name(p_organization_id uuid, p_kind text, p_name text) FROM PUBLIC;
GRANT ALL ON FUNCTION private.lock_property_legacy_location_assignment_name(p_organization_id uuid, p_kind text, p_name text) TO service_role;


--
-- Name: FUNCTION lock_property_legacy_location_name(p_organization_id uuid, p_kind text, p_name text); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.lock_property_legacy_location_name(p_organization_id uuid, p_kind text, p_name text) FROM PUBLIC;
GRANT ALL ON FUNCTION private.lock_property_legacy_location_name(p_organization_id uuid, p_kind text, p_name text) TO service_role;


--
-- Name: FUNCTION lock_push_notification_recipient(p_organization_id uuid, p_user_id uuid, p_token_id uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.lock_push_notification_recipient(p_organization_id uuid, p_user_id uuid, p_token_id uuid) FROM PUBLIC;


--
-- Name: FUNCTION maintain_authenticated_user_activity_timestamps(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.maintain_authenticated_user_activity_timestamps() FROM PUBLIC;


--
-- Name: FUNCTION maintain_user_activity_idle_since(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.maintain_user_activity_idle_since() FROM PUBLIC;


--
-- Name: FUNCTION managed_whatsapp_message_fingerprint(p_organization_id uuid, p_session_id uuid, p_provider_message_id text, p_message text); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.managed_whatsapp_message_fingerprint(p_organization_id uuid, p_session_id uuid, p_provider_message_id text, p_message text) FROM PUBLIC;


--
-- Name: FUNCTION management_automation_graph_tag_ids(graph jsonb); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.management_automation_graph_tag_ids(graph jsonb) FROM PUBLIC;


--
-- Name: FUNCTION management_campaign_match_values(p_match jsonb, p_legacy_value text); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.management_campaign_match_values(p_match jsonb, p_legacy_value text) FROM PUBLIC;
GRANT ALL ON FUNCTION private.management_campaign_match_values(p_match jsonb, p_legacy_value text) TO service_role;


--
-- Name: FUNCTION management_distribution_source(text); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.management_distribution_source(text) FROM PUBLIC;
GRANT ALL ON FUNCTION private.management_distribution_source(text) TO service_role;


--
-- Name: FUNCTION management_meta_default_tag_ids(payload jsonb); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.management_meta_default_tag_ids(payload jsonb) FROM PUBLIC;


--
-- Name: FUNCTION management_tag_configuration_ids(table_name text, payload jsonb); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.management_tag_configuration_ids(table_name text, payload jsonb) FROM PUBLIC;


--
-- Name: FUNCTION management_tag_reference_ids(payload jsonb); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.management_tag_reference_ids(payload jsonb) FROM PUBLIC;


--
-- Name: FUNCTION management_tag_usages(uuid, uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.management_tag_usages(uuid, uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION private.management_tag_usages(uuid, uuid) TO service_role;


--
-- Name: FUNCTION management_tag_value_ids(payload jsonb); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.management_tag_value_ids(payload jsonb) FROM PUBLIC;


--
-- Name: FUNCTION mark_billing_cleanup_late_payment_event(p_organization_id uuid, p_provider_payment_id text, p_error_code text); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.mark_billing_cleanup_late_payment_event(p_organization_id uuid, p_provider_payment_id text, p_error_code text) FROM PUBLIC;


--
-- Name: FUNCTION mark_whatsapp_outbox_sent(p_outbox_id uuid, p_worker_id text, p_provider_message_id text, p_sent_at timestamp with time zone); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.mark_whatsapp_outbox_sent(p_outbox_id uuid, p_worker_id text, p_provider_message_id text, p_sent_at timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION private.mark_whatsapp_outbox_sent(p_outbox_id uuid, p_worker_id text, p_provider_message_id text, p_sent_at timestamp with time zone) TO service_role;


--
-- Name: FUNCTION mark_whatsapp_unlinked_retention_v1(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.mark_whatsapp_unlinked_retention_v1() FROM PUBLIC;


--
-- Name: FUNCTION materialize_cadence_for_stage_cycle(p_stage_cycle_id uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.materialize_cadence_for_stage_cycle(p_stage_cycle_id uuid) FROM PUBLIC;


--
-- Name: FUNCTION materialize_notification_deliveries(p_notification_id uuid, p_backfill boolean); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.materialize_notification_deliveries(p_notification_id uuid, p_backfill boolean) FROM PUBLIC;


--
-- Name: FUNCTION meta_delete_access_token(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.meta_delete_access_token() FROM PUBLIC;


--
-- Name: FUNCTION meta_delete_oauth_flow_transient_secret(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.meta_delete_oauth_flow_transient_secret() FROM PUBLIC;


--
-- Name: FUNCTION meta_legacy_plaintext_token(p_secret_ref text); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.meta_legacy_plaintext_token(p_secret_ref text) FROM PUBLIC;


--
-- Name: FUNCTION meta_legacy_vault_secret_id(p_secret_ref text); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.meta_legacy_vault_secret_id(p_secret_ref text) FROM PUBLIC;


--
-- Name: FUNCTION meta_oauth_flow_transient_secret_id(p_payload jsonb); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.meta_oauth_flow_transient_secret_id(p_payload jsonb) FROM PUBLIC;


--
-- Name: FUNCTION meta_store_access_token(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.meta_store_access_token() FROM PUBLIC;


--
-- Name: FUNCTION meta_store_crm_dataset_access_token(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.meta_store_crm_dataset_access_token() FROM PUBLIC;


--
-- Name: FUNCTION meta_store_user_access_token(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.meta_store_user_access_token() FROM PUBLIC;


--
-- Name: FUNCTION mirror_legacy_property_photos_to_assets(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.mirror_legacy_property_photos_to_assets() FROM PUBLIC;


--
-- Name: FUNCTION next_round_robin_ticket(p_round_robin_id uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.next_round_robin_ticket(p_round_robin_id uuid) FROM PUBLIC;


--
-- Name: FUNCTION normalize_lead_distribution_source(p_source text); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.normalize_lead_distribution_source(p_source text) FROM PUBLIC;


--
-- Name: FUNCTION normalize_legacy_property_offer_before_write(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.normalize_legacy_property_offer_before_write() FROM PUBLIC;


--
-- Name: FUNCTION normalize_property_deal_type(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.normalize_property_deal_type() FROM PUBLIC;
GRANT ALL ON FUNCTION private.normalize_property_deal_type() TO service_role;


--
-- Name: FUNCTION notification_delivery_expected_message_id(p_idempotency_key text); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.notification_delivery_expected_message_id(p_idempotency_key text) FROM PUBLIC;


--
-- Name: FUNCTION notification_delivery_expiry(p_created_at timestamp with time zone, p_metadata jsonb, p_channel_metadata jsonb); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.notification_delivery_expiry(p_created_at timestamp with time zone, p_metadata jsonb, p_channel_metadata jsonb) FROM PUBLIC;


--
-- Name: FUNCTION notification_delivery_idempotency_key(p_organization_id uuid, p_notification_id uuid, p_source_dedupe_key text, p_channel text, p_recipient_key text); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.notification_delivery_idempotency_key(p_organization_id uuid, p_notification_id uuid, p_source_dedupe_key text, p_channel text, p_recipient_key text) FROM PUBLIC;


--
-- Name: FUNCTION notification_delivery_metrics(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.notification_delivery_metrics() FROM PUBLIC;
GRANT ALL ON FUNCTION private.notification_delivery_metrics() TO service_role;


--
-- Name: FUNCTION notification_delivery_retry_delay(p_attempt_count integer); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.notification_delivery_retry_delay(p_attempt_count integer) FROM PUBLIC;


--
-- Name: FUNCTION notification_dispatch_required(p_value jsonb); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.notification_dispatch_required(p_value jsonb) FROM PUBLIC;


--
-- Name: FUNCTION notification_safe_integer(p_value text, p_default integer, p_minimum integer, p_maximum integer); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.notification_safe_integer(p_value text, p_default integer, p_minimum integer, p_maximum integer) FROM PUBLIC;


--
-- Name: FUNCTION notification_safe_timestamptz(p_value text); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.notification_safe_timestamptz(p_value text) FROM PUBLIC;


--
-- Name: FUNCTION notify_automation_attention(p_organization_id uuid, p_lead_id uuid, p_user_id uuid, p_title text, p_content text, p_event_key text, p_dedupe_key text, p_metadata jsonb); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.notify_automation_attention(p_organization_id uuid, p_lead_id uuid, p_user_id uuid, p_title text, p_content text, p_event_key text, p_dedupe_key text, p_metadata jsonb) FROM PUBLIC;


--
-- Name: FUNCTION persist_asaas_billing_snapshot_after_exact_validation(p_organization_id uuid, p_provider_customer_id text, p_provider_subscription_id text, p_provider_subscription_status text, p_latest_payment_id text, p_latest_payment_status text, p_latest_payment_amount numeric, p_latest_payment_due_date date, p_next_billing_date date, p_observed_at timestamp with time zone, p_source text); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.persist_asaas_billing_snapshot_after_exact_validation(p_organization_id uuid, p_provider_customer_id text, p_provider_subscription_id text, p_provider_subscription_status text, p_latest_payment_id text, p_latest_payment_status text, p_latest_payment_amount numeric, p_latest_payment_due_date date, p_next_billing_date date, p_observed_at timestamp with time zone, p_source text) FROM PUBLIC;


--
-- Name: FUNCTION pick_queue_runtime_ticket_candidate(p_org uuid, p_queue uuid, p_strategy text, p_ticket bigint, p_now timestamp with time zone); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.pick_queue_runtime_ticket_candidate(p_org uuid, p_queue uuid, p_strategy text, p_ticket bigint, p_now timestamp with time zone) FROM PUBLIC;


--
-- Name: FUNCTION pick_round_robin_rotation_candidate(p_organization_id uuid, p_lead_id uuid, p_round_robin_id uuid, p_current_user_id uuid, p_required_team_id uuid, p_now timestamp with time zone); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.pick_round_robin_rotation_candidate(p_organization_id uuid, p_lead_id uuid, p_round_robin_id uuid, p_current_user_id uuid, p_required_team_id uuid, p_now timestamp with time zone) FROM PUBLIC;


--
-- Name: FUNCTION pick_round_robin_ticket_candidate(p_organization_id uuid, p_round_robin_id uuid, p_strategy text, p_ignore_availability boolean, p_current_day integer, p_current_time time without time zone, p_ticket bigint); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.pick_round_robin_ticket_candidate(p_organization_id uuid, p_round_robin_id uuid, p_strategy text, p_ignore_availability boolean, p_current_day integer, p_current_time time without time zone, p_ticket bigint) FROM PUBLIC;


--
-- Name: FUNCTION pick_round_robin_ticket_candidate_before_queue_runtime(p_organization_id uuid, p_round_robin_id uuid, p_strategy text, p_ignore_availability boolean, p_current_day integer, p_current_time time without time zone, p_ticket bigint); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.pick_round_robin_ticket_candidate_before_queue_runtime(p_organization_id uuid, p_round_robin_id uuid, p_strategy text, p_ignore_availability boolean, p_current_day integer, p_current_time time without time zone, p_ticket bigint) FROM PUBLIC;


--
-- Name: FUNCTION prepare_queue_manual_transfer(p_org uuid, p_lead uuid, p_actor uuid, p_target_user uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.prepare_queue_manual_transfer(p_org uuid, p_lead uuid, p_actor uuid, p_target_user uuid) FROM PUBLIC;


--
-- Name: FUNCTION prepare_queue_manual_transfer_before_concurrency_guard(p_org uuid, p_lead uuid, p_actor uuid, p_target_user uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.prepare_queue_manual_transfer_before_concurrency_guard(p_org uuid, p_lead uuid, p_actor uuid, p_target_user uuid) FROM PUBLIC;


--
-- Name: FUNCTION prepare_whatsapp_confirmed_phone_route_retirement(p_organization_id uuid, p_session_id uuid, p_conversation_id uuid, p_expected_lead_id uuid, p_actor_user_id uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.prepare_whatsapp_confirmed_phone_route_retirement(p_organization_id uuid, p_session_id uuid, p_conversation_id uuid, p_expected_lead_id uuid, p_actor_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION private.prepare_whatsapp_confirmed_phone_route_retirement(p_organization_id uuid, p_session_id uuid, p_conversation_id uuid, p_expected_lead_id uuid, p_actor_user_id uuid) TO service_role;


--
-- Name: FUNCTION prepare_whatsapp_inbound_attendant_push(p_notification_id uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.prepare_whatsapp_inbound_attendant_push(p_notification_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION private.prepare_whatsapp_inbound_attendant_push(p_notification_id uuid) TO service_role;


--
-- Name: FUNCTION preserve_managed_whatsapp_lead_intake(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.preserve_managed_whatsapp_lead_intake() FROM PUBLIC;


--
-- Name: FUNCTION preserve_whatsapp_webhook_routing_snapshot(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.preserve_whatsapp_webhook_routing_snapshot() FROM PUBLIC;


--
-- Name: FUNCTION prevent_property_publication_version_update(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.prevent_property_publication_version_update() FROM PUBLIC;


--
-- Name: FUNCTION prevent_team_distribution_event_mutation(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.prevent_team_distribution_event_mutation() FROM PUBLIC;


--
-- Name: FUNCTION preview_round_robin_redistribution_candidate(p_organization_id uuid, p_lead_id uuid, p_round_robin_id uuid, p_excluded_user_id uuid, p_required_team_id uuid, p_now timestamp with time zone); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.preview_round_robin_redistribution_candidate(p_organization_id uuid, p_lead_id uuid, p_round_robin_id uuid, p_excluded_user_id uuid, p_required_team_id uuid, p_now timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION private.preview_round_robin_redistribution_candidate(p_organization_id uuid, p_lead_id uuid, p_round_robin_id uuid, p_excluded_user_id uuid, p_required_team_id uuid, p_now timestamp with time zone) TO service_role;


--
-- Name: FUNCTION process_queue_runtime_batch(p_limit integer, p_now timestamp with time zone); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.process_queue_runtime_batch(p_limit integer, p_now timestamp with time zone) FROM PUBLIC;


--
-- Name: FUNCTION project_property_offer_prices(target_organization_id uuid, target_property_id uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.project_property_offer_prices(target_organization_id uuid, target_property_id uuid) FROM PUBLIC;


--
-- Name: FUNCTION project_property_offer_prices_trigger(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.project_property_offer_prices_trigger() FROM PUBLIC;


--
-- Name: FUNCTION project_property_owner_from_ownership(p_organization_id uuid, p_property_id uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.project_property_owner_from_ownership(p_organization_id uuid, p_property_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION private.project_property_owner_from_ownership(p_organization_id uuid, p_property_id uuid) TO service_role;


--
-- Name: FUNCTION promote_whatsapp_unlinked_retention_v1(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.promote_whatsapp_unlinked_retention_v1() FROM PUBLIC;


--
-- Name: FUNCTION property_asset_integration_providers(p_metadata jsonb); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.property_asset_integration_providers(p_metadata jsonb) FROM PUBLIC;


--
-- Name: FUNCTION property_creation_ledger_is_valid(ledger jsonb); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.property_creation_ledger_is_valid(ledger jsonb) FROM PUBLIC;


--
-- Name: FUNCTION property_user_belongs_to_organization(target_organization_id uuid, target_user_id uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.property_user_belongs_to_organization(target_organization_id uuid, target_user_id uuid) FROM PUBLIC;


--
-- Name: FUNCTION protect_dead_whatsapp_message_webhook_expiry(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.protect_dead_whatsapp_message_webhook_expiry() FROM PUBLIC;


--
-- Name: FUNCTION protect_whatsapp_provider_attribution(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.protect_whatsapp_provider_attribution() FROM PUBLIC;


--
-- Name: FUNCTION prune_user_activity_sessions(p_organization_id uuid, p_retention interval, p_batch_size integer, p_now timestamp with time zone); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.prune_user_activity_sessions(p_organization_id uuid, p_retention interval, p_batch_size integer, p_now timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION private.prune_user_activity_sessions(p_organization_id uuid, p_retention interval, p_batch_size integer, p_now timestamp with time zone) TO service_role;


--
-- Name: FUNCTION publish_automation_tag_association(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.publish_automation_tag_association() FROM PUBLIC;


--
-- Name: FUNCTION purge_expired_meta_oauth_flows(p_now timestamp with time zone); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.purge_expired_meta_oauth_flows(p_now timestamp with time zone) FROM PUBLIC;


--
-- Name: FUNCTION purge_meta_webhook_events(p_now timestamp with time zone, p_retention interval); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.purge_meta_webhook_events(p_now timestamp with time zone, p_retention interval) FROM PUBLIC;


--
-- Name: FUNCTION push_device_endpoint_key(p_endpoint text, p_platform text, p_token text); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.push_device_endpoint_key(p_endpoint text, p_platform text, p_token text) FROM PUBLIC;
GRANT ALL ON FUNCTION private.push_device_endpoint_key(p_endpoint text, p_platform text, p_token text) TO service_role;


--
-- Name: FUNCTION push_notification_recipient_is_active(p_organization_id uuid, p_user_id uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.push_notification_recipient_is_active(p_organization_id uuid, p_user_id uuid) FROM PUBLIC;


--
-- Name: FUNCTION queue_notification_delivery_allowed(p_org uuid, p_lead uuid, p_actor uuid, p_event text, p_metadata jsonb); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.queue_notification_delivery_allowed(p_org uuid, p_lead uuid, p_actor uuid, p_event text, p_metadata jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION private.queue_notification_delivery_allowed(p_org uuid, p_lead uuid, p_actor uuid, p_event text, p_metadata jsonb) TO service_role;


--
-- Name: FUNCTION queue_pool_alert_audience(p_org uuid, p_queue uuid, p_actor uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.queue_pool_alert_audience(p_org uuid, p_queue uuid, p_actor uuid) FROM PUBLIC;


--
-- Name: FUNCTION queue_pool_audience(p_org uuid, p_queue uuid, p_actor uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.queue_pool_audience(p_org uuid, p_queue uuid, p_actor uuid) FROM PUBLIC;


--
-- Name: FUNCTION queue_pool_metadata(p_organization_id uuid, p_lead_id uuid, p_actor_id uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.queue_pool_metadata(p_organization_id uuid, p_lead_id uuid, p_actor_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION private.queue_pool_metadata(p_organization_id uuid, p_lead_id uuid, p_actor_id uuid) TO service_role;


--
-- Name: FUNCTION queue_pool_read_access(p_organization_id uuid, p_lead_id uuid, p_actor_id uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.queue_pool_read_access(p_organization_id uuid, p_lead_id uuid, p_actor_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION private.queue_pool_read_access(p_organization_id uuid, p_lead_id uuid, p_actor_id uuid) TO authenticated;
GRANT ALL ON FUNCTION private.queue_pool_read_access(p_organization_id uuid, p_lead_id uuid, p_actor_id uuid) TO service_role;


--
-- Name: FUNCTION queue_pool_related_read_access(p_lead uuid, p_actor uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.queue_pool_related_read_access(p_lead uuid, p_actor uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION private.queue_pool_related_read_access(p_lead uuid, p_actor uuid) TO authenticated;
GRANT ALL ON FUNCTION private.queue_pool_related_read_access(p_lead uuid, p_actor uuid) TO service_role;


--
-- Name: FUNCTION queue_property_asset_storage_cleanup(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.queue_property_asset_storage_cleanup() FROM PUBLIC;


--
-- Name: FUNCTION queue_property_asset_upload_cleanup_on_cascade(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.queue_property_asset_upload_cleanup_on_cascade() FROM PUBLIC;


--
-- Name: FUNCTION queue_runtime_actor_active(p_org uuid, p_actor uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.queue_runtime_actor_active(p_org uuid, p_actor uuid) FROM PUBLIC;


--
-- Name: FUNCTION queue_runtime_actor_admin(p_org uuid, p_actor uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.queue_runtime_actor_admin(p_org uuid, p_actor uuid) FROM PUBLIC;


--
-- Name: FUNCTION queue_runtime_actor_can_claim(p_org uuid, p_actor uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.queue_runtime_actor_can_claim(p_org uuid, p_actor uuid) FROM PUBLIC;


--
-- Name: FUNCTION queue_runtime_assign(p_org uuid, p_lead uuid, p_user uuid, p_team uuid, p_member uuid, p_position integer, p_window_key text, p_round integer, p_now timestamp with time zone, p_actor uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.queue_runtime_assign(p_org uuid, p_lead uuid, p_user uuid, p_team uuid, p_member uuid, p_position integer, p_window_key text, p_round integer, p_now timestamp with time zone, p_actor uuid) FROM PUBLIC;


--
-- Name: FUNCTION queue_runtime_claim_permissions(p_org uuid, p_actor uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.queue_runtime_claim_permissions(p_org uuid, p_actor uuid) FROM PUBLIC;


--
-- Name: FUNCTION queue_runtime_dispatch_metadata(p_data jsonb); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.queue_runtime_dispatch_metadata(p_data jsonb) FROM PUBLIC;


--
-- Name: FUNCTION queue_runtime_enroll(p_org uuid, p_lead uuid, p_queue uuid, p_now timestamp with time zone); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.queue_runtime_enroll(p_org uuid, p_lead uuid, p_queue uuid, p_now timestamp with time zone) FROM PUBLIC;


--
-- Name: FUNCTION queue_runtime_has_human_activity(p_org uuid, p_lead uuid, p_baseline timestamp with time zone); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.queue_runtime_has_human_activity(p_org uuid, p_lead uuid, p_baseline timestamp with time zone) FROM PUBLIC;


--
-- Name: FUNCTION queue_runtime_is_managed(p_organization_id uuid, p_round_robin_id uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.queue_runtime_is_managed(p_organization_id uuid, p_round_robin_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION private.queue_runtime_is_managed(p_organization_id uuid, p_round_robin_id uuid) TO service_role;


--
-- Name: FUNCTION queue_runtime_legacy_adoption_kind(p_org uuid, p_lead uuid, p_queue uuid, p_job uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.queue_runtime_legacy_adoption_kind(p_org uuid, p_lead uuid, p_queue uuid, p_job uuid) FROM PUBLIC;


--
-- Name: FUNCTION queue_runtime_members(p_org uuid, p_queue uuid, p_now timestamp with time zone); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.queue_runtime_members(p_org uuid, p_queue uuid, p_now timestamp with time zone) FROM PUBLIC;


--
-- Name: FUNCTION queue_runtime_meta_initial_pending_proven(p_org uuid, p_lead uuid, p_queue uuid, p_job uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.queue_runtime_meta_initial_pending_proven(p_org uuid, p_lead uuid, p_queue uuid, p_job uuid) FROM PUBLIC;


--
-- Name: FUNCTION queue_runtime_pool(p_org uuid, p_lead uuid, p_reason text, p_now timestamp with time zone, p_window jsonb); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.queue_runtime_pool(p_org uuid, p_lead uuid, p_reason text, p_now timestamp with time zone, p_window jsonb) FROM PUBLIC;


--
-- Name: FUNCTION queue_runtime_redistribute(p_org uuid, p_lead uuid, p_actor uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.queue_runtime_redistribute(p_org uuid, p_lead uuid, p_actor uuid) FROM PUBLIC;


--
-- Name: FUNCTION queue_runtime_redistribute_before_concurrency_guard(p_org uuid, p_lead uuid, p_actor uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.queue_runtime_redistribute_before_concurrency_guard(p_org uuid, p_lead uuid, p_actor uuid) FROM PUBLIC;


--
-- Name: FUNCTION queue_runtime_step(p_org uuid, p_lead uuid, p_now timestamp with time zone, p_force boolean, p_actor uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.queue_runtime_step(p_org uuid, p_lead uuid, p_now timestamp with time zone, p_force boolean, p_actor uuid) FROM PUBLIC;


--
-- Name: FUNCTION queue_runtime_warning_guard(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.queue_runtime_warning_guard() FROM PUBLIC;


--
-- Name: FUNCTION queue_schedule_valid(p_schedule jsonb); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.queue_schedule_valid(p_schedule jsonb) FROM PUBLIC;


--
-- Name: FUNCTION queue_timezone_name_valid(p_name text); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.queue_timezone_name_valid(p_name text) FROM PUBLIC;


--
-- Name: FUNCTION queue_window(p_organization_id uuid, p_round_robin_id uuid, p_now timestamp with time zone); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.queue_window(p_organization_id uuid, p_round_robin_id uuid, p_now timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION private.queue_window(p_organization_id uuid, p_round_robin_id uuid, p_now timestamp with time zone) TO service_role;


--
-- Name: FUNCTION read_whatsapp_webhook_pn_route_quarantine(p_organization_id uuid, p_session_id uuid, p_inbox_id uuid, p_execution_id uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.read_whatsapp_webhook_pn_route_quarantine(p_organization_id uuid, p_session_id uuid, p_inbox_id uuid, p_execution_id uuid) FROM PUBLIC;


--
-- Name: FUNCTION reconcile_asaas_payment_webhook_unordered_legacy(p_event_id text, p_event_type text, p_event_at timestamp with time zone, p_payment jsonb, p_payload jsonb); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.reconcile_asaas_payment_webhook_unordered_legacy(p_event_id text, p_event_type text, p_event_at timestamp with time zone, p_payment jsonb, p_payload jsonb) FROM PUBLIC;


--
-- Name: FUNCTION reconcile_billing_payment_access_proof(p_organization_id uuid, p_provider_payment_id text, p_current_status text, p_proof_status text); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.reconcile_billing_payment_access_proof(p_organization_id uuid, p_provider_payment_id text, p_current_status text, p_proof_status text) FROM PUBLIC;


--
-- Name: FUNCTION reconcile_google_calendar_cron_jobs(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.reconcile_google_calendar_cron_jobs() FROM PUBLIC;


--
-- Name: FUNCTION reconcile_meta_feedback_module_activation(p_organization_id uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.reconcile_meta_feedback_module_activation(p_organization_id uuid) FROM PUBLIC;


--
-- Name: FUNCTION reconcile_notification_whatsapp_delivery(p_organization_id uuid, p_expected_message_id text, p_status text, p_occurred_at timestamp with time zone); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.reconcile_notification_whatsapp_delivery(p_organization_id uuid, p_expected_message_id text, p_status text, p_occurred_at timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION private.reconcile_notification_whatsapp_delivery(p_organization_id uuid, p_expected_message_id text, p_status text, p_occurred_at timestamp with time zone) TO service_role;


--
-- Name: FUNCTION reconcile_resend_email_events_after_log(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.reconcile_resend_email_events_after_log() FROM PUBLIC;


--
-- Name: FUNCTION reconcile_resend_email_events_for_log(p_email_log_id uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.reconcile_resend_email_events_for_log(p_email_log_id uuid) FROM PUBLIC;


--
-- Name: FUNCTION record_billing_cleanup_access_cause_event(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.record_billing_cleanup_access_cause_event() FROM PUBLIC;


--
-- Name: FUNCTION record_billing_cleanup_payment_event(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.record_billing_cleanup_payment_event() FROM PUBLIC;


--
-- Name: FUNCTION record_lead_action_fact(p_organization_id uuid, p_lead_id uuid, p_actor_user_id uuid, p_action_type text, p_channel text, p_occurred_at timestamp with time zone, p_is_automated boolean, p_is_inbound boolean, p_qualifies_first_outreach boolean, p_qualifies_stage_inactivity boolean, p_is_effective_contact boolean, p_source_type text, p_source_id text, p_metadata jsonb); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.record_lead_action_fact(p_organization_id uuid, p_lead_id uuid, p_actor_user_id uuid, p_action_type text, p_channel text, p_occurred_at timestamp with time zone, p_is_automated boolean, p_is_inbound boolean, p_qualifies_first_outreach boolean, p_qualifies_stage_inactivity boolean, p_is_effective_contact boolean, p_source_type text, p_source_id text, p_metadata jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION private.record_lead_action_fact(p_organization_id uuid, p_lead_id uuid, p_actor_user_id uuid, p_action_type text, p_channel text, p_occurred_at timestamp with time zone, p_is_automated boolean, p_is_inbound boolean, p_qualifies_first_outreach boolean, p_qualifies_stage_inactivity boolean, p_is_effective_contact boolean, p_source_type text, p_source_id text, p_metadata jsonb) TO service_role;


--
-- Name: FUNCTION record_round_robin_rotation_assignment(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.record_round_robin_rotation_assignment() FROM PUBLIC;


--
-- Name: FUNCTION recover_paid_checkout_after_payment_delete(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.recover_paid_checkout_after_payment_delete() FROM PUBLIC;


--
-- Name: FUNCTION recover_paid_checkout_after_subscription_delete(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.recover_paid_checkout_after_subscription_delete() FROM PUBLIC;


--
-- Name: FUNCTION recover_whatsapp_inbound_push_waiting(p_limit integer); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.recover_whatsapp_inbound_push_waiting(p_limit integer) FROM PUBLIC;


--
-- Name: FUNCTION refresh_queue_timezone_catalog(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.refresh_queue_timezone_catalog() FROM PUBLIC;


--
-- Name: FUNCTION register_whatsapp_inbound_push_waiting(p_notification_id uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.register_whatsapp_inbound_push_waiting(p_notification_id uuid) FROM PUBLIC;


--
-- Name: FUNCTION reject_automation_flow_version_update(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.reject_automation_flow_version_update() FROM PUBLIC;


--
-- Name: FUNCTION reject_new_whatsapp_legacy_capture(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.reject_new_whatsapp_legacy_capture() FROM PUBLIC;


--
-- Name: FUNCTION renew_whatsapp_media_job(p_job_id uuid, p_worker_id text, p_lease_token uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.renew_whatsapp_media_job(p_job_id uuid, p_worker_id text, p_lease_token uuid) FROM PUBLIC;


--
-- Name: FUNCTION replay_notification_delivery(p_delivery_id uuid, p_reason text, p_requested_by text); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.replay_notification_delivery(p_delivery_id uuid, p_reason text, p_requested_by text) FROM PUBLIC;
GRANT ALL ON FUNCTION private.replay_notification_delivery(p_delivery_id uuid, p_reason text, p_requested_by text) TO service_role;


--
-- Name: FUNCTION reschedule_notification_delivery(p_delivery_id uuid, p_lease_token uuid, p_next_attempt_at timestamp with time zone, p_error_code text, p_error_message text, p_provider_status text, p_attempt_metadata jsonb); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.reschedule_notification_delivery(p_delivery_id uuid, p_lease_token uuid, p_next_attempt_at timestamp with time zone, p_error_code text, p_error_message text, p_provider_status text, p_attempt_metadata jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION private.reschedule_notification_delivery(p_delivery_id uuid, p_lease_token uuid, p_next_attempt_at timestamp with time zone, p_error_code text, p_error_message text, p_provider_status text, p_attempt_metadata jsonb) TO service_role;


--
-- Name: FUNCTION resend_email_event_status(p_event_type text); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.resend_email_event_status(p_event_type text) FROM PUBLIC;


--
-- Name: FUNCTION resend_email_status_rank(p_status text); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.resend_email_status_rank(p_status text) FROM PUBLIC;


--
-- Name: FUNCTION reserve_managed_whatsapp_distribution_auto_reply_from_entry(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.reserve_managed_whatsapp_distribution_auto_reply_from_entry() FROM PUBLIC;


--
-- Name: FUNCTION reset_lead_redistribution_worker_retry_clocks(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.reset_lead_redistribution_worker_retry_clocks() FROM PUBLIC;


--
-- Name: FUNCTION resolve_billing_payment_checkout_snapshot(p_payment_id uuid, p_allow_legacy_catalog boolean); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.resolve_billing_payment_checkout_snapshot(p_payment_id uuid, p_allow_legacy_catalog boolean) FROM PUBLIC;


--
-- Name: FUNCTION revoke_whatsapp_grants_on_org_member_change(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.revoke_whatsapp_grants_on_org_member_change() FROM PUBLIC;


--
-- Name: FUNCTION revoke_whatsapp_grants_on_user_deactivation(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.revoke_whatsapp_grants_on_user_deactivation() FROM PUBLIC;


--
-- Name: FUNCTION revoke_whatsapp_team_grants_on_member_change(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.revoke_whatsapp_team_grants_on_member_change() FROM PUBLIC;


--
-- Name: FUNCTION revoke_whatsapp_team_grants_on_team_change(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.revoke_whatsapp_team_grants_on_team_change() FROM PUBLIC;


--
-- Name: FUNCTION round_robin_has_pending_whatsapp_intake(p_organization_id uuid, p_round_robin_id uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.round_robin_has_pending_whatsapp_intake(p_organization_id uuid, p_round_robin_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION private.round_robin_has_pending_whatsapp_intake(p_organization_id uuid, p_round_robin_id uuid) TO service_role;


--
-- Name: FUNCTION round_robin_rotation_candidates(p_organization_id uuid, p_round_robin_id uuid, p_ignore_availability boolean, p_current_day integer, p_current_time time without time zone, p_required_team_id uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.round_robin_rotation_candidates(p_organization_id uuid, p_round_robin_id uuid, p_ignore_availability boolean, p_current_day integer, p_current_time time without time zone, p_required_team_id uuid) FROM PUBLIC;


--
-- Name: FUNCTION round_robin_ticket_sequence_name(p_round_robin_id uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.round_robin_ticket_sequence_name(p_round_robin_id uuid) FROM PUBLIC;


--
-- Name: FUNCTION safe_automation_timestamptz(value text); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.safe_automation_timestamptz(value text) FROM PUBLIC;


--
-- Name: FUNCTION safe_legacy_property_offer_price(legacy_price numeric); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.safe_legacy_property_offer_price(legacy_price numeric) FROM PUBLIC;


--
-- Name: FUNCTION safe_uuid(value text); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.safe_uuid(value text) FROM PUBLIC;
GRANT ALL ON FUNCTION private.safe_uuid(value text) TO authenticated;
GRANT ALL ON FUNCTION private.safe_uuid(value text) TO service_role;


--
-- Name: FUNCTION sanitize_whatsapp_attendance_lead_insert(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.sanitize_whatsapp_attendance_lead_insert() FROM PUBLIC;


--
-- Name: FUNCTION scope_distribution_notification_dedupe(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.scope_distribution_notification_dedupe() FROM PUBLIC;


--
-- Name: FUNCTION scrub_expired_whatsapp_normalized_reactions(p_limit integer); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.scrub_expired_whatsapp_normalized_reactions(p_limit integer) FROM PUBLIC;


--
-- Name: FUNCTION scrub_expired_whatsapp_unlinked_conversations(p_message_limit integer); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.scrub_expired_whatsapp_unlinked_conversations(p_message_limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION private.scrub_expired_whatsapp_unlinked_conversations(p_message_limit integer) TO service_role;


--
-- Name: FUNCTION scrub_expired_whatsapp_unlinked_conversations_base(p_message_limit integer); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.scrub_expired_whatsapp_unlinked_conversations_base(p_message_limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION private.scrub_expired_whatsapp_unlinked_conversations_base(p_message_limit integer) TO service_role;


--
-- Name: FUNCTION scrub_expired_whatsapp_unlinked_inbox(p_limit integer); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.scrub_expired_whatsapp_unlinked_inbox(p_limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION private.scrub_expired_whatsapp_unlinked_inbox(p_limit integer) TO service_role;


--
-- Name: FUNCTION scrub_expired_whatsapp_unlinked_inbox_exclusive(p_limit integer); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.scrub_expired_whatsapp_unlinked_inbox_exclusive(p_limit integer) FROM PUBLIC;


--
-- Name: FUNCTION seed_whatsapp_inbound_push_waiting(p_limit integer); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.seed_whatsapp_inbound_push_waiting(p_limit integer) FROM PUBLIC;


--
-- Name: FUNCTION serialize_property_legacy_location_assignment(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.serialize_property_legacy_location_assignment() FROM PUBLIC;
GRANT ALL ON FUNCTION private.serialize_property_legacy_location_assignment() TO service_role;


--
-- Name: FUNCTION set_attention_updated_at(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.set_attention_updated_at() FROM PUBLIC;


--
-- Name: FUNCTION set_billing_payment_checkout_capability_updated_at(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.set_billing_payment_checkout_capability_updated_at() FROM PUBLIC;


--
-- Name: FUNCTION set_lead_creation_status_phase(p_organization_id uuid, p_lead_id uuid, p_phase text); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.set_lead_creation_status_phase(p_organization_id uuid, p_lead_id uuid, p_phase text) FROM PUBLIC;
GRANT ALL ON FUNCTION private.set_lead_creation_status_phase(p_organization_id uuid, p_lead_id uuid, p_phase text) TO service_role;


--
-- Name: FUNCTION set_membership_generation(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.set_membership_generation() FROM PUBLIC;


--
-- Name: FUNCTION stamp_meta_feedback_module_activation(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.stamp_meta_feedback_module_activation() FROM PUBLIC;


--
-- Name: FUNCTION start_notification_delivery(p_delivery_id uuid, p_lease_token uuid, p_provider text); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.start_notification_delivery(p_delivery_id uuid, p_lease_token uuid, p_provider text) FROM PUBLIC;
GRANT ALL ON FUNCTION private.start_notification_delivery(p_delivery_id uuid, p_lease_token uuid, p_provider text) TO service_role;


--
-- Name: FUNCTION stop_active_redistribution_on_stage_move(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.stop_active_redistribution_on_stage_move() FROM PUBLIC;


--
-- Name: FUNCTION strip_whatsapp_provider_retention_marker(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.strip_whatsapp_provider_retention_marker() FROM PUBLIC;


--
-- Name: FUNCTION suppress_whatsapp_attendance_lead_message(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.suppress_whatsapp_attendance_lead_message() FROM PUBLIC;


--
-- Name: FUNCTION sweep_stale_notification_deliveries(p_acceptance_timeout interval); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.sweep_stale_notification_deliveries(p_acceptance_timeout interval) FROM PUBLIC;
GRANT ALL ON FUNCTION private.sweep_stale_notification_deliveries(p_acceptance_timeout interval) TO service_role;


--
-- Name: FUNCTION switch_lead_cadence(p_organization_id uuid, p_lead_id uuid, p_cadence_template_id uuid, p_actor_user_id uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.switch_lead_cadence(p_organization_id uuid, p_lead_id uuid, p_cadence_template_id uuid, p_actor_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION private.switch_lead_cadence(p_organization_id uuid, p_lead_id uuid, p_cadence_template_id uuid, p_actor_user_id uuid) TO service_role;


--
-- Name: FUNCTION sync_asaas_bank_slip_registration_state(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.sync_asaas_bank_slip_registration_state() FROM PUBLIC;


--
-- Name: FUNCTION sync_billing_payment_checkout_capability(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.sync_billing_payment_checkout_capability() FROM PUBLIC;


--
-- Name: FUNCTION sync_billing_subscription_card_update_payment(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.sync_billing_subscription_card_update_payment() FROM PUBLIC;


--
-- Name: FUNCTION sync_cadence_lifecycle(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.sync_cadence_lifecycle() FROM PUBLIC;


--
-- Name: FUNCTION sync_cadence_task_state(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.sync_cadence_task_state() FROM PUBLIC;


--
-- Name: FUNCTION sync_lead_cadence_assignee(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.sync_lead_cadence_assignee() FROM PUBLIC;


--
-- Name: FUNCTION sync_linked_property_from_unit_price(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.sync_linked_property_from_unit_price() FROM PUBLIC;


--
-- Name: FUNCTION sync_linked_property_price_for_development_unit(source_organization_id uuid, source_development_id uuid, source_unit_id uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.sync_linked_property_price_for_development_unit(source_organization_id uuid, source_development_id uuid, source_unit_id uuid) FROM PUBLIC;


--
-- Name: FUNCTION sync_meta_feedback_module_activation(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.sync_meta_feedback_module_activation() FROM PUBLIC;


--
-- Name: FUNCTION sync_notification_deliveries_from_notification(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.sync_notification_deliveries_from_notification() FROM PUBLIC;


--
-- Name: FUNCTION sync_organization_billing_state(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.sync_organization_billing_state() FROM PUBLIC;


--
-- Name: FUNCTION sync_organization_plan_modules(p_organization_id uuid, p_plan_id uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.sync_organization_plan_modules(p_organization_id uuid, p_plan_id uuid) FROM PUBLIC;


--
-- Name: FUNCTION sync_properties_from_development_price_table(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.sync_properties_from_development_price_table() FROM PUBLIC;


--
-- Name: FUNCTION sync_property_from_development_unit(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.sync_property_from_development_unit() FROM PUBLIC;


--
-- Name: TABLE properties; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.properties TO service_role;


--
-- Name: FUNCTION sync_property_legacy_offers(target_property public.properties); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.sync_property_legacy_offers(target_property public.properties) FROM PUBLIC;


--
-- Name: FUNCTION sync_property_legacy_offers_trigger(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.sync_property_legacy_offers_trigger() FROM PUBLIC;


--
-- Name: FUNCTION sync_property_owner_details(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.sync_property_owner_details() FROM PUBLIC;
GRANT ALL ON FUNCTION private.sync_property_owner_details() TO service_role;


--
-- Name: FUNCTION sync_property_owner_from_ownership(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.sync_property_owner_from_ownership() FROM PUBLIC;
GRANT ALL ON FUNCTION private.sync_property_owner_from_ownership() TO service_role;


--
-- Name: FUNCTION sync_property_owner_to_ownership(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.sync_property_owner_to_ownership() FROM PUBLIC;
GRANT ALL ON FUNCTION private.sync_property_owner_to_ownership() TO service_role;


--
-- Name: FUNCTION sync_resend_delivery_to_notification(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.sync_resend_delivery_to_notification() FROM PUBLIC;


--
-- Name: FUNCTION sync_round_robin_contract(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.sync_round_robin_contract() FROM PUBLIC;


--
-- Name: FUNCTION touch_property_publication_source_revision(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.touch_property_publication_source_revision() FROM PUBLIC;


--
-- Name: FUNCTION try_team_distribution_uuid(p_value text); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.try_team_distribution_uuid(p_value text) FROM PUBLIC;


--
-- Name: FUNCTION unblock_notification_deliveries(p_organization_id uuid, p_dependency_key text, p_channel text, p_limit integer); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.unblock_notification_deliveries(p_organization_id uuid, p_dependency_key text, p_channel text, p_limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION private.unblock_notification_deliveries(p_organization_id uuid, p_dependency_key text, p_channel text, p_limit integer) TO service_role;


--
-- Name: FUNCTION update_whatsapp_conversation_routing_head(p_organization_id uuid, p_conversation_id uuid, p_provider_message_id text, p_lead_id uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.update_whatsapp_conversation_routing_head(p_organization_id uuid, p_conversation_id uuid, p_provider_message_id text, p_lead_id uuid) FROM PUBLIC;


--
-- Name: FUNCTION user_belongs_to_organization(org_id uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.user_belongs_to_organization(org_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION private.user_belongs_to_organization(org_id uuid) TO service_role;
GRANT ALL ON FUNCTION private.user_belongs_to_organization(org_id uuid) TO authenticated;


--
-- Name: FUNCTION user_can_import_historical_leads(p_organization_id uuid, p_user_id uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.user_can_import_historical_leads(p_organization_id uuid, p_user_id uuid) FROM PUBLIC;


--
-- Name: FUNCTION user_has_organization(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.user_has_organization() FROM PUBLIC;
GRANT ALL ON FUNCTION private.user_has_organization() TO service_role;
GRANT ALL ON FUNCTION private.user_has_organization() TO authenticated;


--
-- Name: FUNCTION user_has_permission(p_permission_key text, p_user_id uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.user_has_permission(p_permission_key text, p_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION private.user_has_permission(p_permission_key text, p_user_id uuid) TO service_role;
GRANT ALL ON FUNCTION private.user_has_permission(p_permission_key text, p_user_id uuid) TO authenticated;


--
-- Name: FUNCTION user_has_permission_in_organization(p_permission_key text, p_user_id uuid, p_organization_id uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.user_has_permission_in_organization(p_permission_key text, p_user_id uuid, p_organization_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION private.user_has_permission_in_organization(p_permission_key text, p_user_id uuid, p_organization_id uuid) TO service_role;


--
-- Name: FUNCTION validate_managed_whatsapp_ctwa_ad(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.validate_managed_whatsapp_ctwa_ad() FROM PUBLIC;


--
-- Name: FUNCTION validate_managed_whatsapp_lead_insert(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.validate_managed_whatsapp_lead_insert() FROM PUBLIC;


--
-- Name: FUNCTION validate_property_ownership_allocation(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.validate_property_ownership_allocation() FROM PUBLIC;


--
-- Name: FUNCTION validate_queue_operating_schedule_write(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.validate_queue_operating_schedule_write() FROM PUBLIC;


--
-- Name: FUNCTION validate_whatsapp_worker_tenant_shape(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.validate_whatsapp_worker_tenant_shape() FROM PUBLIC;
GRANT ALL ON FUNCTION private.validate_whatsapp_worker_tenant_shape() TO service_role;


--
-- Name: FUNCTION vimob_can_access_whatsapp_session(p_session_id uuid, p_permission text); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.vimob_can_access_whatsapp_session(p_session_id uuid, p_permission text) FROM PUBLIC;
GRANT ALL ON FUNCTION private.vimob_can_access_whatsapp_session(p_session_id uuid, p_permission text) TO service_role;


--
-- Name: FUNCTION vimob_user_has_active_org_membership(p_org_id uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.vimob_user_has_active_org_membership(p_org_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION private.vimob_user_has_active_org_membership(p_org_id uuid) TO service_role;
GRANT ALL ON FUNCTION private.vimob_user_has_active_org_membership(p_org_id uuid) TO authenticated;


--
-- Name: FUNCTION vimob_users_share_active_org(p_target_user_id uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.vimob_users_share_active_org(p_target_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION private.vimob_users_share_active_org(p_target_user_id uuid) TO service_role;
GRANT ALL ON FUNCTION private.vimob_users_share_active_org(p_target_user_id uuid) TO authenticated;


--
-- Name: FUNCTION vista_delete_api_key(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.vista_delete_api_key() FROM PUBLIC;


--
-- Name: FUNCTION vista_store_api_key(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.vista_store_api_key() FROM PUBLIC;


--
-- Name: FUNCTION wake_notification_deliveries_after_whatsapp_connect(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.wake_notification_deliveries_after_whatsapp_connect() FROM PUBLIC;


--
-- Name: FUNCTION whatsapp_actor_can_read_lead(p_organization_id uuid, p_lead_id uuid, p_actor_user_id uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.whatsapp_actor_can_read_lead(p_organization_id uuid, p_lead_id uuid, p_actor_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION private.whatsapp_actor_can_read_lead(p_organization_id uuid, p_lead_id uuid, p_actor_user_id uuid) TO authenticated;


--
-- Name: FUNCTION whatsapp_actor_has_lead_permission(p_organization_id uuid, p_actor_user_id uuid, p_permission_key text); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.whatsapp_actor_has_lead_permission(p_organization_id uuid, p_actor_user_id uuid, p_permission_key text) FROM PUBLIC;


--
-- Name: FUNCTION whatsapp_attendance_message_evidence_matches(p_capture_state text, p_content text, p_metadata jsonb, p_expected_fingerprint text, p_expected_content text); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.whatsapp_attendance_message_evidence_matches(p_capture_state text, p_content text, p_metadata jsonb, p_expected_fingerprint text, p_expected_content text) FROM PUBLIC;


--
-- Name: FUNCTION whatsapp_contact_pn_reference(p_values text[]); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.whatsapp_contact_pn_reference(p_values text[]) FROM PUBLIC;


--
-- Name: FUNCTION whatsapp_contact_pns_conflict(p_values text[]); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.whatsapp_contact_pns_conflict(p_values text[]) FROM PUBLIC;


--
-- Name: FUNCTION whatsapp_conversation_contact_pn_evidence(p_organization_id uuid, p_session_id uuid, p_conversation_id uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.whatsapp_conversation_contact_pn_evidence(p_organization_id uuid, p_session_id uuid, p_conversation_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION private.whatsapp_conversation_contact_pn_evidence(p_organization_id uuid, p_session_id uuid, p_conversation_id uuid) TO service_role;


--
-- Name: FUNCTION whatsapp_conversation_has_protected_history(p_conversation_id uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.whatsapp_conversation_has_protected_history(p_conversation_id uuid) FROM PUBLIC;


--
-- Name: FUNCTION whatsapp_inbound_push_is_unstarted(p_delivery private.notification_deliveries); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.whatsapp_inbound_push_is_unstarted(p_delivery private.notification_deliveries) FROM PUBLIC;


--
-- Name: FUNCTION whatsapp_inbound_push_needs_reassignment(p_delivery private.notification_deliveries); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.whatsapp_inbound_push_needs_reassignment(p_delivery private.notification_deliveries) FROM PUBLIC;


--
-- Name: FUNCTION whatsapp_inbound_push_recipient(p_organization_id uuid, p_message_id uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.whatsapp_inbound_push_recipient(p_organization_id uuid, p_message_id uuid) FROM PUBLIC;


--
-- Name: FUNCTION whatsapp_ingress_routing_event_is_current(p_organization_id uuid, p_conversation_id uuid, p_provider_message_id text, p_lead_id uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.whatsapp_ingress_routing_event_is_current(p_organization_id uuid, p_conversation_id uuid, p_provider_message_id text, p_lead_id uuid) FROM PUBLIC;


--
-- Name: TABLE whatsapp_webhook_routing_snapshots; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.whatsapp_webhook_routing_snapshots TO service_role;


--
-- Name: FUNCTION whatsapp_inherited_predecessor_provenance_matches(p_route public.whatsapp_webhook_routing_snapshots, p_predecessor public.whatsapp_webhook_routing_snapshots); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.whatsapp_inherited_predecessor_provenance_matches(p_route public.whatsapp_webhook_routing_snapshots, p_predecessor public.whatsapp_webhook_routing_snapshots) FROM PUBLIC;


--
-- Name: FUNCTION whatsapp_managed_initial_proof_matches(p_organization_id uuid, p_lead_id uuid, p_session_id uuid, p_provider_event_id text, p_message_fingerprint text, p_rule_id uuid, p_target_round_robin_id uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.whatsapp_managed_initial_proof_matches(p_organization_id uuid, p_lead_id uuid, p_session_id uuid, p_provider_event_id text, p_message_fingerprint text, p_rule_id uuid, p_target_round_robin_id uuid) FROM PUBLIC;


--
-- Name: FUNCTION whatsapp_message_conversation_session_matches(p_conversation_id uuid, p_session_id uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.whatsapp_message_conversation_session_matches(p_conversation_id uuid, p_session_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION private.whatsapp_message_conversation_session_matches(p_conversation_id uuid, p_session_id uuid) TO service_role;


--
-- Name: FUNCTION whatsapp_message_epoch_matches(p_organization_id uuid, p_conversation_id uuid, p_session_id uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.whatsapp_message_epoch_matches(p_organization_id uuid, p_conversation_id uuid, p_session_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION private.whatsapp_message_epoch_matches(p_organization_id uuid, p_conversation_id uuid, p_session_id uuid) TO authenticated;


--
-- Name: FUNCTION whatsapp_metadata_ctwa_confirmation_method(p_metadata jsonb); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.whatsapp_metadata_ctwa_confirmation_method(p_metadata jsonb) FROM PUBLIC;


--
-- Name: FUNCTION whatsapp_metadata_is_ctwa_ad(p_metadata jsonb); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.whatsapp_metadata_is_ctwa_ad(p_metadata jsonb) FROM PUBLIC;


--
-- Name: FUNCTION whatsapp_owner_can_view_session(p_organization_id uuid, p_session_id uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.whatsapp_owner_can_view_session(p_organization_id uuid, p_session_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION private.whatsapp_owner_can_view_session(p_organization_id uuid, p_session_id uuid) TO authenticated;


--
-- Name: FUNCTION whatsapp_unlinked_capture_resolution(p_organization_id uuid, p_session_id uuid, p_conversation_id uuid, p_provider_message_id text, p_inbox_event_key text); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.whatsapp_unlinked_capture_resolution(p_organization_id uuid, p_session_id uuid, p_conversation_id uuid, p_provider_message_id text, p_inbox_event_key text) FROM PUBLIC;


--
-- Name: FUNCTION whatsapp_unlinked_has_unscrubbed_inbox(p_conversation_id uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.whatsapp_unlinked_has_unscrubbed_inbox(p_conversation_id uuid) FROM PUBLIC;


--
-- Name: FUNCTION whatsapp_unlinked_inbox_batch_exclusive(p_inbox_id uuid, p_conversation_id uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.whatsapp_unlinked_inbox_batch_exclusive(p_inbox_id uuid, p_conversation_id uuid) FROM PUBLIC;


--
-- Name: FUNCTION whatsapp_unlinked_media_gc_can_delete(p_id uuid, p_worker_id text); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.whatsapp_unlinked_media_gc_can_delete(p_id uuid, p_worker_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION private.whatsapp_unlinked_media_gc_can_delete(p_id uuid, p_worker_id text) TO service_role;


--
-- Name: FUNCTION whatsapp_unlinked_mixed_inbox_plan(p_inbox_id uuid, p_conversation_id uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.whatsapp_unlinked_mixed_inbox_plan(p_inbox_id uuid, p_conversation_id uuid) FROM PUBLIC;


--
-- Name: TABLE whatsapp_messages; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.whatsapp_messages TO service_role;


--
-- Name: FUNCTION whatsapp_unlinked_promotion_is_authorized(p_old public.whatsapp_messages, p_new public.whatsapp_messages); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.whatsapp_unlinked_promotion_is_authorized(p_old public.whatsapp_messages, p_new public.whatsapp_messages) FROM PUBLIC;


--
-- Name: FUNCTION write_audit_log_for_row(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.write_audit_log_for_row() FROM PUBLIC;
GRANT ALL ON FUNCTION private.write_audit_log_for_row() TO service_role;


--
-- Name: FUNCTION abandon_billing_subscription_card_update_job(p_job_id uuid, p_organization_id uuid, p_generation bigint, p_attempt_lease_id uuid, p_error_code text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.abandon_billing_subscription_card_update_job(p_job_id uuid, p_organization_id uuid, p_generation bigint, p_attempt_lease_id uuid, p_error_code text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.abandon_billing_subscription_card_update_job(p_job_id uuid, p_organization_id uuid, p_generation bigint, p_attempt_lease_id uuid, p_error_code text) TO service_role;


--
-- Name: FUNCTION ack_billing_organization_asaas_cleanup_resource(p_organization_id uuid, p_claim_token uuid, p_resource_kind text, p_resource_id text, p_attempt_token uuid, p_http_status integer, p_provider_response jsonb); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.ack_billing_organization_asaas_cleanup_resource(p_organization_id uuid, p_claim_token uuid, p_resource_kind text, p_resource_id text, p_attempt_token uuid, p_http_status integer, p_provider_response jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.ack_billing_organization_asaas_cleanup_resource(p_organization_id uuid, p_claim_token uuid, p_resource_kind text, p_resource_id text, p_attempt_token uuid, p_http_status integer, p_provider_response jsonb) TO service_role;


--
-- Name: FUNCTION activate_whatsapp_conversation_lead_binding(p_organization_id uuid, p_conversation_id uuid, p_lead_id uuid, p_provider_message_id text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.activate_whatsapp_conversation_lead_binding(p_organization_id uuid, p_conversation_id uuid, p_lead_id uuid, p_provider_message_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.activate_whatsapp_conversation_lead_binding(p_organization_id uuid, p_conversation_id uuid, p_lead_id uuid, p_provider_message_id text) TO service_role;


--
-- Name: FUNCTION activate_whatsapp_conversation_lead_binding(p_organization_id uuid, p_conversation_id uuid, p_lead_id uuid, p_provider_message_id text, p_expected_previous_lead_id text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.activate_whatsapp_conversation_lead_binding(p_organization_id uuid, p_conversation_id uuid, p_lead_id uuid, p_provider_message_id text, p_expected_previous_lead_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.activate_whatsapp_conversation_lead_binding(p_organization_id uuid, p_conversation_id uuid, p_lead_id uuid, p_provider_message_id text, p_expected_previous_lead_id text) TO service_role;


--
-- Name: FUNCTION activate_whatsapp_conversation_lead_binding_if_current(p_organization_id uuid, p_conversation_id uuid, p_lead_id uuid, p_provider_message_id text, p_expected_active_binding_id uuid, p_expected_current_lead_id uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.activate_whatsapp_conversation_lead_binding_if_current(p_organization_id uuid, p_conversation_id uuid, p_lead_id uuid, p_provider_message_id text, p_expected_active_binding_id uuid, p_expected_current_lead_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.activate_whatsapp_conversation_lead_binding_if_current(p_organization_id uuid, p_conversation_id uuid, p_lead_id uuid, p_provider_message_id text, p_expected_active_binding_id uuid, p_expected_current_lead_id uuid) TO service_role;


--
-- Name: FUNCTION admin_dashboard_feed(p_limit integer); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.admin_dashboard_feed(p_limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_dashboard_feed(p_limit integer) TO anon;
GRANT ALL ON FUNCTION public.admin_dashboard_feed(p_limit integer) TO authenticated;
GRANT ALL ON FUNCTION public.admin_dashboard_feed(p_limit integer) TO service_role;


--
-- Name: FUNCTION admin_dashboard_pending_boards(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.admin_dashboard_pending_boards() FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_dashboard_pending_boards() TO anon;
GRANT ALL ON FUNCTION public.admin_dashboard_pending_boards() TO authenticated;
GRANT ALL ON FUNCTION public.admin_dashboard_pending_boards() TO service_role;


--
-- Name: FUNCTION admin_list_organizations(p_search text, p_status text, p_segment text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.admin_list_organizations(p_search text, p_status text, p_segment text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_list_organizations(p_search text, p_status text, p_segment text) TO anon;
GRANT ALL ON FUNCTION public.admin_list_organizations(p_search text, p_status text, p_segment text) TO authenticated;
GRANT ALL ON FUNCTION public.admin_list_organizations(p_search text, p_status text, p_segment text) TO service_role;


--
-- Name: FUNCTION apply_automation_internal_effect(p_organization_id uuid, p_execution_id uuid, p_node_key text, p_lease_token text, p_effect_key text, p_effect_type text, p_payload jsonb); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.apply_automation_internal_effect(p_organization_id uuid, p_execution_id uuid, p_node_key text, p_lease_token text, p_effect_key text, p_effect_type text, p_payload jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.apply_automation_internal_effect(p_organization_id uuid, p_execution_id uuid, p_node_key text, p_lease_token text, p_effect_key text, p_effect_type text, p_payload jsonb) TO service_role;


--
-- Name: FUNCTION apply_whatsapp_provider_reaction(p_organization_id uuid, p_session_id uuid, p_provider_message_id text, p_target_provider_message_id text, p_actor_jid text, p_actor_name text, p_from_me boolean, p_emoji text, p_reacted_at timestamp with time zone, p_inbox_event_key text, p_processing_epoch integer, p_ingress_sequence bigint, p_execution_id uuid, p_native_worker_id text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.apply_whatsapp_provider_reaction(p_organization_id uuid, p_session_id uuid, p_provider_message_id text, p_target_provider_message_id text, p_actor_jid text, p_actor_name text, p_from_me boolean, p_emoji text, p_reacted_at timestamp with time zone, p_inbox_event_key text, p_processing_epoch integer, p_ingress_sequence bigint, p_execution_id uuid, p_native_worker_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.apply_whatsapp_provider_reaction(p_organization_id uuid, p_session_id uuid, p_provider_message_id text, p_target_provider_message_id text, p_actor_jid text, p_actor_name text, p_from_me boolean, p_emoji text, p_reacted_at timestamp with time zone, p_inbox_event_key text, p_processing_epoch integer, p_ingress_sequence bigint, p_execution_id uuid, p_native_worker_id text) TO service_role;


--
-- Name: FUNCTION assign_neximob_lancamentos_webhook_lead(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.assign_neximob_lancamentos_webhook_lead() FROM PUBLIC;
GRANT ALL ON FUNCTION public.assign_neximob_lancamentos_webhook_lead() TO anon;
GRANT ALL ON FUNCTION public.assign_neximob_lancamentos_webhook_lead() TO authenticated;
GRANT ALL ON FUNCTION public.assign_neximob_lancamentos_webhook_lead() TO service_role;


--
-- Name: FUNCTION auto_enter_whatsapp_ctwa_attendance(p_organization_id uuid, p_conversation_id uuid, p_session_id uuid, p_lead_id uuid, p_binding_id uuid, p_provider_message_id text, p_ingress_sequence bigint, p_provider_occurred_at timestamp with time zone); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.auto_enter_whatsapp_ctwa_attendance(p_organization_id uuid, p_conversation_id uuid, p_session_id uuid, p_lead_id uuid, p_binding_id uuid, p_provider_message_id text, p_ingress_sequence bigint, p_provider_occurred_at timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.auto_enter_whatsapp_ctwa_attendance(p_organization_id uuid, p_conversation_id uuid, p_session_id uuid, p_lead_id uuid, p_binding_id uuid, p_provider_message_id text, p_ingress_sequence bigint, p_provider_occurred_at timestamp with time zone) TO service_role;


--
-- Name: FUNCTION can_access_lead(p_lead_id uuid, p_user_id uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.can_access_lead(p_lead_id uuid, p_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.can_access_lead(p_lead_id uuid, p_user_id uuid) TO anon;
GRANT ALL ON FUNCTION public.can_access_lead(p_lead_id uuid, p_user_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.can_access_lead(p_lead_id uuid, p_user_id uuid) TO service_role;


--
-- Name: FUNCTION can_access_schedule_event(p_event_id uuid, p_require_full_details boolean); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.can_access_schedule_event(p_event_id uuid, p_require_full_details boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.can_access_schedule_event(p_event_id uuid, p_require_full_details boolean) TO anon;
GRANT ALL ON FUNCTION public.can_access_schedule_event(p_event_id uuid, p_require_full_details boolean) TO authenticated;
GRANT ALL ON FUNCTION public.can_access_schedule_event(p_event_id uuid, p_require_full_details boolean) TO service_role;


--
-- Name: FUNCTION can_access_whatsapp_session(p_session_id uuid, p_user_id uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.can_access_whatsapp_session(p_session_id uuid, p_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.can_access_whatsapp_session(p_session_id uuid, p_user_id uuid) TO anon;
GRANT ALL ON FUNCTION public.can_access_whatsapp_session(p_session_id uuid, p_user_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.can_access_whatsapp_session(p_session_id uuid, p_user_id uuid) TO service_role;


--
-- Name: FUNCTION can_manage_round_robin_as_leader(p_round_robin_id uuid, p_user_id uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.can_manage_round_robin_as_leader(p_round_robin_id uuid, p_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.can_manage_round_robin_as_leader(p_round_robin_id uuid, p_user_id uuid) TO anon;
GRANT ALL ON FUNCTION public.can_manage_round_robin_as_leader(p_round_robin_id uuid, p_user_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.can_manage_round_robin_as_leader(p_round_robin_id uuid, p_user_id uuid) TO service_role;


--
-- Name: FUNCTION can_manage_session(session_id uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.can_manage_session(session_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.can_manage_session(session_id uuid) TO anon;
GRANT ALL ON FUNCTION public.can_manage_session(session_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.can_manage_session(session_id uuid) TO service_role;


--
-- Name: FUNCTION can_view_whatsapp_conversation(p_conversation_id uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.can_view_whatsapp_conversation(p_conversation_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.can_view_whatsapp_conversation(p_conversation_id uuid) TO service_role;


--
-- Name: FUNCTION cancel_automations_on_stage_change(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.cancel_automations_on_stage_change() FROM PUBLIC;
GRANT ALL ON FUNCTION public.cancel_automations_on_stage_change() TO anon;
GRANT ALL ON FUNCTION public.cancel_automations_on_stage_change() TO authenticated;
GRANT ALL ON FUNCTION public.cancel_automations_on_stage_change() TO service_role;


--
-- Name: FUNCTION cancel_billing_checkout_intent(p_organization_id uuid, p_payment_id text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.cancel_billing_checkout_intent(p_organization_id uuid, p_payment_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.cancel_billing_checkout_intent(p_organization_id uuid, p_payment_id text) TO service_role;


--
-- Name: FUNCTION cancel_billing_checkout_resource(p_organization_id uuid, p_intent_id uuid, p_payment_id text, p_subscription_id text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.cancel_billing_checkout_resource(p_organization_id uuid, p_intent_id uuid, p_payment_id text, p_subscription_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.cancel_billing_checkout_resource(p_organization_id uuid, p_intent_id uuid, p_payment_id text, p_subscription_id text) TO service_role;


--
-- Name: FUNCTION cancel_disabled_automation_runtime(p_batch_size integer); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.cancel_disabled_automation_runtime(p_batch_size integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.cancel_disabled_automation_runtime(p_batch_size integer) TO anon;
GRANT ALL ON FUNCTION public.cancel_disabled_automation_runtime(p_batch_size integer) TO authenticated;
GRANT ALL ON FUNCTION public.cancel_disabled_automation_runtime(p_batch_size integer) TO service_role;


--
-- Name: FUNCTION cancel_whatsapp_webhook_edge_execution(p_organization_id uuid, p_session_id uuid, p_inbox_id uuid, p_execution_id uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.cancel_whatsapp_webhook_edge_execution(p_organization_id uuid, p_session_id uuid, p_inbox_id uuid, p_execution_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.cancel_whatsapp_webhook_edge_execution(p_organization_id uuid, p_session_id uuid, p_inbox_id uuid, p_execution_id uuid) TO service_role;


--
-- Name: FUNCTION check_edge_rate_limit(p_scope text, p_identifier_hash text, p_limit integer, p_window_seconds integer); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.check_edge_rate_limit(p_scope text, p_identifier_hash text, p_limit integer, p_window_seconds integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.check_edge_rate_limit(p_scope text, p_identifier_hash text, p_limit integer, p_window_seconds integer) TO anon;
GRANT ALL ON FUNCTION public.check_edge_rate_limit(p_scope text, p_identifier_hash text, p_limit integer, p_window_seconds integer) TO authenticated;
GRANT ALL ON FUNCTION public.check_edge_rate_limit(p_scope text, p_identifier_hash text, p_limit integer, p_window_seconds integer) TO service_role;


--
-- Name: FUNCTION check_ranking_overtake(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.check_ranking_overtake() FROM PUBLIC;
GRANT ALL ON FUNCTION public.check_ranking_overtake() TO anon;
GRANT ALL ON FUNCTION public.check_ranking_overtake() TO authenticated;
GRANT ALL ON FUNCTION public.check_ranking_overtake() TO service_role;


--
-- Name: FUNCTION check_storage_org_access(org_id_text text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.check_storage_org_access(org_id_text text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.check_storage_org_access(org_id_text text) TO anon;
GRANT ALL ON FUNCTION public.check_storage_org_access(org_id_text text) TO authenticated;
GRANT ALL ON FUNCTION public.check_storage_org_access(org_id_text text) TO service_role;


--
-- Name: FUNCTION check_whatsapp_conversation_insert(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.check_whatsapp_conversation_insert() TO anon;
GRANT ALL ON FUNCTION public.check_whatsapp_conversation_insert() TO authenticated;
GRANT ALL ON FUNCTION public.check_whatsapp_conversation_insert() TO service_role;


--
-- Name: FUNCTION claim_authenticated_organization_card_attempt(p_organization_id uuid, p_actor_user_id uuid, p_ip_fingerprint text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.claim_authenticated_organization_card_attempt(p_organization_id uuid, p_actor_user_id uuid, p_ip_fingerprint text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.claim_authenticated_organization_card_attempt(p_organization_id uuid, p_actor_user_id uuid, p_ip_fingerprint text) TO service_role;


--
-- Name: TABLE automation_event_outbox; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.automation_event_outbox TO anon;
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.automation_event_outbox TO authenticated;
GRANT ALL ON TABLE public.automation_event_outbox TO service_role;


--
-- Name: FUNCTION claim_automation_events(p_worker_id text, p_batch_size integer); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.claim_automation_events(p_worker_id text, p_batch_size integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.claim_automation_events(p_worker_id text, p_batch_size integer) TO service_role;


--
-- Name: TABLE automation_executions; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.automation_executions TO anon;
GRANT ALL ON TABLE public.automation_executions TO authenticated;
GRANT ALL ON TABLE public.automation_executions TO service_role;


--
-- Name: FUNCTION claim_automation_executions(p_worker_id text, p_batch_size integer); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.claim_automation_executions(p_worker_id text, p_batch_size integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.claim_automation_executions(p_worker_id text, p_batch_size integer) TO service_role;


--
-- Name: FUNCTION claim_billing_card_recurrence(p_payment_id uuid, p_provider_payment_id text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.claim_billing_card_recurrence(p_payment_id uuid, p_provider_payment_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.claim_billing_card_recurrence(p_payment_id uuid, p_provider_payment_id text) TO service_role;


--
-- Name: FUNCTION claim_billing_card_recurrence_by_provider_payment(p_provider_payment_id text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.claim_billing_card_recurrence_by_provider_payment(p_provider_payment_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.claim_billing_card_recurrence_by_provider_payment(p_provider_payment_id text) TO service_role;


--
-- Name: FUNCTION claim_billing_card_recurrence_jobs(p_worker_id text, p_limit integer, p_lease_seconds integer); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.claim_billing_card_recurrence_jobs(p_worker_id text, p_limit integer, p_lease_seconds integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.claim_billing_card_recurrence_jobs(p_worker_id text, p_limit integer, p_lease_seconds integer) TO service_role;


--
-- Name: FUNCTION claim_billing_organization_asaas_cleanup(p_organization_id uuid, p_lease_owner text, p_lease_seconds integer); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.claim_billing_organization_asaas_cleanup(p_organization_id uuid, p_lease_owner text, p_lease_seconds integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.claim_billing_organization_asaas_cleanup(p_organization_id uuid, p_lease_owner text, p_lease_seconds integer) TO service_role;


--
-- Name: FUNCTION claim_billing_organization_asaas_cleanup_resource(p_organization_id uuid, p_claim_token uuid, p_lease_owner text, p_lease_seconds integer); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.claim_billing_organization_asaas_cleanup_resource(p_organization_id uuid, p_claim_token uuid, p_lease_owner text, p_lease_seconds integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.claim_billing_organization_asaas_cleanup_resource(p_organization_id uuid, p_claim_token uuid, p_lease_owner text, p_lease_seconds integer) TO service_role;


--
-- Name: FUNCTION claim_billing_payment_card_attempt_guard(p_payment_id uuid, p_provider_payment_id text, p_ip_fingerprint text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.claim_billing_payment_card_attempt_guard(p_payment_id uuid, p_provider_payment_id text, p_ip_fingerprint text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.claim_billing_payment_card_attempt_guard(p_payment_id uuid, p_provider_payment_id text, p_ip_fingerprint text) TO service_role;


--
-- Name: FUNCTION claim_billing_payment_checkout_attempt(p_payment_id uuid, p_provider_payment_id text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.claim_billing_payment_checkout_attempt(p_payment_id uuid, p_provider_payment_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.claim_billing_payment_checkout_attempt(p_payment_id uuid, p_provider_payment_id text) TO service_role;


--
-- Name: FUNCTION claim_billing_payment_checkout_cancellation(p_organization_id uuid, p_intent_id uuid, p_provider_payment_id text, p_lease_owner text, p_lease_seconds integer); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.claim_billing_payment_checkout_cancellation(p_organization_id uuid, p_intent_id uuid, p_provider_payment_id text, p_lease_owner text, p_lease_seconds integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.claim_billing_payment_checkout_cancellation(p_organization_id uuid, p_intent_id uuid, p_provider_payment_id text, p_lease_owner text, p_lease_seconds integer) TO service_role;


--
-- Name: FUNCTION claim_billing_payment_checkout_cancellation_jobs(p_worker_id text, p_limit integer, p_lease_seconds integer); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.claim_billing_payment_checkout_cancellation_jobs(p_worker_id text, p_limit integer, p_lease_seconds integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.claim_billing_payment_checkout_cancellation_jobs(p_worker_id text, p_limit integer, p_lease_seconds integer) TO service_role;


--
-- Name: FUNCTION claim_billing_payment_restore(p_payment_id uuid, p_checkout_token text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.claim_billing_payment_restore(p_payment_id uuid, p_checkout_token text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.claim_billing_payment_restore(p_payment_id uuid, p_checkout_token text) TO service_role;


--
-- Name: FUNCTION claim_billing_subscription_card_update_jobs(p_worker_id text, p_limit integer, p_lease_seconds integer); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.claim_billing_subscription_card_update_jobs(p_worker_id text, p_limit integer, p_lease_seconds integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.claim_billing_subscription_card_update_jobs(p_worker_id text, p_limit integer, p_lease_seconds integer) TO service_role;


--
-- Name: FUNCTION claim_billing_subscription_checkout_cancellation(p_organization_id uuid, p_intent_id uuid, p_payment_id text, p_subscription_id text, p_lease_owner text, p_lease_seconds integer); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.claim_billing_subscription_checkout_cancellation(p_organization_id uuid, p_intent_id uuid, p_payment_id text, p_subscription_id text, p_lease_owner text, p_lease_seconds integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.claim_billing_subscription_checkout_cancellation(p_organization_id uuid, p_intent_id uuid, p_payment_id text, p_subscription_id text, p_lease_owner text, p_lease_seconds integer) TO service_role;


--
-- Name: FUNCTION claim_billing_subscription_checkout_cancellation_jobs(p_worker_id text, p_limit integer, p_lease_seconds integer); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.claim_billing_subscription_checkout_cancellation_jobs(p_worker_id text, p_limit integer, p_lease_seconds integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.claim_billing_subscription_checkout_cancellation_jobs(p_worker_id text, p_limit integer, p_lease_seconds integer) TO service_role;


--
-- Name: FUNCTION claim_organization_checkout_card_attempt(p_organization_id uuid, p_checkout_token text, p_ip_fingerprint text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.claim_organization_checkout_card_attempt(p_organization_id uuid, p_checkout_token text, p_ip_fingerprint text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.claim_organization_checkout_card_attempt(p_organization_id uuid, p_checkout_token text, p_ip_fingerprint text) TO service_role;


--
-- Name: FUNCTION claim_specific_automation_execution(p_organization_id uuid, p_execution_id uuid, p_worker_id text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.claim_specific_automation_execution(p_organization_id uuid, p_execution_id uuid, p_worker_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.claim_specific_automation_execution(p_organization_id uuid, p_execution_id uuid, p_worker_id text) TO service_role;


--
-- Name: FUNCTION cleanup_orphan_members(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.cleanup_orphan_members() FROM PUBLIC;
GRANT ALL ON FUNCTION public.cleanup_orphan_members() TO service_role;


--
-- Name: FUNCTION cleanup_whatsapp_retention(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.cleanup_whatsapp_retention() FROM PUBLIC;
GRANT ALL ON FUNCTION public.cleanup_whatsapp_retention() TO service_role;


--
-- Name: FUNCTION complete_automation_event(p_event_id uuid, p_worker_id text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.complete_automation_event(p_event_id uuid, p_worker_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.complete_automation_event(p_event_id uuid, p_worker_id text) TO anon;
GRANT ALL ON FUNCTION public.complete_automation_event(p_event_id uuid, p_worker_id text) TO authenticated;
GRANT ALL ON FUNCTION public.complete_automation_event(p_event_id uuid, p_worker_id text) TO service_role;


--
-- Name: FUNCTION complete_billing_card_recurrence(p_payment_id uuid, p_provider_payment_id text, p_lease_id uuid, p_subscription jsonb); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.complete_billing_card_recurrence(p_payment_id uuid, p_provider_payment_id text, p_lease_id uuid, p_subscription jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.complete_billing_card_recurrence(p_payment_id uuid, p_provider_payment_id text, p_lease_id uuid, p_subscription jsonb) TO service_role;


--
-- Name: FUNCTION confirm_whatsapp_unlinked_history_binding(p_organization_id uuid, p_conversation_id uuid, p_lead_id uuid, p_expected_previous_lead_id uuid, p_actor_user_id uuid, p_action text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.confirm_whatsapp_unlinked_history_binding(p_organization_id uuid, p_conversation_id uuid, p_lead_id uuid, p_expected_previous_lead_id uuid, p_actor_user_id uuid, p_action text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.confirm_whatsapp_unlinked_history_binding(p_organization_id uuid, p_conversation_id uuid, p_lead_id uuid, p_expected_previous_lead_id uuid, p_actor_user_id uuid, p_action text) TO service_role;


--
-- Name: FUNCTION copy_default_dre_groups(org_id uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.copy_default_dre_groups(org_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.copy_default_dre_groups(org_id uuid) TO anon;
GRANT ALL ON FUNCTION public.copy_default_dre_groups(org_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.copy_default_dre_groups(org_id uuid) TO service_role;


--
-- Name: FUNCTION count_unique_sessions(p_organization_id uuid, p_date_from timestamp with time zone, p_date_to timestamp with time zone); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.count_unique_sessions(p_organization_id uuid, p_date_from timestamp with time zone, p_date_to timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.count_unique_sessions(p_organization_id uuid, p_date_from timestamp with time zone, p_date_to timestamp with time zone) TO anon;
GRANT ALL ON FUNCTION public.count_unique_sessions(p_organization_id uuid, p_date_from timestamp with time zone, p_date_to timestamp with time zone) TO authenticated;
GRANT ALL ON FUNCTION public.count_unique_sessions(p_organization_id uuid, p_date_from timestamp with time zone, p_date_to timestamp with time zone) TO service_role;


--
-- Name: FUNCTION create_commission_on_won(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.create_commission_on_won() FROM PUBLIC;
GRANT ALL ON FUNCTION public.create_commission_on_won() TO anon;
GRANT ALL ON FUNCTION public.create_commission_on_won() TO authenticated;
GRANT ALL ON FUNCTION public.create_commission_on_won() TO service_role;


--
-- Name: FUNCTION create_default_stages_for_pipeline(p_pipeline_id uuid, p_org_id uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.create_default_stages_for_pipeline(p_pipeline_id uuid, p_org_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.create_default_stages_for_pipeline(p_pipeline_id uuid, p_org_id uuid) TO service_role;


--
-- Name: FUNCTION create_initial_entry_event(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.create_initial_entry_event() FROM PUBLIC;
GRANT ALL ON FUNCTION public.create_initial_entry_event() TO anon;
GRANT ALL ON FUNCTION public.create_initial_entry_event() TO authenticated;
GRANT ALL ON FUNCTION public.create_initial_entry_event() TO service_role;


--
-- Name: FUNCTION create_notification(p_user_id uuid, p_organization_id uuid, p_title text, p_content text, p_type text, p_lead_id uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.create_notification(p_user_id uuid, p_organization_id uuid, p_title text, p_content text, p_type text, p_lead_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.create_notification(p_user_id uuid, p_organization_id uuid, p_title text, p_content text, p_type text, p_lead_id uuid) TO service_role;


--
-- Name: FUNCTION defer_automation_stage_command(p_organization_id uuid, p_execution_id uuid, p_step_id uuid, p_node_key text, p_lease_token text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.defer_automation_stage_command(p_organization_id uuid, p_execution_id uuid, p_step_id uuid, p_node_key text, p_lease_token text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.defer_automation_stage_command(p_organization_id uuid, p_execution_id uuid, p_step_id uuid, p_node_key text, p_lease_token text) TO service_role;


--
-- Name: FUNCTION distribute_lead_from_backend(p_organization_id uuid, p_lead_id uuid, p_idempotency_key text, p_round_robin_id uuid, p_preserve_assignee boolean, p_source text, p_now timestamp with time zone); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.distribute_lead_from_backend(p_organization_id uuid, p_lead_id uuid, p_idempotency_key text, p_round_robin_id uuid, p_preserve_assignee boolean, p_source text, p_now timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.distribute_lead_from_backend(p_organization_id uuid, p_lead_id uuid, p_idempotency_key text, p_round_robin_id uuid, p_preserve_assignee boolean, p_source text, p_now timestamp with time zone) TO service_role;


--
-- Name: FUNCTION enforce_whatsapp_message_session_match(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.enforce_whatsapp_message_session_match() FROM PUBLIC;
GRANT ALL ON FUNCTION public.enforce_whatsapp_message_session_match() TO anon;
GRANT ALL ON FUNCTION public.enforce_whatsapp_message_session_match() TO authenticated;
GRANT ALL ON FUNCTION public.enforce_whatsapp_message_session_match() TO service_role;


--
-- Name: FUNCTION enforce_whatsapp_outbox_session_match(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.enforce_whatsapp_outbox_session_match() FROM PUBLIC;
GRANT ALL ON FUNCTION public.enforce_whatsapp_outbox_session_match() TO service_role;


--
-- Name: FUNCTION enqueue_automation_whatsapp_outbox(p_organization_id uuid, p_execution_id uuid, p_node_key text, p_lease_token text, p_effect_key text, p_conversation_id uuid, p_session_id uuid, p_client_message_id text, p_message_type text, p_content text, p_media_mime_type text, p_media_storage_path text, p_media_size bigint, p_filename text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.enqueue_automation_whatsapp_outbox(p_organization_id uuid, p_execution_id uuid, p_node_key text, p_lease_token text, p_effect_key text, p_conversation_id uuid, p_session_id uuid, p_client_message_id text, p_message_type text, p_content text, p_media_mime_type text, p_media_storage_path text, p_media_size bigint, p_filename text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.enqueue_automation_whatsapp_outbox(p_organization_id uuid, p_execution_id uuid, p_node_key text, p_lease_token text, p_effect_key text, p_conversation_id uuid, p_session_id uuid, p_client_message_id text, p_message_type text, p_content text, p_media_mime_type text, p_media_storage_path text, p_media_size bigint, p_filename text) TO service_role;


--
-- Name: FUNCTION enqueue_due_automation_inactivity(p_batch_size integer); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.enqueue_due_automation_inactivity(p_batch_size integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.enqueue_due_automation_inactivity(p_batch_size integer) TO service_role;


--
-- Name: FUNCTION enqueue_due_automation_schedules(p_batch_size integer); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.enqueue_due_automation_schedules(p_batch_size integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.enqueue_due_automation_schedules(p_batch_size integer) TO service_role;


--
-- Name: FUNCTION enqueue_managed_whatsapp_distribution_auto_reply(p_organization_id uuid, p_entry_event_id uuid, p_assigned_user_id uuid, p_distribution_event_id text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.enqueue_managed_whatsapp_distribution_auto_reply(p_organization_id uuid, p_entry_event_id uuid, p_assigned_user_id uuid, p_distribution_event_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.enqueue_managed_whatsapp_distribution_auto_reply(p_organization_id uuid, p_entry_event_id uuid, p_assigned_user_id uuid, p_distribution_event_id text) TO service_role;


--
-- Name: FUNCTION enrich_whatsapp_lead_entry_attribution(p_organization_id uuid, p_lead_id uuid, p_session_id uuid, p_provider_message_id text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.enrich_whatsapp_lead_entry_attribution(p_organization_id uuid, p_lead_id uuid, p_session_id uuid, p_provider_message_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.enrich_whatsapp_lead_entry_attribution(p_organization_id uuid, p_lead_id uuid, p_session_id uuid, p_provider_message_id text) TO service_role;


--
-- Name: FUNCTION ensure_billing_payment_checkout_capability(p_payment_id uuid, p_organization_id uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.ensure_billing_payment_checkout_capability(p_payment_id uuid, p_organization_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.ensure_billing_payment_checkout_capability(p_payment_id uuid, p_organization_id uuid) TO service_role;


--
-- Name: FUNCTION ensure_lead_has_pipeline(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.ensure_lead_has_pipeline() FROM PUBLIC;
GRANT ALL ON FUNCTION public.ensure_lead_has_pipeline() TO anon;
GRANT ALL ON FUNCTION public.ensure_lead_has_pipeline() TO authenticated;
GRANT ALL ON FUNCTION public.ensure_lead_has_pipeline() TO service_role;


--
-- Name: FUNCTION ensure_organization_membership(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.ensure_organization_membership() FROM PUBLIC;
GRANT ALL ON FUNCTION public.ensure_organization_membership() TO anon;
GRANT ALL ON FUNCTION public.ensure_organization_membership() TO authenticated;
GRANT ALL ON FUNCTION public.ensure_organization_membership() TO service_role;


--
-- Name: FUNCTION ensure_single_notification_session(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.ensure_single_notification_session() FROM PUBLIC;
GRANT ALL ON FUNCTION public.ensure_single_notification_session() TO anon;
GRANT ALL ON FUNCTION public.ensure_single_notification_session() TO authenticated;
GRANT ALL ON FUNCTION public.ensure_single_notification_session() TO service_role;


--
-- Name: FUNCTION enter_automation_delay_wait(p_organization_id uuid, p_execution_id uuid, p_step_id uuid, p_node_key text, p_lease_token text, p_next_execution_at timestamp with time zone); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.enter_automation_delay_wait(p_organization_id uuid, p_execution_id uuid, p_step_id uuid, p_node_key text, p_lease_token text, p_next_execution_at timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.enter_automation_delay_wait(p_organization_id uuid, p_execution_id uuid, p_step_id uuid, p_node_key text, p_lease_token text, p_next_execution_at timestamp with time zone) TO anon;
GRANT ALL ON FUNCTION public.enter_automation_delay_wait(p_organization_id uuid, p_execution_id uuid, p_step_id uuid, p_node_key text, p_lease_token text, p_next_execution_at timestamp with time zone) TO authenticated;
GRANT ALL ON FUNCTION public.enter_automation_delay_wait(p_organization_id uuid, p_execution_id uuid, p_step_id uuid, p_node_key text, p_lease_token text, p_next_execution_at timestamp with time zone) TO service_role;


--
-- Name: FUNCTION evolution_go_reconcile_notification_receipt(p_organization_id uuid, p_session_id uuid, p_provider_message_id text, p_status text, p_occurred_at timestamp with time zone); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.evolution_go_reconcile_notification_receipt(p_organization_id uuid, p_session_id uuid, p_provider_message_id text, p_status text, p_occurred_at timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.evolution_go_reconcile_notification_receipt(p_organization_id uuid, p_session_id uuid, p_provider_message_id text, p_status text, p_occurred_at timestamp with time zone) TO service_role;


--
-- Name: FUNCTION execute_stage_automations(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.execute_stage_automations() FROM PUBLIC;
GRANT ALL ON FUNCTION public.execute_stage_automations() TO service_role;


--
-- Name: FUNCTION execute_stage_operational_actions(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.execute_stage_operational_actions() TO anon;
GRANT ALL ON FUNCTION public.execute_stage_operational_actions() TO authenticated;
GRANT ALL ON FUNCTION public.execute_stage_operational_actions() TO service_role;


--
-- Name: FUNCTION fail_automation_event(p_event_id uuid, p_worker_id text, p_error text, p_retry_seconds integer); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.fail_automation_event(p_event_id uuid, p_worker_id text, p_error text, p_retry_seconds integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.fail_automation_event(p_event_id uuid, p_worker_id text, p_error text, p_retry_seconds integer) TO anon;
GRANT ALL ON FUNCTION public.fail_automation_event(p_event_id uuid, p_worker_id text, p_error text, p_retry_seconds integer) TO authenticated;
GRANT ALL ON FUNCTION public.fail_automation_event(p_event_id uuid, p_worker_id text, p_error text, p_retry_seconds integer) TO service_role;


--
-- Name: FUNCTION fail_billing_card_recurrence(p_payment_id uuid, p_provider_payment_id text, p_lease_id uuid, p_error text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.fail_billing_card_recurrence(p_payment_id uuid, p_provider_payment_id text, p_lease_id uuid, p_error text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.fail_billing_card_recurrence(p_payment_id uuid, p_provider_payment_id text, p_lease_id uuid, p_error text) TO service_role;


--
-- Name: FUNCTION fail_billing_card_recurrence_job(p_payment_id uuid, p_worker_id text, p_job_lease_id uuid, p_failure_class text, p_error_code text, p_retry_after_seconds integer); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.fail_billing_card_recurrence_job(p_payment_id uuid, p_worker_id text, p_job_lease_id uuid, p_failure_class text, p_error_code text, p_retry_after_seconds integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.fail_billing_card_recurrence_job(p_payment_id uuid, p_worker_id text, p_job_lease_id uuid, p_failure_class text, p_error_code text, p_retry_after_seconds integer) TO service_role;


--
-- Name: FUNCTION fail_billing_checkout_intent(p_intent_id uuid, p_error text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.fail_billing_checkout_intent(p_intent_id uuid, p_error text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.fail_billing_checkout_intent(p_intent_id uuid, p_error text) TO service_role;


--
-- Name: FUNCTION fail_billing_payment_checkout_cancellation(p_organization_id uuid, p_intent_id uuid, p_claim_token uuid, p_failure_class text, p_error_code text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.fail_billing_payment_checkout_cancellation(p_organization_id uuid, p_intent_id uuid, p_claim_token uuid, p_failure_class text, p_error_code text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.fail_billing_payment_checkout_cancellation(p_organization_id uuid, p_intent_id uuid, p_claim_token uuid, p_failure_class text, p_error_code text) TO service_role;


--
-- Name: FUNCTION fail_billing_subscription_card_update_capture(p_job_id uuid, p_organization_id uuid, p_generation bigint, p_attempt_lease_id uuid, p_error_code text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.fail_billing_subscription_card_update_capture(p_job_id uuid, p_organization_id uuid, p_generation bigint, p_attempt_lease_id uuid, p_error_code text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.fail_billing_subscription_card_update_capture(p_job_id uuid, p_organization_id uuid, p_generation bigint, p_attempt_lease_id uuid, p_error_code text) TO service_role;


--
-- Name: FUNCTION fail_billing_subscription_card_update_job(p_job_id uuid, p_organization_id uuid, p_generation bigint, p_job_lease_id uuid, p_failure_class text, p_error_code text, p_retry_after_seconds integer); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.fail_billing_subscription_card_update_job(p_job_id uuid, p_organization_id uuid, p_generation bigint, p_job_lease_id uuid, p_failure_class text, p_error_code text, p_retry_after_seconds integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.fail_billing_subscription_card_update_job(p_job_id uuid, p_organization_id uuid, p_generation bigint, p_job_lease_id uuid, p_failure_class text, p_error_code text, p_retry_after_seconds integer) TO service_role;


--
-- Name: FUNCTION fail_billing_subscription_checkout_cancellation(p_organization_id uuid, p_intent_id uuid, p_claim_token uuid, p_failure_class text, p_error_code text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.fail_billing_subscription_checkout_cancellation(p_organization_id uuid, p_intent_id uuid, p_claim_token uuid, p_failure_class text, p_error_code text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.fail_billing_subscription_checkout_cancellation(p_organization_id uuid, p_intent_id uuid, p_claim_token uuid, p_failure_class text, p_error_code text) TO service_role;


--
-- Name: FUNCTION fail_prepared_billing_card_recurrence(p_payment_id uuid, p_provider_payment_id text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.fail_prepared_billing_card_recurrence(p_payment_id uuid, p_provider_payment_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.fail_prepared_billing_card_recurrence(p_payment_id uuid, p_provider_payment_id text) TO service_role;


--
-- Name: FUNCTION finalize_billing_organization_asaas_cleanup(p_organization_id uuid, p_claim_token uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.finalize_billing_organization_asaas_cleanup(p_organization_id uuid, p_claim_token uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.finalize_billing_organization_asaas_cleanup(p_organization_id uuid, p_claim_token uuid) TO service_role;


--
-- Name: FUNCTION finalize_billing_payment_checkout_cancellation(p_organization_id uuid, p_intent_id uuid, p_claim_token uuid, p_provider_payment_id text, p_provider_delete_result text, p_provider_deleted_at timestamp with time zone); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.finalize_billing_payment_checkout_cancellation(p_organization_id uuid, p_intent_id uuid, p_claim_token uuid, p_provider_payment_id text, p_provider_delete_result text, p_provider_deleted_at timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.finalize_billing_payment_checkout_cancellation(p_organization_id uuid, p_intent_id uuid, p_claim_token uuid, p_provider_payment_id text, p_provider_delete_result text, p_provider_deleted_at timestamp with time zone) TO service_role;


--
-- Name: FUNCTION finalize_billing_subscription_checkout_cancellation(p_organization_id uuid, p_intent_id uuid, p_claim_token uuid, p_subscription_id text, p_provider_deleted_at timestamp with time zone); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.finalize_billing_subscription_checkout_cancellation(p_organization_id uuid, p_intent_id uuid, p_claim_token uuid, p_subscription_id text, p_provider_deleted_at timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.finalize_billing_subscription_checkout_cancellation(p_organization_id uuid, p_intent_id uuid, p_claim_token uuid, p_subscription_id text, p_provider_deleted_at timestamp with time zone) TO service_role;


--
-- Name: FUNCTION find_duplicate_lead_by_phone(p_phone text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.find_duplicate_lead_by_phone(p_phone text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.find_duplicate_lead_by_phone(p_phone text) TO anon;
GRANT ALL ON FUNCTION public.find_duplicate_lead_by_phone(p_phone text) TO authenticated;
GRANT ALL ON FUNCTION public.find_duplicate_lead_by_phone(p_phone text) TO service_role;


--
-- Name: FUNCTION find_lead_by_normalized_phone(p_organization_id uuid, p_phone text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.find_lead_by_normalized_phone(p_organization_id uuid, p_phone text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.find_lead_by_normalized_phone(p_organization_id uuid, p_phone text) TO service_role;


--
-- Name: FUNCTION find_lead_by_normalized_phone(p_organization_id uuid, p_phone text, p_origin_round_robin_id uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.find_lead_by_normalized_phone(p_organization_id uuid, p_phone text, p_origin_round_robin_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.find_lead_by_normalized_phone(p_organization_id uuid, p_phone text, p_origin_round_robin_id uuid) TO service_role;


--
-- Name: FUNCTION find_orphan_rr_members(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.find_orphan_rr_members() FROM PUBLIC;
GRANT ALL ON FUNCTION public.find_orphan_rr_members() TO service_role;


--
-- Name: FUNCTION find_orphan_team_members(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.find_orphan_team_members() FROM PUBLIC;
GRANT ALL ON FUNCTION public.find_orphan_team_members() TO service_role;


--
-- Name: FUNCTION finish_automation_external_effect(p_effect_key text, p_status text, p_response jsonb, p_provider_id text, p_error text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.finish_automation_external_effect(p_effect_key text, p_status text, p_response jsonb, p_provider_id text, p_error text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.finish_automation_external_effect(p_effect_key text, p_status text, p_response jsonb, p_provider_id text, p_error text) TO anon;
GRANT ALL ON FUNCTION public.finish_automation_external_effect(p_effect_key text, p_status text, p_response jsonb, p_provider_id text, p_error text) TO authenticated;
GRANT ALL ON FUNCTION public.finish_automation_external_effect(p_effect_key text, p_status text, p_response jsonb, p_provider_id text, p_error text) TO service_role;


--
-- Name: FUNCTION finish_whatsapp_webhook_edge_execution(p_organization_id uuid, p_session_id uuid, p_inbox_id uuid, p_execution_id uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.finish_whatsapp_webhook_edge_execution(p_organization_id uuid, p_session_id uuid, p_inbox_id uuid, p_execution_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.finish_whatsapp_webhook_edge_execution(p_organization_id uuid, p_session_id uuid, p_inbox_id uuid, p_execution_id uuid) TO service_role;


--
-- Name: FUNCTION fn_update_construction_financial_progress(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.fn_update_construction_financial_progress() TO anon;
GRANT ALL ON FUNCTION public.fn_update_construction_financial_progress() TO authenticated;
GRANT ALL ON FUNCTION public.fn_update_construction_financial_progress() TO service_role;


--
-- Name: FUNCTION fn_update_construction_project_progress(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.fn_update_construction_project_progress() TO anon;
GRANT ALL ON FUNCTION public.fn_update_construction_project_progress() TO authenticated;
GRANT ALL ON FUNCTION public.fn_update_construction_project_progress() TO service_role;


--
-- Name: FUNCTION gamification_level_for_xp(p_xp integer); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.gamification_level_for_xp(p_xp integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.gamification_level_for_xp(p_xp integer) TO anon;
GRANT ALL ON FUNCTION public.gamification_level_for_xp(p_xp integer) TO authenticated;
GRANT ALL ON FUNCTION public.gamification_level_for_xp(p_xp integer) TO service_role;


--
-- Name: FUNCTION gamification_rank_tier(p_level integer); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.gamification_rank_tier(p_level integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.gamification_rank_tier(p_level integer) TO anon;
GRANT ALL ON FUNCTION public.gamification_rank_tier(p_level integer) TO authenticated;
GRANT ALL ON FUNCTION public.gamification_rank_tier(p_level integer) TO service_role;


--
-- Name: FUNCTION gamification_xp_for_level(p_level integer); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.gamification_xp_for_level(p_level integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.gamification_xp_for_level(p_level integer) TO anon;
GRANT ALL ON FUNCTION public.gamification_xp_for_level(p_level integer) TO authenticated;
GRANT ALL ON FUNCTION public.gamification_xp_for_level(p_level integer) TO service_role;


--
-- Name: FUNCTION generate_commissions_for_contract(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.generate_commissions_for_contract() FROM PUBLIC;
GRANT ALL ON FUNCTION public.generate_commissions_for_contract() TO anon;
GRANT ALL ON FUNCTION public.generate_commissions_for_contract() TO authenticated;
GRANT ALL ON FUNCTION public.generate_commissions_for_contract() TO service_role;


--
-- Name: FUNCTION generate_organization_api_key(p_name text, p_organization_id uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.generate_organization_api_key(p_name text, p_organization_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.generate_organization_api_key(p_name text, p_organization_id uuid) TO anon;
GRANT ALL ON FUNCTION public.generate_organization_api_key(p_name text, p_organization_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.generate_organization_api_key(p_name text, p_organization_id uuid) TO service_role;


--
-- Name: FUNCTION get_billing_card_recurrence_reversal_target(p_provider_payment_id text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.get_billing_card_recurrence_reversal_target(p_provider_payment_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_billing_card_recurrence_reversal_target(p_provider_payment_id text) TO service_role;


--
-- Name: FUNCTION get_billing_checkout_state(p_organization_id uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.get_billing_checkout_state(p_organization_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_billing_checkout_state(p_organization_id uuid) TO service_role;


--
-- Name: FUNCTION get_billing_subscription_card_update_status(p_job_id uuid, p_organization_id uuid, p_expected_payment_id uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.get_billing_subscription_card_update_status(p_job_id uuid, p_organization_id uuid, p_expected_payment_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_billing_subscription_card_update_status(p_job_id uuid, p_organization_id uuid, p_expected_payment_id uuid) TO service_role;


--
-- Name: FUNCTION get_dashboard_stats(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.get_dashboard_stats() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_dashboard_stats() TO service_role;


--
-- Name: FUNCTION get_dashboard_team_lead_ids(p_team_id uuid, p_date_from timestamp with time zone, p_date_to timestamp with time zone); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.get_dashboard_team_lead_ids(p_team_id uuid, p_date_from timestamp with time zone, p_date_to timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_dashboard_team_lead_ids(p_team_id uuid, p_date_from timestamp with time zone, p_date_to timestamp with time zone) TO service_role;


--
-- Name: FUNCTION get_funnel_data(p_date_from timestamp with time zone, p_date_to timestamp with time zone, p_team_id uuid, p_user_id uuid, p_source text, p_pipeline_id uuid, p_tag_id uuid, p_deal_status text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.get_funnel_data(p_date_from timestamp with time zone, p_date_to timestamp with time zone, p_team_id uuid, p_user_id uuid, p_source text, p_pipeline_id uuid, p_tag_id uuid, p_deal_status text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_funnel_data(p_date_from timestamp with time zone, p_date_to timestamp with time zone, p_team_id uuid, p_user_id uuid, p_source text, p_pipeline_id uuid, p_tag_id uuid, p_deal_status text) TO service_role;


--
-- Name: FUNCTION get_gamification_points(p_org_id uuid, p_action_type text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.get_gamification_points(p_org_id uuid, p_action_type text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_gamification_points(p_org_id uuid, p_action_type text) TO anon;
GRANT ALL ON FUNCTION public.get_gamification_points(p_org_id uuid, p_action_type text) TO authenticated;
GRANT ALL ON FUNCTION public.get_gamification_points(p_org_id uuid, p_action_type text) TO service_role;


--
-- Name: FUNCTION get_lead_sources_data(p_date_from timestamp with time zone, p_date_to timestamp with time zone, p_team_id uuid, p_user_id uuid, p_source text, p_pipeline_id uuid, p_tag_id uuid, p_deal_status text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.get_lead_sources_data(p_date_from timestamp with time zone, p_date_to timestamp with time zone, p_team_id uuid, p_user_id uuid, p_source text, p_pipeline_id uuid, p_tag_id uuid, p_deal_status text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_lead_sources_data(p_date_from timestamp with time zone, p_date_to timestamp with time zone, p_team_id uuid, p_user_id uuid, p_source text, p_pipeline_id uuid, p_tag_id uuid, p_deal_status text) TO service_role;


--
-- Name: FUNCTION get_my_org_id(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.get_my_org_id() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_my_org_id() TO anon;
GRANT ALL ON FUNCTION public.get_my_org_id() TO authenticated;
GRANT ALL ON FUNCTION public.get_my_org_id() TO service_role;


--
-- Name: FUNCTION get_or_create_active_season(p_org_id uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.get_or_create_active_season(p_org_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_or_create_active_season(p_org_id uuid) TO anon;
GRANT ALL ON FUNCTION public.get_or_create_active_season(p_org_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.get_or_create_active_season(p_org_id uuid) TO service_role;


--
-- Name: FUNCTION get_schedule_events_secure(p_user_id uuid, p_lead_id uuid, p_start_time timestamp with time zone, p_end_time timestamp with time zone); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.get_schedule_events_secure(p_user_id uuid, p_lead_id uuid, p_start_time timestamp with time zone, p_end_time timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_schedule_events_secure(p_user_id uuid, p_lead_id uuid, p_start_time timestamp with time zone, p_end_time timestamp with time zone) TO service_role;


--
-- Name: FUNCTION get_session_owner(p_session_id uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.get_session_owner(p_session_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_session_owner(p_session_id uuid) TO anon;
GRANT ALL ON FUNCTION public.get_session_owner(p_session_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.get_session_owner(p_session_id uuid) TO service_role;


--
-- Name: FUNCTION get_sla_pending_leads(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.get_sla_pending_leads() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_sla_pending_leads() TO anon;
GRANT ALL ON FUNCTION public.get_sla_pending_leads() TO authenticated;
GRANT ALL ON FUNCTION public.get_sla_pending_leads() TO service_role;


--
-- Name: FUNCTION get_sla_start_at(p_lead_id uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.get_sla_start_at(p_lead_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_sla_start_at(p_lead_id uuid) TO anon;
GRANT ALL ON FUNCTION public.get_sla_start_at(p_lead_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.get_sla_start_at(p_lead_id uuid) TO service_role;


--
-- Name: FUNCTION get_team_member_ids(p_team_id uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.get_team_member_ids(p_team_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_team_member_ids(p_team_id uuid) TO service_role;


--
-- Name: FUNCTION get_user_led_pipeline_ids(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.get_user_led_pipeline_ids() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_user_led_pipeline_ids() TO anon;
GRANT ALL ON FUNCTION public.get_user_led_pipeline_ids() TO authenticated;
GRANT ALL ON FUNCTION public.get_user_led_pipeline_ids() TO service_role;


--
-- Name: FUNCTION get_user_led_team_ids(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.get_user_led_team_ids() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_user_led_team_ids() TO anon;
GRANT ALL ON FUNCTION public.get_user_led_team_ids() TO authenticated;
GRANT ALL ON FUNCTION public.get_user_led_team_ids() TO service_role;


--
-- Name: FUNCTION get_user_organization_id(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.get_user_organization_id() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_user_organization_id() TO anon;
GRANT ALL ON FUNCTION public.get_user_organization_id() TO authenticated;
GRANT ALL ON FUNCTION public.get_user_organization_id() TO service_role;


--
-- Name: FUNCTION get_user_organization_role(p_user_id uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.get_user_organization_role(p_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_user_organization_role(p_user_id uuid) TO anon;
GRANT ALL ON FUNCTION public.get_user_organization_role(p_user_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.get_user_organization_role(p_user_id uuid) TO service_role;


--
-- Name: FUNCTION get_user_team_ids(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.get_user_team_ids() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_user_team_ids() TO anon;
GRANT ALL ON FUNCTION public.get_user_team_ids() TO authenticated;
GRANT ALL ON FUNCTION public.get_user_team_ids() TO service_role;


--
-- Name: FUNCTION google_calendar_abort_disconnect(p_connection_id uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.google_calendar_abort_disconnect(p_connection_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.google_calendar_abort_disconnect(p_connection_id uuid) TO service_role;


--
-- Name: FUNCTION google_calendar_activate_oauth_connection(p_connection_id uuid, p_organization_id uuid, p_user_id uuid, p_expected_revision bigint, p_account_email text, p_account_picture_url text, p_token jsonb); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.google_calendar_activate_oauth_connection(p_connection_id uuid, p_organization_id uuid, p_user_id uuid, p_expected_revision bigint, p_account_email text, p_account_picture_url text, p_token jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.google_calendar_activate_oauth_connection(p_connection_id uuid, p_organization_id uuid, p_user_id uuid, p_expected_revision bigint, p_account_email text, p_account_picture_url text, p_token jsonb) TO service_role;


--
-- Name: FUNCTION google_calendar_begin_disconnect(p_connection_id uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.google_calendar_begin_disconnect(p_connection_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.google_calendar_begin_disconnect(p_connection_id uuid) TO service_role;


--
-- Name: TABLE google_calendar_sync_jobs; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.google_calendar_sync_jobs TO service_role;


--
-- Name: FUNCTION google_calendar_claim_outbound_sync_jobs(p_limit integer, p_worker text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.google_calendar_claim_outbound_sync_jobs(p_limit integer, p_worker text) FROM PUBLIC;


--
-- Name: FUNCTION google_calendar_claim_outbound_sync_jobs_v2(p_limit integer, p_worker text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.google_calendar_claim_outbound_sync_jobs_v2(p_limit integer, p_worker text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.google_calendar_claim_outbound_sync_jobs_v2(p_limit integer, p_worker text) TO service_role;


--
-- Name: FUNCTION google_calendar_claim_sync_jobs(p_limit integer, p_worker text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.google_calendar_claim_sync_jobs(p_limit integer, p_worker text) FROM PUBLIC;


--
-- Name: FUNCTION google_calendar_disconnect_connection(p_connection_id uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.google_calendar_disconnect_connection(p_connection_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.google_calendar_disconnect_connection(p_connection_id uuid) TO service_role;


--
-- Name: FUNCTION google_calendar_finish_outbound_job(p_job_id uuid, p_worker text, p_status text, p_error text, p_delay_seconds integer, p_consume_attempt boolean, p_is_conflict boolean); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.google_calendar_finish_outbound_job(p_job_id uuid, p_worker text, p_status text, p_error text, p_delay_seconds integer, p_consume_attempt boolean, p_is_conflict boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.google_calendar_finish_outbound_job(p_job_id uuid, p_worker text, p_status text, p_error text, p_delay_seconds integer, p_consume_attempt boolean, p_is_conflict boolean) TO service_role;


--
-- Name: FUNCTION google_calendar_get_authorized_event_lead(p_event_id uuid, p_organization_id uuid, p_owner_user_id uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.google_calendar_get_authorized_event_lead(p_event_id uuid, p_organization_id uuid, p_owner_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.google_calendar_get_authorized_event_lead(p_event_id uuid, p_organization_id uuid, p_owner_user_id uuid) TO service_role;


--
-- Name: FUNCTION google_calendar_get_token_secret(p_secret_ref uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.google_calendar_get_token_secret(p_secret_ref uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.google_calendar_get_token_secret(p_secret_ref uuid) TO service_role;


--
-- Name: FUNCTION google_calendar_job_heartbeat(p_job_id uuid, p_worker text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.google_calendar_job_heartbeat(p_job_id uuid, p_worker text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.google_calendar_job_heartbeat(p_job_id uuid, p_worker text) TO service_role;


--
-- Name: FUNCTION google_calendar_refresh_outbound_connection_status(p_connection_id uuid, p_organization_id uuid, p_owner_user_id uuid, p_synced_at timestamp with time zone); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.google_calendar_refresh_outbound_connection_status(p_connection_id uuid, p_organization_id uuid, p_owner_user_id uuid, p_synced_at timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.google_calendar_refresh_outbound_connection_status(p_connection_id uuid, p_organization_id uuid, p_owner_user_id uuid, p_synced_at timestamp with time zone) TO service_role;


--
-- Name: FUNCTION google_calendar_save_token_secret(p_existing_secret_ref uuid, p_secret text, p_name text, p_description text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.google_calendar_save_token_secret(p_existing_secret_ref uuid, p_secret text, p_name text, p_description text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.google_calendar_save_token_secret(p_existing_secret_ref uuid, p_secret text, p_name text, p_description text) TO service_role;


--
-- Name: FUNCTION google_calendar_store_refreshed_token(p_connection_id uuid, p_expected_revision bigint, p_expected_secret_ref uuid, p_token jsonb, p_allow_disconnecting boolean); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.google_calendar_store_refreshed_token(p_connection_id uuid, p_expected_revision bigint, p_expected_secret_ref uuid, p_token jsonb, p_allow_disconnecting boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.google_calendar_store_refreshed_token(p_connection_id uuid, p_expected_revision bigint, p_expected_secret_ref uuid, p_token jsonb, p_allow_disconnecting boolean) TO service_role;


--
-- Name: FUNCTION google_calendar_verify_cron_secret(p_secret text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.google_calendar_verify_cron_secret(p_secret text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.google_calendar_verify_cron_secret(p_secret text) TO service_role;


--
-- Name: FUNCTION handle_deal_status_change(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.handle_deal_status_change() TO anon;
GRANT ALL ON FUNCTION public.handle_deal_status_change() TO authenticated;
GRANT ALL ON FUNCTION public.handle_deal_status_change() TO service_role;


--
-- Name: FUNCTION handle_gamification_event(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.handle_gamification_event() FROM PUBLIC;
GRANT ALL ON FUNCTION public.handle_gamification_event() TO anon;
GRANT ALL ON FUNCTION public.handle_gamification_event() TO authenticated;
GRANT ALL ON FUNCTION public.handle_gamification_event() TO service_role;


--
-- Name: FUNCTION handle_lead_intake(p_lead_id uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.handle_lead_intake(p_lead_id uuid) FROM PUBLIC;


--
-- Name: FUNCTION handle_managed_whatsapp_message_lead(p_lead_id uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.handle_managed_whatsapp_message_lead(p_lead_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.handle_managed_whatsapp_message_lead(p_lead_id uuid) TO service_role;


--
-- Name: FUNCTION handle_new_auth_user(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.handle_new_auth_user() FROM PUBLIC;
GRANT ALL ON FUNCTION public.handle_new_auth_user() TO service_role;


--
-- Name: FUNCTION handle_new_user(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC;
GRANT ALL ON FUNCTION public.handle_new_user() TO anon;
GRANT ALL ON FUNCTION public.handle_new_user() TO authenticated;
GRANT ALL ON FUNCTION public.handle_new_user() TO service_role;


--
-- Name: FUNCTION handle_routed_lead_intake(p_lead_id uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.handle_routed_lead_intake(p_lead_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.handle_routed_lead_intake(p_lead_id uuid) TO service_role;


--
-- Name: FUNCTION handle_updated_at(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.handle_updated_at() TO anon;
GRANT ALL ON FUNCTION public.handle_updated_at() TO authenticated;
GRANT ALL ON FUNCTION public.handle_updated_at() TO service_role;


--
-- Name: FUNCTION has_whatsapp_session_ownership(p_session_id uuid, p_user_id uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.has_whatsapp_session_ownership(p_session_id uuid, p_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.has_whatsapp_session_ownership(p_session_id uuid, p_user_id uuid) TO anon;
GRANT ALL ON FUNCTION public.has_whatsapp_session_ownership(p_session_id uuid, p_user_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.has_whatsapp_session_ownership(p_session_id uuid, p_user_id uuid) TO service_role;


--
-- Name: FUNCTION hydrate_lead_entry_attribution(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.hydrate_lead_entry_attribution() FROM PUBLIC;
GRANT ALL ON FUNCTION public.hydrate_lead_entry_attribution() TO service_role;


--
-- Name: FUNCTION import_historical_lead_batch(p_organization_id uuid, p_actor_user_id uuid, p_batch jsonb); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.import_historical_lead_batch(p_organization_id uuid, p_actor_user_id uuid, p_batch jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.import_historical_lead_batch(p_organization_id uuid, p_actor_user_id uuid, p_batch jsonb) TO service_role;


--
-- Name: FUNCTION initialize_organization_financial_categories(p_org_id uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.initialize_organization_financial_categories(p_org_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.initialize_organization_financial_categories(p_org_id uuid) TO service_role;


--
-- Name: FUNCTION is_admin(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT ALL ON FUNCTION public.is_admin() TO anon;
GRANT ALL ON FUNCTION public.is_admin() TO authenticated;
GRANT ALL ON FUNCTION public.is_admin() TO service_role;


--
-- Name: FUNCTION is_member_available(p_user_id uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.is_member_available(p_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.is_member_available(p_user_id uuid) TO service_role;


--
-- Name: FUNCTION is_pipeline_in_led_team(p_pipeline_id uuid, p_user_id uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.is_pipeline_in_led_team(p_pipeline_id uuid, p_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.is_pipeline_in_led_team(p_pipeline_id uuid, p_user_id uuid) TO anon;
GRANT ALL ON FUNCTION public.is_pipeline_in_led_team(p_pipeline_id uuid, p_user_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.is_pipeline_in_led_team(p_pipeline_id uuid, p_user_id uuid) TO service_role;


--
-- Name: FUNCTION is_schedule_event_assignee(p_event_id uuid, p_user_id uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.is_schedule_event_assignee(p_event_id uuid, p_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.is_schedule_event_assignee(p_event_id uuid, p_user_id uuid) TO service_role;


--
-- Name: FUNCTION is_super_admin(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.is_super_admin() FROM PUBLIC;
GRANT ALL ON FUNCTION public.is_super_admin() TO anon;
GRANT ALL ON FUNCTION public.is_super_admin() TO authenticated;
GRANT ALL ON FUNCTION public.is_super_admin() TO service_role;


--
-- Name: FUNCTION is_super_admin_member_bypass(p_user_id uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.is_super_admin_member_bypass(p_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.is_super_admin_member_bypass(p_user_id uuid) TO anon;
GRANT ALL ON FUNCTION public.is_super_admin_member_bypass(p_user_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.is_super_admin_member_bypass(p_user_id uuid) TO service_role;


--
-- Name: FUNCTION is_team_leader(check_user_id uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.is_team_leader(check_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.is_team_leader(check_user_id uuid) TO anon;
GRANT ALL ON FUNCTION public.is_team_leader(check_user_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.is_team_leader(check_user_id uuid) TO service_role;


--
-- Name: FUNCTION is_user_available_for_distribution(p_user_id uuid, p_team_id uuid, p_current_day integer, p_current_time time without time zone); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.is_user_available_for_distribution(p_user_id uuid, p_team_id uuid, p_current_day integer, p_current_time time without time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.is_user_available_for_distribution(p_user_id uuid, p_team_id uuid, p_current_day integer, p_current_time time without time zone) TO service_role;


--
-- Name: FUNCTION is_user_in_led_team(p_target_user_id uuid, p_user_id uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.is_user_in_led_team(p_target_user_id uuid, p_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.is_user_in_led_team(p_target_user_id uuid, p_user_id uuid) TO anon;
GRANT ALL ON FUNCTION public.is_user_in_led_team(p_target_user_id uuid, p_user_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.is_user_in_led_team(p_target_user_id uuid, p_user_id uuid) TO service_role;


--
-- Name: FUNCTION is_user_leader_of_team(p_team_id uuid, p_user_id uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.is_user_leader_of_team(p_team_id uuid, p_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.is_user_leader_of_team(p_team_id uuid, p_user_id uuid) TO anon;
GRANT ALL ON FUNCTION public.is_user_leader_of_team(p_team_id uuid, p_user_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.is_user_leader_of_team(p_team_id uuid, p_user_id uuid) TO service_role;


--
-- Name: FUNCTION list_all_organizations_admin(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.list_all_organizations_admin() FROM PUBLIC;
GRANT ALL ON FUNCTION public.list_all_organizations_admin() TO anon;
GRANT ALL ON FUNCTION public.list_all_organizations_admin() TO authenticated;
GRANT ALL ON FUNCTION public.list_all_organizations_admin() TO service_role;


--
-- Name: FUNCTION list_all_users_admin(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.list_all_users_admin() FROM PUBLIC;
GRANT ALL ON FUNCTION public.list_all_users_admin() TO anon;
GRANT ALL ON FUNCTION public.list_all_users_admin() TO authenticated;
GRANT ALL ON FUNCTION public.list_all_users_admin() TO service_role;


--
-- Name: FUNCTION list_contacts_paginated(p_search text, p_team_id uuid, p_pipeline_id uuid, p_stage_id uuid, p_assignee_id uuid, p_unassigned boolean, p_tag_id uuid, p_source text, p_deal_status text, p_created_from text, p_created_to text, p_sort_by text, p_sort_dir text, p_page integer, p_limit integer, p_campaign_id text, p_adset_id text, p_ad_id text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.list_contacts_paginated(p_search text, p_team_id uuid, p_pipeline_id uuid, p_stage_id uuid, p_assignee_id uuid, p_unassigned boolean, p_tag_id uuid, p_source text, p_deal_status text, p_created_from text, p_created_to text, p_sort_by text, p_sort_dir text, p_page integer, p_limit integer, p_campaign_id text, p_adset_id text, p_ad_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.list_contacts_paginated(p_search text, p_team_id uuid, p_pipeline_id uuid, p_stage_id uuid, p_assignee_id uuid, p_unassigned boolean, p_tag_id uuid, p_source text, p_deal_status text, p_created_from text, p_created_to text, p_sort_by text, p_sort_dir text, p_page integer, p_limit integer, p_campaign_id text, p_adset_id text, p_ad_id text) TO service_role;


--
-- Name: FUNCTION log_commission_lead_activity(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.log_commission_lead_activity() FROM PUBLIC;
GRANT ALL ON FUNCTION public.log_commission_lead_activity() TO anon;
GRANT ALL ON FUNCTION public.log_commission_lead_activity() TO authenticated;
GRANT ALL ON FUNCTION public.log_commission_lead_activity() TO service_role;


--
-- Name: FUNCTION log_commission_status_change(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.log_commission_status_change() FROM PUBLIC;
GRANT ALL ON FUNCTION public.log_commission_status_change() TO anon;
GRANT ALL ON FUNCTION public.log_commission_status_change() TO authenticated;
GRANT ALL ON FUNCTION public.log_commission_status_change() TO service_role;


--
-- Name: FUNCTION log_lead_activity(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.log_lead_activity() FROM PUBLIC;
GRANT ALL ON FUNCTION public.log_lead_activity() TO anon;
GRANT ALL ON FUNCTION public.log_lead_activity() TO authenticated;
GRANT ALL ON FUNCTION public.log_lead_activity() TO service_role;


--
-- Name: FUNCTION log_platform_event_org_created(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.log_platform_event_org_created() FROM PUBLIC;
GRANT ALL ON FUNCTION public.log_platform_event_org_created() TO anon;
GRANT ALL ON FUNCTION public.log_platform_event_org_created() TO authenticated;
GRANT ALL ON FUNCTION public.log_platform_event_org_created() TO service_role;


--
-- Name: FUNCTION log_platform_event_payment(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.log_platform_event_payment() FROM PUBLIC;
GRANT ALL ON FUNCTION public.log_platform_event_payment() TO anon;
GRANT ALL ON FUNCTION public.log_platform_event_payment() TO authenticated;
GRANT ALL ON FUNCTION public.log_platform_event_payment() TO service_role;


--
-- Name: FUNCTION lookup_managed_whatsapp_lead_entry(p_organization_id uuid, p_session_id uuid, p_provider_message_id text, p_message text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.lookup_managed_whatsapp_lead_entry(p_organization_id uuid, p_session_id uuid, p_provider_message_id text, p_message text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.lookup_managed_whatsapp_lead_entry(p_organization_id uuid, p_session_id uuid, p_provider_message_id text, p_message text) TO service_role;


--
-- Name: FUNCTION mark_billing_card_capture_request_started(p_payment_id uuid, p_provider_payment_id text, p_attempt_lease_id uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.mark_billing_card_capture_request_started(p_payment_id uuid, p_provider_payment_id text, p_attempt_lease_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.mark_billing_card_capture_request_started(p_payment_id uuid, p_provider_payment_id text, p_attempt_lease_id uuid) TO service_role;


--
-- Name: FUNCTION mark_billing_card_recurrence_provider_request_started(p_payment_id uuid, p_worker_id text, p_job_lease_id uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.mark_billing_card_recurrence_provider_request_started(p_payment_id uuid, p_worker_id text, p_job_lease_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.mark_billing_card_recurrence_provider_request_started(p_payment_id uuid, p_worker_id text, p_job_lease_id uuid) TO service_role;


--
-- Name: FUNCTION mark_billing_card_recurrence_recovering(p_payment_id uuid, p_provider_payment_id text, p_lease_id uuid, p_error text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.mark_billing_card_recurrence_recovering(p_payment_id uuid, p_provider_payment_id text, p_lease_id uuid, p_error text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.mark_billing_card_recurrence_recovering(p_payment_id uuid, p_provider_payment_id text, p_lease_id uuid, p_error text) TO service_role;


--
-- Name: FUNCTION mark_billing_payment_checkout_cancellation_delete_started(p_organization_id uuid, p_intent_id uuid, p_claim_token uuid, p_provider_payment_id text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.mark_billing_payment_checkout_cancellation_delete_started(p_organization_id uuid, p_intent_id uuid, p_claim_token uuid, p_provider_payment_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.mark_billing_payment_checkout_cancellation_delete_started(p_organization_id uuid, p_intent_id uuid, p_claim_token uuid, p_provider_payment_id text) TO service_role;


--
-- Name: FUNCTION mark_billing_subscription_card_update_capture_started(p_job_id uuid, p_organization_id uuid, p_generation bigint, p_attempt_lease_id uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.mark_billing_subscription_card_update_capture_started(p_job_id uuid, p_organization_id uuid, p_generation bigint, p_attempt_lease_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.mark_billing_subscription_card_update_capture_started(p_job_id uuid, p_organization_id uuid, p_generation bigint, p_attempt_lease_id uuid) TO service_role;


--
-- Name: FUNCTION mark_billing_subscription_card_update_provider_request_started(p_job_id uuid, p_organization_id uuid, p_generation bigint, p_job_lease_id uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.mark_billing_subscription_card_update_provider_request_started(p_job_id uuid, p_organization_id uuid, p_generation bigint, p_job_lease_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.mark_billing_subscription_card_update_provider_request_started(p_job_id uuid, p_organization_id uuid, p_generation bigint, p_job_lease_id uuid) TO service_role;


--
-- Name: FUNCTION mark_lead_owner_activity_for_redistribution(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.mark_lead_owner_activity_for_redistribution() FROM PUBLIC;
GRANT ALL ON FUNCTION public.mark_lead_owner_activity_for_redistribution() TO anon;
GRANT ALL ON FUNCTION public.mark_lead_owner_activity_for_redistribution() TO authenticated;
GRANT ALL ON FUNCTION public.mark_lead_owner_activity_for_redistribution() TO service_role;


--
-- Name: FUNCTION mark_overdue_financial_entries(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.mark_overdue_financial_entries() FROM PUBLIC;
GRANT ALL ON FUNCTION public.mark_overdue_financial_entries() TO anon;
GRANT ALL ON FUNCTION public.mark_overdue_financial_entries() TO authenticated;
GRANT ALL ON FUNCTION public.mark_overdue_financial_entries() TO service_role;


--
-- Name: TABLE leads; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.leads TO service_role;
GRANT SELECT ON TABLE public.leads TO authenticated;


--
-- Name: FUNCTION move_lead_stage(p_lead_id uuid, p_stage_id uuid, p_is_own_resource boolean); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.move_lead_stage(p_lead_id uuid, p_stage_id uuid, p_is_own_resource boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.move_lead_stage(p_lead_id uuid, p_stage_id uuid, p_is_own_resource boolean) TO service_role;


--
-- Name: FUNCTION move_lead_stage(p_lead_id uuid, p_stage_id uuid, p_is_own_resource boolean, p_stage_entered_at timestamp with time zone); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.move_lead_stage(p_lead_id uuid, p_stage_id uuid, p_is_own_resource boolean, p_stage_entered_at timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.move_lead_stage(p_lead_id uuid, p_stage_id uuid, p_is_own_resource boolean, p_stage_entered_at timestamp with time zone) TO service_role;


--
-- Name: FUNCTION normalize_phone(phone_input text); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.normalize_phone(phone_input text) TO anon;
GRANT ALL ON FUNCTION public.normalize_phone(phone_input text) TO authenticated;
GRANT ALL ON FUNCTION public.normalize_phone(phone_input text) TO service_role;


--
-- Name: FUNCTION notify_commission_pending(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.notify_commission_pending() FROM PUBLIC;
GRANT ALL ON FUNCTION public.notify_commission_pending() TO anon;
GRANT ALL ON FUNCTION public.notify_commission_pending() TO authenticated;
GRANT ALL ON FUNCTION public.notify_commission_pending() TO service_role;


--
-- Name: FUNCTION notify_feature_request_response(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.notify_feature_request_response() FROM PUBLIC;
GRANT ALL ON FUNCTION public.notify_feature_request_response() TO anon;
GRANT ALL ON FUNCTION public.notify_feature_request_response() TO authenticated;
GRANT ALL ON FUNCTION public.notify_feature_request_response() TO service_role;


--
-- Name: FUNCTION notify_financial_entries(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.notify_financial_entries() FROM PUBLIC;
GRANT ALL ON FUNCTION public.notify_financial_entries() TO anon;
GRANT ALL ON FUNCTION public.notify_financial_entries() TO authenticated;
GRANT ALL ON FUNCTION public.notify_financial_entries() TO service_role;


--
-- Name: FUNCTION notify_financial_overdue(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.notify_financial_overdue() FROM PUBLIC;
GRANT ALL ON FUNCTION public.notify_financial_overdue() TO anon;
GRANT ALL ON FUNCTION public.notify_financial_overdue() TO authenticated;
GRANT ALL ON FUNCTION public.notify_financial_overdue() TO service_role;


--
-- Name: FUNCTION notify_lead_first_assignment(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.notify_lead_first_assignment() FROM PUBLIC;
GRANT ALL ON FUNCTION public.notify_lead_first_assignment() TO anon;
GRANT ALL ON FUNCTION public.notify_lead_first_assignment() TO authenticated;
GRANT ALL ON FUNCTION public.notify_lead_first_assignment() TO service_role;


--
-- Name: FUNCTION notify_superadmins_onboarding_request(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.notify_superadmins_onboarding_request() FROM PUBLIC;
GRANT ALL ON FUNCTION public.notify_superadmins_onboarding_request() TO anon;
GRANT ALL ON FUNCTION public.notify_superadmins_onboarding_request() TO authenticated;
GRANT ALL ON FUNCTION public.notify_superadmins_onboarding_request() TO service_role;


--
-- Name: FUNCTION notify_whatsapp_on_lead(p_lead_name text, p_org_id uuid, p_source text, p_user_id uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.notify_whatsapp_on_lead(p_lead_name text, p_org_id uuid, p_source text, p_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.notify_whatsapp_on_lead(p_lead_name text, p_org_id uuid, p_source text, p_user_id uuid) TO anon;
GRANT ALL ON FUNCTION public.notify_whatsapp_on_lead(p_lead_name text, p_org_id uuid, p_source text, p_user_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.notify_whatsapp_on_lead(p_lead_name text, p_org_id uuid, p_source text, p_user_id uuid) TO service_role;


--
-- Name: FUNCTION notify_whatsapp_on_lead(p_org_id uuid, p_user_id uuid, p_lead_name text, p_source text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.notify_whatsapp_on_lead(p_org_id uuid, p_user_id uuid, p_lead_name text, p_source text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.notify_whatsapp_on_lead(p_org_id uuid, p_user_id uuid, p_lead_name text, p_source text) TO anon;
GRANT ALL ON FUNCTION public.notify_whatsapp_on_lead(p_org_id uuid, p_user_id uuid, p_lead_name text, p_source text) TO authenticated;
GRANT ALL ON FUNCTION public.notify_whatsapp_on_lead(p_org_id uuid, p_user_id uuid, p_lead_name text, p_source text) TO service_role;


--
-- Name: FUNCTION on_lead_created_entry_event(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.on_lead_created_entry_event() FROM PUBLIC;
GRANT ALL ON FUNCTION public.on_lead_created_entry_event() TO anon;
GRANT ALL ON FUNCTION public.on_lead_created_entry_event() TO authenticated;
GRANT ALL ON FUNCTION public.on_lead_created_entry_event() TO service_role;


--
-- Name: FUNCTION on_organization_created_init_financial(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.on_organization_created_init_financial() FROM PUBLIC;
GRANT ALL ON FUNCTION public.on_organization_created_init_financial() TO anon;
GRANT ALL ON FUNCTION public.on_organization_created_init_financial() TO authenticated;
GRANT ALL ON FUNCTION public.on_organization_created_init_financial() TO service_role;


--
-- Name: FUNCTION pick_round_robin_for_lead(p_lead_id uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.pick_round_robin_for_lead(p_lead_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.pick_round_robin_for_lead(p_lead_id uuid) TO anon;
GRANT ALL ON FUNCTION public.pick_round_robin_for_lead(p_lead_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.pick_round_robin_for_lead(p_lead_id uuid) TO service_role;


--
-- Name: FUNCTION preflight_historical_lead_import(p_organization_id uuid, p_actor_user_id uuid, p_manifest_sha256 text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.preflight_historical_lead_import(p_organization_id uuid, p_actor_user_id uuid, p_manifest_sha256 text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.preflight_historical_lead_import(p_organization_id uuid, p_actor_user_id uuid, p_manifest_sha256 text) TO service_role;


--
-- Name: FUNCTION prepare_billing_card_recurrence(p_payment_id uuid, p_provider_payment_id text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.prepare_billing_card_recurrence(p_payment_id uuid, p_provider_payment_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.prepare_billing_card_recurrence(p_payment_id uuid, p_provider_payment_id text) TO service_role;


--
-- Name: FUNCTION prepare_billing_subscription_card_update(p_job_id uuid, p_organization_id uuid, p_mode text, p_payment_id uuid, p_provider_payment_id text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.prepare_billing_subscription_card_update(p_job_id uuid, p_organization_id uuid, p_mode text, p_payment_id uuid, p_provider_payment_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.prepare_billing_subscription_card_update(p_job_id uuid, p_organization_id uuid, p_mode text, p_payment_id uuid, p_provider_payment_id text) TO service_role;


--
-- Name: FUNCTION prevent_property_code_change(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.prevent_property_code_change() FROM PUBLIC;
GRANT ALL ON FUNCTION public.prevent_property_code_change() TO anon;
GRANT ALL ON FUNCTION public.prevent_property_code_change() TO authenticated;
GRANT ALL ON FUNCTION public.prevent_property_code_change() TO service_role;


--
-- Name: FUNCTION process_automation_inbound_message(p_organization_id uuid, p_lead_id uuid, p_conversation_id uuid, p_message_id uuid, p_message_type text, p_content text, p_occurred_at timestamp with time zone); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.process_automation_inbound_message(p_organization_id uuid, p_lead_id uuid, p_conversation_id uuid, p_message_id uuid, p_message_type text, p_content text, p_occurred_at timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.process_automation_inbound_message(p_organization_id uuid, p_lead_id uuid, p_conversation_id uuid, p_message_id uuid, p_message_type text, p_content text, p_occurred_at timestamp with time zone) TO service_role;


--
-- Name: FUNCTION process_managed_whatsapp_lead_entry(p_organization_id uuid, p_lead_id uuid, p_session_id uuid, p_rule_id uuid, p_provider_message_id text, p_message text, p_occurred_at timestamp with time zone); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.process_managed_whatsapp_lead_entry(p_organization_id uuid, p_lead_id uuid, p_session_id uuid, p_rule_id uuid, p_provider_message_id text, p_message text, p_occurred_at timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.process_managed_whatsapp_lead_entry(p_organization_id uuid, p_lead_id uuid, p_session_id uuid, p_rule_id uuid, p_provider_message_id text, p_message text, p_occurred_at timestamp with time zone) TO service_role;


--
-- Name: FUNCTION process_managed_whatsapp_lead_entry_attendance(p_organization_id uuid, p_lead_id uuid, p_session_id uuid, p_rule_id uuid, p_provider_message_id text, p_message text, p_occurred_at timestamp with time zone, p_suppress_lead_message boolean); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.process_managed_whatsapp_lead_entry_attendance(p_organization_id uuid, p_lead_id uuid, p_session_id uuid, p_rule_id uuid, p_provider_message_id text, p_message text, p_occurred_at timestamp with time zone, p_suppress_lead_message boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.process_managed_whatsapp_lead_entry_attendance(p_organization_id uuid, p_lead_id uuid, p_session_id uuid, p_rule_id uuid, p_provider_message_id text, p_message text, p_occurred_at timestamp with time zone, p_suppress_lead_message boolean) TO service_role;


--
-- Name: FUNCTION process_whatsapp_lead_reentry_from_backend(p_organization_id uuid, p_lead_id uuid, p_provider_event_id text, p_conversation_id uuid, p_source text, p_entry_subtype text, p_metadata jsonb, p_lead_meta jsonb, p_occurred_at timestamp with time zone); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.process_whatsapp_lead_reentry_from_backend(p_organization_id uuid, p_lead_id uuid, p_provider_event_id text, p_conversation_id uuid, p_source text, p_entry_subtype text, p_metadata jsonb, p_lead_meta jsonb, p_occurred_at timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.process_whatsapp_lead_reentry_from_backend(p_organization_id uuid, p_lead_id uuid, p_provider_event_id text, p_conversation_id uuid, p_source text, p_entry_subtype text, p_metadata jsonb, p_lead_meta jsonb, p_occurred_at timestamp with time zone) TO service_role;


--
-- Name: FUNCTION read_whatsapp_webhook_pn_route_quarantine(p_organization_id uuid, p_session_id uuid, p_inbox_id uuid, p_execution_id uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.read_whatsapp_webhook_pn_route_quarantine(p_organization_id uuid, p_session_id uuid, p_inbox_id uuid, p_execution_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.read_whatsapp_webhook_pn_route_quarantine(p_organization_id uuid, p_session_id uuid, p_inbox_id uuid, p_execution_id uuid) TO service_role;


--
-- Name: TABLE whatsapp_conversations; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.whatsapp_conversations TO service_role;


--
-- Name: FUNCTION rebind_whatsapp_conversation_session(p_conversation_id uuid, p_session_id uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.rebind_whatsapp_conversation_session(p_conversation_id uuid, p_session_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rebind_whatsapp_conversation_session(p_conversation_id uuid, p_session_id uuid) TO anon;
GRANT ALL ON FUNCTION public.rebind_whatsapp_conversation_session(p_conversation_id uuid, p_session_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.rebind_whatsapp_conversation_session(p_conversation_id uuid, p_session_id uuid) TO service_role;


--
-- Name: FUNCTION rebind_whatsapp_conversation_session(p_conversation_id uuid, p_session_id uuid, p_remote_jid text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.rebind_whatsapp_conversation_session(p_conversation_id uuid, p_session_id uuid, p_remote_jid text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rebind_whatsapp_conversation_session(p_conversation_id uuid, p_session_id uuid, p_remote_jid text) TO service_role;


--
-- Name: FUNCTION reconcile_asaas_billing_snapshot(p_organization_id uuid, p_provider_customer_id text, p_provider_subscription_id text, p_provider_subscription_status text, p_latest_payment_status text, p_next_billing_date date, p_observed_at timestamp with time zone, p_source text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.reconcile_asaas_billing_snapshot(p_organization_id uuid, p_provider_customer_id text, p_provider_subscription_id text, p_provider_subscription_status text, p_latest_payment_status text, p_next_billing_date date, p_observed_at timestamp with time zone, p_source text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.reconcile_asaas_billing_snapshot(p_organization_id uuid, p_provider_customer_id text, p_provider_subscription_id text, p_provider_subscription_status text, p_latest_payment_status text, p_next_billing_date date, p_observed_at timestamp with time zone, p_source text) TO service_role;


--
-- Name: FUNCTION reconcile_asaas_checkout_webhook_with_intent(p_event_id text, p_event_type text, p_event_at timestamp with time zone, p_checkout jsonb, p_payload jsonb); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.reconcile_asaas_checkout_webhook_with_intent(p_event_id text, p_event_type text, p_event_at timestamp with time zone, p_checkout jsonb, p_payload jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.reconcile_asaas_checkout_webhook_with_intent(p_event_id text, p_event_type text, p_event_at timestamp with time zone, p_checkout jsonb, p_payload jsonb) TO service_role;


--
-- Name: FUNCTION reconcile_asaas_payment_method_change(p_payment_id uuid, p_organization_id uuid, p_billing_intent_id uuid, p_provider_payment_id text, p_provider_customer_id text, p_provider_subscription_id text, p_external_reference text, p_payment_amount numeric, p_expected_old_billing_type text, p_expected_old_status text, p_expected_old_due_date date, p_new_billing_type text, p_new_status text, p_new_due_date date, p_observed_at timestamp with time zone); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.reconcile_asaas_payment_method_change(p_payment_id uuid, p_organization_id uuid, p_billing_intent_id uuid, p_provider_payment_id text, p_provider_customer_id text, p_provider_subscription_id text, p_external_reference text, p_payment_amount numeric, p_expected_old_billing_type text, p_expected_old_status text, p_expected_old_due_date date, p_new_billing_type text, p_new_status text, p_new_due_date date, p_observed_at timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.reconcile_asaas_payment_method_change(p_payment_id uuid, p_organization_id uuid, p_billing_intent_id uuid, p_provider_payment_id text, p_provider_customer_id text, p_provider_subscription_id text, p_external_reference text, p_payment_amount numeric, p_expected_old_billing_type text, p_expected_old_status text, p_expected_old_due_date date, p_new_billing_type text, p_new_status text, p_new_due_date date, p_observed_at timestamp with time zone) TO service_role;


--
-- Name: FUNCTION reconcile_asaas_payment_snapshot(p_organization_id uuid, p_provider_payment_id text, p_provider_customer_id text, p_provider_subscription_id text, p_payment_status text, p_payment_amount numeric, p_payment_due_date date, p_observed_at timestamp with time zone, p_source text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.reconcile_asaas_payment_snapshot(p_organization_id uuid, p_provider_payment_id text, p_provider_customer_id text, p_provider_subscription_id text, p_payment_status text, p_payment_amount numeric, p_payment_due_date date, p_observed_at timestamp with time zone, p_source text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.reconcile_asaas_payment_snapshot(p_organization_id uuid, p_provider_payment_id text, p_provider_customer_id text, p_provider_subscription_id text, p_payment_status text, p_payment_amount numeric, p_payment_due_date date, p_observed_at timestamp with time zone, p_source text) TO service_role;


--
-- Name: FUNCTION reconcile_asaas_payment_webhook(p_event_id text, p_event_type text, p_event_at timestamp with time zone, p_payment jsonb, p_payload jsonb); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.reconcile_asaas_payment_webhook(p_event_id text, p_event_type text, p_event_at timestamp with time zone, p_payment jsonb, p_payload jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.reconcile_asaas_payment_webhook(p_event_id text, p_event_type text, p_event_at timestamp with time zone, p_payment jsonb, p_payload jsonb) TO service_role;


--
-- Name: FUNCTION reconcile_asaas_payment_webhook_with_intent(p_event_id text, p_event_type text, p_event_at timestamp with time zone, p_payment jsonb, p_payload jsonb); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.reconcile_asaas_payment_webhook_with_intent(p_event_id text, p_event_type text, p_event_at timestamp with time zone, p_payment jsonb, p_payload jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.reconcile_asaas_payment_webhook_with_intent(p_event_id text, p_event_type text, p_event_at timestamp with time zone, p_payment jsonb, p_payload jsonb) TO service_role;


--
-- Name: FUNCTION reconcile_asaas_payment_webhook_with_period_intent(p_event_id text, p_event_type text, p_event_at timestamp with time zone, p_payment jsonb, p_payload jsonb); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.reconcile_asaas_payment_webhook_with_period_intent(p_event_id text, p_event_type text, p_event_at timestamp with time zone, p_payment jsonb, p_payload jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.reconcile_asaas_payment_webhook_with_period_intent(p_event_id text, p_event_type text, p_event_at timestamp with time zone, p_payment jsonb, p_payload jsonb) TO service_role;


--
-- Name: FUNCTION reconcile_asaas_subscription_webhook(p_event_id text, p_event_type text, p_event_at timestamp with time zone, p_subscription jsonb, p_payload jsonb); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.reconcile_asaas_subscription_webhook(p_event_id text, p_event_type text, p_event_at timestamp with time zone, p_subscription jsonb, p_payload jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.reconcile_asaas_subscription_webhook(p_event_id text, p_event_type text, p_event_at timestamp with time zone, p_subscription jsonb, p_payload jsonb) TO service_role;


--
-- Name: FUNCTION reconcile_asaas_subscription_webhook_with_intent(p_event_id text, p_event_type text, p_event_at timestamp with time zone, p_subscription jsonb, p_payload jsonb); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.reconcile_asaas_subscription_webhook_with_intent(p_event_id text, p_event_type text, p_event_at timestamp with time zone, p_subscription jsonb, p_payload jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.reconcile_asaas_subscription_webhook_with_intent(p_event_id text, p_event_type text, p_event_at timestamp with time zone, p_subscription jsonb, p_payload jsonb) TO service_role;


--
-- Name: FUNCTION reconcile_asaas_subscription_webhook_with_period_intent(p_event_id text, p_event_type text, p_event_at timestamp with time zone, p_subscription jsonb, p_payload jsonb); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.reconcile_asaas_subscription_webhook_with_period_intent(p_event_id text, p_event_type text, p_event_at timestamp with time zone, p_subscription jsonb, p_payload jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.reconcile_asaas_subscription_webhook_with_period_intent(p_event_id text, p_event_type text, p_event_at timestamp with time zone, p_subscription jsonb, p_payload jsonb) TO service_role;


--
-- Name: FUNCTION reconcile_billing_card_recurrence_subscription(p_subscription jsonb); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.reconcile_billing_card_recurrence_subscription(p_subscription jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.reconcile_billing_card_recurrence_subscription(p_subscription jsonb) TO service_role;


--
-- Name: FUNCTION reconcile_imported_property_photos(p_organization_id uuid, p_property_id uuid, p_provider text, p_photo_urls text[], p_primary_url text, p_gallery_complete boolean); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.reconcile_imported_property_photos(p_organization_id uuid, p_property_id uuid, p_provider text, p_photo_urls text[], p_primary_url text, p_gallery_complete boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.reconcile_imported_property_photos(p_organization_id uuid, p_property_id uuid, p_provider text, p_photo_urls text[], p_primary_url text, p_gallery_complete boolean) TO service_role;


--
-- Name: FUNCTION record_resend_email_event(p_provider_event_id text, p_provider_message_id text, p_event_type text, p_occurred_at timestamp with time zone, p_payload jsonb); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.record_resend_email_event(p_provider_event_id text, p_provider_message_id text, p_event_type text, p_occurred_at timestamp with time zone, p_payload jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.record_resend_email_event(p_provider_event_id text, p_provider_message_id text, p_event_type text, p_occurred_at timestamp with time zone, p_payload jsonb) TO service_role;


--
-- Name: FUNCTION record_whatsapp_webhook_contact_pn_quarantine(p_organization_id uuid, p_session_id uuid, p_inbox_id uuid, p_execution_id uuid, p_provider_message_id text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.record_whatsapp_webhook_contact_pn_quarantine(p_organization_id uuid, p_session_id uuid, p_inbox_id uuid, p_execution_id uuid, p_provider_message_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.record_whatsapp_webhook_contact_pn_quarantine(p_organization_id uuid, p_session_id uuid, p_inbox_id uuid, p_execution_id uuid, p_provider_message_id text) TO service_role;


--
-- Name: FUNCTION recover_stuck_executions(p_stale_minutes integer); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.recover_stuck_executions(p_stale_minutes integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.recover_stuck_executions(p_stale_minutes integer) TO anon;
GRANT ALL ON FUNCTION public.recover_stuck_executions(p_stale_minutes integer) TO authenticated;
GRANT ALL ON FUNCTION public.recover_stuck_executions(p_stale_minutes integer) TO service_role;


--
-- Name: FUNCTION redistribute_lead_from_pool(p_lead_id uuid, p_reason text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.redistribute_lead_from_pool(p_lead_id uuid, p_reason text) FROM PUBLIC;


--
-- Name: FUNCTION redistribute_lead_from_pool_backend(p_organization_id uuid, p_lead_id uuid, p_idempotency_key text, p_round_robin_id uuid, p_expected_assigned_user_id uuid, p_expected_assigned_at timestamp with time zone, p_expected_redistribution_count integer, p_now timestamp with time zone); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.redistribute_lead_from_pool_backend(p_organization_id uuid, p_lead_id uuid, p_idempotency_key text, p_round_robin_id uuid, p_expected_assigned_user_id uuid, p_expected_assigned_at timestamp with time zone, p_expected_redistribution_count integer, p_now timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.redistribute_lead_from_pool_backend(p_organization_id uuid, p_lead_id uuid, p_idempotency_key text, p_round_robin_id uuid, p_expected_assigned_user_id uuid, p_expected_assigned_at timestamp with time zone, p_expected_redistribution_count integer, p_now timestamp with time zone) TO service_role;


--
-- Name: FUNCTION redistribute_lead_round_robin(p_lead_id uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.redistribute_lead_round_robin(p_lead_id uuid) FROM PUBLIC;


--
-- Name: FUNCTION refresh_help_article_search_vector(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.refresh_help_article_search_vector() FROM PUBLIC;
GRANT ALL ON FUNCTION public.refresh_help_article_search_vector() TO service_role;


--
-- Name: FUNCTION register_billing_checkout_provider(p_intent_id uuid, p_customer_id text, p_payment_id text, p_subscription_id text, p_provider_response jsonb); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.register_billing_checkout_provider(p_intent_id uuid, p_customer_id text, p_payment_id text, p_subscription_id text, p_provider_response jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.register_billing_checkout_provider(p_intent_id uuid, p_customer_id text, p_payment_id text, p_subscription_id text, p_provider_response jsonb) TO service_role;


--
-- Name: FUNCTION register_billing_hosted_checkout(p_intent_id uuid, p_checkout_id text, p_provider_response jsonb); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.register_billing_hosted_checkout(p_intent_id uuid, p_checkout_id text, p_provider_response jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.register_billing_hosted_checkout(p_intent_id uuid, p_checkout_id text, p_provider_response jsonb) TO service_role;


--
-- Name: FUNCTION register_lead_reentry(p_lead_id uuid, p_org_id uuid, p_entry_type text, p_source text, p_campaign_name text, p_utm_source text, p_utm_medium text, p_utm_campaign text, p_property_id uuid, p_valor_interesse numeric, p_metadata jsonb); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.register_lead_reentry(p_lead_id uuid, p_org_id uuid, p_entry_type text, p_source text, p_campaign_name text, p_utm_source text, p_utm_medium text, p_utm_campaign text, p_property_id uuid, p_valor_interesse numeric, p_metadata jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.register_lead_reentry(p_lead_id uuid, p_org_id uuid, p_entry_type text, p_source text, p_campaign_name text, p_utm_source text, p_utm_medium text, p_utm_campaign text, p_property_id uuid, p_valor_interesse numeric, p_metadata jsonb) TO service_role;


--
-- Name: FUNCTION register_lead_reentry_from_backend(p_organization_id uuid, p_lead_id uuid, p_provider text, p_provider_event_id text, p_source text, p_entry_subtype text, p_property_id uuid, p_valor_interesse numeric, p_metadata jsonb, p_occurred_at timestamp with time zone); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.register_lead_reentry_from_backend(p_organization_id uuid, p_lead_id uuid, p_provider text, p_provider_event_id text, p_source text, p_entry_subtype text, p_property_id uuid, p_valor_interesse numeric, p_metadata jsonb, p_occurred_at timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.register_lead_reentry_from_backend(p_organization_id uuid, p_lead_id uuid, p_provider text, p_provider_event_id text, p_source text, p_entry_subtype text, p_property_id uuid, p_valor_interesse numeric, p_metadata jsonb, p_occurred_at timestamp with time zone) TO service_role;


--
-- Name: FUNCTION register_pending_asaas_subscription(p_organization_id uuid, p_customer_id text, p_subscription_id text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.register_pending_asaas_subscription(p_organization_id uuid, p_customer_id text, p_subscription_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.register_pending_asaas_subscription(p_organization_id uuid, p_customer_id text, p_subscription_id text) TO service_role;


--
-- Name: FUNCTION release_billing_payment_checkout_attempt(p_payment_id uuid, p_provider_payment_id text, p_lease_id uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.release_billing_payment_checkout_attempt(p_payment_id uuid, p_provider_payment_id text, p_lease_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.release_billing_payment_checkout_attempt(p_payment_id uuid, p_provider_payment_id text, p_lease_id uuid) TO service_role;


--
-- Name: FUNCTION release_commissions_on_payment(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.release_commissions_on_payment() FROM PUBLIC;
GRANT ALL ON FUNCTION public.release_commissions_on_payment() TO anon;
GRANT ALL ON FUNCTION public.release_commissions_on_payment() TO authenticated;
GRANT ALL ON FUNCTION public.release_commissions_on_payment() TO service_role;


--
-- Name: FUNCTION release_due_automation_delays(p_batch_size integer); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.release_due_automation_delays(p_batch_size integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.release_due_automation_delays(p_batch_size integer) TO anon;
GRANT ALL ON FUNCTION public.release_due_automation_delays(p_batch_size integer) TO authenticated;
GRANT ALL ON FUNCTION public.release_due_automation_delays(p_batch_size integer) TO service_role;


--
-- Name: FUNCTION release_execution_step_lock(p_execution_id uuid, p_token text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.release_execution_step_lock(p_execution_id uuid, p_token text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.release_execution_step_lock(p_execution_id uuid, p_token text) TO anon;
GRANT ALL ON FUNCTION public.release_execution_step_lock(p_execution_id uuid, p_token text) TO authenticated;
GRANT ALL ON FUNCTION public.release_execution_step_lock(p_execution_id uuid, p_token text) TO service_role;


--
-- Name: FUNCTION reorder_stages(p_stages jsonb); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.reorder_stages(p_stages jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.reorder_stages(p_stages jsonb) TO service_role;


--
-- Name: FUNCTION reserve_automation_external_effect(p_organization_id uuid, p_execution_id uuid, p_node_key text, p_lease_token text, p_effect_key text, p_effect_type text, p_request jsonb); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.reserve_automation_external_effect(p_organization_id uuid, p_execution_id uuid, p_node_key text, p_lease_token text, p_effect_key text, p_effect_type text, p_request jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.reserve_automation_external_effect(p_organization_id uuid, p_execution_id uuid, p_node_key text, p_lease_token text, p_effect_key text, p_effect_type text, p_request jsonb) TO anon;
GRANT ALL ON FUNCTION public.reserve_automation_external_effect(p_organization_id uuid, p_execution_id uuid, p_node_key text, p_lease_token text, p_effect_key text, p_effect_type text, p_request jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.reserve_automation_external_effect(p_organization_id uuid, p_execution_id uuid, p_node_key text, p_lease_token text, p_effect_key text, p_effect_type text, p_request jsonb) TO service_role;


--
-- Name: FUNCTION reserve_billing_checkout_intent(p_organization_id uuid, p_billing_method text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.reserve_billing_checkout_intent(p_organization_id uuid, p_billing_method text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.reserve_billing_checkout_intent(p_organization_id uuid, p_billing_method text) TO service_role;


--
-- Name: FUNCTION reserve_billing_checkout_intent(p_organization_id uuid, p_billing_method text, p_billing_period_months integer); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.reserve_billing_checkout_intent(p_organization_id uuid, p_billing_method text, p_billing_period_months integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.reserve_billing_checkout_intent(p_organization_id uuid, p_billing_method text, p_billing_period_months integer) TO service_role;


--
-- Name: FUNCTION reserve_billing_checkout_intent(p_organization_id uuid, p_billing_method text, p_billing_period_months integer, p_expected_plan_id uuid, p_expected_monthly_price numeric); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.reserve_billing_checkout_intent(p_organization_id uuid, p_billing_method text, p_billing_period_months integer, p_expected_plan_id uuid, p_expected_monthly_price numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION public.reserve_billing_checkout_intent(p_organization_id uuid, p_billing_method text, p_billing_period_months integer, p_expected_plan_id uuid, p_expected_monthly_price numeric) TO service_role;


--
-- Name: FUNCTION reserve_whatsapp_webhook_edge_execution(p_organization_id uuid, p_session_id uuid, p_inbox_id uuid, p_worker_id text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.reserve_whatsapp_webhook_edge_execution(p_organization_id uuid, p_session_id uuid, p_inbox_id uuid, p_worker_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.reserve_whatsapp_webhook_edge_execution(p_organization_id uuid, p_session_id uuid, p_inbox_id uuid, p_worker_id text) TO service_role;


--
-- Name: FUNCTION reset_gamification_season(p_organization_id uuid, p_season_name text, p_reason text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.reset_gamification_season(p_organization_id uuid, p_season_name text, p_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.reset_gamification_season(p_organization_id uuid, p_season_name text, p_reason text) TO service_role;


--
-- Name: FUNCTION resolve_automation_whatsapp_conversation(p_organization_id uuid, p_execution_id uuid, p_node_key text, p_lease_token text, p_session_id uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.resolve_automation_whatsapp_conversation(p_organization_id uuid, p_execution_id uuid, p_node_key text, p_lease_token text, p_session_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.resolve_automation_whatsapp_conversation(p_organization_id uuid, p_execution_id uuid, p_node_key text, p_lease_token text, p_session_id uuid) TO service_role;


--
-- Name: FUNCTION resolve_billing_payment_checkout_capability(p_checkout_token text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.resolve_billing_payment_checkout_capability(p_checkout_token text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.resolve_billing_payment_checkout_capability(p_checkout_token text) TO service_role;


--
-- Name: FUNCTION resolve_billing_subscription_card_update_manual_review(p_job_id uuid, p_organization_id uuid, p_resolution text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.resolve_billing_subscription_card_update_manual_review(p_job_id uuid, p_organization_id uuid, p_resolution text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.resolve_billing_subscription_card_update_manual_review(p_job_id uuid, p_organization_id uuid, p_resolution text) TO service_role;


--
-- Name: FUNCTION resolve_site_domain(p_domain text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.resolve_site_domain(p_domain text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.resolve_site_domain(p_domain text) TO anon;
GRANT ALL ON FUNCTION public.resolve_site_domain(p_domain text) TO authenticated;
GRANT ALL ON FUNCTION public.resolve_site_domain(p_domain text) TO service_role;


--
-- Name: FUNCTION resolve_whatsapp_unlinked_history_capture(p_organization_id uuid, p_session_id uuid, p_conversation_id uuid, p_provider_message_id text, p_inbox_event_key text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.resolve_whatsapp_unlinked_history_capture(p_organization_id uuid, p_session_id uuid, p_conversation_id uuid, p_provider_message_id text, p_inbox_event_key text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.resolve_whatsapp_unlinked_history_capture(p_organization_id uuid, p_session_id uuid, p_conversation_id uuid, p_provider_message_id text, p_inbox_event_key text) TO service_role;


--
-- Name: FUNCTION resolve_whatsapp_webhook_inherited_routing_target(p_organization_id uuid, p_session_id uuid, p_provider_message_id text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.resolve_whatsapp_webhook_inherited_routing_target(p_organization_id uuid, p_session_id uuid, p_provider_message_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.resolve_whatsapp_webhook_inherited_routing_target(p_organization_id uuid, p_session_id uuid, p_provider_message_id text) TO service_role;


--
-- Name: FUNCTION resume_automation_delay(p_organization_id uuid, p_execution_id uuid, p_branch text, p_occurred_at timestamp with time zone, p_reply_payload jsonb, p_lead_id uuid, p_conversation_id uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.resume_automation_delay(p_organization_id uuid, p_execution_id uuid, p_branch text, p_occurred_at timestamp with time zone, p_reply_payload jsonb, p_lead_id uuid, p_conversation_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.resume_automation_delay(p_organization_id uuid, p_execution_id uuid, p_branch text, p_occurred_at timestamp with time zone, p_reply_payload jsonb, p_lead_id uuid, p_conversation_id uuid) TO anon;
GRANT ALL ON FUNCTION public.resume_automation_delay(p_organization_id uuid, p_execution_id uuid, p_branch text, p_occurred_at timestamp with time zone, p_reply_payload jsonb, p_lead_id uuid, p_conversation_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.resume_automation_delay(p_organization_id uuid, p_execution_id uuid, p_branch text, p_occurred_at timestamp with time zone, p_reply_payload jsonb, p_lead_id uuid, p_conversation_id uuid) TO service_role;


--
-- Name: FUNCTION retire_whatsapp_unlinked_conversation_epoch(p_organization_id uuid, p_session_id uuid, p_expected_conversation_id uuid, p_remote_jid text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.retire_whatsapp_unlinked_conversation_epoch(p_organization_id uuid, p_session_id uuid, p_expected_conversation_id uuid, p_remote_jid text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.retire_whatsapp_unlinked_conversation_epoch(p_organization_id uuid, p_session_id uuid, p_expected_conversation_id uuid, p_remote_jid text) TO service_role;


--
-- Name: FUNCTION retire_whatsapp_unlinked_conversation_for_lead_intake(p_organization_id uuid, p_session_id uuid, p_expected_conversation_id uuid, p_remote_jid text, p_provider_message_id text, p_inbox_event_key text, p_lead_id uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.retire_whatsapp_unlinked_conversation_for_lead_intake(p_organization_id uuid, p_session_id uuid, p_expected_conversation_id uuid, p_remote_jid text, p_provider_message_id text, p_inbox_event_key text, p_lead_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.retire_whatsapp_unlinked_conversation_for_lead_intake(p_organization_id uuid, p_session_id uuid, p_expected_conversation_id uuid, p_remote_jid text, p_provider_message_id text, p_inbox_event_key text, p_lead_id uuid) TO service_role;


--
-- Name: FUNCTION sanitize_whatsapp_message_metadata(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.sanitize_whatsapp_message_metadata() TO anon;
GRANT ALL ON FUNCTION public.sanitize_whatsapp_message_metadata() TO authenticated;
GRANT ALL ON FUNCTION public.sanitize_whatsapp_message_metadata() TO service_role;


--
-- Name: FUNCTION send_pool_redistribution_warning_from_backend(p_organization_id uuid, p_lead_id uuid, p_round_robin_id uuid, p_expected_assigned_user_id uuid, p_expected_lead_assigned_at timestamp with time zone, p_expected_distribution_assignment_at timestamp with time zone, p_expected_redistribution_count integer, p_now timestamp with time zone); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.send_pool_redistribution_warning_from_backend(p_organization_id uuid, p_lead_id uuid, p_round_robin_id uuid, p_expected_assigned_user_id uuid, p_expected_lead_assigned_at timestamp with time zone, p_expected_distribution_assignment_at timestamp with time zone, p_expected_redistribution_count integer, p_now timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.send_pool_redistribution_warning_from_backend(p_organization_id uuid, p_lead_id uuid, p_round_robin_id uuid, p_expected_assigned_user_id uuid, p_expected_lead_assigned_at timestamp with time zone, p_expected_distribution_assignment_at timestamp with time zone, p_expected_redistribution_count integer, p_now timestamp with time zone) TO service_role;


--
-- Name: FUNCTION set_lead_assigned_at(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.set_lead_assigned_at() FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_lead_assigned_at() TO anon;
GRANT ALL ON FUNCTION public.set_lead_assigned_at() TO authenticated;
GRANT ALL ON FUNCTION public.set_lead_assigned_at() TO service_role;


--
-- Name: FUNCTION set_lead_assigned_at_on_insert(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.set_lead_assigned_at_on_insert() FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_lead_assigned_at_on_insert() TO anon;
GRANT ALL ON FUNCTION public.set_lead_assigned_at_on_insert() TO authenticated;
GRANT ALL ON FUNCTION public.set_lead_assigned_at_on_insert() TO service_role;


--
-- Name: FUNCTION set_lead_timeline_event_at(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.set_lead_timeline_event_at() TO anon;
GRANT ALL ON FUNCTION public.set_lead_timeline_event_at() TO authenticated;
GRANT ALL ON FUNCTION public.set_lead_timeline_event_at() TO service_role;


--
-- Name: FUNCTION set_round_robin_member_organization_id(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.set_round_robin_member_organization_id() FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_round_robin_member_organization_id() TO anon;
GRANT ALL ON FUNCTION public.set_round_robin_member_organization_id() TO authenticated;
GRANT ALL ON FUNCTION public.set_round_robin_member_organization_id() TO service_role;


--
-- Name: FUNCTION set_stage_organization_id_from_pipeline(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.set_stage_organization_id_from_pipeline() TO anon;
GRANT ALL ON FUNCTION public.set_stage_organization_id_from_pipeline() TO authenticated;
GRANT ALL ON FUNCTION public.set_stage_organization_id_from_pipeline() TO service_role;


--
-- Name: FUNCTION set_whatsapp_message_context(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.set_whatsapp_message_context() FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_whatsapp_message_context() TO anon;
GRANT ALL ON FUNCTION public.set_whatsapp_message_context() TO authenticated;
GRANT ALL ON FUNCTION public.set_whatsapp_message_context() TO service_role;


--
-- Name: FUNCTION set_whatsapp_message_received_at(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.set_whatsapp_message_received_at() TO anon;
GRANT ALL ON FUNCTION public.set_whatsapp_message_received_at() TO authenticated;
GRANT ALL ON FUNCTION public.set_whatsapp_message_received_at() TO service_role;


--
-- Name: FUNCTION start_automation_execution_from_event(p_event_id uuid, p_automation_id uuid, p_flow_version_id uuid, p_lead_id uuid, p_conversation_id uuid, p_first_node_key text, p_execution_data jsonb); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.start_automation_execution_from_event(p_event_id uuid, p_automation_id uuid, p_flow_version_id uuid, p_lead_id uuid, p_conversation_id uuid, p_first_node_key text, p_execution_data jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.start_automation_execution_from_event(p_event_id uuid, p_automation_id uuid, p_flow_version_id uuid, p_lead_id uuid, p_conversation_id uuid, p_first_node_key text, p_execution_data jsonb) TO anon;
GRANT ALL ON FUNCTION public.start_automation_execution_from_event(p_event_id uuid, p_automation_id uuid, p_flow_version_id uuid, p_lead_id uuid, p_conversation_id uuid, p_first_node_key text, p_execution_data jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.start_automation_execution_from_event(p_event_id uuid, p_automation_id uuid, p_flow_version_id uuid, p_lead_id uuid, p_conversation_id uuid, p_first_node_key text, p_execution_data jsonb) TO service_role;


--
-- Name: FUNCTION start_whatsapp_webhook_edge_execution(p_organization_id uuid, p_session_id uuid, p_inbox_id uuid, p_execution_id uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.start_whatsapp_webhook_edge_execution(p_organization_id uuid, p_session_id uuid, p_inbox_id uuid, p_execution_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.start_whatsapp_webhook_edge_execution(p_organization_id uuid, p_session_id uuid, p_inbox_id uuid, p_execution_id uuid) TO service_role;


--
-- Name: FUNCTION store_billing_card_recurrence_credential(p_payment_id uuid, p_provider_payment_id text, p_credential_ciphertext text, p_card_last4 text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.store_billing_card_recurrence_credential(p_payment_id uuid, p_provider_payment_id text, p_credential_ciphertext text, p_card_last4 text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.store_billing_card_recurrence_credential(p_payment_id uuid, p_provider_payment_id text, p_credential_ciphertext text, p_card_last4 text) TO service_role;


--
-- Name: FUNCTION store_billing_card_recurrence_credential(p_payment_id uuid, p_provider_payment_id text, p_attempt_lease_id uuid, p_credential_ciphertext text, p_card_last4 text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.store_billing_card_recurrence_credential(p_payment_id uuid, p_provider_payment_id text, p_attempt_lease_id uuid, p_credential_ciphertext text, p_card_last4 text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.store_billing_card_recurrence_credential(p_payment_id uuid, p_provider_payment_id text, p_attempt_lease_id uuid, p_credential_ciphertext text, p_card_last4 text) TO service_role;


--
-- Name: FUNCTION store_billing_checkout_payment(p_intent_id uuid, p_organization_id uuid, p_payment_id text, p_customer_id text, p_subscription_id text, p_billing_type text, p_status text, p_value numeric, p_net_value numeric, p_due_date date, p_payment_date date, p_invoice_url text, p_raw_event jsonb); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.store_billing_checkout_payment(p_intent_id uuid, p_organization_id uuid, p_payment_id text, p_customer_id text, p_subscription_id text, p_billing_type text, p_status text, p_value numeric, p_net_value numeric, p_due_date date, p_payment_date date, p_invoice_url text, p_raw_event jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.store_billing_checkout_payment(p_intent_id uuid, p_organization_id uuid, p_payment_id text, p_customer_id text, p_subscription_id text, p_billing_type text, p_status text, p_value numeric, p_net_value numeric, p_due_date date, p_payment_date date, p_invoice_url text, p_raw_event jsonb) TO service_role;


--
-- Name: FUNCTION store_billing_subscription_card_update_credential(p_job_id uuid, p_organization_id uuid, p_generation bigint, p_attempt_lease_id uuid, p_credential_ciphertext text, p_card_last4 text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.store_billing_subscription_card_update_credential(p_job_id uuid, p_organization_id uuid, p_generation bigint, p_attempt_lease_id uuid, p_credential_ciphertext text, p_card_last4 text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.store_billing_subscription_card_update_credential(p_job_id uuid, p_organization_id uuid, p_generation bigint, p_attempt_lease_id uuid, p_credential_ciphertext text, p_card_last4 text) TO service_role;


--
-- Name: FUNCTION succeed_billing_card_recurrence_job(p_payment_id uuid, p_provider_payment_id text, p_worker_id text, p_job_lease_id uuid, p_provider_result jsonb); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.succeed_billing_card_recurrence_job(p_payment_id uuid, p_provider_payment_id text, p_worker_id text, p_job_lease_id uuid, p_provider_result jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.succeed_billing_card_recurrence_job(p_payment_id uuid, p_provider_payment_id text, p_worker_id text, p_job_lease_id uuid, p_provider_result jsonb) TO service_role;


--
-- Name: FUNCTION succeed_billing_subscription_card_update_job(p_job_id uuid, p_organization_id uuid, p_generation bigint, p_job_lease_id uuid, p_provider_snapshot jsonb); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.succeed_billing_subscription_card_update_job(p_job_id uuid, p_organization_id uuid, p_generation bigint, p_job_lease_id uuid, p_provider_snapshot jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.succeed_billing_subscription_card_update_job(p_job_id uuid, p_organization_id uuid, p_generation bigint, p_job_lease_id uuid, p_provider_snapshot jsonb) TO service_role;


--
-- Name: FUNCTION sync_commission_rule_percentage(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.sync_commission_rule_percentage() TO anon;
GRANT ALL ON FUNCTION public.sync_commission_rule_percentage() TO authenticated;
GRANT ALL ON FUNCTION public.sync_commission_rule_percentage() TO service_role;


--
-- Name: FUNCTION sync_historical_commissions(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.sync_historical_commissions() FROM PUBLIC;
GRANT ALL ON FUNCTION public.sync_historical_commissions() TO service_role;


--
-- Name: FUNCTION sync_lead_seller_to_customer(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.sync_lead_seller_to_customer() FROM PUBLIC;
GRANT ALL ON FUNCTION public.sync_lead_seller_to_customer() TO anon;
GRANT ALL ON FUNCTION public.sync_lead_seller_to_customer() TO authenticated;
GRANT ALL ON FUNCTION public.sync_lead_seller_to_customer() TO service_role;


--
-- Name: FUNCTION sync_telecom_customer_plan_value(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.sync_telecom_customer_plan_value() FROM PUBLIC;
GRANT ALL ON FUNCTION public.sync_telecom_customer_plan_value() TO anon;
GRANT ALL ON FUNCTION public.sync_telecom_customer_plan_value() TO authenticated;
GRANT ALL ON FUNCTION public.sync_telecom_customer_plan_value() TO service_role;


--
-- Name: FUNCTION sync_telecom_customer_seller_on_insert(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.sync_telecom_customer_seller_on_insert() FROM PUBLIC;
GRANT ALL ON FUNCTION public.sync_telecom_customer_seller_on_insert() TO anon;
GRANT ALL ON FUNCTION public.sync_telecom_customer_seller_on_insert() TO authenticated;
GRANT ALL ON FUNCTION public.sync_telecom_customer_seller_on_insert() TO service_role;


--
-- Name: FUNCTION sync_user_roles(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.sync_user_roles() FROM PUBLIC;
GRANT ALL ON FUNCTION public.sync_user_roles() TO anon;
GRANT ALL ON FUNCTION public.sync_user_roles() TO authenticated;
GRANT ALL ON FUNCTION public.sync_user_roles() TO service_role;


--
-- Name: FUNCTION sync_whatsapp_groups_compat_columns(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.sync_whatsapp_groups_compat_columns() TO anon;
GRANT ALL ON FUNCTION public.sync_whatsapp_groups_compat_columns() TO authenticated;
GRANT ALL ON FUNCTION public.sync_whatsapp_groups_compat_columns() TO service_role;


--
-- Name: FUNCTION touch_setup_guide_progress(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.touch_setup_guide_progress() FROM PUBLIC;
GRANT ALL ON FUNCTION public.touch_setup_guide_progress() TO anon;
GRANT ALL ON FUNCTION public.touch_setup_guide_progress() TO authenticated;
GRANT ALL ON FUNCTION public.touch_setup_guide_progress() TO service_role;


--
-- Name: FUNCTION touch_whatsapp_conversation_received_at(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.touch_whatsapp_conversation_received_at() TO anon;
GRANT ALL ON FUNCTION public.touch_whatsapp_conversation_received_at() TO authenticated;
GRANT ALL ON FUNCTION public.touch_whatsapp_conversation_received_at() TO service_role;


--
-- Name: FUNCTION transfer_lead_assignee(p_lead_id uuid, p_assigned_user_id uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.transfer_lead_assignee(p_lead_id uuid, p_assigned_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.transfer_lead_assignee(p_lead_id uuid, p_assigned_user_id uuid) TO service_role;


--
-- Name: FUNCTION trigger_handle_lead_intake(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.trigger_handle_lead_intake() FROM PUBLIC;


--
-- Name: FUNCTION try_acquire_execution_step_lock(p_execution_id uuid, p_max_lock_age_seconds integer); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.try_acquire_execution_step_lock(p_execution_id uuid, p_max_lock_age_seconds integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.try_acquire_execution_step_lock(p_execution_id uuid, p_max_lock_age_seconds integer) TO anon;
GRANT ALL ON FUNCTION public.try_acquire_execution_step_lock(p_execution_id uuid, p_max_lock_age_seconds integer) TO authenticated;
GRANT ALL ON FUNCTION public.try_acquire_execution_step_lock(p_execution_id uuid, p_max_lock_age_seconds integer) TO service_role;


--
-- Name: FUNCTION update_ai_agent_conversations_updated_at(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.update_ai_agent_conversations_updated_at() TO anon;
GRANT ALL ON FUNCTION public.update_ai_agent_conversations_updated_at() TO authenticated;
GRANT ALL ON FUNCTION public.update_ai_agent_conversations_updated_at() TO service_role;


--
-- Name: FUNCTION update_ai_agents_updated_at(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.update_ai_agents_updated_at() TO anon;
GRANT ALL ON FUNCTION public.update_ai_agents_updated_at() TO authenticated;
GRANT ALL ON FUNCTION public.update_ai_agents_updated_at() TO service_role;


--
-- Name: FUNCTION update_ai_control_plane_updated_at(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.update_ai_control_plane_updated_at() TO anon;
GRANT ALL ON FUNCTION public.update_ai_control_plane_updated_at() TO authenticated;
GRANT ALL ON FUNCTION public.update_ai_control_plane_updated_at() TO service_role;


--
-- Name: FUNCTION update_broker_monthly_goals_updated_at(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.update_broker_monthly_goals_updated_at() TO anon;
GRANT ALL ON FUNCTION public.update_broker_monthly_goals_updated_at() TO authenticated;
GRANT ALL ON FUNCTION public.update_broker_monthly_goals_updated_at() TO service_role;


--
-- Name: FUNCTION update_entry_status_on_payment(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.update_entry_status_on_payment() TO anon;
GRANT ALL ON FUNCTION public.update_entry_status_on_payment() TO authenticated;
GRANT ALL ON FUNCTION public.update_entry_status_on_payment() TO service_role;


--
-- Name: FUNCTION update_meta_form_configs_updated_at(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.update_meta_form_configs_updated_at() FROM PUBLIC;
GRANT ALL ON FUNCTION public.update_meta_form_configs_updated_at() TO anon;
GRANT ALL ON FUNCTION public.update_meta_form_configs_updated_at() TO authenticated;
GRANT ALL ON FUNCTION public.update_meta_form_configs_updated_at() TO service_role;


--
-- Name: FUNCTION update_updated_at_column(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.update_updated_at_column() TO anon;
GRANT ALL ON FUNCTION public.update_updated_at_column() TO authenticated;
GRANT ALL ON FUNCTION public.update_updated_at_column() TO service_role;


--
-- Name: FUNCTION upsert_whatsapp_webhook_lead(p_organization_id uuid, p_name text, p_phone text, p_whatsapp text, p_whatsapp_avatar_url text, p_whatsapp_avatar_synced_at timestamp with time zone, p_source_detail text, p_source_session_id uuid, p_initial_message text, p_message text, p_property_code text, p_property_id uuid, p_interest_property_id uuid, p_assigned_user_id uuid, p_assigned_at timestamp with time zone, p_pipeline_id uuid, p_stage_id uuid, p_created_by uuid, p_first_touch_at timestamp with time zone, p_first_touch_channel text, p_last_contact_at timestamp with time zone, p_metadata jsonb); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.upsert_whatsapp_webhook_lead(p_organization_id uuid, p_name text, p_phone text, p_whatsapp text, p_whatsapp_avatar_url text, p_whatsapp_avatar_synced_at timestamp with time zone, p_source_detail text, p_source_session_id uuid, p_initial_message text, p_message text, p_property_code text, p_property_id uuid, p_interest_property_id uuid, p_assigned_user_id uuid, p_assigned_at timestamp with time zone, p_pipeline_id uuid, p_stage_id uuid, p_created_by uuid, p_first_touch_at timestamp with time zone, p_first_touch_channel text, p_last_contact_at timestamp with time zone, p_metadata jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.upsert_whatsapp_webhook_lead(p_organization_id uuid, p_name text, p_phone text, p_whatsapp text, p_whatsapp_avatar_url text, p_whatsapp_avatar_synced_at timestamp with time zone, p_source_detail text, p_source_session_id uuid, p_initial_message text, p_message text, p_property_code text, p_property_id uuid, p_interest_property_id uuid, p_assigned_user_id uuid, p_assigned_at timestamp with time zone, p_pipeline_id uuid, p_stage_id uuid, p_created_by uuid, p_first_touch_at timestamp with time zone, p_first_touch_channel text, p_last_contact_at timestamp with time zone, p_metadata jsonb) TO service_role;


--
-- Name: FUNCTION upsert_whatsapp_webhook_lead(p_organization_id uuid, p_name text, p_phone text, p_whatsapp text, p_whatsapp_avatar_url text, p_whatsapp_avatar_synced_at timestamp with time zone, p_source_detail text, p_source_session_id uuid, p_initial_message text, p_message text, p_property_code text, p_property_id uuid, p_interest_property_id uuid, p_assigned_user_id uuid, p_assigned_at timestamp with time zone, p_pipeline_id uuid, p_stage_id uuid, p_created_by uuid, p_first_touch_at timestamp with time zone, p_first_touch_channel text, p_last_contact_at timestamp with time zone, p_metadata jsonb, p_origin_round_robin_id uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.upsert_whatsapp_webhook_lead(p_organization_id uuid, p_name text, p_phone text, p_whatsapp text, p_whatsapp_avatar_url text, p_whatsapp_avatar_synced_at timestamp with time zone, p_source_detail text, p_source_session_id uuid, p_initial_message text, p_message text, p_property_code text, p_property_id uuid, p_interest_property_id uuid, p_assigned_user_id uuid, p_assigned_at timestamp with time zone, p_pipeline_id uuid, p_stage_id uuid, p_created_by uuid, p_first_touch_at timestamp with time zone, p_first_touch_channel text, p_last_contact_at timestamp with time zone, p_metadata jsonb, p_origin_round_robin_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.upsert_whatsapp_webhook_lead(p_organization_id uuid, p_name text, p_phone text, p_whatsapp text, p_whatsapp_avatar_url text, p_whatsapp_avatar_synced_at timestamp with time zone, p_source_detail text, p_source_session_id uuid, p_initial_message text, p_message text, p_property_code text, p_property_id uuid, p_interest_property_id uuid, p_assigned_user_id uuid, p_assigned_at timestamp with time zone, p_pipeline_id uuid, p_stage_id uuid, p_created_by uuid, p_first_touch_at timestamp with time zone, p_first_touch_channel text, p_last_contact_at timestamp with time zone, p_metadata jsonb, p_origin_round_robin_id uuid) TO service_role;


--
-- Name: FUNCTION user_belongs_to_organization(org_id uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.user_belongs_to_organization(org_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.user_belongs_to_organization(org_id uuid) TO anon;
GRANT ALL ON FUNCTION public.user_belongs_to_organization(org_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.user_belongs_to_organization(org_id uuid) TO service_role;


--
-- Name: FUNCTION user_has_organization(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.user_has_organization() FROM PUBLIC;
GRANT ALL ON FUNCTION public.user_has_organization() TO anon;
GRANT ALL ON FUNCTION public.user_has_organization() TO authenticated;
GRANT ALL ON FUNCTION public.user_has_organization() TO service_role;


--
-- Name: FUNCTION user_has_permission(p_permission_key text, p_user_id uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.user_has_permission(p_permission_key text, p_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.user_has_permission(p_permission_key text, p_user_id uuid) TO anon;
GRANT ALL ON FUNCTION public.user_has_permission(p_permission_key text, p_user_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.user_has_permission(p_permission_key text, p_user_id uuid) TO service_role;


--
-- Name: FUNCTION user_has_session_access(session_id uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.user_has_session_access(session_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.user_has_session_access(session_id uuid) TO anon;
GRANT ALL ON FUNCTION public.user_has_session_access(session_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.user_has_session_access(session_id uuid) TO service_role;


--
-- Name: FUNCTION verify_billing_payment_receipt(p_verification_token uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.verify_billing_payment_receipt(p_verification_token uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.verify_billing_payment_receipt(p_verification_token uuid) TO anon;
GRANT ALL ON FUNCTION public.verify_billing_payment_receipt(p_verification_token uuid) TO authenticated;
GRANT ALL ON FUNCTION public.verify_billing_payment_receipt(p_verification_token uuid) TO service_role;


--
-- Name: FUNCTION vimob_can_access_whatsapp_conversation(p_conversation_id uuid, p_permission text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.vimob_can_access_whatsapp_conversation(p_conversation_id uuid, p_permission text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.vimob_can_access_whatsapp_conversation(p_conversation_id uuid, p_permission text) TO anon;
GRANT ALL ON FUNCTION public.vimob_can_access_whatsapp_conversation(p_conversation_id uuid, p_permission text) TO authenticated;
GRANT ALL ON FUNCTION public.vimob_can_access_whatsapp_conversation(p_conversation_id uuid, p_permission text) TO service_role;


--
-- Name: FUNCTION vimob_can_access_whatsapp_session(p_session_id uuid, p_permission text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.vimob_can_access_whatsapp_session(p_session_id uuid, p_permission text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.vimob_can_access_whatsapp_session(p_session_id uuid, p_permission text) TO service_role;


--
-- Name: FUNCTION vimob_can_view_whatsapp_lead(p_organization_id uuid, p_lead_id uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.vimob_can_view_whatsapp_lead(p_organization_id uuid, p_lead_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.vimob_can_view_whatsapp_lead(p_organization_id uuid, p_lead_id uuid) TO service_role;


--
-- Name: FUNCTION vimob_user_has_active_org_membership(p_org_id uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.vimob_user_has_active_org_membership(p_org_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.vimob_user_has_active_org_membership(p_org_id uuid) TO anon;
GRANT ALL ON FUNCTION public.vimob_user_has_active_org_membership(p_org_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.vimob_user_has_active_org_membership(p_org_id uuid) TO service_role;


--
-- Name: FUNCTION vimob_users_share_active_org(p_target_user_id uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.vimob_users_share_active_org(p_target_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.vimob_users_share_active_org(p_target_user_id uuid) TO anon;
GRANT ALL ON FUNCTION public.vimob_users_share_active_org(p_target_user_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.vimob_users_share_active_org(p_target_user_id uuid) TO service_role;


--
-- Name: FUNCTION whatsapp_message_conversation_session_matches(p_conversation_id uuid, p_session_id uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.whatsapp_message_conversation_session_matches(p_conversation_id uuid, p_session_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.whatsapp_message_conversation_session_matches(p_conversation_id uuid, p_session_id uuid) TO service_role;


--
-- Name: FUNCTION whatsapp_webhook_has_lead_creation_context(p_metadata jsonb); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.whatsapp_webhook_has_lead_creation_context(p_metadata jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.whatsapp_webhook_has_lead_creation_context(p_metadata jsonb) TO service_role;


--
-- Name: FUNCTION apply_rls(wal jsonb, max_record_bytes integer); Type: ACL; Schema: realtime; Owner: supabase_admin
--

GRANT ALL ON FUNCTION realtime.apply_rls(wal jsonb, max_record_bytes integer) TO postgres;
GRANT ALL ON FUNCTION realtime.apply_rls(wal jsonb, max_record_bytes integer) TO dashboard_user;
GRANT ALL ON FUNCTION realtime.apply_rls(wal jsonb, max_record_bytes integer) TO anon;
GRANT ALL ON FUNCTION realtime.apply_rls(wal jsonb, max_record_bytes integer) TO authenticated;
GRANT ALL ON FUNCTION realtime.apply_rls(wal jsonb, max_record_bytes integer) TO service_role;
GRANT ALL ON FUNCTION realtime.apply_rls(wal jsonb, max_record_bytes integer) TO supabase_realtime_admin;


--
-- Name: FUNCTION broadcast_changes(topic_name text, event_name text, operation text, table_name text, table_schema text, new record, old record, level text); Type: ACL; Schema: realtime; Owner: supabase_admin
--

GRANT ALL ON FUNCTION realtime.broadcast_changes(topic_name text, event_name text, operation text, table_name text, table_schema text, new record, old record, level text) TO postgres;
GRANT ALL ON FUNCTION realtime.broadcast_changes(topic_name text, event_name text, operation text, table_name text, table_schema text, new record, old record, level text) TO dashboard_user;


--
-- Name: FUNCTION build_prepared_statement_sql(prepared_statement_name text, entity regclass, columns realtime.wal_column[]); Type: ACL; Schema: realtime; Owner: supabase_admin
--

GRANT ALL ON FUNCTION realtime.build_prepared_statement_sql(prepared_statement_name text, entity regclass, columns realtime.wal_column[]) TO postgres;
GRANT ALL ON FUNCTION realtime.build_prepared_statement_sql(prepared_statement_name text, entity regclass, columns realtime.wal_column[]) TO dashboard_user;
GRANT ALL ON FUNCTION realtime.build_prepared_statement_sql(prepared_statement_name text, entity regclass, columns realtime.wal_column[]) TO anon;
GRANT ALL ON FUNCTION realtime.build_prepared_statement_sql(prepared_statement_name text, entity regclass, columns realtime.wal_column[]) TO authenticated;
GRANT ALL ON FUNCTION realtime.build_prepared_statement_sql(prepared_statement_name text, entity regclass, columns realtime.wal_column[]) TO service_role;
GRANT ALL ON FUNCTION realtime.build_prepared_statement_sql(prepared_statement_name text, entity regclass, columns realtime.wal_column[]) TO supabase_realtime_admin;


--
-- Name: FUNCTION "cast"(val text, type_ regtype); Type: ACL; Schema: realtime; Owner: supabase_admin
--

GRANT ALL ON FUNCTION realtime."cast"(val text, type_ regtype) TO postgres;
GRANT ALL ON FUNCTION realtime."cast"(val text, type_ regtype) TO dashboard_user;
GRANT ALL ON FUNCTION realtime."cast"(val text, type_ regtype) TO anon;
GRANT ALL ON FUNCTION realtime."cast"(val text, type_ regtype) TO authenticated;
GRANT ALL ON FUNCTION realtime."cast"(val text, type_ regtype) TO service_role;
GRANT ALL ON FUNCTION realtime."cast"(val text, type_ regtype) TO supabase_realtime_admin;


--
-- Name: FUNCTION check_equality_op(op realtime.equality_op, type_ regtype, val_1 text, val_2 text); Type: ACL; Schema: realtime; Owner: supabase_admin
--

GRANT ALL ON FUNCTION realtime.check_equality_op(op realtime.equality_op, type_ regtype, val_1 text, val_2 text) TO postgres;
GRANT ALL ON FUNCTION realtime.check_equality_op(op realtime.equality_op, type_ regtype, val_1 text, val_2 text) TO dashboard_user;
GRANT ALL ON FUNCTION realtime.check_equality_op(op realtime.equality_op, type_ regtype, val_1 text, val_2 text) TO anon;
GRANT ALL ON FUNCTION realtime.check_equality_op(op realtime.equality_op, type_ regtype, val_1 text, val_2 text) TO authenticated;
GRANT ALL ON FUNCTION realtime.check_equality_op(op realtime.equality_op, type_ regtype, val_1 text, val_2 text) TO service_role;
GRANT ALL ON FUNCTION realtime.check_equality_op(op realtime.equality_op, type_ regtype, val_1 text, val_2 text) TO supabase_realtime_admin;


--
-- Name: FUNCTION is_visible_through_filters(columns realtime.wal_column[], filters realtime.user_defined_filter[]); Type: ACL; Schema: realtime; Owner: supabase_admin
--

GRANT ALL ON FUNCTION realtime.is_visible_through_filters(columns realtime.wal_column[], filters realtime.user_defined_filter[]) TO postgres;
GRANT ALL ON FUNCTION realtime.is_visible_through_filters(columns realtime.wal_column[], filters realtime.user_defined_filter[]) TO dashboard_user;
GRANT ALL ON FUNCTION realtime.is_visible_through_filters(columns realtime.wal_column[], filters realtime.user_defined_filter[]) TO anon;
GRANT ALL ON FUNCTION realtime.is_visible_through_filters(columns realtime.wal_column[], filters realtime.user_defined_filter[]) TO authenticated;
GRANT ALL ON FUNCTION realtime.is_visible_through_filters(columns realtime.wal_column[], filters realtime.user_defined_filter[]) TO service_role;
GRANT ALL ON FUNCTION realtime.is_visible_through_filters(columns realtime.wal_column[], filters realtime.user_defined_filter[]) TO supabase_realtime_admin;


--
-- Name: FUNCTION list_changes(publication name, slot_name name, max_changes integer, max_record_bytes integer); Type: ACL; Schema: realtime; Owner: supabase_admin
--

GRANT ALL ON FUNCTION realtime.list_changes(publication name, slot_name name, max_changes integer, max_record_bytes integer) TO postgres;
GRANT ALL ON FUNCTION realtime.list_changes(publication name, slot_name name, max_changes integer, max_record_bytes integer) TO dashboard_user;
GRANT ALL ON FUNCTION realtime.list_changes(publication name, slot_name name, max_changes integer, max_record_bytes integer) TO anon;
GRANT ALL ON FUNCTION realtime.list_changes(publication name, slot_name name, max_changes integer, max_record_bytes integer) TO authenticated;
GRANT ALL ON FUNCTION realtime.list_changes(publication name, slot_name name, max_changes integer, max_record_bytes integer) TO service_role;
GRANT ALL ON FUNCTION realtime.list_changes(publication name, slot_name name, max_changes integer, max_record_bytes integer) TO supabase_realtime_admin;


--
-- Name: FUNCTION quote_wal2json(entity regclass); Type: ACL; Schema: realtime; Owner: supabase_admin
--

GRANT ALL ON FUNCTION realtime.quote_wal2json(entity regclass) TO postgres;
GRANT ALL ON FUNCTION realtime.quote_wal2json(entity regclass) TO dashboard_user;
GRANT ALL ON FUNCTION realtime.quote_wal2json(entity regclass) TO anon;
GRANT ALL ON FUNCTION realtime.quote_wal2json(entity regclass) TO authenticated;
GRANT ALL ON FUNCTION realtime.quote_wal2json(entity regclass) TO service_role;
GRANT ALL ON FUNCTION realtime.quote_wal2json(entity regclass) TO supabase_realtime_admin;


--
-- Name: FUNCTION send(payload jsonb, event text, topic text, private boolean); Type: ACL; Schema: realtime; Owner: supabase_admin
--

GRANT ALL ON FUNCTION realtime.send(payload jsonb, event text, topic text, private boolean) TO postgres;
GRANT ALL ON FUNCTION realtime.send(payload jsonb, event text, topic text, private boolean) TO dashboard_user;


--
-- Name: FUNCTION subscription_check_filters(); Type: ACL; Schema: realtime; Owner: supabase_admin
--

GRANT ALL ON FUNCTION realtime.subscription_check_filters() TO postgres;
GRANT ALL ON FUNCTION realtime.subscription_check_filters() TO dashboard_user;
GRANT ALL ON FUNCTION realtime.subscription_check_filters() TO anon;
GRANT ALL ON FUNCTION realtime.subscription_check_filters() TO authenticated;
GRANT ALL ON FUNCTION realtime.subscription_check_filters() TO service_role;
GRANT ALL ON FUNCTION realtime.subscription_check_filters() TO supabase_realtime_admin;


--
-- Name: FUNCTION to_regrole(role_name text); Type: ACL; Schema: realtime; Owner: supabase_admin
--

GRANT ALL ON FUNCTION realtime.to_regrole(role_name text) TO postgres;
GRANT ALL ON FUNCTION realtime.to_regrole(role_name text) TO dashboard_user;
GRANT ALL ON FUNCTION realtime.to_regrole(role_name text) TO anon;
GRANT ALL ON FUNCTION realtime.to_regrole(role_name text) TO authenticated;
GRANT ALL ON FUNCTION realtime.to_regrole(role_name text) TO service_role;
GRANT ALL ON FUNCTION realtime.to_regrole(role_name text) TO supabase_realtime_admin;


--
-- Name: FUNCTION topic(); Type: ACL; Schema: realtime; Owner: supabase_realtime_admin
--

GRANT ALL ON FUNCTION realtime.topic() TO postgres;
GRANT ALL ON FUNCTION realtime.topic() TO dashboard_user;


--
-- Name: FUNCTION http_request(); Type: ACL; Schema: supabase_functions; Owner: supabase_functions_admin
--

REVOKE ALL ON FUNCTION supabase_functions.http_request() FROM PUBLIC;
GRANT ALL ON FUNCTION supabase_functions.http_request() TO postgres;
GRANT ALL ON FUNCTION supabase_functions.http_request() TO anon;
GRANT ALL ON FUNCTION supabase_functions.http_request() TO authenticated;
GRANT ALL ON FUNCTION supabase_functions.http_request() TO service_role;


--
-- Name: FUNCTION _crypto_aead_det_decrypt(message bytea, additional bytea, key_id bigint, context bytea, nonce bytea); Type: ACL; Schema: vault; Owner: supabase_admin
--

GRANT ALL ON FUNCTION vault._crypto_aead_det_decrypt(message bytea, additional bytea, key_id bigint, context bytea, nonce bytea) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION vault._crypto_aead_det_decrypt(message bytea, additional bytea, key_id bigint, context bytea, nonce bytea) TO service_role;


--
-- Name: FUNCTION create_secret(new_secret text, new_name text, new_description text, new_key_id uuid); Type: ACL; Schema: vault; Owner: supabase_admin
--

GRANT ALL ON FUNCTION vault.create_secret(new_secret text, new_name text, new_description text, new_key_id uuid) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION vault.create_secret(new_secret text, new_name text, new_description text, new_key_id uuid) TO service_role;


--
-- Name: FUNCTION update_secret(secret_id uuid, new_secret text, new_name text, new_description text, new_key_id uuid); Type: ACL; Schema: vault; Owner: supabase_admin
--

GRANT ALL ON FUNCTION vault.update_secret(secret_id uuid, new_secret text, new_name text, new_description text, new_key_id uuid) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION vault.update_secret(secret_id uuid, new_secret text, new_name text, new_description text, new_key_id uuid) TO service_role;


--
-- Name: TABLE audit_log_entries; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT ALL ON TABLE auth.audit_log_entries TO dashboard_user;
GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE auth.audit_log_entries TO postgres;
GRANT SELECT ON TABLE auth.audit_log_entries TO postgres WITH GRANT OPTION;


--
-- Name: TABLE flow_state; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE auth.flow_state TO postgres;
GRANT SELECT ON TABLE auth.flow_state TO postgres WITH GRANT OPTION;
GRANT ALL ON TABLE auth.flow_state TO dashboard_user;


--
-- Name: TABLE identities; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE auth.identities TO postgres;
GRANT SELECT ON TABLE auth.identities TO postgres WITH GRANT OPTION;
GRANT ALL ON TABLE auth.identities TO dashboard_user;


--
-- Name: TABLE instances; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT ALL ON TABLE auth.instances TO dashboard_user;
GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE auth.instances TO postgres;
GRANT SELECT ON TABLE auth.instances TO postgres WITH GRANT OPTION;


--
-- Name: TABLE mfa_amr_claims; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE auth.mfa_amr_claims TO postgres;
GRANT SELECT ON TABLE auth.mfa_amr_claims TO postgres WITH GRANT OPTION;
GRANT ALL ON TABLE auth.mfa_amr_claims TO dashboard_user;


--
-- Name: TABLE mfa_challenges; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE auth.mfa_challenges TO postgres;
GRANT SELECT ON TABLE auth.mfa_challenges TO postgres WITH GRANT OPTION;
GRANT ALL ON TABLE auth.mfa_challenges TO dashboard_user;


--
-- Name: TABLE mfa_factors; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE auth.mfa_factors TO postgres;
GRANT SELECT ON TABLE auth.mfa_factors TO postgres WITH GRANT OPTION;
GRANT ALL ON TABLE auth.mfa_factors TO dashboard_user;


--
-- Name: TABLE oauth_authorizations; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT ALL ON TABLE auth.oauth_authorizations TO postgres;
GRANT ALL ON TABLE auth.oauth_authorizations TO dashboard_user;


--
-- Name: TABLE oauth_client_states; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT ALL ON TABLE auth.oauth_client_states TO postgres;
GRANT ALL ON TABLE auth.oauth_client_states TO dashboard_user;


--
-- Name: TABLE oauth_clients; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT ALL ON TABLE auth.oauth_clients TO postgres;
GRANT ALL ON TABLE auth.oauth_clients TO dashboard_user;


--
-- Name: TABLE oauth_consents; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT ALL ON TABLE auth.oauth_consents TO postgres;
GRANT ALL ON TABLE auth.oauth_consents TO dashboard_user;


--
-- Name: TABLE one_time_tokens; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE auth.one_time_tokens TO postgres;
GRANT SELECT ON TABLE auth.one_time_tokens TO postgres WITH GRANT OPTION;
GRANT ALL ON TABLE auth.one_time_tokens TO dashboard_user;


--
-- Name: TABLE refresh_tokens; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT ALL ON TABLE auth.refresh_tokens TO dashboard_user;
GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE auth.refresh_tokens TO postgres;
GRANT SELECT ON TABLE auth.refresh_tokens TO postgres WITH GRANT OPTION;


--
-- Name: SEQUENCE refresh_tokens_id_seq; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT ALL ON SEQUENCE auth.refresh_tokens_id_seq TO dashboard_user;
GRANT ALL ON SEQUENCE auth.refresh_tokens_id_seq TO postgres;


--
-- Name: TABLE saml_providers; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE auth.saml_providers TO postgres;
GRANT SELECT ON TABLE auth.saml_providers TO postgres WITH GRANT OPTION;
GRANT ALL ON TABLE auth.saml_providers TO dashboard_user;


--
-- Name: TABLE saml_relay_states; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE auth.saml_relay_states TO postgres;
GRANT SELECT ON TABLE auth.saml_relay_states TO postgres WITH GRANT OPTION;
GRANT ALL ON TABLE auth.saml_relay_states TO dashboard_user;


--
-- Name: TABLE schema_migrations; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT SELECT ON TABLE auth.schema_migrations TO postgres WITH GRANT OPTION;


--
-- Name: TABLE sessions; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE auth.sessions TO postgres;
GRANT SELECT ON TABLE auth.sessions TO postgres WITH GRANT OPTION;
GRANT ALL ON TABLE auth.sessions TO dashboard_user;


--
-- Name: TABLE sso_domains; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE auth.sso_domains TO postgres;
GRANT SELECT ON TABLE auth.sso_domains TO postgres WITH GRANT OPTION;
GRANT ALL ON TABLE auth.sso_domains TO dashboard_user;


--
-- Name: TABLE sso_providers; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE auth.sso_providers TO postgres;
GRANT SELECT ON TABLE auth.sso_providers TO postgres WITH GRANT OPTION;
GRANT ALL ON TABLE auth.sso_providers TO dashboard_user;


--
-- Name: TABLE users; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT ALL ON TABLE auth.users TO dashboard_user;
GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE auth.users TO postgres;
GRANT SELECT ON TABLE auth.users TO postgres WITH GRANT OPTION;


--
-- Name: TABLE pg_stat_statements; Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON TABLE extensions.pg_stat_statements TO postgres WITH GRANT OPTION;


--
-- Name: TABLE pg_stat_statements_info; Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON TABLE extensions.pg_stat_statements_info TO postgres WITH GRANT OPTION;


--
-- Name: TABLE billing_card_recurrence_provisions; Type: ACL; Schema: private; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE private.billing_card_recurrence_provisions TO service_role;


--
-- Name: TABLE crm_management_create_requests; Type: ACL; Schema: private; Owner: postgres
--

GRANT SELECT,INSERT ON TABLE private.crm_management_create_requests TO service_role;


--
-- Name: TABLE stage_inactivity_jobs; Type: ACL; Schema: private; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE private.stage_inactivity_jobs TO service_role;


--
-- Name: TABLE stage_inactivity_lead_scopes; Type: ACL; Schema: private; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE private.stage_inactivity_lead_scopes TO service_role;


--
-- Name: TABLE stage_inactivity_policies; Type: ACL; Schema: private; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE private.stage_inactivity_policies TO service_role;


--
-- Name: TABLE whatsapp_quick_replies; Type: ACL; Schema: private; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE private.whatsapp_quick_replies TO service_role;


--
-- Name: TABLE whatsapp_webhook_ignored_events; Type: ACL; Schema: private; Owner: postgres
--

GRANT SELECT,INSERT ON TABLE private.whatsapp_webhook_ignored_events TO service_role;


--
-- Name: TABLE whatsapp_webhook_session_cutovers; Type: ACL; Schema: private; Owner: postgres
--

GRANT SELECT ON TABLE private.whatsapp_webhook_session_cutovers TO service_role;


--
-- Name: TABLE activities; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.activities TO anon;
GRANT ALL ON TABLE public.activities TO authenticated;
GRANT ALL ON TABLE public.activities TO service_role;


--
-- Name: TABLE admin_subscription_plans; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.admin_subscription_plans TO anon;
GRANT ALL ON TABLE public.admin_subscription_plans TO authenticated;
GRANT ALL ON TABLE public.admin_subscription_plans TO service_role;


--
-- Name: TABLE ai_agent_conversations; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.ai_agent_conversations TO anon;
GRANT ALL ON TABLE public.ai_agent_conversations TO authenticated;
GRANT ALL ON TABLE public.ai_agent_conversations TO service_role;


--
-- Name: TABLE ai_agents; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.ai_agents TO anon;
GRANT ALL ON TABLE public.ai_agents TO authenticated;
GRANT ALL ON TABLE public.ai_agents TO service_role;


--
-- Name: TABLE ai_conversation_states; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.ai_conversation_states TO anon;
GRANT ALL ON TABLE public.ai_conversation_states TO authenticated;
GRANT ALL ON TABLE public.ai_conversation_states TO service_role;


--
-- Name: TABLE ai_global_agent_versions; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.ai_global_agent_versions TO anon;
GRANT ALL ON TABLE public.ai_global_agent_versions TO authenticated;
GRANT ALL ON TABLE public.ai_global_agent_versions TO service_role;


--
-- Name: TABLE ai_global_agents; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.ai_global_agents TO anon;
GRANT ALL ON TABLE public.ai_global_agents TO authenticated;
GRANT ALL ON TABLE public.ai_global_agents TO service_role;


--
-- Name: TABLE ai_interaction_logs; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.ai_interaction_logs TO anon;
GRANT ALL ON TABLE public.ai_interaction_logs TO authenticated;
GRANT ALL ON TABLE public.ai_interaction_logs TO service_role;


--
-- Name: TABLE ai_jobs; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.ai_jobs TO anon;
GRANT ALL ON TABLE public.ai_jobs TO authenticated;
GRANT ALL ON TABLE public.ai_jobs TO service_role;


--
-- Name: TABLE ai_organization_settings; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.ai_organization_settings TO anon;
GRANT ALL ON TABLE public.ai_organization_settings TO authenticated;
GRANT ALL ON TABLE public.ai_organization_settings TO service_role;


--
-- Name: TABLE ai_outbox_messages; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.ai_outbox_messages TO anon;
GRANT ALL ON TABLE public.ai_outbox_messages TO authenticated;
GRANT ALL ON TABLE public.ai_outbox_messages TO service_role;


--
-- Name: TABLE ai_preview_messages; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.ai_preview_messages TO anon;
GRANT ALL ON TABLE public.ai_preview_messages TO authenticated;
GRANT ALL ON TABLE public.ai_preview_messages TO service_role;


--
-- Name: TABLE ai_preview_sessions; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.ai_preview_sessions TO anon;
GRANT ALL ON TABLE public.ai_preview_sessions TO authenticated;
GRANT ALL ON TABLE public.ai_preview_sessions TO service_role;


--
-- Name: TABLE ai_routing_rules; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.ai_routing_rules TO anon;
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.ai_routing_rules TO authenticated;
GRANT ALL ON TABLE public.ai_routing_rules TO service_role;


--
-- Name: TABLE announcements; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.announcements TO anon;
GRANT ALL ON TABLE public.announcements TO authenticated;
GRANT ALL ON TABLE public.announcements TO service_role;


--
-- Name: TABLE asaas_payments; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.asaas_payments TO service_role;


--
-- Name: TABLE assignments_log; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.assignments_log TO anon;
GRANT ALL ON TABLE public.assignments_log TO authenticated;
GRANT ALL ON TABLE public.assignments_log TO service_role;


--
-- Name: TABLE audit_logs; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.audit_logs TO service_role;


--
-- Name: TABLE automation_circuit_breakers; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.automation_circuit_breakers TO anon;
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.automation_circuit_breakers TO authenticated;
GRANT ALL ON TABLE public.automation_circuit_breakers TO service_role;


--
-- Name: TABLE automation_connections; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.automation_connections TO anon;
GRANT ALL ON TABLE public.automation_connections TO authenticated;
GRANT ALL ON TABLE public.automation_connections TO service_role;


--
-- Name: TABLE automation_edges; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.automation_edges TO anon;
GRANT ALL ON TABLE public.automation_edges TO authenticated;
GRANT ALL ON TABLE public.automation_edges TO service_role;


--
-- Name: TABLE automation_effect_dispatches; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.automation_effect_dispatches TO anon;
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.automation_effect_dispatches TO authenticated;
GRANT ALL ON TABLE public.automation_effect_dispatches TO service_role;


--
-- Name: TABLE automation_execution_steps; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.automation_execution_steps TO anon;
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.automation_execution_steps TO authenticated;
GRANT ALL ON TABLE public.automation_execution_steps TO service_role;


--
-- Name: TABLE automation_flow_versions; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.automation_flow_versions TO anon;
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.automation_flow_versions TO authenticated;
GRANT ALL ON TABLE public.automation_flow_versions TO service_role;


--
-- Name: TABLE automation_message_dispatches; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.automation_message_dispatches TO anon;
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.automation_message_dispatches TO authenticated;
GRANT ALL ON TABLE public.automation_message_dispatches TO service_role;


--
-- Name: TABLE automation_nodes; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.automation_nodes TO anon;
GRANT ALL ON TABLE public.automation_nodes TO authenticated;
GRANT ALL ON TABLE public.automation_nodes TO service_role;


--
-- Name: TABLE automation_schedule_state; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.automation_schedule_state TO anon;
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.automation_schedule_state TO authenticated;
GRANT ALL ON TABLE public.automation_schedule_state TO service_role;


--
-- Name: TABLE automation_templates; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.automation_templates TO anon;
GRANT ALL ON TABLE public.automation_templates TO authenticated;
GRANT ALL ON TABLE public.automation_templates TO service_role;


--
-- Name: TABLE automations; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.automations TO anon;
GRANT ALL ON TABLE public.automations TO authenticated;
GRANT ALL ON TABLE public.automations TO service_role;


--
-- Name: TABLE available_permissions; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.available_permissions TO service_role;
GRANT SELECT ON TABLE public.available_permissions TO authenticated;


--
-- Name: TABLE billing_payment_checkout_capabilities; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.billing_payment_checkout_capabilities TO service_role;


--
-- Name: TABLE billing_payment_receipts; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.billing_payment_receipts TO service_role;
GRANT SELECT ON TABLE public.billing_payment_receipts TO authenticated;


--
-- Name: TABLE broker_monthly_goals; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.broker_monthly_goals TO anon;
GRANT ALL ON TABLE public.broker_monthly_goals TO authenticated;
GRANT ALL ON TABLE public.broker_monthly_goals TO service_role;


--
-- Name: TABLE cadence_enrollments; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.cadence_enrollments TO anon;
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.cadence_enrollments TO authenticated;
GRANT ALL ON TABLE public.cadence_enrollments TO service_role;


--
-- Name: TABLE cadence_tasks_template; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.cadence_tasks_template TO anon;
GRANT ALL ON TABLE public.cadence_tasks_template TO authenticated;
GRANT ALL ON TABLE public.cadence_tasks_template TO service_role;


--
-- Name: TABLE cadence_templates; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.cadence_templates TO anon;
GRANT ALL ON TABLE public.cadence_templates TO authenticated;
GRANT ALL ON TABLE public.cadence_templates TO service_role;


--
-- Name: TABLE chatbot_conversation_state; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.chatbot_conversation_state TO anon;
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.chatbot_conversation_state TO authenticated;
GRANT ALL ON TABLE public.chatbot_conversation_state TO service_role;


--
-- Name: SEQUENCE chatbot_conversation_state_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE public.chatbot_conversation_state_id_seq TO anon;
GRANT ALL ON SEQUENCE public.chatbot_conversation_state_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.chatbot_conversation_state_id_seq TO service_role;


--
-- Name: TABLE chatbot_inbound_messages; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.chatbot_inbound_messages TO anon;
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.chatbot_inbound_messages TO authenticated;
GRANT ALL ON TABLE public.chatbot_inbound_messages TO service_role;


--
-- Name: SEQUENCE chatbot_inbound_messages_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE public.chatbot_inbound_messages_id_seq TO anon;
GRANT ALL ON SEQUENCE public.chatbot_inbound_messages_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.chatbot_inbound_messages_id_seq TO service_role;


--
-- Name: TABLE commission_history; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.commission_history TO anon;
GRANT ALL ON TABLE public.commission_history TO authenticated;
GRANT ALL ON TABLE public.commission_history TO service_role;


--
-- Name: TABLE commission_rules; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.commission_rules TO anon;
GRANT ALL ON TABLE public.commission_rules TO authenticated;
GRANT ALL ON TABLE public.commission_rules TO service_role;


--
-- Name: TABLE commissions; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.commissions TO anon;
GRANT ALL ON TABLE public.commissions TO authenticated;
GRANT ALL ON TABLE public.commissions TO service_role;


--
-- Name: TABLE construction_daily_reports; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.construction_daily_reports TO anon;
GRANT ALL ON TABLE public.construction_daily_reports TO authenticated;
GRANT ALL ON TABLE public.construction_daily_reports TO service_role;


--
-- Name: TABLE construction_documents; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.construction_documents TO anon;
GRANT ALL ON TABLE public.construction_documents TO authenticated;
GRANT ALL ON TABLE public.construction_documents TO service_role;


--
-- Name: TABLE construction_milestones; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.construction_milestones TO anon;
GRANT ALL ON TABLE public.construction_milestones TO authenticated;
GRANT ALL ON TABLE public.construction_milestones TO service_role;


--
-- Name: TABLE construction_projects; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.construction_projects TO anon;
GRANT ALL ON TABLE public.construction_projects TO authenticated;
GRANT ALL ON TABLE public.construction_projects TO service_role;


--
-- Name: TABLE construction_purchase_order_items; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.construction_purchase_order_items TO anon;
GRANT ALL ON TABLE public.construction_purchase_order_items TO authenticated;
GRANT ALL ON TABLE public.construction_purchase_order_items TO service_role;


--
-- Name: TABLE construction_purchase_orders; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.construction_purchase_orders TO anon;
GRANT ALL ON TABLE public.construction_purchase_orders TO authenticated;
GRANT ALL ON TABLE public.construction_purchase_orders TO service_role;


--
-- Name: TABLE construction_suppliers; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.construction_suppliers TO anon;
GRANT ALL ON TABLE public.construction_suppliers TO authenticated;
GRANT ALL ON TABLE public.construction_suppliers TO service_role;


--
-- Name: TABLE construction_team_members; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.construction_team_members TO anon;
GRANT ALL ON TABLE public.construction_team_members TO authenticated;
GRANT ALL ON TABLE public.construction_team_members TO service_role;


--
-- Name: TABLE construction_teams; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.construction_teams TO anon;
GRANT ALL ON TABLE public.construction_teams TO authenticated;
GRANT ALL ON TABLE public.construction_teams TO service_role;


--
-- Name: TABLE contract_brokers; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.contract_brokers TO anon;
GRANT ALL ON TABLE public.contract_brokers TO authenticated;
GRANT ALL ON TABLE public.contract_brokers TO service_role;


--
-- Name: TABLE contract_sequences; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.contract_sequences TO anon;
GRANT ALL ON TABLE public.contract_sequences TO authenticated;
GRANT ALL ON TABLE public.contract_sequences TO service_role;


--
-- Name: TABLE contracts; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.contracts TO anon;
GRANT ALL ON TABLE public.contracts TO authenticated;
GRANT ALL ON TABLE public.contracts TO service_role;


--
-- Name: TABLE conversation_ai_state; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.conversation_ai_state TO anon;
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.conversation_ai_state TO authenticated;
GRANT ALL ON TABLE public.conversation_ai_state TO service_role;


--
-- Name: TABLE coverage_areas; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.coverage_areas TO anon;
GRANT ALL ON TABLE public.coverage_areas TO authenticated;
GRANT ALL ON TABLE public.coverage_areas TO service_role;


--
-- Name: TABLE dre_account_groups; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.dre_account_groups TO anon;
GRANT ALL ON TABLE public.dre_account_groups TO authenticated;
GRANT ALL ON TABLE public.dre_account_groups TO service_role;


--
-- Name: TABLE dre_account_mappings; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.dre_account_mappings TO anon;
GRANT ALL ON TABLE public.dre_account_mappings TO authenticated;
GRANT ALL ON TABLE public.dre_account_mappings TO service_role;


--
-- Name: TABLE edge_rate_limits; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.edge_rate_limits TO anon;
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.edge_rate_limits TO authenticated;
GRANT ALL ON TABLE public.edge_rate_limits TO service_role;


--
-- Name: TABLE email_delivery_events; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT ON TABLE public.email_delivery_events TO service_role;


--
-- Name: TABLE email_logs; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,MAINTAIN ON TABLE public.email_logs TO anon;
GRANT SELECT,MAINTAIN ON TABLE public.email_logs TO authenticated;
GRANT ALL ON TABLE public.email_logs TO service_role;


--
-- Name: TABLE email_templates; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.email_templates TO anon;
GRANT ALL ON TABLE public.email_templates TO authenticated;
GRANT ALL ON TABLE public.email_templates TO service_role;


--
-- Name: TABLE error_events; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.error_events TO anon;
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.error_events TO authenticated;
GRANT ALL ON TABLE public.error_events TO service_role;


--
-- Name: TABLE events; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.events TO anon;
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.events TO authenticated;
GRANT ALL ON TABLE public.events TO service_role;


--
-- Name: TABLE feature_requests; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.feature_requests TO anon;
GRANT ALL ON TABLE public.feature_requests TO authenticated;
GRANT ALL ON TABLE public.feature_requests TO service_role;


--
-- Name: TABLE financial_categories; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.financial_categories TO anon;
GRANT ALL ON TABLE public.financial_categories TO authenticated;
GRANT ALL ON TABLE public.financial_categories TO service_role;


--
-- Name: TABLE financial_entries; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.financial_entries TO anon;
GRANT ALL ON TABLE public.financial_entries TO authenticated;
GRANT ALL ON TABLE public.financial_entries TO service_role;


--
-- Name: TABLE gamification_activity_logs; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.gamification_activity_logs TO anon;
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.gamification_activity_logs TO authenticated;
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.gamification_activity_logs TO service_role;


--
-- Name: TABLE gamification_events; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.gamification_events TO anon;
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.gamification_events TO authenticated;
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.gamification_events TO service_role;


--
-- Name: TABLE gamification_manual_entries; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.gamification_manual_entries TO anon;
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.gamification_manual_entries TO authenticated;
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.gamification_manual_entries TO service_role;


--
-- Name: TABLE gamification_mission_progress; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.gamification_mission_progress TO anon;
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.gamification_mission_progress TO authenticated;
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.gamification_mission_progress TO service_role;


--
-- Name: TABLE gamification_missions; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.gamification_missions TO anon;
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.gamification_missions TO authenticated;
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.gamification_missions TO service_role;


--
-- Name: TABLE gamification_outbox; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.gamification_outbox TO anon;
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.gamification_outbox TO authenticated;
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.gamification_outbox TO service_role;


--
-- Name: TABLE gamification_participants; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.gamification_participants TO anon;
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.gamification_participants TO authenticated;
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.gamification_participants TO service_role;


--
-- Name: TABLE gamification_rankings; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.gamification_rankings TO anon;
GRANT ALL ON TABLE public.gamification_rankings TO authenticated;
GRANT ALL ON TABLE public.gamification_rankings TO service_role;


--
-- Name: TABLE gamification_rules; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.gamification_rules TO anon;
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.gamification_rules TO authenticated;
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.gamification_rules TO service_role;


--
-- Name: TABLE gamification_seasons; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.gamification_seasons TO anon;
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.gamification_seasons TO authenticated;
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.gamification_seasons TO service_role;


--
-- Name: TABLE gamification_streaks; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.gamification_streaks TO anon;
GRANT ALL ON TABLE public.gamification_streaks TO authenticated;
GRANT ALL ON TABLE public.gamification_streaks TO service_role;


--
-- Name: TABLE google_calendar_channels; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.google_calendar_channels TO service_role;


--
-- Name: TABLE google_calendar_event_links; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.google_calendar_event_links TO service_role;


--
-- Name: TABLE google_calendar_oauth_states; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.google_calendar_oauth_states TO service_role;


--
-- Name: TABLE google_calendar_tokens; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.google_calendar_tokens TO service_role;


--
-- Name: TABLE help_articles; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT ON TABLE public.help_articles TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.help_articles TO service_role;


--
-- Name: TABLE home_publications; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.home_publications TO service_role;


--
-- Name: TABLE imoview_integrations; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.imoview_integrations TO anon;
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.imoview_integrations TO authenticated;
GRANT ALL ON TABLE public.imoview_integrations TO service_role;


--
-- Name: TABLE secrets; Type: ACL; Schema: vault; Owner: supabase_admin
--

GRANT SELECT,REFERENCES,DELETE,TRUNCATE ON TABLE vault.secrets TO postgres WITH GRANT OPTION;
GRANT SELECT,DELETE ON TABLE vault.secrets TO service_role;


--
-- Name: TABLE decrypted_secrets; Type: ACL; Schema: vault; Owner: supabase_admin
--

GRANT SELECT,REFERENCES,DELETE,TRUNCATE ON TABLE vault.decrypted_secrets TO postgres WITH GRANT OPTION;
GRANT SELECT,DELETE ON TABLE vault.decrypted_secrets TO service_role;


--
-- Name: TABLE imoview_integrations_service; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.imoview_integrations_service TO anon;
GRANT ALL ON TABLE public.imoview_integrations_service TO authenticated;
GRANT ALL ON TABLE public.imoview_integrations_service TO service_role;


--
-- Name: TABLE incident_20260701_pool_redistribution_backup; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.incident_20260701_pool_redistribution_backup TO anon;
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.incident_20260701_pool_redistribution_backup TO authenticated;
GRANT ALL ON TABLE public.incident_20260701_pool_redistribution_backup TO service_role;


--
-- Name: TABLE invitations; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.invitations TO service_role;


--
-- Name: TABLE jobs; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.jobs TO anon;
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.jobs TO authenticated;
GRANT ALL ON TABLE public.jobs TO service_role;


--
-- Name: TABLE lead_action_facts; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.lead_action_facts TO anon;
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.lead_action_facts TO authenticated;
GRANT ALL ON TABLE public.lead_action_facts TO service_role;


--
-- Name: TABLE lead_assignment_cycles; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.lead_assignment_cycles TO anon;
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.lead_assignment_cycles TO authenticated;
GRANT ALL ON TABLE public.lead_assignment_cycles TO service_role;


--
-- Name: TABLE lead_assignment_history; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.lead_assignment_history TO anon;
GRANT ALL ON TABLE public.lead_assignment_history TO authenticated;
GRANT ALL ON TABLE public.lead_assignment_history TO service_role;


--
-- Name: TABLE lead_attachments; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.lead_attachments TO anon;
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.lead_attachments TO authenticated;
GRANT ALL ON TABLE public.lead_attachments TO service_role;


--
-- Name: TABLE lead_attention_events; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.lead_attention_events TO anon;
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.lead_attention_events TO authenticated;
GRANT ALL ON TABLE public.lead_attention_events TO service_role;


--
-- Name: TABLE lead_attention_instances; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.lead_attention_instances TO anon;
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.lead_attention_instances TO authenticated;
GRANT ALL ON TABLE public.lead_attention_instances TO service_role;


--
-- Name: TABLE lead_attention_policies; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.lead_attention_policies TO anon;
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.lead_attention_policies TO authenticated;
GRANT ALL ON TABLE public.lead_attention_policies TO service_role;


--
-- Name: TABLE lead_entry_events; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.lead_entry_events TO service_role;


--
-- Name: TABLE lead_events; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.lead_events TO anon;
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.lead_events TO authenticated;
GRANT ALL ON TABLE public.lead_events TO service_role;


--
-- Name: TABLE lead_meta; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.lead_meta TO anon;
GRANT ALL ON TABLE public.lead_meta TO authenticated;
GRANT ALL ON TABLE public.lead_meta TO service_role;


--
-- Name: TABLE lead_pool_history; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.lead_pool_history TO anon;
GRANT ALL ON TABLE public.lead_pool_history TO authenticated;
GRANT ALL ON TABLE public.lead_pool_history TO service_role;


--
-- Name: TABLE lead_property_interests; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.lead_property_interests TO anon;
GRANT ALL ON TABLE public.lead_property_interests TO authenticated;
GRANT ALL ON TABLE public.lead_property_interests TO service_role;


--
-- Name: TABLE lead_redistribution_jobs; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,MAINTAIN ON TABLE public.lead_redistribution_jobs TO anon;
GRANT SELECT,MAINTAIN ON TABLE public.lead_redistribution_jobs TO authenticated;
GRANT ALL ON TABLE public.lead_redistribution_jobs TO service_role;


--
-- Name: TABLE lead_sources; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.lead_sources TO service_role;
GRANT ALL ON TABLE public.lead_sources TO anon;
GRANT ALL ON TABLE public.lead_sources TO authenticated;


--
-- Name: TABLE lead_stage_cycles; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.lead_stage_cycles TO anon;
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.lead_stage_cycles TO authenticated;
GRANT ALL ON TABLE public.lead_stage_cycles TO service_role;


--
-- Name: TABLE lead_stage_history; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.lead_stage_history TO anon;
GRANT ALL ON TABLE public.lead_stage_history TO authenticated;
GRANT ALL ON TABLE public.lead_stage_history TO service_role;


--
-- Name: TABLE lead_tags; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.lead_tags TO anon;
GRANT ALL ON TABLE public.lead_tags TO authenticated;
GRANT ALL ON TABLE public.lead_tags TO service_role;


--
-- Name: TABLE lead_tasks; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.lead_tasks TO anon;
GRANT ALL ON TABLE public.lead_tasks TO authenticated;
GRANT ALL ON TABLE public.lead_tasks TO service_role;


--
-- Name: TABLE lead_timeline_events; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.lead_timeline_events TO service_role;


--
-- Name: TABLE legal_consents; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.legal_consents TO anon;
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.legal_consents TO authenticated;
GRANT SELECT,INSERT ON TABLE public.legal_consents TO service_role;


--
-- Name: TABLE member_availability; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.member_availability TO service_role;


--
-- Name: TABLE meta_campaign_insights; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.meta_campaign_insights TO service_role;


--
-- Name: TABLE meta_conversations; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.meta_conversations TO service_role;


--
-- Name: TABLE meta_form_configs; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.meta_form_configs TO service_role;


--
-- Name: TABLE meta_integrations; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.meta_integrations TO service_role;


--
-- Name: TABLE meta_integrations_public; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.meta_integrations_public TO service_role;


--
-- Name: TABLE meta_messages; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT ON TABLE public.meta_messages TO service_role;


--
-- Name: TABLE meta_webhook_events; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.meta_webhook_events TO service_role;


--
-- Name: TABLE notification_logs; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.notification_logs TO anon;
GRANT ALL ON TABLE public.notification_logs TO authenticated;
GRANT ALL ON TABLE public.notification_logs TO service_role;


--
-- Name: TABLE notification_settings; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.notification_settings TO anon;
GRANT ALL ON TABLE public.notification_settings TO authenticated;
GRANT ALL ON TABLE public.notification_settings TO service_role;


--
-- Name: TABLE notification_templates; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.notification_templates TO anon;
GRANT ALL ON TABLE public.notification_templates TO authenticated;
GRANT ALL ON TABLE public.notification_templates TO service_role;


--
-- Name: TABLE notifications; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.notifications TO service_role;


--
-- Name: TABLE onboarding_requests; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.onboarding_requests TO anon;
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.onboarding_requests TO authenticated;
GRANT ALL ON TABLE public.onboarding_requests TO service_role;


--
-- Name: TABLE operational_requests; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.operational_requests TO anon;
GRANT ALL ON TABLE public.operational_requests TO authenticated;
GRANT ALL ON TABLE public.operational_requests TO service_role;


--
-- Name: TABLE operational_timelines; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.operational_timelines TO anon;
GRANT ALL ON TABLE public.operational_timelines TO authenticated;
GRANT ALL ON TABLE public.operational_timelines TO service_role;


--
-- Name: TABLE organization_ai_settings; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.organization_ai_settings TO anon;
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.organization_ai_settings TO authenticated;
GRANT ALL ON TABLE public.organization_ai_settings TO service_role;


--
-- Name: TABLE organization_api_keys; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.organization_api_keys TO anon;
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.organization_api_keys TO authenticated;
GRANT ALL ON TABLE public.organization_api_keys TO service_role;


--
-- Name: TABLE organization_attention_settings; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.organization_attention_settings TO anon;
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.organization_attention_settings TO authenticated;
GRANT ALL ON TABLE public.organization_attention_settings TO service_role;


--
-- Name: TABLE organization_checkout_capabilities; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.organization_checkout_capabilities TO service_role;


--
-- Name: TABLE organization_kpi_cache; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.organization_kpi_cache TO anon;
GRANT ALL ON TABLE public.organization_kpi_cache TO authenticated;
GRANT ALL ON TABLE public.organization_kpi_cache TO service_role;


--
-- Name: TABLE organization_members; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.organization_members TO service_role;
GRANT SELECT ON TABLE public.organization_members TO anon;
GRANT SELECT ON TABLE public.organization_members TO authenticated;


--
-- Name: TABLE organization_modules; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.organization_modules TO service_role;
GRANT SELECT ON TABLE public.organization_modules TO anon;
GRANT SELECT ON TABLE public.organization_modules TO authenticated;


--
-- Name: TABLE organization_role_permissions; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.organization_role_permissions TO service_role;
GRANT SELECT ON TABLE public.organization_role_permissions TO anon;
GRANT SELECT ON TABLE public.organization_role_permissions TO authenticated;


--
-- Name: TABLE organization_roles; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.organization_roles TO service_role;
GRANT SELECT ON TABLE public.organization_roles TO anon;
GRANT SELECT ON TABLE public.organization_roles TO authenticated;


--
-- Name: TABLE organization_sites; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.organization_sites TO anon;
GRANT ALL ON TABLE public.organization_sites TO authenticated;
GRANT ALL ON TABLE public.organization_sites TO service_role;


--
-- Name: TABLE organizations; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.organizations TO service_role;


--
-- Name: COLUMN organizations.id; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(id) ON TABLE public.organizations TO authenticated;


--
-- Name: COLUMN organizations.name; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(name) ON TABLE public.organizations TO authenticated;


--
-- Name: COLUMN organizations.logo_url; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(logo_url) ON TABLE public.organizations TO authenticated;


--
-- Name: COLUMN organizations.logo_size; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(logo_size) ON TABLE public.organizations TO authenticated;


--
-- Name: COLUMN organizations.accent_color; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(accent_color) ON TABLE public.organizations TO authenticated;


--
-- Name: COLUMN organizations.segment; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(segment) ON TABLE public.organizations TO authenticated;


--
-- Name: COLUMN organizations.theme_mode; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(theme_mode) ON TABLE public.organizations TO authenticated;


--
-- Name: COLUMN organizations.created_at; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(created_at) ON TABLE public.organizations TO authenticated;


--
-- Name: COLUMN organizations.updated_at; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(updated_at) ON TABLE public.organizations TO authenticated;


--
-- Name: COLUMN organizations.created_by; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(created_by) ON TABLE public.organizations TO authenticated;


--
-- Name: COLUMN organizations.is_active; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(is_active) ON TABLE public.organizations TO authenticated;


--
-- Name: COLUMN organizations.subscription_status; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(subscription_status) ON TABLE public.organizations TO authenticated;


--
-- Name: COLUMN organizations.max_users; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(max_users) ON TABLE public.organizations TO authenticated;


--
-- Name: COLUMN organizations.admin_notes; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(admin_notes) ON TABLE public.organizations TO authenticated;


--
-- Name: COLUMN organizations.last_access_at; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(last_access_at) ON TABLE public.organizations TO authenticated;


--
-- Name: COLUMN organizations.plan_id; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(plan_id) ON TABLE public.organizations TO authenticated;


--
-- Name: COLUMN organizations.trial_ends_at; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(trial_ends_at) ON TABLE public.organizations TO authenticated;


--
-- Name: COLUMN organizations.subscription_type; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(subscription_type) ON TABLE public.organizations TO authenticated;


--
-- Name: COLUMN organizations.cnpj; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(cnpj) ON TABLE public.organizations TO authenticated;


--
-- Name: COLUMN organizations.inscricao_estadual; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(inscricao_estadual) ON TABLE public.organizations TO authenticated;


--
-- Name: COLUMN organizations.razao_social; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(razao_social) ON TABLE public.organizations TO authenticated;


--
-- Name: COLUMN organizations.nome_fantasia; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(nome_fantasia) ON TABLE public.organizations TO authenticated;


--
-- Name: COLUMN organizations.cep; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(cep) ON TABLE public.organizations TO authenticated;


--
-- Name: COLUMN organizations.endereco; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(endereco) ON TABLE public.organizations TO authenticated;


--
-- Name: COLUMN organizations.numero; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(numero) ON TABLE public.organizations TO authenticated;


--
-- Name: COLUMN organizations.complemento; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(complemento) ON TABLE public.organizations TO authenticated;


--
-- Name: COLUMN organizations.bairro; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(bairro) ON TABLE public.organizations TO authenticated;


--
-- Name: COLUMN organizations.cidade; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(cidade) ON TABLE public.organizations TO authenticated;


--
-- Name: COLUMN organizations.uf; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(uf) ON TABLE public.organizations TO authenticated;


--
-- Name: COLUMN organizations.telefone; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(telefone) ON TABLE public.organizations TO authenticated;


--
-- Name: COLUMN organizations.whatsapp; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(whatsapp) ON TABLE public.organizations TO authenticated;


--
-- Name: COLUMN organizations.email; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(email) ON TABLE public.organizations TO authenticated;


--
-- Name: COLUMN organizations.website; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(website) ON TABLE public.organizations TO authenticated;


--
-- Name: COLUMN organizations.default_commission_percentage; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(default_commission_percentage) ON TABLE public.organizations TO authenticated;


--
-- Name: COLUMN organizations.asaas_customer_id; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(asaas_customer_id) ON TABLE public.organizations TO authenticated;


--
-- Name: COLUMN organizations.asaas_payment_link_id; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(asaas_payment_link_id) ON TABLE public.organizations TO authenticated;


--
-- Name: COLUMN organizations.asaas_payment_link_url; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(asaas_payment_link_url) ON TABLE public.organizations TO authenticated;


--
-- Name: COLUMN organizations.asaas_subscription_id; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(asaas_subscription_id) ON TABLE public.organizations TO authenticated;


--
-- Name: COLUMN organizations.subscription_value; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(subscription_value) ON TABLE public.organizations TO authenticated;


--
-- Name: COLUMN organizations.billing_day; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(billing_day) ON TABLE public.organizations TO authenticated;


--
-- Name: COLUMN organizations.is_financial_module_enabled; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(is_financial_module_enabled) ON TABLE public.organizations TO authenticated;


--
-- Name: COLUMN organizations.next_billing_date; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(next_billing_date) ON TABLE public.organizations TO authenticated;


--
-- Name: COLUMN organizations.creci; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(creci) ON TABLE public.organizations TO authenticated;


--
-- Name: COLUMN organizations.max_whatsapp_sessions_override; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(max_whatsapp_sessions_override) ON TABLE public.organizations TO authenticated;


--
-- Name: COLUMN organizations.slug; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(slug) ON TABLE public.organizations TO authenticated;


--
-- Name: COLUMN organizations.property_edit_policy; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(property_edit_policy) ON TABLE public.organizations TO authenticated;


--
-- Name: COLUMN organizations.property_owner_contact_visibility; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(property_owner_contact_visibility) ON TABLE public.organizations TO authenticated;


--
-- Name: COLUMN organizations.asaas_last_event_id; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(asaas_last_event_id) ON TABLE public.organizations TO authenticated;


--
-- Name: COLUMN organizations.asaas_last_event_at; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(asaas_last_event_at) ON TABLE public.organizations TO authenticated;


--
-- Name: COLUMN organizations.pending_plan_id; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(pending_plan_id) ON TABLE public.organizations TO authenticated;


--
-- Name: COLUMN organizations.billing_status_changed_at; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(billing_status_changed_at) ON TABLE public.organizations TO authenticated;


--
-- Name: COLUMN organizations.billing_delinquent_at; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(billing_delinquent_at) ON TABLE public.organizations TO authenticated;


--
-- Name: COLUMN organizations.billing_grace_until; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(billing_grace_until) ON TABLE public.organizations TO authenticated;


--
-- Name: COLUMN organizations.billing_blocked_at; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(billing_blocked_at) ON TABLE public.organizations TO authenticated;


--
-- Name: COLUMN organizations.billing_last_reconciled_at; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(billing_last_reconciled_at) ON TABLE public.organizations TO authenticated;


--
-- Name: COLUMN organizations.billing_legal_name; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(billing_legal_name) ON TABLE public.organizations TO authenticated;


--
-- Name: COLUMN organizations.billing_tax_id; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(billing_tax_id) ON TABLE public.organizations TO authenticated;


--
-- Name: COLUMN organizations.billing_email; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(billing_email) ON TABLE public.organizations TO authenticated;


--
-- Name: COLUMN organizations.billing_phone; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(billing_phone) ON TABLE public.organizations TO authenticated;


--
-- Name: COLUMN organizations.billing_postal_code; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(billing_postal_code) ON TABLE public.organizations TO authenticated;


--
-- Name: COLUMN organizations.billing_address; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(billing_address) ON TABLE public.organizations TO authenticated;


--
-- Name: COLUMN organizations.billing_address_number; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(billing_address_number) ON TABLE public.organizations TO authenticated;


--
-- Name: COLUMN organizations.billing_address_complement; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(billing_address_complement) ON TABLE public.organizations TO authenticated;


--
-- Name: COLUMN organizations.billing_neighborhood; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(billing_neighborhood) ON TABLE public.organizations TO authenticated;


--
-- Name: COLUMN organizations.billing_city; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(billing_city) ON TABLE public.organizations TO authenticated;


--
-- Name: COLUMN organizations.billing_state; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(billing_state) ON TABLE public.organizations TO authenticated;


--
-- Name: COLUMN organizations.subscription_billing_period_months; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(subscription_billing_period_months) ON TABLE public.organizations TO authenticated;


--
-- Name: COLUMN organizations.signup_requires_payment; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(signup_requires_payment) ON TABLE public.organizations TO authenticated;


--
-- Name: TABLE outbox_messages; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.outbox_messages TO anon;
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.outbox_messages TO authenticated;
GRANT ALL ON TABLE public.outbox_messages TO service_role;


--
-- Name: TABLE password_change_events; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.password_change_events TO anon;
GRANT ALL ON TABLE public.password_change_events TO authenticated;
GRANT ALL ON TABLE public.password_change_events TO service_role;


--
-- Name: TABLE password_change_lockouts; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.password_change_lockouts TO anon;
GRANT ALL ON TABLE public.password_change_lockouts TO authenticated;
GRANT ALL ON TABLE public.password_change_lockouts TO service_role;


--
-- Name: TABLE permissions; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.permissions TO service_role;
GRANT SELECT ON TABLE public.permissions TO anon;
GRANT SELECT ON TABLE public.permissions TO authenticated;


--
-- Name: TABLE pipeline_sla_settings; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.pipeline_sla_settings TO service_role;
GRANT SELECT ON TABLE public.pipeline_sla_settings TO authenticated;


--
-- Name: TABLE pipelines; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.pipelines TO service_role;
GRANT SELECT ON TABLE public.pipelines TO authenticated;


--
-- Name: TABLE platform_events; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.platform_events TO anon;
GRANT ALL ON TABLE public.platform_events TO authenticated;
GRANT ALL ON TABLE public.platform_events TO service_role;


--
-- Name: TABLE portal_import_reports; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.portal_import_reports TO service_role;


--
-- Name: TABLE portal_integrations; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.portal_integrations TO service_role;


--
-- Name: TABLE portal_listing_publications; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.portal_listing_publications TO service_role;


--
-- Name: TABLE portal_webhook_events; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.portal_webhook_events TO service_role;


--
-- Name: TABLE property_asset_storage_cleanup_queue; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.property_asset_storage_cleanup_queue TO service_role;


--
-- Name: TABLE property_asset_upload_intents; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.property_asset_upload_intents TO service_role;


--
-- Name: TABLE property_assets; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.property_assets TO service_role;


--
-- Name: TABLE property_channel_publication_versions; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT ON TABLE public.property_channel_publication_versions TO service_role;


--
-- Name: TABLE property_channel_publications; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.property_channel_publications TO service_role;


--
-- Name: TABLE property_cities; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT ON TABLE public.property_cities TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.property_cities TO service_role;


--
-- Name: TABLE property_condominiums; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT ON TABLE public.property_condominiums TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.property_condominiums TO service_role;


--
-- Name: TABLE property_creation_receipts; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.property_creation_receipts TO service_role;


--
-- Name: TABLE property_developers; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.property_developers TO service_role;


--
-- Name: TABLE property_development_buildings; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.property_development_buildings TO service_role;


--
-- Name: TABLE property_development_floor_plans; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.property_development_floor_plans TO service_role;


--
-- Name: TABLE property_development_phases; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.property_development_phases TO service_role;


--
-- Name: TABLE property_development_price_tables; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.property_development_price_tables TO service_role;


--
-- Name: TABLE property_development_reservations; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.property_development_reservations TO service_role;


--
-- Name: TABLE property_development_unit_events; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT ON TABLE public.property_development_unit_events TO service_role;


--
-- Name: TABLE property_development_unit_prices; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.property_development_unit_prices TO service_role;


--
-- Name: TABLE property_development_units; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.property_development_units TO service_role;


--
-- Name: TABLE property_developments; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.property_developments TO service_role;


--
-- Name: TABLE property_feature_catalog; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.property_feature_catalog TO service_role;


--
-- Name: TABLE property_features; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.property_features TO service_role;
GRANT SELECT ON TABLE public.property_features TO authenticated;


--
-- Name: TABLE property_key_movements; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT ON TABLE public.property_key_movements TO service_role;


--
-- Name: TABLE property_keys; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.property_keys TO service_role;


--
-- Name: TABLE property_neighborhoods; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT ON TABLE public.property_neighborhoods TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.property_neighborhoods TO service_role;


--
-- Name: TABLE property_offers; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.property_offers TO service_role;


--
-- Name: TABLE property_owners; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.property_owners TO service_role;


--
-- Name: TABLE property_ownerships; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.property_ownerships TO service_role;


--
-- Name: TABLE property_proximities; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.property_proximities TO service_role;
GRANT SELECT ON TABLE public.property_proximities TO authenticated;


--
-- Name: TABLE property_proximity_catalog; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.property_proximity_catalog TO service_role;


--
-- Name: TABLE property_sequences; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.property_sequences TO service_role;


--
-- Name: TABLE property_types; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT ON TABLE public.property_types TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.property_types TO service_role;


--
-- Name: TABLE prospecting_reports; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.prospecting_reports TO authenticated;
GRANT ALL ON TABLE public.prospecting_reports TO service_role;


--
-- Name: TABLE push_delivery_events; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.push_delivery_events TO anon;
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.push_delivery_events TO authenticated;
GRANT ALL ON TABLE public.push_delivery_events TO service_role;


--
-- Name: TABLE push_subscriptions; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.push_subscriptions TO anon;
GRANT ALL ON TABLE public.push_subscriptions TO authenticated;
GRANT ALL ON TABLE public.push_subscriptions TO service_role;


--
-- Name: TABLE push_tokens; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.push_tokens TO service_role;
GRANT SELECT ON TABLE public.push_tokens TO anon;
GRANT SELECT ON TABLE public.push_tokens TO authenticated;


--
-- Name: TABLE round_robin_logs; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,MAINTAIN ON TABLE public.round_robin_logs TO anon;
GRANT SELECT,MAINTAIN ON TABLE public.round_robin_logs TO authenticated;
GRANT ALL ON TABLE public.round_robin_logs TO service_role;


--
-- Name: TABLE round_robin_members; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.round_robin_members TO service_role;
GRANT SELECT ON TABLE public.round_robin_members TO authenticated;


--
-- Name: TABLE round_robin_rules; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.round_robin_rules TO service_role;
GRANT SELECT ON TABLE public.round_robin_rules TO authenticated;


--
-- Name: TABLE round_robins; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,REFERENCES,TRIGGER,MAINTAIN,UPDATE ON TABLE public.round_robins TO service_role;
GRANT SELECT ON TABLE public.round_robins TO authenticated;


--
-- Name: TABLE schedule_event_assignees; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.schedule_event_assignees TO service_role;


--
-- Name: TABLE schedule_event_comments; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.schedule_event_comments TO service_role;


--
-- Name: TABLE schedule_events; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.schedule_events TO service_role;


--
-- Name: TABLE service_plans; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.service_plans TO anon;
GRANT ALL ON TABLE public.service_plans TO authenticated;
GRANT ALL ON TABLE public.service_plans TO service_role;


--
-- Name: TABLE setup_guide_progress; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.setup_guide_progress TO anon;
GRANT ALL ON TABLE public.setup_guide_progress TO authenticated;
GRANT ALL ON TABLE public.setup_guide_progress TO service_role;


--
-- Name: TABLE site_analytics_events; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.site_analytics_events TO service_role;


--
-- Name: TABLE site_lead_submissions; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.site_lead_submissions TO anon;
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.site_lead_submissions TO authenticated;
GRANT ALL ON TABLE public.site_lead_submissions TO service_role;


--
-- Name: TABLE site_menu_items; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.site_menu_items TO service_role;
GRANT SELECT ON TABLE public.site_menu_items TO anon;
GRANT SELECT ON TABLE public.site_menu_items TO authenticated;


--
-- Name: TABLE site_search_filters; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.site_search_filters TO service_role;
GRANT SELECT ON TABLE public.site_search_filters TO anon;
GRANT SELECT ON TABLE public.site_search_filters TO authenticated;


--
-- Name: TABLE stage_automations; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.stage_automations TO service_role;
GRANT SELECT ON TABLE public.stage_automations TO authenticated;


--
-- Name: TABLE stage_operational_configs; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.stage_operational_configs TO service_role;
GRANT SELECT ON TABLE public.stage_operational_configs TO authenticated;


--
-- Name: TABLE stages; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.stages TO service_role;
GRANT SELECT ON TABLE public.stages TO authenticated;


--
-- Name: TABLE subscription_logs; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.subscription_logs TO anon;
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.subscription_logs TO authenticated;
GRANT ALL ON TABLE public.subscription_logs TO service_role;


--
-- Name: TABLE subscriptions; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.subscriptions TO anon;
GRANT ALL ON TABLE public.subscriptions TO authenticated;
GRANT ALL ON TABLE public.subscriptions TO service_role;


--
-- Name: TABLE system_settings; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.system_settings TO anon;
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.system_settings TO authenticated;
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.system_settings TO service_role;


--
-- Name: TABLE tags; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.tags TO service_role;
GRANT SELECT ON TABLE public.tags TO authenticated;


--
-- Name: TABLE team_members; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.team_members TO service_role;
GRANT SELECT ON TABLE public.team_members TO authenticated;


--
-- Name: TABLE team_pipelines; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.team_pipelines TO service_role;
GRANT SELECT ON TABLE public.team_pipelines TO authenticated;


--
-- Name: TABLE teams; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.teams TO service_role;
GRANT SELECT ON TABLE public.teams TO authenticated;


--
-- Name: TABLE telecom_billing; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.telecom_billing TO anon;
GRANT ALL ON TABLE public.telecom_billing TO authenticated;
GRANT ALL ON TABLE public.telecom_billing TO service_role;


--
-- Name: TABLE telecom_customers; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.telecom_customers TO anon;
GRANT ALL ON TABLE public.telecom_customers TO authenticated;
GRANT ALL ON TABLE public.telecom_customers TO service_role;


--
-- Name: TABLE telephony_calls; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.telephony_calls TO anon;
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.telephony_calls TO authenticated;
GRANT ALL ON TABLE public.telephony_calls TO service_role;


--
-- Name: TABLE user_activity_sessions; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.user_activity_sessions TO anon;
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.user_activity_sessions TO authenticated;
GRANT ALL ON TABLE public.user_activity_sessions TO service_role;


--
-- Name: TABLE user_gamification_stats; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.user_gamification_stats TO anon;
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.user_gamification_stats TO authenticated;
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.user_gamification_stats TO service_role;


--
-- Name: TABLE user_mission_progress; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.user_mission_progress TO anon;
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.user_mission_progress TO authenticated;
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.user_mission_progress TO service_role;


--
-- Name: TABLE user_org_cache; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.user_org_cache TO anon;
GRANT ALL ON TABLE public.user_org_cache TO authenticated;
GRANT ALL ON TABLE public.user_org_cache TO service_role;


--
-- Name: TABLE user_organization_roles; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.user_organization_roles TO service_role;
GRANT SELECT ON TABLE public.user_organization_roles TO anon;
GRANT SELECT ON TABLE public.user_organization_roles TO authenticated;


--
-- Name: TABLE user_permission_overrides; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,MAINTAIN ON TABLE public.user_permission_overrides TO anon;
GRANT SELECT,MAINTAIN ON TABLE public.user_permission_overrides TO authenticated;
GRANT ALL ON TABLE public.user_permission_overrides TO service_role;


--
-- Name: TABLE user_permissions; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.user_permissions TO service_role;
GRANT SELECT ON TABLE public.user_permissions TO authenticated;


--
-- Name: TABLE user_roles; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.user_roles TO service_role;
GRANT SELECT ON TABLE public.user_roles TO authenticated;


--
-- Name: TABLE users; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.users TO anon;
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.users TO authenticated;
GRANT ALL ON TABLE public.users TO service_role;


--
-- Name: TABLE vista_integrations; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.vista_integrations TO anon;
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.vista_integrations TO authenticated;
GRANT ALL ON TABLE public.vista_integrations TO service_role;


--
-- Name: TABLE vista_integrations_service; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.vista_integrations_service TO anon;
GRANT ALL ON TABLE public.vista_integrations_service TO authenticated;
GRANT ALL ON TABLE public.vista_integrations_service TO service_role;


--
-- Name: TABLE webhooks; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.webhooks TO service_role;


--
-- Name: TABLE webhooks_integrations; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.webhooks_integrations TO service_role;


--
-- Name: COLUMN webhooks_integrations.id; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(id) ON TABLE public.webhooks_integrations TO authenticated;


--
-- Name: COLUMN webhooks_integrations.organization_id; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(organization_id) ON TABLE public.webhooks_integrations TO authenticated;


--
-- Name: COLUMN webhooks_integrations.name; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(name) ON TABLE public.webhooks_integrations TO authenticated;


--
-- Name: COLUMN webhooks_integrations.type; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(type) ON TABLE public.webhooks_integrations TO authenticated;


--
-- Name: COLUMN webhooks_integrations.webhook_url; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(webhook_url) ON TABLE public.webhooks_integrations TO authenticated;


--
-- Name: COLUMN webhooks_integrations.target_pipeline_id; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(target_pipeline_id) ON TABLE public.webhooks_integrations TO authenticated;


--
-- Name: COLUMN webhooks_integrations.target_team_id; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(target_team_id) ON TABLE public.webhooks_integrations TO authenticated;


--
-- Name: COLUMN webhooks_integrations.target_stage_id; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(target_stage_id) ON TABLE public.webhooks_integrations TO authenticated;


--
-- Name: COLUMN webhooks_integrations.target_tag_ids; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(target_tag_ids) ON TABLE public.webhooks_integrations TO authenticated;


--
-- Name: COLUMN webhooks_integrations.target_property_id; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(target_property_id) ON TABLE public.webhooks_integrations TO authenticated;


--
-- Name: COLUMN webhooks_integrations.field_mapping; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(field_mapping) ON TABLE public.webhooks_integrations TO authenticated;


--
-- Name: COLUMN webhooks_integrations.is_active; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(is_active) ON TABLE public.webhooks_integrations TO authenticated;


--
-- Name: COLUMN webhooks_integrations.leads_received; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(leads_received) ON TABLE public.webhooks_integrations TO authenticated;


--
-- Name: COLUMN webhooks_integrations.last_lead_at; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(last_lead_at) ON TABLE public.webhooks_integrations TO authenticated;


--
-- Name: COLUMN webhooks_integrations.last_triggered_at; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(last_triggered_at) ON TABLE public.webhooks_integrations TO authenticated;


--
-- Name: COLUMN webhooks_integrations.trigger_events; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(trigger_events) ON TABLE public.webhooks_integrations TO authenticated;


--
-- Name: COLUMN webhooks_integrations.created_at; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(created_at) ON TABLE public.webhooks_integrations TO authenticated;


--
-- Name: COLUMN webhooks_integrations.updated_at; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(updated_at) ON TABLE public.webhooks_integrations TO authenticated;


--
-- Name: COLUMN webhooks_integrations.created_by; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(created_by) ON TABLE public.webhooks_integrations TO authenticated;


--
-- Name: TABLE whatsapp_attendance_entries; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT ON TABLE public.whatsapp_attendance_entries TO service_role;


--
-- Name: TABLE whatsapp_attendance_marker_confirmations; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT ON TABLE public.whatsapp_attendance_marker_confirmations TO service_role;


--
-- Name: TABLE whatsapp_chat_labels; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.whatsapp_chat_labels TO service_role;


--
-- Name: TABLE whatsapp_contact_identity_aliases; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.whatsapp_contact_identity_aliases TO service_role;


--
-- Name: TABLE whatsapp_conversation_lead_bindings; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.whatsapp_conversation_lead_bindings TO service_role;


--
-- Name: TABLE whatsapp_conversation_routing_heads; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT ON TABLE public.whatsapp_conversation_routing_heads TO service_role;


--
-- Name: TABLE whatsapp_groups; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.whatsapp_groups TO service_role;


--
-- Name: TABLE whatsapp_inbound_logs; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.whatsapp_inbound_logs TO service_role;


--
-- Name: TABLE whatsapp_inbound_rules; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.whatsapp_inbound_rules TO service_role;


--
-- Name: TABLE whatsapp_labels; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.whatsapp_labels TO service_role;


--
-- Name: TABLE whatsapp_message_reactions; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.whatsapp_message_reactions TO service_role;


--
-- Name: TABLE whatsapp_message_templates; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.whatsapp_message_templates TO service_role;


--
-- Name: TABLE whatsapp_session_access; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.whatsapp_session_access TO service_role;


--
-- Name: TABLE whatsapp_sessions; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.whatsapp_sessions TO service_role;


--
-- Name: SEQUENCE whatsapp_webhook_routing_ingress_sequence; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE public.whatsapp_webhook_routing_ingress_sequence TO service_role;


--
-- Name: TABLE whatsapp_webhook_routing_outcomes; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.whatsapp_webhook_routing_outcomes TO service_role;


--
-- Name: TABLE messages; Type: ACL; Schema: realtime; Owner: supabase_realtime_admin
--

GRANT ALL ON TABLE realtime.messages TO postgres;
GRANT ALL ON TABLE realtime.messages TO dashboard_user;
GRANT SELECT,INSERT,UPDATE ON TABLE realtime.messages TO anon;
GRANT SELECT,INSERT,UPDATE ON TABLE realtime.messages TO authenticated;
GRANT SELECT,INSERT,UPDATE ON TABLE realtime.messages TO service_role;


--
-- Name: TABLE messages_2026_10_14; Type: ACL; Schema: realtime; Owner: supabase_admin
--

GRANT ALL ON TABLE realtime.messages_2026_10_14 TO postgres;
GRANT ALL ON TABLE realtime.messages_2026_10_14 TO dashboard_user;


--
-- Name: TABLE messages_2026_10_15; Type: ACL; Schema: realtime; Owner: supabase_admin
--

GRANT ALL ON TABLE realtime.messages_2026_10_15 TO postgres;
GRANT ALL ON TABLE realtime.messages_2026_10_15 TO dashboard_user;


--
-- Name: TABLE messages_2026_10_16; Type: ACL; Schema: realtime; Owner: supabase_admin
--

GRANT ALL ON TABLE realtime.messages_2026_10_16 TO postgres;
GRANT ALL ON TABLE realtime.messages_2026_10_16 TO dashboard_user;


--
-- Name: TABLE messages_2026_10_17; Type: ACL; Schema: realtime; Owner: supabase_admin
--

GRANT ALL ON TABLE realtime.messages_2026_10_17 TO postgres;
GRANT ALL ON TABLE realtime.messages_2026_10_17 TO dashboard_user;


--
-- Name: TABLE messages_2026_10_18; Type: ACL; Schema: realtime; Owner: supabase_admin
--

GRANT ALL ON TABLE realtime.messages_2026_10_18 TO postgres;
GRANT ALL ON TABLE realtime.messages_2026_10_18 TO dashboard_user;


--
-- Name: TABLE schema_migrations; Type: ACL; Schema: realtime; Owner: supabase_admin
--

GRANT ALL ON TABLE realtime.schema_migrations TO postgres;
GRANT ALL ON TABLE realtime.schema_migrations TO dashboard_user;
GRANT SELECT ON TABLE realtime.schema_migrations TO anon;
GRANT SELECT ON TABLE realtime.schema_migrations TO authenticated;
GRANT SELECT ON TABLE realtime.schema_migrations TO service_role;
GRANT ALL ON TABLE realtime.schema_migrations TO supabase_realtime_admin;


--
-- Name: TABLE subscription; Type: ACL; Schema: realtime; Owner: supabase_admin
--

GRANT ALL ON TABLE realtime.subscription TO postgres;
GRANT ALL ON TABLE realtime.subscription TO dashboard_user;
GRANT SELECT ON TABLE realtime.subscription TO anon;
GRANT SELECT ON TABLE realtime.subscription TO authenticated;
GRANT SELECT ON TABLE realtime.subscription TO service_role;
GRANT ALL ON TABLE realtime.subscription TO supabase_realtime_admin;


--
-- Name: SEQUENCE subscription_id_seq; Type: ACL; Schema: realtime; Owner: supabase_admin
--

GRANT ALL ON SEQUENCE realtime.subscription_id_seq TO postgres;
GRANT ALL ON SEQUENCE realtime.subscription_id_seq TO dashboard_user;
GRANT USAGE ON SEQUENCE realtime.subscription_id_seq TO anon;
GRANT USAGE ON SEQUENCE realtime.subscription_id_seq TO authenticated;
GRANT USAGE ON SEQUENCE realtime.subscription_id_seq TO service_role;
GRANT ALL ON SEQUENCE realtime.subscription_id_seq TO supabase_realtime_admin;


--
-- Name: TABLE buckets; Type: ACL; Schema: storage; Owner: supabase_storage_admin
--

GRANT ALL ON TABLE storage.buckets TO postgres WITH GRANT OPTION;
GRANT ALL ON TABLE storage.buckets TO service_role;
GRANT ALL ON TABLE storage.buckets TO authenticated;
GRANT ALL ON TABLE storage.buckets TO anon;


--
-- Name: TABLE buckets_analytics; Type: ACL; Schema: storage; Owner: supabase_storage_admin
--

GRANT ALL ON TABLE storage.buckets_analytics TO service_role;
GRANT ALL ON TABLE storage.buckets_analytics TO authenticated;
GRANT ALL ON TABLE storage.buckets_analytics TO anon;


--
-- Name: TABLE buckets_vectors; Type: ACL; Schema: storage; Owner: supabase_storage_admin
--

GRANT SELECT ON TABLE storage.buckets_vectors TO service_role;
GRANT SELECT ON TABLE storage.buckets_vectors TO authenticated;
GRANT SELECT ON TABLE storage.buckets_vectors TO anon;


--
-- Name: TABLE iceberg_namespaces; Type: ACL; Schema: storage; Owner: supabase_storage_admin
--

GRANT ALL ON TABLE storage.iceberg_namespaces TO service_role;
GRANT SELECT ON TABLE storage.iceberg_namespaces TO authenticated;
GRANT SELECT ON TABLE storage.iceberg_namespaces TO anon;


--
-- Name: TABLE iceberg_tables; Type: ACL; Schema: storage; Owner: supabase_storage_admin
--

GRANT ALL ON TABLE storage.iceberg_tables TO service_role;
GRANT SELECT ON TABLE storage.iceberg_tables TO authenticated;
GRANT SELECT ON TABLE storage.iceberg_tables TO anon;


--
-- Name: TABLE objects; Type: ACL; Schema: storage; Owner: supabase_storage_admin
--

GRANT ALL ON TABLE storage.objects TO postgres WITH GRANT OPTION;
GRANT ALL ON TABLE storage.objects TO service_role;
GRANT ALL ON TABLE storage.objects TO authenticated;
GRANT ALL ON TABLE storage.objects TO anon;


--
-- Name: TABLE s3_multipart_uploads; Type: ACL; Schema: storage; Owner: supabase_storage_admin
--

GRANT ALL ON TABLE storage.s3_multipart_uploads TO service_role;
GRANT SELECT ON TABLE storage.s3_multipart_uploads TO authenticated;
GRANT SELECT ON TABLE storage.s3_multipart_uploads TO anon;


--
-- Name: TABLE s3_multipart_uploads_parts; Type: ACL; Schema: storage; Owner: supabase_storage_admin
--

GRANT ALL ON TABLE storage.s3_multipart_uploads_parts TO service_role;
GRANT SELECT ON TABLE storage.s3_multipart_uploads_parts TO authenticated;
GRANT SELECT ON TABLE storage.s3_multipart_uploads_parts TO anon;


--
-- Name: TABLE vector_indexes; Type: ACL; Schema: storage; Owner: supabase_storage_admin
--

GRANT SELECT ON TABLE storage.vector_indexes TO service_role;
GRANT SELECT ON TABLE storage.vector_indexes TO authenticated;
GRANT SELECT ON TABLE storage.vector_indexes TO anon;


--
-- Name: TABLE hooks; Type: ACL; Schema: supabase_functions; Owner: supabase_functions_admin
--

GRANT ALL ON TABLE supabase_functions.hooks TO postgres;
GRANT ALL ON TABLE supabase_functions.hooks TO anon;
GRANT ALL ON TABLE supabase_functions.hooks TO authenticated;
GRANT ALL ON TABLE supabase_functions.hooks TO service_role;


--
-- Name: SEQUENCE hooks_id_seq; Type: ACL; Schema: supabase_functions; Owner: supabase_functions_admin
--

GRANT ALL ON SEQUENCE supabase_functions.hooks_id_seq TO postgres;
GRANT ALL ON SEQUENCE supabase_functions.hooks_id_seq TO anon;
GRANT ALL ON SEQUENCE supabase_functions.hooks_id_seq TO authenticated;
GRANT ALL ON SEQUENCE supabase_functions.hooks_id_seq TO service_role;


--
-- Name: TABLE migrations; Type: ACL; Schema: supabase_functions; Owner: supabase_functions_admin
--

GRANT ALL ON TABLE supabase_functions.migrations TO postgres;
GRANT ALL ON TABLE supabase_functions.migrations TO anon;
GRANT ALL ON TABLE supabase_functions.migrations TO authenticated;
GRANT ALL ON TABLE supabase_functions.migrations TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: auth; Owner: supabase_auth_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_auth_admin IN SCHEMA auth GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_auth_admin IN SCHEMA auth GRANT ALL ON SEQUENCES TO dashboard_user;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: auth; Owner: supabase_auth_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_auth_admin IN SCHEMA auth GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_auth_admin IN SCHEMA auth GRANT ALL ON FUNCTIONS TO dashboard_user;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: auth; Owner: supabase_auth_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_auth_admin IN SCHEMA auth GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_auth_admin IN SCHEMA auth GRANT ALL ON TABLES TO dashboard_user;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: extensions; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA extensions GRANT ALL ON SEQUENCES TO postgres WITH GRANT OPTION;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: extensions; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA extensions GRANT ALL ON FUNCTIONS TO postgres WITH GRANT OPTION;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: extensions; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA extensions GRANT ALL ON TABLES TO postgres WITH GRANT OPTION;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: graphql; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA graphql GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA graphql GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA graphql GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA graphql GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: graphql; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA graphql GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA graphql GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA graphql GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA graphql GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: graphql; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA graphql GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA graphql GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA graphql GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA graphql GRANT ALL ON TABLES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: graphql_public; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA graphql_public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA graphql_public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA graphql_public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA graphql_public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: graphql_public; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA graphql_public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA graphql_public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA graphql_public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA graphql_public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: graphql_public; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA graphql_public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA graphql_public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA graphql_public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA graphql_public GRANT ALL ON TABLES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: realtime; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA realtime GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA realtime GRANT ALL ON SEQUENCES TO dashboard_user;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: realtime; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA realtime GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA realtime GRANT ALL ON FUNCTIONS TO dashboard_user;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: realtime; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA realtime GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA realtime GRANT ALL ON TABLES TO dashboard_user;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: storage; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: storage; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: storage; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage GRANT ALL ON TABLES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: supabase_functions; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA supabase_functions GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA supabase_functions GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA supabase_functions GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA supabase_functions GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: supabase_functions; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA supabase_functions GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA supabase_functions GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA supabase_functions GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA supabase_functions GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: supabase_functions; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA supabase_functions GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA supabase_functions GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA supabase_functions GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA supabase_functions GRANT ALL ON TABLES TO service_role;


--
-- Name: issue_graphql_placeholder; Type: EVENT TRIGGER; Schema: -; Owner: supabase_admin
--

CREATE EVENT TRIGGER issue_graphql_placeholder ON sql_drop
         WHEN TAG IN ('DROP EXTENSION')
   EXECUTE FUNCTION extensions.set_graphql_placeholder();


ALTER EVENT TRIGGER issue_graphql_placeholder OWNER TO supabase_admin;

--
-- Name: issue_pg_cron_access; Type: EVENT TRIGGER; Schema: -; Owner: supabase_admin
--

CREATE EVENT TRIGGER issue_pg_cron_access ON ddl_command_end
         WHEN TAG IN ('CREATE EXTENSION')
   EXECUTE FUNCTION extensions.grant_pg_cron_access();


ALTER EVENT TRIGGER issue_pg_cron_access OWNER TO supabase_admin;

--
-- Name: issue_pg_graphql_access; Type: EVENT TRIGGER; Schema: -; Owner: supabase_admin
--

CREATE EVENT TRIGGER issue_pg_graphql_access ON ddl_command_end
         WHEN TAG IN ('CREATE FUNCTION')
   EXECUTE FUNCTION extensions.grant_pg_graphql_access();


ALTER EVENT TRIGGER issue_pg_graphql_access OWNER TO supabase_admin;

--
-- Name: issue_pg_net_access; Type: EVENT TRIGGER; Schema: -; Owner: supabase_admin
--

CREATE EVENT TRIGGER issue_pg_net_access ON ddl_command_end
         WHEN TAG IN ('CREATE EXTENSION')
   EXECUTE FUNCTION extensions.grant_pg_net_access();


ALTER EVENT TRIGGER issue_pg_net_access OWNER TO supabase_admin;

--
-- Name: pgrst_ddl_watch; Type: EVENT TRIGGER; Schema: -; Owner: supabase_admin
--

CREATE EVENT TRIGGER pgrst_ddl_watch ON ddl_command_end
   EXECUTE FUNCTION extensions.pgrst_ddl_watch();


ALTER EVENT TRIGGER pgrst_ddl_watch OWNER TO supabase_admin;

--
-- Name: pgrst_drop_watch; Type: EVENT TRIGGER; Schema: -; Owner: supabase_admin
--

CREATE EVENT TRIGGER pgrst_drop_watch ON sql_drop
   EXECUTE FUNCTION extensions.pgrst_drop_watch();


ALTER EVENT TRIGGER pgrst_drop_watch OWNER TO supabase_admin;

--
-- PostgreSQL database dump complete
--

\unrestrict p8Jx9JZN4E90KcwbtaiCedAhXcz1AhJsnZKYTehKVtdTKwFbHwM5wFQaC4z3CiE

