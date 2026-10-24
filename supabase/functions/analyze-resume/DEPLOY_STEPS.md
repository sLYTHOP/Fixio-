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

## 5. Apply the database migration
npx supabase db push

This applies pending migrations, including the policies for reading saved feedback,
the authenticated waitlist table, and the key used to reuse identical resume analyses.
The analysis is stored in the existing `feedback` table and is shown again when the user signs in.

## 6. Deploy the function
npx supabase functions deploy analyze-resume

Apply the migration before deploying the updated function, because the function
looks up the analysis key in the `feedback` table. Deploy again whenever `index.ts`
or `llm.ts` changes. The results page reads the structured `issues` entries returned
by this function to annotate the resume and pair each gap with a solution.

## 7. Confirm it's live
Check Supabase dashboard -> Edge Functions -> you should see "analyze-resume" listed.

## Optional settings (Supabase secrets)
GEMINI_MODELS   comma-separated model names, tried in order, best first. Example: GEMINI_MODELS="model-a,model-b"
                (list the names your key can use: see the models command in the chat notes)
LLM_FALLBACK    "claude" to use Claude only when every Gemini model has failed. Default "none".
                Needs the ANTHROPIC_API_KEY secret and credit on that account.
Each model gets 2 tries with a pause between them. Failures are logged with the status code
(Supabase -> Edge Functions -> analyze-resume -> Logs) and the list of attempts is saved
inside each result under meta.tried.
