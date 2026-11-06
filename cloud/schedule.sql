-- Run after deploying the monthly-brief function. Sends the brief at 07:00 UTC on the 1st of every month.
-- Replace YOUR-PROJECT-REF and YOUR-CRON-SECRET (the same value you saved as the CRON_SECRET function secret).
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.unschedule('glidepath-monthly-brief') where exists (select 1 from cron.job where jobname = 'glidepath-monthly-brief');
select cron.schedule(
  'glidepath-monthly-brief',
  '0 7 1 * *',
  $$ select net.http_post(
       url := 'https://YOUR-PROJECT-REF.supabase.co/functions/v1/monthly-brief',
       headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', 'YOUR-CRON-SECRET'),
       body := '{}'::jsonb,
       timeout_milliseconds := 120000
     ) $$
);
