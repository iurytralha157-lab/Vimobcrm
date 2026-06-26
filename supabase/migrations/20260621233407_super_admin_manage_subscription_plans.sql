grant insert, update, delete on public.admin_subscription_plans to authenticated;

drop policy if exists "super admins manage plans" on public.admin_subscription_plans;
create policy "super admins manage plans"
on public.admin_subscription_plans
for all
to authenticated
using (
  exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.role = 'super_admin'
  )
)
with check (
  exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.role = 'super_admin'
  )
);
