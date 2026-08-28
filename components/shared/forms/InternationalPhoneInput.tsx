import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  countries,
  formatPhoneFromParts,
  parsePhoneInput,
  type Country,
} from '@/lib/phone-utils';
import { normalizeSearchText } from '@/lib/search-text';
import { cn } from '@/lib/utils';

interface InternationalPhoneInputProps {
  value: string;
  onChange: (value: string) => void;
  id?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
}

type PhoneView = {
  country: Country | null;
  text: string;
};

function formatBrazilianLocalPhone(digits: string) {
  const clean = digits.replace(/\D/g, '').slice(0, 11);
  if (clean.length <= 2) return clean;

  const ddd = clean.slice(0, 2);
  const number = clean.slice(2);
  if (number.length <= 4) return `(${ddd}) ${number}`;
  if (number.length <= 8) return `(${ddd}) ${number.slice(0, 4)}-${number.slice(4)}`;
  return `(${ddd}) ${number.slice(0, 5)}-${number.slice(5)}`;
}

function countryForCode(countryCode: string) {
  return countries.find((country) => country.code === countryCode) || null;
}

function viewForValue(value: string): PhoneView {
  if (!value) return { country: countries[0], text: '' };

  const parsed = parsePhoneInput(value);
  const country = countryForCode(parsed.countryCode);
  if (!country) {
    const trimmed = value.trim();
    const digits = value.replace(/\D/g, '').slice(0, 15);
    return {
      country: null,
      text: digits ? `+${digits}` : trimmed.startsWith('+') ? '+' : '',
    };
  }

  const localDigits = `${parsed.ddd}${parsed.number}`;
  return {
    country,
    text: country.code === '55' ? formatBrazilianLocalPhone(localDigits) : localDigits,
  };
}

function canonicalPartialInternational(raw: string) {
  const trimmed = raw.trim();
  const digits = raw.replace(/\D/g, '');
  const internationalDigits = trimmed.startsWith('00') ? digits.slice(2) : digits;
  if (internationalDigits) return `+${internationalDigits.slice(0, 15)}`;
  return trimmed.startsWith('+') || trimmed.startsWith('00') ? '+' : '';
}

export function InternationalPhoneInput({
  value,
  onChange,
  id,
  placeholder = '(00) 00000-0000',
  disabled = false,
  className,
  'aria-invalid': ariaInvalid,
  'aria-describedby': ariaDescribedBy,
}: InternationalPhoneInputProps) {
  const initialView = useMemo(() => viewForValue(value), [value]);
  const [selectedCountry, setSelectedCountry] = useState<Country | null>(initialView.country);
  const [phoneText, setPhoneText] = useState(initialView.text);
  const [countryPopoverOpen, setCountryPopoverOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      const next = viewForValue(value);
      setSelectedCountry(next.country);
      setPhoneText(next.text);
    });

    return () => {
      cancelled = true;
    };
  }, [value]);

  const filteredCountries = useMemo(() => {
    if (!searchQuery) return countries;
    const query = normalizeSearchText(searchQuery);
    return countries.filter((country) =>
      normalizeSearchText(country.name).includes(query) || country.code.includes(query)
    );
  }, [searchQuery]);

  const commitInternational = (raw: string) => {
    const nextValue = canonicalPartialInternational(raw);
    const next = viewForValue(nextValue);
    setSelectedCountry(next.country);
    setPhoneText(next.text);
    onChange(nextValue);
  };

  const handlePhoneChange = (raw: string) => {
    const trimmed = raw.trim();
    const digits = raw.replace(/\D/g, '');
    const hasInternationalPrefix = trimmed.startsWith('+') || trimmed.startsWith('00');
    const pastedCountryInclusive = selectedCountry?.code === '55' && digits.length >= 12;

    if (hasInternationalPrefix || pastedCountryInclusive || !selectedCountry) {
      commitInternational(raw);
      return;
    }

    const localDigits = selectedCountry.code === '55'
      ? digits.slice(0, 11)
      : digits.slice(0, Math.max(0, 15 - selectedCountry.code.length));
    const nextValue = formatPhoneFromParts(selectedCountry.code, '', localDigits);
    setPhoneText(selectedCountry.code === '55' ? formatBrazilianLocalPhone(localDigits) : localDigits);
    onChange(nextValue);
  };

  const handleCountrySelect = (country: Country) => {
    setSelectedCountry(country);
    setCountryPopoverOpen(false);
    setSearchQuery('');

    const currentParsed = parsePhoneInput(value);
    const currentCountry = countryForCode(currentParsed.countryCode);
    const localDigits = currentCountry ? `${currentParsed.ddd}${currentParsed.number}` : '';
    const nextValue = formatPhoneFromParts(country.code, '', localDigits);
    setPhoneText(country.code === '55' ? formatBrazilianLocalPhone(localDigits) : localDigits);
    onChange(nextValue);
  };

  return (
    <div className={cn('flex items-center gap-1', className)}>
      <Popover open={countryPopoverOpen} onOpenChange={setCountryPopoverOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-label="Selecionar DDI do telefone"
            aria-expanded={countryPopoverOpen}
            disabled={disabled}
            className="w-[100px] shrink-0 justify-between px-2 font-normal"
          >
            <span className="flex items-center gap-1 truncate">
              <span className="text-base">{selectedCountry?.flag || '🌐'}</span>
              <span className="text-sm text-muted-foreground">
                {selectedCountry ? `+${selectedCountry.code}` : 'DDI'}
              </span>
            </span>
            <ChevronDown className="ml-1 h-3 w-3 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[240px] p-0" align="start">
          <div className="border-b p-2">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label="Buscar pais ou DDI"
                placeholder="Buscar pais..."
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                className="h-8 pl-8"
              />
            </div>
          </div>
          <ScrollArea className="h-[200px]">
            <div className="p-1">
              {filteredCountries.map((country) => (
                <button
                  key={`${country.code}-${country.name}`}
                  type="button"
                  onClick={() => handleCountrySelect(country)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent',
                    selectedCountry?.name === country.name && 'bg-accent'
                  )}
                >
                  <span className="text-lg">{country.flag}</span>
                  <span className="flex-1 truncate">{country.name}</span>
                  <span className="text-muted-foreground">+{country.code}</span>
                </button>
              ))}
            </div>
          </ScrollArea>
        </PopoverContent>
      </Popover>

      <Input
        id={id}
        value={phoneText}
        onChange={(event) => handlePhoneChange(event.target.value)}
        placeholder={selectedCountry ? placeholder : '+DDI e numero'}
        disabled={disabled}
        inputMode="tel"
        autoComplete="tel"
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedBy}
        className="min-w-0 flex-1"
      />
    </div>
  );
}
