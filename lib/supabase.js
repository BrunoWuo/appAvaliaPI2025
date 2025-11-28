import AsyncStorage from '@react-native-async-storage/async-storage'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://hleqnmmnxbizyogdhytj.supabase.co'
const supabasePublishableKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhsZXFubW1ueGJpenlvZ2RoeXRqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk4NjEwMTAsImV4cCI6MjA3NTQzNzAxMH0.EvYcPqY8FfW4FlB_07Y26I9Q3wgJwqdCPP5aEg2-Qh0'

export const supabase = createClient(supabaseUrl, supabasePublishableKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
})

// Helper para inserir múltiplas avaliações (retorna { data, error })
export async function insertAvaliacoesBatch(records) {
  try {
    return await supabase.from('avaliacoes').insert(records);
  } catch (e) {
    console.error('insertAvaliacoesBatch error:', e);
    return { data: null, error: e };
  }
}

// Helper para inserir uma única avaliação
export async function insertAvaliacao(record) {
  try {
    return await supabase.from('avaliacoes').insert([record]);
  } catch (e) {
    console.error('insertAvaliacao error:', e);
    return { data: null, error: e };
  }
}