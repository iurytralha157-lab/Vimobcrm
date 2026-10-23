
-- Extension-created GraphQL wrapper: exact source definition and effective grants.
CREATE OR REPLACE FUNCTION graphql_public.graphql("operationName" text DEFAULT NULL::text, query text DEFAULT NULL::text, variables jsonb DEFAULT NULL::jsonb, extensions jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE sql
AS $function$
            select graphql.resolve(
                query := query,
                variables := coalesce(variables, '{}'),
                "operationName" := "operationName",
                extensions := extensions
            );
        $function$;

ALTER FUNCTION graphql_public.graphql(text,text,jsonb,jsonb) OWNER TO "supabase_admin";
REVOKE ALL ON FUNCTION graphql_public.graphql(text,text,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION graphql_public.graphql(text,text,jsonb,jsonb) TO PUBLIC;
GRANT EXECUTE ON FUNCTION graphql_public.graphql(text,text,jsonb,jsonb) TO "supabase_admin";
GRANT EXECUTE ON FUNCTION graphql_public.graphql(text,text,jsonb,jsonb) TO "postgres";
GRANT EXECUTE ON FUNCTION graphql_public.graphql(text,text,jsonb,jsonb) TO "anon";
GRANT EXECUTE ON FUNCTION graphql_public.graphql(text,text,jsonb,jsonb) TO "authenticated";
GRANT EXECUTE ON FUNCTION graphql_public.graphql(text,text,jsonb,jsonb) TO "service_role";
