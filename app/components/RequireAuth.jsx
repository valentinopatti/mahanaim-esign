'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../lib/supabaseClient';
import { authedFetch } from '../lib/authedFetch';

const AuthContext = createContext(null);

export function useAuth() {
  return useContext(AuthContext);
}

export default function RequireAuth({ children }) {
  const router = useRouter();
  const [state, setState] = useState({ loading: true, user: null, profile: null });

  const refreshProfile = async () => {
    const res = await authedFetch('/api/profile');
    if (res.ok) {
      const { profile } = await res.json();
      setState((s) => ({ ...s, profile }));
      return profile;
    }
    return null;
  };

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const { data } = await supabase.auth.getSession();
      const user = data?.session?.user || null;
      if (!user) {
        if (!cancelled) setState({ loading: false, user: null, profile: null });
        router.replace('/login');
        return;
      }
      const profileRes = await authedFetch('/api/profile');
      const profile = profileRes.ok ? (await profileRes.json()).profile : null;
      if (!cancelled) setState({ loading: false, user, profile });
    }
    load();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        setState({ loading: false, user: null, profile: null });
        router.replace('/login');
      }
    });

    return () => { cancelled = true; sub.subscription.unsubscribe(); };
  }, [router]);

  if (state.loading) {
    return (
      <div className="flex h-[100dvh] items-center justify-center bg-slate-100">
        <div className="w-6 h-6 border-2 border-slate-300 border-t-blue-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (!state.user) return null;

  return (
    <AuthContext.Provider value={{ ...state, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}
