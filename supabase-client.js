/* ---------------- Supabase client ---------------- */
const SUPABASE_URL = 'https://nbyztvcvdjrqhtpktqfx.supabase.co';
const SUPABASE_KEY = 'sb_publishable_Z0ju--CzxpdAWsGGdkJD5w_s3blbSzW';
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

/* ---------------- auth actions ---------------- */
async function signUpUser({ name, country, phone, email, password, plan }) {
  const { data, error } = await supabaseClient.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: name, country, phone }
    }
  });
  if (error) return { error };

  // plan gets set separately since the auto-created profile row defaults to 'basic'
  if (data.user && plan && plan !== 'basic') {
    await supabaseClient.from('profiles').update({ plan }).eq('id', data.user.id);
  }
  return { data };
}

async function signInUser({ email, password }) {
  const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
  return { data, error };
}

async function signOutUser() {
  await supabaseClient.auth.signOut();
}

async function getCurrentSession() {
  const { data } = await supabaseClient.auth.getSession();
  return data.session;
}

async function getProfile(userId) {
  const { data, error } = await supabaseClient.from('profiles').select('*').eq('id', userId).single();
  if (error) return null;
  return data;
}

/* ---------------- holdings persistence ---------------- */
async function fetchHoldingsFromDb(userId) {
  const { data, error } = await supabaseClient.from('holdings').select('*').eq('user_id', userId);
  if (error) return [];
  return data.map(row => ({ id: row.coin_id, sym: row.symbol, name: row.name, amount: Number(row.amount), dbId: row.id }));
}

async function saveHoldingToDb(userId, holding) {
  const { data, error } = await supabaseClient.from('holdings').insert({
    user_id: userId, coin_id: holding.id, symbol: holding.sym, name: holding.name, amount: holding.amount
  }).select().single();
  if (error) return null;
  return data.id;
}

async function updateHoldingAmountInDb(dbId, newAmount) {
  await supabaseClient.from('holdings').update({ amount: newAmount }).eq('id', dbId);
}

async function deleteHoldingFromDb(dbId) {
  await supabaseClient.from('holdings').delete().eq('id', dbId);
}
