import { evaluatePasswordPolicy } from '@/lib/validation/password';

export interface PasswordStrength {
  score: number; // 0-5
  level: 'very-weak' | 'weak' | 'fair' | 'good' | 'strong';
  feedback: string[];
  isValid: boolean;
}

export function usePasswordStrength(password: string): PasswordStrength {
  if (password.length === 0) {
    return {
      score: 0,
      level: 'very-weak',
      feedback: ['Senha é obrigatória'],
      isValid: false,
    };
  }

  const requirements = evaluatePasswordPolicy(password);
  const score = requirements.filter((requirement) => requirement.isValid).length;

  // Mapear score para level
  let level: PasswordStrength['level'];
  switch (score) {
    case 0:
    case 1:
      level = 'very-weak';
      break;
    case 2:
      level = 'weak';
      break;
    case 3:
      level = 'fair';
      break;
    case 4:
      level = 'good';
      break;
    case 5:
      level = 'strong';
      break;
    default:
      level = 'very-weak';
  }

  const isValid = requirements.every((requirement) => requirement.isValid);

  return {
    score,
    level,
    feedback: isValid
      ? ['Senha forte!']
      : requirements
          .filter((requirement) => !requirement.isValid)
          .map((requirement) => requirement.message),
    isValid,
  };
}

// Hook para hook bem simples
export function usePasswordValidation(password: string) {
  return usePasswordStrength(password);
}
