/**
 * Country data used by the phone input. Codes do not include the leading `+`.
 */
export interface Country {
  name: string;
  code: string;
  flag: string;
}

export const countries: Country[] = [
  { name: 'Brasil', code: '55', flag: '🇧🇷' },
  { name: 'Estados Unidos', code: '1', flag: '🇺🇸' },
  { name: 'Portugal', code: '351', flag: '🇵🇹' },
  { name: 'Argentina', code: '54', flag: '🇦🇷' },
  { name: 'México', code: '52', flag: '🇲🇽' },
  { name: 'Espanha', code: '34', flag: '🇪🇸' },
  { name: 'Colômbia', code: '57', flag: '🇨🇴' },
  { name: 'Chile', code: '56', flag: '🇨🇱' },
  { name: 'Peru', code: '51', flag: '🇵🇪' },
  { name: 'Uruguai', code: '598', flag: '🇺🇾' },
  { name: 'Paraguai', code: '595', flag: '🇵🇾' },
  { name: 'Bolívia', code: '591', flag: '🇧🇴' },
  { name: 'Equador', code: '593', flag: '🇪🇨' },
  { name: 'Venezuela', code: '58', flag: '🇻🇪' },
  { name: 'Canadá', code: '1', flag: '🇨🇦' },
  { name: 'Reino Unido', code: '44', flag: '🇬🇧' },
  { name: 'França', code: '33', flag: '🇫🇷' },
  { name: 'Alemanha', code: '49', flag: '🇩🇪' },
  { name: 'Itália', code: '39', flag: '🇮🇹' },
  { name: 'Japão', code: '81', flag: '🇯🇵' },
];

const E164_PATTERN = /^\+[1-9]\d{7,14}$/;
const PHONE_INPUT_PATTERN = /^[+\d\s().-]+$/;

function hasValidParenthesisStructure(value: string) {
  let parenthesisDepth = 0;

  for (const character of value) {
    if (character === '(') {
      if (parenthesisDepth !== 0) return false;
      parenthesisDepth = 1;
    } else if (character === ')') {
      if (parenthesisDepth !== 1) return false;
      parenthesisDepth = 0;
    }
  }

  return parenthesisDepth === 0;
}

function hasExplicitInternationalPrefix(value: string) {
  const trimmed = value.trim();
  return trimmed.startsWith('+') || trimmed.startsWith('00');
}

function sortedUniqueCountryCodes() {
  return Array.from(new Set(countries.map((country) => country.code)))
    .sort((left, right) => right.length - left.length);
}

/**
 * Converts a user/provider phone into E.164.
 *
 * Brazilian numbers remain convenient: a local DDD + number (10 or 11
 * digits), and legacy values beginning with 55, are accepted. International
 * values must carry an explicit `+`/`00`, or already contain 12-15 digits.
 */
export function normalizePhoneToE164(phone?: string | null): string | null {
  if (!phone) return null;

  const trimmed = phone.trim();
  if (
    !trimmed
    || !PHONE_INPUT_PATTERN.test(trimmed)
    || !hasValidParenthesisStructure(trimmed)
  ) return null;

  const plusCount = (trimmed.match(/\+/g) || []).length;
  if (plusCount > 1 || (plusCount === 1 && !trimmed.startsWith('+'))) return null;

  const digits = trimmed.replace(/\D/g, '');
  let internationalDigits: string;

  if (trimmed.startsWith('+')) {
    internationalDigits = digits;
  } else if (trimmed.startsWith('00')) {
    internationalDigits = digits.slice(2);
  } else if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) {
    internationalDigits = digits;
  } else if (digits.length === 10 || digits.length === 11) {
    internationalDigits = `55${digits}`;
  } else if (digits.length >= 12 && digits.length <= 15) {
    internationalDigits = digits;
  } else {
    return null;
  }

  const normalized = `+${internationalDigits}`;
  return E164_PATTERN.test(normalized) ? normalized : null;
}

export function isValidE164Phone(phone?: string | null): boolean {
  return normalizePhoneToE164(phone) !== null;
}

/**
 * Parses a phone for the controlled country/local-number input.
 */
export function parsePhoneInput(phone: string): { countryCode: string; ddd: string; number: string } {
  if (!phone) return { countryCode: '55', ddd: '', number: '' };

  const trimmed = phone.trim();
  const cleaned = trimmed.replace(/\D/g, '');
  const explicitInternational = hasExplicitInternationalPrefix(trimmed);

  if (!explicitInternational && (cleaned.length === 10 || cleaned.length === 11)) {
    return {
      countryCode: '55',
      ddd: cleaned.slice(0, 2),
      number: cleaned.slice(2),
    };
  }

  if (cleaned.startsWith('55') && (cleaned.length === 12 || cleaned.length === 13)) {
    return {
      countryCode: '55',
      ddd: cleaned.slice(2, 4),
      number: cleaned.slice(4),
    };
  }

  if (explicitInternational || cleaned.length >= 12) {
    const countryCode = sortedUniqueCountryCodes().find((code) => cleaned.startsWith(code));
    if (countryCode) {
      const rest = cleaned.slice(countryCode.length);
      if (countryCode === '55') {
        return {
          countryCode,
          ddd: rest.slice(0, 2),
          number: rest.slice(2),
        };
      }
      return { countryCode, ddd: '', number: rest };
    }
  }

  if (explicitInternational) {
    return { countryCode: '', ddd: '', number: cleaned };
  }

  return { countryCode: '55', ddd: '', number: cleaned };
}

/**
 * Builds the canonical value emitted by the phone input. Partial values are
 * allowed while typing; submit-time validation is handled separately.
 */
export function formatPhoneFromParts(countryCode: string, ddd: string, number: string): string {
  const cleanCountry = countryCode.replace(/\D/g, '');
  const localDigits = `${ddd}${number}`.replace(/\D/g, '');
  if (!cleanCountry || !localDigits) return '';

  return `+${`${cleanCountry}${localDigits}`.slice(0, 15)}`;
}

export function getCountryFromPhone(phone: string): Country {
  const { countryCode } = parsePhoneInput(phone);
  return countries.find((country) => country.code === countryCode) || countries[0];
}

/**
 * Produces a comparison key while retaining compatibility with legacy BR
 * matching, where the 55 prefix was intentionally omitted.
 */
export function normalizePhone(phone: string): string {
  const canonical = normalizePhoneToE164(phone);
  const digits = (canonical || phone).replace(/\D/g, '');
  return digits.startsWith('55') && (digits.length === 12 || digits.length === 13)
    ? digits.slice(2)
    : digits;
}

/**
 * WhatsApp addresses use the E.164 digits without the leading `+`.
 */
export function formatPhoneForWhatsApp(phone: string): string {
  const canonical = normalizePhoneToE164(phone);
  return canonical ? canonical.slice(1) : '';
}

export function isValidWhatsAppPhone(phone?: string | null): boolean {
  return isValidE164Phone(phone);
}

/**
 * Formats known countries without changing the canonical country code.
 */
export function formatPhoneForDisplay(phone: string): string {
  if (!phone) return '';

  const canonical = normalizePhoneToE164(phone);
  if (!canonical) return phone.trim();

  const parsed = parsePhoneInput(canonical);
  const country = countries.find((entry) => entry.code === parsed.countryCode);
  if (!country) return canonical;

  if (parsed.countryCode === '55') {
    const num = parsed.number;
    if (num.length === 9) {
      return `${country.flag} +55 (${parsed.ddd}) ${num.slice(0, 5)}-${num.slice(5)}`;
    }
    if (num.length === 8) {
      return `${country.flag} +55 (${parsed.ddd}) ${num.slice(0, 4)}-${num.slice(4)}`;
    }
  }

  return `${country.flag} +${parsed.countryCode} ${parsed.number}`.trim();
}

const WHATSAPP_INDIVIDUAL_JID_PATTERN = /^([1-9]\d{7,14})(?::\d+)?@(s\.whatsapp\.net|c\.us)$/i;

function phoneFromWhatsAppJid(remoteJid?: string | null) {
  const match = remoteJid?.trim().match(WHATSAPP_INDIVIDUAL_JID_PATTERN);
  return match ? normalizePhoneToE164(`+${match[1]}`) : null;
}

function normalizeWhatsAppContactValue(value?: string | null) {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('+') || trimmed.startsWith('00')) {
    return normalizePhoneToE164(trimmed);
  }
  if (/^[1-9]\d{7,14}$/.test(trimmed)) {
    return normalizePhoneToE164(`+${trimmed}`);
  }

  return normalizePhoneToE164(trimmed);
}

/**
 * Resolves the canonical phone identity stored by WhatsApp. Unlike manual
 * lead entry, digits-only contact_phone/JID values already include the DDI.
 */
export function normalizeWhatsAppContactPhoneToE164(
  contactPhone?: string | null,
  remoteJid?: string | null,
): string | null {
  return phoneFromWhatsAppJid(remoteJid) || normalizeWhatsAppContactValue(contactPhone);
}

export function formatWhatsAppContactPhoneForDisplay(
  contactPhone?: string | null,
  remoteJid?: string | null,
): string {
  const canonical = normalizeWhatsAppContactPhoneToE164(contactPhone, remoteJid);
  return canonical ? formatPhoneForDisplay(canonical) : contactPhone?.trim() || '';
}

export function formatWhatsAppContactLabel(
  contactName?: string | null,
  contactPhone?: string | null,
  remoteJid?: string | null,
): string {
  const trimmedName = contactName?.trim() || '';
  const canonical = normalizeWhatsAppContactPhoneToE164(contactPhone, remoteJid);

  if (trimmedName) {
    const nameCanonical = normalizeWhatsAppContactPhoneToE164(trimmedName, trimmedName);
    if (!canonical || nameCanonical !== canonical) return trimmedName;
  }

  return canonical ? formatPhoneForDisplay(canonical) : trimmedName;
}
