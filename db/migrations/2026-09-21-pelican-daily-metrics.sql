-- Raw-reading metrics per thermostat per day (comfort, humidity, setpoint changes
-- at the thermostat, staging, overnight runtime, supply-air and loop temperatures).
-- Computed by lib/pelican-day-metrics.js. Written only when PELICAN_SUMMARY_METRICS=1.
alter table public.pelican_daily_summaries
  add column if not exists metrics jsonb;
