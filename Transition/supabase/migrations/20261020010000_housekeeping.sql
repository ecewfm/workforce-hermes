-- ════════════════════════════════════════════════════════════════════════════
-- Housekeeping
--   • Caddy's per-user rate limit (api/gemini.js) logs one AI_REQUEST row per
--     Gemini call in security_logs. Only the last 10 minutes matter for the
--     limit, so rows older than a day are pruned every hour.
-- ════════════════════════════════════════════════════════════════════════════
create index if not exists security_logs_user_action_time_idx
  on public.security_logs (user_email, action, created_at desc);

do $$
begin
  perform cron.schedule('prune-ai-request-logs', '17 * * * *',
    $c$delete from public.security_logs where action = 'AI_REQUEST' and created_at < now() - interval '1 day'$c$);
exception when others then
  raise notice 'pg_cron unavailable (%) — prune AI_REQUEST rows in security_logs some other way.', sqlerrm;
end $$;
