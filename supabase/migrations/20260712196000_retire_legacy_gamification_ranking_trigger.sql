-- This legacy ranking trigger belongs to the old synchronous gamification
-- engine. Its function name does not contain "gamification", so the canonical
-- migration cannot discover it before widening total_points to bigint.
drop trigger if exists tr_check_ranking_overtake
  on public.user_gamification_stats;

do $harden_legacy_ranking_function$
begin
  if to_regprocedure('public.check_ranking_overtake()') is not null then
    revoke execute on function public.check_ranking_overtake()
      from public, anon, authenticated;
    grant execute on function public.check_ranking_overtake()
      to service_role;
  end if;
end;
$harden_legacy_ranking_function$;
