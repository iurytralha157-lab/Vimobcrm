"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { fetchPropertyCepAddress, type PropertyCepClientAddress } from "@/lib/api/property-cep-client";
import { PropertyCepRequests } from "@/lib/properties/property-cep-request";

type Options = {
  scopeKey: string;
  onAddress: (cep: string, address: PropertyCepClientAddress) => void;
};

export function usePropertyCepLookup({ scopeKey, onAddress }: Options) {
  const requests = useRef(new PropertyCepRequests());
  const lastLookup = useRef("");
  const scopeToken = useMemo(() => Symbol(scopeKey), [scopeKey]);
  const [loadingScope, setLoadingScope] = useState<symbol | null>(null);

  useEffect(() => {
    const coordinator = requests.current;
    return () => {
      coordinator.invalidate();
      lastLookup.current = "";
    };
  }, [scopeKey]);

  const invalidateCepLookup = useCallback(() => {
    requests.current.invalidate();
    lastLookup.current = "";
    setLoadingScope(null);
  }, []);

  const lookupCep = useCallback(async (rawCep: string, force = false) => {
    const cep = rawCep.replace(/\D/g, "");
    if (cep.length !== 8) {
      invalidateCepLookup();
      return;
    }
    if (!force && lastLookup.current === `${scopeKey}:${cep}`) return;

    const request = requests.current.begin();
    lastLookup.current = `${scopeKey}:${cep}`;
    setLoadingScope(scopeToken);
    // The client also has a deadline if the BFF or the connection stops responding.
    const timeout = window.setTimeout(() => request.controller.abort(), 5_000);
    try {
      const address = await fetchPropertyCepAddress(cep, request.controller.signal);
      if (!requests.current.isCurrent(request)) return;
      onAddress(cep, address);
      if (!address.bairro) toast.info("O CEP não informou um bairro. Preencha o bairro manualmente.");
    } catch (error) {
      // Manual edits and replacement requests must not report stale failures.
      if (!requests.current.isCurrent(request)) {
        if (request.controller.signal.aborted && requests.current.owns(request)) {
          lastLookup.current = "";
          setLoadingScope(null);
          toast.info("A consulta do CEP demorou. Você pode preencher o endereço manualmente.");
        }
        return;
      }
      lastLookup.current = "";
      toast.error(error instanceof Error ? error.message : "Não foi possível consultar o CEP. Preencha o endereço manualmente.");
    } finally {
      window.clearTimeout(timeout);
      if (requests.current.owns(request)) {
        requests.current.finish(request);
        setLoadingScope(null);
      }
    }
  }, [invalidateCepLookup, onAddress, scopeKey, scopeToken]);

  return { lookupCep, invalidateCepLookup, isCepLoading: loadingScope === scopeToken };
}
