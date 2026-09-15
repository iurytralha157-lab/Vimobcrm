-- Adds an organization-scoped catalog of custom lead sources ("origens"),
-- mirroring the public.tags table so custom origins created by one
-- organization are never visible to another.
--
-- leads.source stays a plain text column (unchanged) for backward
-- compatibility with the existing built-in options, imports and webhooks
-- that already write free-text values there. public.lead_sources is only
-- the org-scoped vocabulary that powers the "Origem" picker's suggestions
-- and its "Criar nova origem" action.

CREATE TABLE IF NOT EXISTS "public"."lead_sources" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE "public"."lead_sources" OWNER TO "postgres";

ALTER TABLE ONLY "public"."lead_sources"
    ADD CONSTRAINT "lead_sources_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."lead_sources"
    ADD CONSTRAINT "lead_sources_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;

CREATE UNIQUE INDEX "lead_sources_org_normalized_name_key" ON "public"."lead_sources" USING "btree" ("organization_id", "lower"("btrim"("name")));

ALTER TABLE "public"."lead_sources" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lead_sources consolidated select" ON "public"."lead_sources" FOR SELECT TO "authenticated" USING ((("organization_id" = "private"."get_user_organization_id"()) OR ("public"."is_super_admin"() AND (("private"."get_user_organization_id"() IS NULL) OR ("organization_id" = "private"."get_user_organization_id"())))));

CREATE POLICY "lead_sources consolidated insert" ON "public"."lead_sources" FOR INSERT TO "authenticated" WITH CHECK ((("organization_id" = "private"."get_user_organization_id"()) OR ("public"."is_super_admin"() AND (("private"."get_user_organization_id"() IS NULL) OR ("organization_id" = "private"."get_user_organization_id"())))));

GRANT ALL ON TABLE "public"."lead_sources" TO "anon";
GRANT ALL ON TABLE "public"."lead_sources" TO "authenticated";
GRANT ALL ON TABLE "public"."lead_sources" TO "service_role";
