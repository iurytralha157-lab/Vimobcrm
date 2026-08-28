import { createBrowserClient } from '@supabase/ssr';
import {
  capturePasswordRecoveryIntent,
  grantPasswordRecoveryProof,
} from '@/lib/auth/password-recovery';
import type { Database } from './types';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// The Supabase client consumes PKCE/hash parameters during its asynchronous
// initialization. Capture only the presence/type of recovery evidence first
// (never the tokens themselves), so the reset screen can distinguish a real
// PASSWORD_RECOVERY session from a session that was already logged in.
if (typeof window !== 'undefined') {
  capturePasswordRecoveryIntent(window.sessionStorage, new URL(window.location.href));
}

export const supabase = createBrowserClient<Database>(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY
);

if (typeof window !== 'undefined') {
  supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY' && session?.user.id) {
      grantPasswordRecoveryProof(window.sessionStorage, session.user.id);
    }
  });
}
