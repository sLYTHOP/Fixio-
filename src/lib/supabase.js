import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    '[supabase] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. ' +
    'Add them to a .env file at the project root (see .env.example).'
  )
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

export async function signInWithGoogle() {
  return supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.origin,
    },
  })
}

export async function signOut() {
  return supabase.auth.signOut()
}

export async function uploadResume(userId, file) {
  const path = `${userId}/${Date.now()}-${file.name}`
  const { data, error } = await supabase.storage.from('resumes').upload(path, file, {
    upsert: true,
  })
  return { data, error }
}

// Saves an email to the waitlist table. Already being on the list counts as success.
export async function joinWaitlist({ email, role = null, source, userId = null }) {
  const { error } = await supabase.from('waitlist').insert({
    email: email.trim().toLowerCase(),
    role,
    source,
    user_id: userId,
  })
  // 23505 = unique violation: this email is already on the list for this role/source
  if (error && error.code !== '23505') return { error }
  return { error: null }
}
