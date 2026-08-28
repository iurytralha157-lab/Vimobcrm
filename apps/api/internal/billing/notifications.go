package billing

import (
	"context"
	"strings"
)

const billingNotificationEnqueueQuery = `
with billing_recipients as (
	select distinct
		membership.organization_id,
		membership.user_id,
		coalesce(account.name, '') as name,
		coalesce(account.email, '') as email,
		coalesce(account.whatsapp, '') as whatsapp
	from public.organization_members membership
	join public.users account
	  on account.id = membership.user_id
	where membership.is_active = true
	  and coalesce(account.is_active, true) = true
	  and (
		lower(coalesce(membership.role, 'user')) in ('owner', 'admin')
		or exists (
			select 1
			from public.user_permission_overrides permission_override
			where permission_override.organization_id = membership.organization_id
			  and permission_override.user_id = membership.user_id
			  and permission_override.permission_key = 'settings_billing'
			  and permission_override.allowed = true
		)
		or (
			not exists (
				select 1
				from public.user_permission_overrides permission_override
				where permission_override.organization_id = membership.organization_id
				  and permission_override.user_id = membership.user_id
				  and permission_override.permission_key = 'settings_billing'
			)
			and exists (
				select 1
				from public.user_organization_roles user_role
				join public.organization_role_permissions role_permission
				  on role_permission.organization_id = user_role.organization_id
				 and role_permission.role_id = user_role.role_id
				join public.available_permissions permission
				  on permission.id = role_permission.permission_id
				where user_role.organization_id = membership.organization_id
				  and user_role.user_id = membership.user_id
				  and user_role.is_active = true
				  and permission.key = 'settings_billing'
			)
		)
	  )
),
payment_events as (
	select payment.*, 'billing_payment_created'::text as event_key
	from public.asaas_payments payment
	where payment.created_at >= now() - interval '48 hours'
	  and upper(coalesce(payment.status, 'PENDING')) in ('CREATED', 'PENDING')
	  and upper(coalesce(payment.billing_type, '')) <> 'CREDIT_CARD'
	  and payment.due_date > (now() at time zone 'America/Sao_Paulo')::date

	union all

	select payment.*, 'billing_due_in_3_days'::text as event_key
	from public.asaas_payments payment
	where upper(coalesce(payment.status, 'PENDING')) in ('CREATED', 'PENDING')
	  and upper(coalesce(payment.billing_type, '')) <> 'CREDIT_CARD'
	  and payment.due_date = (now() at time zone 'America/Sao_Paulo')::date + 3
	  and payment.created_at < now() - interval '48 hours'

	union all

	select payment.*, 'billing_due_today'::text as event_key
	from public.asaas_payments payment
	where upper(coalesce(payment.status, 'PENDING')) in ('CREATED', 'PENDING')
	  and upper(coalesce(payment.billing_type, '')) <> 'CREDIT_CARD'
	  and payment.due_date = (now() at time zone 'America/Sao_Paulo')::date

	union all

	select payment.*, 'billing_card_refused'::text as event_key
	from public.asaas_payments payment
	where upper(coalesce(payment.status, '')) in (
		'CREDIT_CARD_CAPTURE_REFUSED',
		'REPROVED_BY_RISK_ANALYSIS'
	)
	  and payment.updated_at >= now() - interval '48 hours'

	union all

	select payment.*, 'billing_overdue_1_day'::text as event_key
	from public.asaas_payments payment
	where upper(coalesce(payment.status, '')) in (
		'PENDING',
		'OVERDUE',
		'DUNNING_REQUESTED',
		'DUNNING_RECEIVED'
	)
	  and payment.due_date = (now() at time zone 'America/Sao_Paulo')::date - 1

	union all

	select payment.*, 'billing_overdue_5_days'::text as event_key
	from public.asaas_payments payment
	where upper(coalesce(payment.status, '')) in (
		'PENDING',
		'OVERDUE',
		'DUNNING_REQUESTED',
		'DUNNING_RECEIVED'
	)
	  and payment.due_date = (now() at time zone 'America/Sao_Paulo')::date - 5

	union all

	select payment.*, 'billing_payment_refunded'::text as event_key
	from public.asaas_payments payment
	where upper(coalesce(payment.status, '')) in (
		'REFUNDED',
		'REFUND_REQUESTED',
		'REFUND_IN_PROGRESS',
		'PARTIALLY_REFUNDED',
		'RECEIVED_IN_CASH_UNDONE',
		'CHARGEBACK',
		'CHARGEBACK_REQUESTED',
		'CHARGEBACK_DISPUTE',
		'AWAITING_CHARGEBACK_REVERSAL'
	)
	  and payment.updated_at >= now() - interval '48 hours'

	union all

	select payment.*, 'billing_payment_cancelled'::text as event_key
	from public.asaas_payments payment
	where upper(coalesce(payment.status, '')) in ('CANCELED', 'CANCELLED', 'DELETED')
	  and payment.updated_at >= now() - interval '48 hours'
),
rendered_events as (
	select
		payment_event.*,
		case
			when payment_event.event_key in ('billing_overdue_1_day', 'billing_overdue_5_days')
			 and payment_event.bank_slip_registration_cancelled_at is not null
			 and payment_event.bank_slip_registration_cancelled_due_date is not distinct from payment_event.due_date
			then 'Boleto expirado: gere uma nova cobranca'
			else case payment_event.event_key
				when 'billing_payment_created' then 'Nova cobranca disponivel'
				when 'billing_due_in_3_days' then 'Sua assinatura vence em 3 dias'
				when 'billing_due_today' then 'Sua assinatura vence hoje'
				when 'billing_payment_confirmed' then 'Pagamento confirmado'
				when 'billing_card_refused' then 'Pagamento no cartao recusado'
				when 'billing_overdue_1_day' then 'Pagamento em atraso'
				when 'billing_overdue_5_days' then 'Pagamento segue em atraso'
				when 'billing_payment_refunded' then 'Pagamento revertido ou contestado'
				when 'billing_payment_cancelled' then 'Cobranca cancelada'
			end
		end as notification_title,
		case
			when payment_event.event_key in ('billing_overdue_1_day', 'billing_overdue_5_days')
			 and payment_event.bank_slip_registration_cancelled_at is not null
			 and payment_event.bank_slip_registration_cancelled_due_date is not distinct from payment_event.due_date
			then 'O boleto anterior expirou. Acesse o checkout seguro da Vimob para gerar um novo boleto ou escolher outra forma de pagamento.'
			else case payment_event.event_key
				when 'billing_payment_created' then 'Uma nova cobranca da assinatura Vimob esta pronta para pagamento.'
				when 'billing_due_in_3_days' then 'A cobranca da assinatura Vimob vence em 3 dias.'
				when 'billing_due_today' then 'A cobranca da assinatura Vimob vence hoje.'
				when 'billing_payment_confirmed' then 'Recebemos o pagamento da sua assinatura Vimob.'
				when 'billing_card_refused' then 'Nao foi possivel processar o cartao da sua assinatura Vimob.'
				when 'billing_overdue_1_day' then 'A cobranca da assinatura Vimob venceu ontem.'
				when 'billing_overdue_5_days' then 'A cobranca da assinatura Vimob esta vencida ha 5 dias.'
				when 'billing_payment_refunded' then 'O pagamento da assinatura Vimob teve uma reversao ou contestacao e precisa de atencao.'
				when 'billing_payment_cancelled' then 'A cobranca da assinatura Vimob foi cancelada.'
			end
		end as notification_content,
		case
			when payment_event.event_key in (
				'billing_payment_created',
				'billing_due_in_3_days',
				'billing_due_today',
				'billing_card_refused',
				'billing_overdue_1_day',
				'billing_overdue_5_days'
			) then '/checkout/' || checkout_capability.checkout_token
			else '/settings?tab=subscription&billing=payments&payment=' || payment_event.id::text
			  || '&organization=' || payment_event.organization_id::text
		end as target_url,
		trim(trailing '/' from $1::text) || case
			when payment_event.event_key in (
				'billing_payment_created',
				'billing_due_in_3_days',
				'billing_due_today',
				'billing_card_refused',
				'billing_overdue_1_day',
				'billing_overdue_5_days'
			) then '/checkout/' || checkout_capability.checkout_token
			else '/settings?tab=subscription&billing=payments&payment=' || payment_event.id::text
			  || '&organization=' || payment_event.organization_id::text
		end as billing_url,
		'R$ ' || replace(
			to_char(coalesce(payment_event.value, 0), 'FM999999990D00'),
			'.',
			','
		) as amount_label,
		coalesce(to_char(payment_event.due_date, 'DD/MM/YYYY'), '') as due_date_label
	from payment_events payment_event
	left join public.billing_payment_checkout_capabilities checkout_capability
	  on checkout_capability.payment_id = payment_event.id
	 and checkout_capability.organization_id = payment_event.organization_id
	 and checkout_capability.asaas_payment_id = payment_event.asaas_payment_id
	 and checkout_capability.revoked_at is null
	 and checkout_capability.expires_at > now()
	 and private.billing_payment_checkout_is_resolvable(payment_event.id)
	where payment_event.event_key not in (
		'billing_payment_created',
		'billing_due_in_3_days',
		'billing_due_today',
		'billing_card_refused',
		'billing_overdue_1_day',
		'billing_overdue_5_days'
	)
	   or checkout_capability.checkout_token is not null
)
insert into public.notifications (
	organization_id,
	user_id,
	title,
	content,
	body,
	type,
	channel,
	target_url,
	metadata
)
select
	event.organization_id,
	recipient.user_id,
	event.notification_title,
	event.notification_content,
	event.notification_content,
	'billing',
	'in_app',
	event.target_url,
	jsonb_build_object(
		'event_key', event.event_key,
		'dedupe_key', 'billing:' || event.event_key || ':' || event.id::text,
		'recipient_name', recipient.name,
		'recipient_email', recipient.email,
		'recipient_whatsapp', recipient.whatsapp,
		'payment_id', event.id::text,
		'asaas_payment_id', event.asaas_payment_id,
		'billing_type', event.billing_type,
		'amount', event.amount_label,
		'due_date', event.due_date_label,
		'billing_url', event.billing_url,
		'variables', jsonb_build_object(
			'amount', event.amount_label,
			'due_date', event.due_date_label,
			'billing_url', event.billing_url,
			'payment_id', event.id::text,
			'billing_type', event.billing_type
		),
		'dispatch', jsonb_build_object(
			'whatsapp', jsonb_build_object('required', true, 'status', 'pending'),
			'email', jsonb_build_object('required', true, 'status', 'pending')
		),
		'whatsapp_dispatch_required', true,
		'whatsapp_dispatch', jsonb_build_object('status', 'pending')
	)
from rendered_events event
join billing_recipients recipient
  on recipient.organization_id = event.organization_id
on conflict do nothing
`

func (reconciler *Reconciler) enqueueBillingNotifications(ctx context.Context) (int64, error) {
	if reconciler == nil || reconciler.db == nil {
		return 0, nil
	}

	result, err := reconciler.db.Pool().Exec(
		ctx,
		billingNotificationEnqueueQuery,
		strings.TrimRight(reconciler.config.AppURL, "/"),
	)
	if err != nil {
		return 0, err
	}
	return result.RowsAffected(), nil
}
