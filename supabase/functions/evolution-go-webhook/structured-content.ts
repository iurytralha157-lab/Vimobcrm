type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue => value !== null && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};
const at = (value: RecordValue, path: string): unknown => path.split(".").reduce<unknown>((current, key) => record(current)[key], value);
const text = (value: RecordValue, paths: string[]): string => paths.map((path) => at(value, path)).find((item) => typeof item === "string" && item.trim()) as string || "";

// A bounded presentation whitelist, shared with the native writer's private
// metadata contract. No vCard body or provider-supplied quoted content is copied.
export function structuredMessagePresentation(node: RecordValue, raw: RecordValue, media: RecordValue): RecordValue {
  const bound = (value: string, bytes: number) => {
    value = value.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim();
    let result = '', size = 0;
    for (const char of value) {
      const width = new TextEncoder().encode(char).length;
      if (size + width > bytes) break;
      result += char; size += width;
    }
    return result;
  };
  const result: RecordValue = {};
  const filename = bound((text(media, ['fileName', 'FileName', 'filename', 'Filename']) || text(raw, ['fileName', 'filename'])).replace(/\\/g, '/').split('/').pop() || '', 255);
  if (filename && filename !== '.' && filename !== '..') result.media_filename = filename;
  const location = record(node.locationMessage ?? node.LocationMessage ?? node.liveLocationMessage ?? node.LiveLocationMessage);
  const latitudeValue = location.degreesLatitude ?? location.DegreesLatitude ?? location.latitude;
  const longitudeValue = location.degreesLongitude ?? location.DegreesLongitude ?? location.longitude;
  const latitude = typeof latitudeValue === 'number' || typeof latitudeValue === 'string' && latitudeValue.trim() ? Number(latitudeValue) : NaN;
  const longitude = typeof longitudeValue === 'number' || typeof longitudeValue === 'string' && longitudeValue.trim() ? Number(longitudeValue) : NaN;
  if (Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180) {
    result.message_location = {
      latitude, longitude,
      ...(text(location, ['name', 'Name']) ? { name: bound(text(location, ['name', 'Name']), 160) } : {}),
      ...(text(location, ['address', 'Address']) ? { address: bound(text(location, ['address', 'Address']), 300) } : {}),
    };
  }
  const array = record(node.contactsArrayMessage ?? node.ContactsArrayMessage);
  const list = array.contacts ?? array.Contacts;
  const contacts: RecordValue[] = [];
  for (const value of [node.contactMessage ?? node.ContactMessage, ...(Array.isArray(list) ? list.slice(0, 5) : [])]) {
    const contact = record(value);
    let name = text(contact, ['displayName', 'DisplayName']);
    const phones: string[] = [];
    for (const line of text(contact, ['vcard', 'Vcard', 'vCard', 'VCard']).slice(0, 8192).replace(/\r\n/g, '\n').split('\n')) {
      const colon = line.indexOf(':');
      if (colon < 0) continue;
      const field = line.slice(0, colon).split(';')[0].toUpperCase(), value = line.slice(colon + 1);
      if (field === 'FN' && !name) name = value;
      if ((field === 'TEL' || field.endsWith('.TEL')) && phones.length < 5) {
        const digits = value.replace(/[^0-9]/g, ''), phone = `${value.trim().startsWith('+') ? '+' : ''}${digits}`;
        if (digits.length >= 3 && phone.length <= 32 && !phones.includes(phone)) phones.push(phone);
      }
    }
    const display_name = bound(name, 160);
    if (display_name || phones.length) contacts.push({ display_name, ...(phones.length ? { phones } : {}) });
    if (contacts.length === 5) break;
  }
  if (contacts.length) result.message_contacts = contacts;
  // Inspect only current supported blocks, never historical quotedMessage descendants.
  const contexts = [raw, node, ...['extendedTextMessage', 'ExtendedTextMessage', 'imageMessage', 'ImageMessage', 'videoMessage', 'VideoMessage', 'audioMessage', 'AudioMessage', 'documentMessage', 'DocumentMessage', 'stickerMessage', 'StickerMessage', 'contactMessage', 'ContactMessage', 'contactsArrayMessage', 'ContactsArrayMessage', 'locationMessage', 'LocationMessage', 'liveLocationMessage', 'LiveLocationMessage', 'interactiveMessage', 'InteractiveMessage', 'interactiveResponseMessage', 'InteractiveResponseMessage', 'buttonsResponseMessage', 'ButtonsResponseMessage', 'templateButtonReplyMessage', 'TemplateButtonReplyMessage', 'albumMessage', 'AlbumMessage', 'templateMessage', 'TemplateMessage'].map(key => record(node[key]))];
  for (const source of contexts) {
    const context = record(source.contextInfo ?? source.ContextInfo ?? source.context_info);
    const ref = text(context, ['stanzaID', 'stanzaId', 'StanzaID', 'StanzaId']).trim();
    if (ref && new TextEncoder().encode(ref).length <= 200 && !/[\u0000-\u001f\u007f-\u009f]/.test(ref)) {
      result.quoted_message_id = ref;
      break;
    }
  }
  return result;
}

export function structuredMessageContent(node: RecordValue): string {
  const candidates: Array<[string[], string[], string]> = [
    [["contactMessage", "ContactMessage"], ["displayName", "DisplayName"], "Contato compartilhado"],
    [["contactsArrayMessage", "ContactsArrayMessage"], ["displayName", "DisplayName"], "Contatos compartilhados"],
    [["locationMessage", "LocationMessage"], ["name", "Name", "comment", "Comment"], "Localização compartilhada"],
    [["liveLocationMessage", "LiveLocationMessage"], ["caption", "Caption"], "Localização em tempo real compartilhada"],
    [["albumMessage", "AlbumMessage"], [], "Álbum de fotos ou vídeos"],
    [["interactiveMessage", "InteractiveMessage"], ["body.text", "Body.Text", "header.title", "Header.Title"], "Mensagem interativa recebida. Abra o WhatsApp para interagir."],
    [["interactiveResponseMessage", "InteractiveResponseMessage"], ["body.text", "Body.Text"], "Resposta interativa recebida"],
    [["templateMessage", "TemplateMessage"], ["hydratedTemplate.hydratedContentText", "HydratedTemplate.HydratedContentText", "hydratedFourRowTemplate.hydratedContentText", "HydratedFourRowTemplate.HydratedContentText", "interactiveMessageTemplate.body.text", "InteractiveMessageTemplate.Body.Text"], "Mensagem recebida. Abra o WhatsApp para ver o conteúdo completo."],
    [["buttonsResponseMessage", "ButtonsResponseMessage"], ["selectedDisplayText", "SelectedDisplayText", "selectedButtonID", "SelectedButtonID"], "Resposta recebida"],
    [["templateButtonReplyMessage", "TemplateButtonReplyMessage"], ["selectedDisplayText", "SelectedDisplayText", "selectedID", "SelectedID"], "Resposta recebida"],
  ];
  for (const [paths, fields, label] of candidates) {
    const block = paths.map((path) => record(node[path])).find((item) => Object.keys(item).length > 0);
    if (!block) continue;
    const content = text(block, fields).trim();
    if (!content) return label;
    return paths[0] === "contactMessage" || paths[0] === "contactsArrayMessage" ? `${label}: ${content}` : content;
  }
  return "";
}

export function isEncryptedMessageEditControl(node: RecordValue, options: {
  providerIdSynthetic: boolean;
  hasCampaignSignal: boolean;
  remoteJid: string;
  unsupportedIdentity?: boolean;
  hasCustomerContent?: boolean;
  outerMessage?: RecordValue;
}): boolean {
  if (options.providerIdSynthetic || options.hasCampaignSignal || options.unsupportedIdentity || options.hasCustomerContent) return false;
  // Unknown representations in declared text/media fields stay retryable.
  for (const key of ["text", "body", "content", "caption", "buttonText", "button_text", "buttonId", "button_id", "base64", "Base64", "media", "file", "mediaUrl", "media_url", "url"]) {
    const value = options.outerMessage?.[key];
    if (value !== undefined && value !== null && value !== "") return false;
  }
  if (Object.keys(node).some((key) => !["secretEncryptedMessage", "SecretEncryptedMessage", "messageContextInfo", "MessageContextInfo"].includes(key))) return false;
  const edit = record(node.secretEncryptedMessage ?? node.SecretEncryptedMessage);
  const kind = edit.secretEncType ?? edit.SecretEncType;
  if (kind !== 2 && kind !== "2" && kind !== "MESSAGE_EDIT") return false;
  if (![edit.encPayload ?? edit.EncPayload, edit.encIV ?? edit.EncIV].every((value) => typeof value === "string" && value.trim())) return false;
  const target = record(edit.targetMessageKey ?? edit.TargetMessageKey);
  const id = target.id ?? target.ID;
  if (typeof id !== "string" || !id.trim()) return false;
  const remote = target.remoteJid ?? target.RemoteJID;
  if (remote != null && (typeof remote !== "string" || (remote.trim() && remote.trim().toLowerCase() !== options.remoteJid))) return false;
  return true;
}

export function encryptedEditHasFrozenCaptureRoute(payload: RecordValue, providerMessageId: string): boolean {
  const routes = at(payload, "__vimob_ingress.routing_snapshot.messages");
  if (!Array.isArray(routes)) return false;
  return routes.some((candidate) => {
    const route = record(candidate);
    return route.provider_message_id === providerMessageId && route.binding_eligible !== false;
  });
}
