# Deploying analyze-resume

Run these in your project folder (where package.json is), in order:

## 1. Install Supabase CLI (one-time)
npx supabase --version
(this installs it on first run if you don't have it — confirms it works)

## 2. Log in (one-time, opens a browser)
npx supabase login

## 3. Link this project to your Supabase project (one-time)
npx supabase link --project-ref YOUR_PROJECT_REF
(find YOUR_PROJECT_REF in Supabase dashboard -> Settings -> General -> Reference ID)

## 4. Set your Anthropic key as a secret (one-time)
npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-your-real-key-here
(SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are auto-injected by Supabase, no need to set those)

## 5. Deploy the function
npx supabase functions deploy analyze-resume

## 6. Confirm it's live
Check Supabase dashboard -> Edge Functions -> you should see "analyze-resume" listed.
