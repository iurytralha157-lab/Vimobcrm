import assert from 'node:assert/strict';
import path from 'node:path';

export const CI_MARKER = 'vimob-whatsapp-ci-v1';
export const CI_PORT = 57924;
export const CI_DATABASE = 'vimob_whatsapp_clone';
export const CI_ROOT_NAME = 'vimob-whatsapp-ci';
export const GO_PACKAGE = 'github.com/vimob-crm/vimob-crm/apps/api/internal/whatsapp';
export const GO_TESTS = Object.freeze([
  'TestWhatsAppCITargetRejectsAllConnectionOverrides',
  'TestWhatsAppCIRuntimeRejectsWrongIdentityAndExpiredProof',
  'TestWebhookRouteClaimLockedHeadAllowsIndependentSameSession',
  'TestWebhookRouteClaimNativeSharedFenceAllowsIndependentSameSession',
  'TestWebhookRouteClaimOldNewSessionFencesRemainCompatible',
  'TestWebhookRouteClaimFreshStatementSeesCommittedOtherLaneLease',
  'TestWebhookRouteClaimConcurrentReplicasKeepCrossLaneDependency',
  'TestWebhookRouteClaimDeferredAndDeadRoutesKeepExactBarriers',
  'TestWebhookCapturedMediaFailureDoesNotBlockSameRouteText',
  'TestWebhookCaptureCancellationKeepsRoutePendingAndNeighborProgresses',
  'TestWebhookSupportedAlbumRecoveryPreservesOutcomeDedupAndFIFO',
  'TestReceiptKnownMessageWinsWithoutReconcilingSameIdentityForeignSessionNotification',
  'TestReceiptKnownSiblingProgressesWhileForeignSessionNotificationRemainsPending',
  'TestNativeMixedReceiptAdvancesKnownAndDropsUnresolvedTarget',
  'TestNativeIsolatedReceiptUnknownTenantTargetDropsWithoutRepeatingKnown',
  'TestBacklogRecoveryRestoresSuppressedMessagesSilently',
  'TestReceiptEffectRetentionKeepsUnresolvedFamilyAndCallbackDedup',
  'TestQuickReplyPersistenceAndHTTPIsolation',
  'TestQuickReplyConcurrentOwnerLimitAndSlotReuse',
  'TestLocalWhatsAppMediaSendAndTransferRegression',
  'TestLocalWhatsAppReactionSendAndRemovalRegression',
  'TestMediaWorkerAttemptCannotKeepRenewingForever',
  'TestMediaWorkerHeartbeatCannotHoldTheExecutorForever',
  'TestMediaWorkerCompletionWinsItsOwnHeartbeatCancellation',
  'TestMediaWorkerRealHeartbeatFailureStillCancelsTheStage',
  'TestMediaWorkerCompletionDoesNotHideConfirmedLeaseLoss',
  'TestQueueTransactionDeadlineIncludesPoolAcquisition',
  'TestQueueTransactionPhaseRetainsEarlierParentDeadline',
  'TestQueueTransactionInstallsLimitsAndReleasesItsContext',
  'TestQueueRollbackSurvivesCanceledParentAndIsBounded',
  'TestQueueSetupFailureRollsBackBeforeReturning',
  'TestQueueCompletionRemainsBoundedAfterShutdown',
  'TestQueueTimeoutClassificationDoesNotRetryArbitraryDatabaseErrors',
  'TestLocalQueueOutboxStartLockReleasesOnlyItsOwnConversation',
  'TestLocalQueueOutboxCanceledWorkUsesCurrentDurableMarker',
  'TestLocalQueueMediaCompletionLockCannotOccupyWorkerForever',
  'TestLocalQueueTimeoutCleanupDoesNotBorrowAnotherScopeOrLease',
  'TestLocalQueueCanceledMediaPhaseRollsBackWithoutLiveWaiters',
  'TestHistoryMediaPreferencePreservesDefaults',
  'TestLocalLeadHistoryLazyMediaContract',
  'TestSessionConnectionObservationReturnsOnlyTheWinningState',
  'TestDeferredSessionControlUsesIngressTimeForEveryUnversionedState',
  'TestDeferredSessionControlOrderingPreservesConnectedAndExplicitLogout',
  'TestDeferredSessionControlOrderingUsesTheInlineMillisecondPrecision',
  'TestLocalSessionQRCodeDoesNotInventDisconnect',
  'TestLocalSessionStatusReturnsStateThatWonTheCAS',
  'TestLocalSessionQRCodeAppliesOnlyCurrentOwnedObservation',
  'TestLocalSessionStatusCannotUndoExplicitLogout',
  'TestLocalDeferredSessionControlsCannotOverwriteNewerConnection',
  'TestLocalDeferredSessionControlsRejectRetainedEpochAndLostLease',
  'TestLocalDeferredSessionControlsAcceptCurrentEpochAndPreserveLogout',
  'TestLocalDeferredSessionControlsRevalidateClaimGenerationAndPayload',
  'TestLocalInboundCaptureContinuesAfterDeferredSessionDisconnect',
]);
export const SQL_BASELINE_TESTS = Object.freeze([
  'whatsapp_webhook_fair_claim_indexes.test.sql',
  'whatsapp_webhook_session_cutover_epoch.test.sql',
  'whatsapp_attendance_capture_gate.test.sql',
  'whatsapp_outbox_fast_lane_indexes.test.sql',
  'whatsapp_realtime_active_session.test.sql',
  'whatsapp_personal_quick_replies.test.sql',
]);
export const SQL_TESTS = Object.freeze([...SQL_BASELINE_TESTS, 'whatsapp_ci_queue_read_scope.test.sql']);
export const DATABASE_NODE_TESTS = Object.freeze([
  'scripts/tests/whatsapp-inbox-maintenance-retention.test.mjs',
]);
export const RUNTIME_TESTS = Object.freeze([
  'hooks/whatsapp-conversations-refresh.runtime.test.mjs',
  'hooks/whatsapp-terminal-auth.runtime.test.mjs',
  'hooks/whatsapp/use-whatsapp-visible-canonical-previews.runtime.test.mjs',
  'components/features/whatsapp/conversations/integrated-surfaces-mobile.runtime.test.mjs',
  'components/features/whatsapp/conversations/presence-mobile.runtime.test.mjs',
  'components/features/whatsapp/conversations/panel-auxiliary-state.runtime.test.mjs',
  'components/features/whatsapp/conversations/reduced-motion-controls.runtime.test.mjs',
  'components/features/whatsapp/conversations/panel-closure.runtime.test.mjs',
  'components/features/whatsapp/conversations/floating-mobile-modal.runtime.test.mjs',
  'components/features/whatsapp/conversations/floating-tags-touch.runtime.test.mjs',
  'hooks/whatsapp/use-whatsapp-sender-avatars.runtime.test.mjs',
  'hooks/use-whatsapp-messages-paginated.race.test.mjs',
  'components/features/whatsapp/conversations/entry-send-receive.runtime.test.mjs',
  'components/features/whatsapp/conversations/send-entry-surfaces.runtime.test.mjs',
  'hooks/whatsapp-send-admission.runtime.test.mjs',
  'hooks/use-whatsapp-send-intent.runtime.test.mjs',
  'hooks/use-whatsapp-session-intent.runtime.test.mjs',
]);
export const NODE_TESTS = Object.freeze([
  'scripts/tests/whatsapp-ci-contract.test.mjs',
  'scripts/tests/whatsapp-ci-sql-source.test.mjs',
  'scripts/tests/whatsapp-ci-workflow.test.mjs',
  'scripts/tests/whatsapp-ci-process.test.mjs',
  'hooks/whatsapp-inbox-denial.runtime.test.mjs',
  'hooks/whatsapp-head-cancellation.runtime.test.mjs',
  'scripts/tests/whatsapp-legacy-edge-hardening.test.mjs',
  'scripts/tests/whatsapp-legacy-health-state.test.mjs',
  'scripts/tests/evolution-proxy-webhook-secret.test.mjs',
  'lib/api/whatsapp-history-media.test.mjs',
  'lib/whatsapp-send-admission.test.mjs',
  'components/features/chat/whatsapp-send-entry-ui.runtime.test.mjs',
  'components/features/chat/own-whatsapp-notice-composer.runtime.test.mjs',
]);

export function fixtureRoot(value) {
  assert.ok(value && path.isAbsolute(value), 'fixture root must be an explicit absolute path');
  const root = path.resolve(value);
  assert.equal(path.basename(root), CI_ROOT_NAME, 'unexpected fixture root name');
  assert.notEqual(root, path.parse(root).root);
  return root;
}
export function targetURL(password = 'synthetic') {
  assert.match(password, /^[a-zA-Z0-9_-]+$/);
  return `postgresql://postgres:${password}@127.0.0.1:${CI_PORT}/${CI_DATABASE}?sslmode=disable`;
}
export function validateURL(value) {
  const url = new URL(value);
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.port, String(CI_PORT));
  assert.equal(url.pathname, '/' + CI_DATABASE);
  assert.equal(url.username, 'postgres');
  assert.equal(url.hash, '');
  assert.deepEqual([...url.searchParams.entries()], [['sslmode', 'disable']], 'connection overrides are forbidden');
  return url;
}
export function validateManifest(value, root, now = Date.now()) {
  fixtureRoot(root);
  assert.equal(value?.kind, CI_MARKER);
  assert.equal(value.marker, CI_MARKER);
  assert.equal(value.database, CI_DATABASE);
  assert.equal(path.resolve(value.root), root);
  assert.equal(path.resolve(value.actual.dataDirectory), path.join(root, 'data'));
  assert.match(value.actual.systemIdentifier, /^[0-9]{16,20}$/);
  assert.match(value.nonce, /^[a-f0-9]{64}$/);
  assert.equal(value.actual.port, String(CI_PORT));
  assert.equal(value.actual.listenAddresses, '127.0.0.1');
  assert.equal(value.actual.serverAddress, '127.0.0.1');
  assert.equal(value.actual.fsync, 'on');
  assert.equal(value.actual.synchronousCommit, 'on');
  const age = now - Date.parse(value.createdAt);
  assert.ok(Number.isFinite(age) && age >= 0 && age <= 6 * 60 * 60_000, 'fixture proof must be fresh');
  return value;
}
export function assertCluster(manifest, actual, sentinel = true, database = sentinel ? CI_DATABASE : 'postgres') {
  for (const key of ['systemIdentifier', 'port', 'listenAddresses', 'serverAddress', 'fsync', 'synchronousCommit']) {
    assert.equal(actual[key], manifest.actual[key], 'cluster identity mismatch: ' + key);
  }
  assert.equal(path.resolve(actual.dataDirectory), path.resolve(manifest.actual.dataDirectory));
  assert.equal(actual.database, database);
  if (sentinel) assert.equal(actual.nonce, manifest.nonce, 'fixture marker mismatch');
}
export function childEnvironment(source = process.env) {
  // No database/provider/auth configuration is inherited from the workstation
  // or repository. In particular PGHOSTADDR/PGOPTIONS/PGSERVICE cannot redirect.
  const allowed = /^(PATH|Path|SystemRoot|SYSTEMROOT|WINDIR|TEMP|TMP|TMPDIR|HOME|USERPROFILE|LOCALAPPDATA|APPDATA|COMSPEC|PATHEXT|NUMBER_OF_PROCESSORS|GOCACHE|GOMODCACHE|GOPATH|PLAYWRIGHT_BROWSERS_PATH|CI|GITHUB_ACTIONS)$/;
  return { ...Object.fromEntries(Object.entries(source).filter(([key]) => allowed.test(key))), LC_ALL: 'C', LANG: 'C', NO_COLOR: '1' };
}
export function assertGoResults(raw) {
  const events = raw.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
  assert.ok(events.every(event => event.Package === GO_PACKAGE), 'unexpected Go package');
  assert.ok(events.every(event => !['fail', 'skip'].includes(event.Action)), 'Go failed/skipped at package or test level');
  const outcomes = events.filter(event => event.Test && ['pass', 'fail', 'skip'].includes(event.Action));
  assert.equal(outcomes.filter(event => event.Action !== 'pass').length, 0, 'Go failed or skipped a selected test/subtest');
  for (const name of GO_TESTS) assert.equal(outcomes.filter(event => event.Test === name).length, 1, 'required Go test missing/duplicated: ' + name);
  assert.equal(outcomes.filter(event => !event.Test.includes('/')).length, GO_TESTS.length, 'unexpected Go top-level test');
  assert.equal(events.filter(event => ['pass', 'fail', 'skip'].includes(event.Action) && !event.Test).length, 1, 'exactly one terminal Go package result is required');
  return { topLevel: GO_TESTS.length, includingSubtests: outcomes.length };
}
export function assertTap(raw) {
  raw = raw.replaceAll('\r\n', '\n');
  assert.doesNotMatch(raw, /^\s*(?:not ok\b|Bail out!)/mi);
  const withoutZeroStatistics = raw.replace(/^# (?:skipped|todo) 0[ \t]*$/gim, '');
  assert.doesNotMatch(withoutZeroStatistics, /#\s*(?:SKIP|TODO)\b/i, 'skips/TODO are not CI proof');
  assert.doesNotMatch(raw, /^\s*#\s*skipped[ \t]+[1-9]\d*\b/mi);
  const plans = [...raw.matchAll(/^1\.\.(\d+)[ \t]*$/gm)];
  assert.equal(plans.length, 1, 'exactly one top-level TAP plan is required');
  const count = Number(plans[0][1]);
  assert.ok(count > 0 && count <= 10000, 'missing/bounded positive TAP plan');
  const numbers = [...raw.matchAll(/^ok[ \t]+(\d+)\b/gm)].map(match => Number(match[1]));
  assert.deepEqual(numbers, Array.from({ length: count }, (_, i) => i + 1), 'TAP assertions must be exactly 1..N');
  return count;
}
export function sqlModeOptions(options = {}) {
  assert.ok(options && !Array.isArray(options) && typeof options === 'object');
  assert.deepEqual(Object.keys(options).filter(key => key !== 'mode'), [], 'SQL runner has no arbitrary argument override');
  const mode = options.mode || 'migration';
  assert.ok(['migration', 'baseline', 'tap', 'assertions'].includes(mode));
  return { mode, args: ['tap', 'assertions'].includes(mode) ? ['-q', '-A', '-t'] : [] };
}
export function assertNodeTap(raw) {
  const topLevel = assertTap(raw), footer = key => {
    const matches = [...raw.matchAll(new RegExp('^# ' + key + ' (\\d+)[ \\t]*\\r?$', 'gm'))];
    assert.equal(matches.length, 1, 'Node TAP requires one ' + key + ' summary');
    return Number(matches[0][1]);
  };
  const includingSubtests = footer('tests');
  assert.ok(includingSubtests >= topLevel);
  assert.equal(footer('pass'), includingSubtests);
  for (const key of ['fail', 'cancelled', 'skipped', 'todo']) assert.equal(footer(key), 0);
  return { topLevel, includingSubtests };
}
