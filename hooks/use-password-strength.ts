/**
 * Hook para validação de força de senha
 * Valida:
 * - Tamanho mínimo (8 caracteres)
 * - Letra maiúscula
 * - Letra minúscula
 * - Número
 * - Caractere especial
 */

export interface PasswordStrength {
  score: number; // 0-5
  level: 'very-weak' | 'weak' | 'fair' | 'good' | 'strong';
  feedback: string[];
  isValid: boolean;
}

export function usePasswordStrength(password: string): PasswordStrength {
  const feedback: string[] = [];
  let score = 0;

  // Verificar tamanho
  if (password.length === 0) {
    return {
      score: 0,
      level: 'very-weak',
      feedback: ['Senha é obrigatória'],
      isValid: false,
    };
  }

  if (password.length < 8) {
    feedback.push('Mínimo 8 caracteres');
  } else {
    score += 1;
  }

  // Verificar letra maiúscula
  if (!/[A-Z]/.test(password)) {
    feedback.push('Adicione letra maiúscula (A-Z)');
  } else {
    score += 1;
  }

  // Verificar letra minúscula
  if (!/[a-z]/.test(password)) {
    feedback.push('Adicione letra minúscula (a-z)');
  } else {
    score += 1;
  }

  // Verificar número
  if (!/[0-9]/.test(password)) {
    feedback.push('Adicione número (0-9)');
  } else {
    score += 1;
  }

  // Verificar caractere especial
  if (!/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password)) {
    feedback.push('Adicione caractere especial (!@#$%...)');
  } else {
    score += 1;
  }

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

  const isValid = score >= 4 && password.length >= 8; // Mínimo "good"

  return {
    score,
    level,
    feedback: feedback.length > 0 ? feedback : ['Senha forte!'],
    isValid,
  };
}

// Hook para hook bem simples
export function usePasswordValidation(password: string) {
  return usePasswordStrength(password);
}
