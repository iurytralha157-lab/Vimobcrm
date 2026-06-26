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
import { cn } from '@/lib/utils';
import { countries, formatPhoneFromParts, parsePhoneInput, type Country } from '@/lib/phone-utils';

interface PhoneInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

function formatBrazilianLocalPhone(digits: string) {
  const clean = digits.replace(/\D/g, '').slice(0, 11);
  if (clean.length <= 2) return clean;

  const ddd = clean.slice(0, 2);
  const number = clean.slice(2);
  if (number.length <= 4) return `(${ddd}) ${number}`;
  if (number.length <= 8) return `(${ddd}) ${number.slice(0, 4)}-${number.slice(4)}`;
  return `(${ddd}) ${number.slice(0, 5)}-${number.slice(5)}`;
}

function displayPhone(value: string, country: Country) {
  const parsed = parsePhoneInput(value);
  const localDigits = `${parsed.ddd}${parsed.number}`;

  if (!value) return '';
  if (country.code === '55') return formatBrazilianLocalPhone(localDigits);
  return localDigits;
}

function buildPhoneValue(raw: string, selectedCountry: Country) {
  const cleaned = raw.replace(/\D/g, '');
  if (!cleaned) return { country: selectedCountry, value: '' };

  const looksInternational = raw.trim().startsWith('+') || (
    selectedCountry.code !== '55' &&
    cleaned.startsWith(selectedCountry.code)
  ) || (cleaned.startsWith('55') && cleaned.length >= 12);

  if (looksInternational) {
    const parsed = parsePhoneInput(cleaned);
    const parsedCountry = countries.find((country) => country.code === parsed.countryCode) || selectedCountry;
    return {
      country: parsedCountry,
      value: formatPhoneFromParts(parsedCountry.code, parsed.ddd, parsed.number),
    };
  }

  if (selectedCountry.code === '55') {
    const localDigits = cleaned.slice(0, 11);
    return {
      country: selectedCountry,
      value: formatPhoneFromParts('55', localDigits.slice(0, 2), localDigits.slice(2)),
    };
  }

  return {
    country: selectedCountry,
    value: formatPhoneFromParts(selectedCountry.code, '', cleaned),
  };
}

export function PhoneInput({
  value,
  onChange,
  placeholder = '(00) 00000-0000',
  disabled = false,
  className,
}: PhoneInputProps) {
  const parsed = useMemo(() => parsePhoneInput(value), [value]);
  const initialCountry = countries.find((country) => country.code === parsed.countryCode) || countries[0];
  const [selectedCountry, setSelectedCountry] = useState<Country>(initialCountry);
  const [phoneText, setPhoneText] = useState(displayPhone(value, initialCountry));
  const [countryPopoverOpen, setCountryPopoverOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      const nextParsed = parsePhoneInput(value);
      const nextCountry = countries.find((country) => country.code === nextParsed.countryCode) || countries[0];
      setSelectedCountry(nextCountry);
      setPhoneText(displayPhone(value, nextCountry));
    });

    return () => {
      cancelled = true;
    };
  }, [value]);

  const filteredCountries = useMemo(() => {
    if (!searchQuery) return countries;
    const query = searchQuery.toLowerCase();
    return countries.filter((country) =>
      country.name.toLowerCase().includes(query) || country.code.includes(query)
    );
  }, [searchQuery]);

  const handlePhoneChange = (raw: string) => {
    const next = buildPhoneValue(raw, selectedCountry);
    setSelectedCountry(next.country);
    setPhoneText(displayPhone(next.value, next.country));
    onChange(next.value);
  };

  const handleCountrySelect = (country: Country) => {
    setSelectedCountry(country);
    setCountryPopoverOpen(false);
    setSearchQuery('');

    const parsedCurrent = parsePhoneInput(value);
    const nextValue = formatPhoneFromParts(country.code, parsedCurrent.ddd, parsedCurrent.number);
    setPhoneText(displayPhone(nextValue, country));
    onChange(nextValue);
  };

  return (
    <div className={cn('flex items-center gap-1', className)}>
      <Popover open={countryPopoverOpen} onOpenChange={setCountryPopoverOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            disabled={disabled}
            className="w-[100px] justify-between px-2 font-normal shrink-0"
          >
            <span className="flex items-center gap-1 truncate">
              <span className="text-base">{selectedCountry.flag}</span>
              <span className="text-sm text-muted-foreground">+{selectedCountry.code}</span>
            </span>
            <ChevronDown className="ml-1 h-3 w-3 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[240px] p-0" align="start">
          <div className="p-2 border-b">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar pais..."
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                className="pl-8 h-8"
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
                    'w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm hover:bg-accent text-left',
                    selectedCountry.code === country.code && 'bg-accent'
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
        value={phoneText}
        onChange={(event) => handlePhoneChange(event.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        inputMode="tel"
        autoComplete="tel"
        className="min-w-0 flex-1"
      />
    </div>
  );
}
