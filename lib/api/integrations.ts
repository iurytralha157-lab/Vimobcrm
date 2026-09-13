import { integrationFunctionsAPI } from './integrations/functions';
import { chavesNaMaoIntegrationsAPI } from './integrations/chaves-na-mao';
import { grupoOLXIntegrationsAPI } from './integrations/grupo-olx';
import { imoviewIntegrationsAPI } from './integrations/imoview';
import { metaIntegrationsAPI } from './integrations/meta';
import { vistaIntegrationsAPI } from './integrations/vista';

export { googleAnalyticsIntegrationsAPI } from './integrations/google-analytics';
export { googleSearchConsoleIntegrationsAPI } from './integrations/google-search-console';
export { googleTagManagerIntegrationsAPI } from './integrations/google-tag-manager';
export type { GrupoOLXIntegrationInput, GrupoOLXPublicationInput } from './integrations/grupo-olx';
export type { IntegrationJSON } from './integrations/shared';
export {
  CHAVES_NA_MAO_HOMOLOGATION_REQUIRED_CODE,
  getChavesNaMaoFeedURL,
  isChavesNaMaoHomologationRequired,
} from './integrations/chaves-na-mao';
export type {
  ChavesNaMaoIntegrationInput,
  ChavesNaMaoPublicationInput,
} from './integrations/chaves-na-mao';

// Compatibility facade: consumers keep the exact same integrationsAPI
// methods while provider-specific implementations remain isolated.
export const integrationsAPI = {
  getChavesNaMao: chavesNaMaoIntegrationsAPI.get,
  saveChavesNaMao: chavesNaMaoIntegrationsAPI.save,
  activateChavesNaMao: chavesNaMaoIntegrationsAPI.activate,
  pauseChavesNaMao: chavesNaMaoIntegrationsAPI.pause,
  regenerateChavesNaMaoFeedToken:
    chavesNaMaoIntegrationsAPI.regenerateFeedToken,
  listChavesNaMaoPublications: chavesNaMaoIntegrationsAPI.listPublications,
  saveChavesNaMaoPublications: chavesNaMaoIntegrationsAPI.savePublications,
  invokeFunction: integrationFunctionsAPI.invokeFunction,
  metaOAuthAction: metaIntegrationsAPI.metaOAuthAction,
  syncMetaMarketing: metaIntegrationsAPI.syncMetaMarketing,
  getVista: vistaIntegrationsAPI.getVista,
  saveVista: vistaIntegrationsAPI.saveVista,
  deleteVista: vistaIntegrationsAPI.deleteVista,
  getImoview: imoviewIntegrationsAPI.getImoview,
  saveImoview: imoviewIntegrationsAPI.saveImoview,
  deleteImoview: imoviewIntegrationsAPI.deleteImoview,
  getGrupoOLX: grupoOLXIntegrationsAPI.getGrupoOLX,
  saveGrupoOLX: grupoOLXIntegrationsAPI.saveGrupoOLX,
  activateGrupoOLX: grupoOLXIntegrationsAPI.activateGrupoOLX,
  pauseGrupoOLX: grupoOLXIntegrationsAPI.pauseGrupoOLX,
  regenerateGrupoOLXFeedToken: grupoOLXIntegrationsAPI.regenerateGrupoOLXFeedToken,
  regenerateGrupoOLXWebhookToken: grupoOLXIntegrationsAPI.regenerateGrupoOLXWebhookToken,
  listGrupoOLXPublications: grupoOLXIntegrationsAPI.listGrupoOLXPublications,
  saveGrupoOLXPublications: grupoOLXIntegrationsAPI.saveGrupoOLXPublications,
  listGrupoOLXImportReports: grupoOLXIntegrationsAPI.listGrupoOLXImportReports,
  replayGrupoOLXImportReport: grupoOLXIntegrationsAPI.replayGrupoOLXImportReport,
  listMetaIntegrations: metaIntegrationsAPI.listMetaIntegrations,
  saveMetaConversionFeedback: metaIntegrationsAPI.saveMetaConversionFeedback,
  getMetaOAuthFlow: metaIntegrationsAPI.getMetaOAuthFlow,
  listMetaPageForms: metaIntegrationsAPI.listMetaPageForms,
  listMetaFormConfigs: metaIntegrationsAPI.listMetaFormConfigs,
  saveMetaFormConfig: metaIntegrationsAPI.saveMetaFormConfig,
  toggleMetaFormConfig: metaIntegrationsAPI.toggleMetaFormConfig,
  deleteMetaFormConfig: metaIntegrationsAPI.deleteMetaFormConfig,
  metaWebhookHealth: metaIntegrationsAPI.metaWebhookHealth,
  listMetaConversations: metaIntegrationsAPI.listMetaConversations,
  listMetaMessages: metaIntegrationsAPI.listMetaMessages,
  sendMetaMessage: metaIntegrationsAPI.sendMetaMessage,
};
