/**
 * Country data for phone input
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

/**
 * Parse a phone number and extract country code, DDD, and number
 */
export function parsePhoneInput(phone: string): { countryCode: string; ddd: string; number: string } {
  if (!phone) return { countryCode: '55', ddd: '', number: '' };

  const cleaned = phone.replace(/\D/g, '');

  if (cleaned.startsWith('55') && (cleaned.length === 12 || cleaned.length === 13)) {
    return {
      countryCode: '55',
      ddd: cleaned.slice(2, 4),
      number: cleaned.slice(4),
    };
  }

  if (cleaned.length === 10 || cleaned.length === 11) {
    return {
      countryCode: '55',
      ddd: cleaned.slice(0, 2),
      number: cleaned.slice(2),
    };
  }

  // Try to match country codes (sorted by length descending to match longer codes first)
  const sortedCountries = [...countries].sort((a, b) => b.code.length - a.code.length);

  for (const country of sortedCountries) {
    if (cleaned.startsWith(country.code)) {
      const rest = cleaned.slice(country.code.length);
      // For Brazil, DDD is 2 digits
      if (country.code === '55' && rest.length >= 2) {
        return {
          countryCode: '55',
          ddd: rest.slice(0, 2),
          number: rest.slice(2),
        };
      }
      // For other countries, assume first 2-3 digits might be area code
      if (rest.length >= 2) {
        return {
          countryCode: country.code,
          ddd: rest.slice(0, Math.min(3, Math.floor(rest.length / 2))),
          number: rest.slice(Math.min(3, Math.floor(rest.length / 2))),
        };
      }
      return {
        countryCode: country.code,
        ddd: '',
        number: rest,
      };
    }
  }

  return { countryCode: '55', ddd: '', number: cleaned };
}

/**
 * Format phone parts into a clean number string for storage
 */
export function formatPhoneFromParts(countryCode: string, ddd: string, number: string): string {
  const cleanCountry = countryCode.replace(/\D/g, '');
  const cleanDdd = ddd.replace(/\D/g, '');
  const cleanNumber = number.replace(/\D/g, '');

  if (!cleanDdd && !cleanNumber) return '';

  return `${cleanCountry}${cleanDdd}${cleanNumber}`;
}

/**
 * Get country from phone number
 */
export function getCountryFromPhone(phone: string): Country {
  const { countryCode } = parsePhoneInput(phone);
  return countries.find(c => c.code === countryCode) || countries[0];
}

/**
 * Normalizes a phone number by removing non-digits and country code 55
 * This is used to match phones in different formats (e.g., 5522999999999 vs 22999999999)
 */
export function normalizePhone(phone: string): string {
  if (!phone) return '';

  // Remove all non-digit characters
  let cleaned = phone.replace(/\D/g, '');

  // If starts with 55 and has 12+ digits, remove the 55
  if (cleaned.length >= 12 && cleaned.startsWith('55')) {
    cleaned = cleaned.substring(2);
  }

  return cleaned;
}

/**
 * Formats a phone number for WhatsApp API (Brazil default)
 * - Removes all non-digit characters
 * - Adds Brazil country code (55) if not present
 * - Handles various input formats
 */
export function formatPhoneForWhatsApp(phone: string): string {
  // Remove all non-digit characters
  const cleaned = phone.replace(/\D/g, "");

  // If empty, return as is
  if (!cleaned) return cleaned;

  // Brazil phone numbers:
  // - Full format: 55 + DDD (2 digits) + number (8-9 digits) = 12-13 digits
  // - Without country code: DDD + number = 10-11 digits
  // - Just the number: 8-9 digits

  // If already has 55 at start and is long enough, keep it
  if (cleaned.startsWith("55") && cleaned.length >= 12) {
    return cleaned;
  }

  // If has 12-13 digits but doesn't start with 55, might be a different country
  // Only add 55 if it looks like a Brazilian number (10-11 digits without country code)
  if (cleaned.length === 10 || cleaned.length === 11) {
    // Brazilian format: DDD (2 digits) + number (8-9 digits)
    return `55${cleaned}`;
  }

  // If 8-9 digits (just the number without DDD), we can't safely add 55
  // because we don't know the DDD - return as is and let it fail gracefully
  if (cleaned.length >= 8 && cleaned.length <= 9) {
    console.warn("Phone number without DDD:", cleaned);
    return cleaned;
  }

  // For any other length, return as is
  return cleaned;
}

export function isValidWhatsAppPhone(phone?: string | null): boolean {
  if (!phone) return false;

  const digits = formatPhoneForWhatsApp(phone).replace(/\D/g, '');

  if (!digits) return false;

  if (digits.startsWith('55')) {
    return digits.length === 12 || digits.length === 13;
  }

  return digits.length >= 10 && digits.length <= 15;
}

/**
 * Formats a phone number for display (with flag and formatted)
 */
export function formatPhoneForDisplay(phone: string): string {
  if (!phone) return '';

  const cleaned = phone.replace(/\D/g, "");
  const parsed = parsePhoneInput(cleaned);
  const country = countries.find(c => c.code === parsed.countryCode) || countries[0];

  // Format based on country
  if (parsed.countryCode === '55') {
    // Brazilian format: (XX) XXXXX-XXXX or (XX) XXXX-XXXX
    const num = parsed.number;
    if (num.length === 9) {
      return `${country.flag} +${parsed.countryCode} (${parsed.ddd}) ${num.slice(0, 5)}-${num.slice(5)}`;
    } else if (num.length === 8) {
      return `${country.flag} +${parsed.countryCode} (${parsed.ddd}) ${num.slice(0, 4)}-${num.slice(4)}`;
    }
  }

  // Generic format for other countries
  if (parsed.ddd) {
    return `${country.flag} +${parsed.countryCode} (${parsed.ddd}) ${parsed.number}`;
  }

  return `${country.flag} +${parsed.countryCode} ${parsed.number}`;
}
