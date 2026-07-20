import { expect, test } from '@playwright/test';
import { Pool } from 'pg';

import {
  E2E_ORGANIZATION_ID,
	E2E_PASSWORD,
  E2E_PROPERTY_ID,
  E2E_STAGE_ID,
  E2E_USERS,
  getE2EConfig,
} from './support/e2e-env';

const TEST_PHONE = '+55 11 98888-7701';
const SESSION_ID = 'e2e-public-site-session';
const SUBMISSION_ID = 'e2e-public-site-submission-1';

test('blinda cadastro, reentrada, atribuicao e metricas do site', async ({ request }) => {
  const config = getE2EConfig();
  const pool = new Pool({ connectionString: config.databaseURL });

  await pool.query(`delete from public.site_lead_submissions where organization_id=$1::uuid and session_id=$2`, [E2E_ORGANIZATION_ID, SESSION_ID]);
  await pool.query(`delete from public.site_analytics_events where organization_id=$1::uuid and session_id=$2`, [E2E_ORGANIZATION_ID, SESSION_ID]);
  await pool.query(`delete from public.leads where organization_id=$1::uuid and normalize_phone(phone)=normalize_phone($2)`, [E2E_ORGANIZATION_ID, TEST_PHONE]);

  const tracking = await request.post(`${config.apiURL}/v1/public/tracking/events`, {
    data: {
      organization_id: E2E_ORGANIZATION_ID,
      event_type: 'pageview',
      page_path: '/imoveis/E2E-SITE-001',
      page_title: 'Imovel publico E2E',
      session_id: SESSION_ID,
      property_id: E2E_PROPERTY_ID,
      device_type: 'mobile',
      browser: 'chromium',
      utm_source: 'google',
      utm_medium: 'cpc',
      utm_campaign: 'campanha-e2e',
      metadata: { os: 'Android', timezone: 'America/Sao_Paulo' },
    },
  });
  expect(tracking.status(), await tracking.text()).toBe(201);

	const forgedConversion = await request.post(`${config.apiURL}/v1/public/tracking/events`, {
	  data: {
		organization_id: E2E_ORGANIZATION_ID,
		event_type: 'form_submit',
		page_path: '/contato',
		session_id: SESSION_ID,
		metadata: {},
	  },
	});
	expect(forgedConversion.status()).toBe(400);

	const invalidPropertyEvent = await request.post(`${config.apiURL}/v1/public/tracking/events`, {
	  data: {
		organization_id: E2E_ORGANIZATION_ID,
		event_type: 'property_view',
		page_path: '/imoveis/invalido',
		session_id: SESSION_ID,
		property_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
		metadata: {},
	  },
	});
	expect(invalidPropertyEvent.status()).toBe(400);

  const payload = {
    organization_id: E2E_ORGANIZATION_ID,
    submission_id: SUBMISSION_ID,
    session_id: SESSION_ID,
    name: 'Lead Site E2E',
    email: 'lead.site.e2e@vimob.test',
    phone: TEST_PHONE,
    message: 'Tenho interesse neste imovel.',
    privacy_accepted: true,
    privacy_url: 'http://127.0.0.1:3000/privacidade',
    property_id: E2E_PROPERTY_ID,
    property_code: 'E2E-SITE-001',
    landing_page: '/imoveis/E2E-SITE-001',
    referrer: 'https://www.google.com/',
    utm_source: 'google',
    utm_medium: 'cpc',
    utm_campaign: 'campanha-e2e',
    utm_term: 'apartamento centro',
    gclid: 'gclid-e2e',
  };

  const created = await request.post(`${config.apiURL}/v1/public/site/contact`, { data: payload });
  const createdBody = await created.json() as { lead_id: string; reentry: boolean };
  expect(created.status()).toBe(201);
  expect(createdBody.reentry).toBe(false);

  const duplicate = await request.post(`${config.apiURL}/v1/public/site/contact`, { data: payload });
  const duplicateBody = await duplicate.json() as { lead_id: string; idempotent: boolean };
  expect(duplicate.status()).toBe(200);
  expect(duplicateBody).toMatchObject({ lead_id: createdBody.lead_id, idempotent: true });

  const adminUser = await pool.query<{ id: string }>(`select id::text from public.users where organization_id=$1::uuid and email=$2 limit 1`, [E2E_ORGANIZATION_ID, E2E_USERS.admin.email]);
  await pool.query(`update public.leads set assigned_user_id=$2::uuid, stage_id=$3::uuid, deal_status='won', status='won' where id=$1::uuid`, [createdBody.lead_id, adminUser.rows[0].id, E2E_STAGE_ID]);

  const reentry = await request.post(`${config.apiURL}/v1/public/site/contact`, {
    data: { ...payload, submission_id: 'e2e-public-site-submission-2', message: 'Voltei ao site e quero uma visita.' },
  });
  const reentryBody = await reentry.json() as { lead_id: string; reentry: boolean };
  expect(reentry.status(), JSON.stringify(reentryBody)).toBe(201);
  expect(reentryBody).toMatchObject({ lead_id: createdBody.lead_id, reentry: true });

  const lead = await pool.query(`select assigned_user_id::text, stage_id::text, deal_status, status, property_id::text, utm_source, metadata from public.leads where id=$1::uuid`, [createdBody.lead_id]);
  expect(lead.rows[0]).toMatchObject({
    assigned_user_id: adminUser.rows[0].id,
    stage_id: E2E_STAGE_ID,
    deal_status: 'won',
    status: 'won',
    property_id: E2E_PROPERTY_ID,
    utm_source: 'google',
  });
  expect(lead.rows[0].metadata.privacy_accepted).toBe(true);

  const counts = await pool.query(`select
    count(*) filter(where event_type='form_submit')::int conversions,
    count(*) filter(where event_type='pageview')::int pageviews
    from public.site_analytics_events where organization_id=$1::uuid and session_id=$2`, [E2E_ORGANIZATION_ID, SESSION_ID]);
  expect(counts.rows[0]).toEqual({ conversions: 2, pageviews: 1 });

	const tokenResponse = await request.post(`${config.supabaseURL}/auth/v1/token?grant_type=password`, {
	  headers: { apikey: config.supabaseAnonKey },
	  data: { email: E2E_USERS.admin.email, password: E2E_PASSWORD },
	});
	const token = await tokenResponse.json() as { access_token: string };
	const authHeaders = { Authorization: `Bearer ${token.access_token}`, 'X-Organization-ID': E2E_ORGANIZATION_ID };
  const summaryResponse = await request.get(`${config.apiURL}/v1/analytics/site-summary`, { headers: authHeaders });
  expect(summaryResponse.status(), await summaryResponse.text()).toBe(200);
	const detailedResponse = await request.get(`${config.apiURL}/v1/analytics/site-detailed`, { headers: authHeaders });
  const detailedEnvelope = await detailedResponse.json() as { data: { topProperties: Array<{ property_id: string }>; campaigns: Array<{ campaign: string }>; totalConversions: number } };
  expect(detailedResponse.status()).toBe(200);
	const detailed = detailedEnvelope.data;
  expect(detailed.totalConversions).toBeGreaterThanOrEqual(2);
  expect(detailed.topProperties).toEqual(expect.arrayContaining([expect.objectContaining({ property_id: E2E_PROPERTY_ID })]));
  expect(detailed.campaigns).toEqual(expect.arrayContaining([expect.objectContaining({ campaign: 'campanha-e2e' })]));

  await pool.end();
});
