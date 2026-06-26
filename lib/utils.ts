import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Retorna a data/hora atual no fuso horário de Brasília (America/Sao_Paulo)
 */
export function getBrasiliaTime(): Date {
  const now = new Date();
  // Converter para horário de Brasília
  const brasiliaTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  return brasiliaTime;
}

/**
 * Retorna a data atual no fuso horário de Brasília
 */
export function getBrasiliaDate(): Date {
  const brasiliaTime = getBrasiliaTime();
  brasiliaTime.setHours(0, 0, 0, 0);
  return brasiliaTime;
}

/**
 * Retorna o horário atual de Brasília formatado para input de tempo (HH:mm)
 * Arredonda para os próximos 15 minutos
 */
export function getCurrentTimeForInput(): string {
  const now = getBrasiliaTime();
  const hours = now.getHours();
  const minutes = Math.ceil(now.getMinutes() / 15) * 15;

  // Ajustar se minutos = 60
  const finalHours = minutes === 60 ? (hours + 1) % 24 : hours;
  const finalMinutes = minutes === 60 ? 0 : minutes;

  return `${String(finalHours).padStart(2, '0')}:${String(finalMinutes).padStart(2, '0')}`;
}
