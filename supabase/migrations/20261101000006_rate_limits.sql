-- Rate limits, so the catalogue cannot be pulled out in bulk.
--
-- One row per caller, rule and time window. rate_hit() counts a request
-- against every window it is given in one round trip and says how long to
-- wait when any of them is full. Only the service role (the app's server)
-- can touch either; RLS with no policies keeps anon and members out.

create table if not exists public.rate_hits (
  bucket text not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (bucket, window_start)
);

alter table public.rate_hits enable row level security;

-- Returns 0 when the request may go ahead, otherwise the seconds until the
-- fullest window resets. p_windows are window lengths in seconds and
-- p_limits the most requests allowed in each.
create or replace function public.rate_hit(p_key text, p_windows int[], p_limits int[], p_cost int default 1)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  i int;
  w timestamptz;
  n int;
  wait int := 0;
begin
  for i in 1 .. coalesce(array_length(p_windows, 1), 0) loop
    w := to_timestamp(floor(extract(epoch from now()) / p_windows[i]) * p_windows[i]);
    insert into rate_hits as r (bucket, window_start, hits)
    values (p_key || '/' || p_windows[i], w, p_cost)
    on conflict (bucket, window_start) do update set hits = r.hits + p_cost
    returning r.hits into n;
    if n > p_limits[i] then
      wait := greatest(wait, ceil(extract(epoch from (w + make_interval(secs => p_windows[i]) - now())))::int);
    end if;
  end loop;

  -- Old windows are no use to anyone; sweep them now and then.
  if random() < 0.01 then
    delete from rate_hits where window_start < now() - interval '2 days';
  end if;

  return wait;
end;
$$;

revoke all on function public.rate_hit(text, int[], int[], int) from public, anon, authenticated;
grant execute on function public.rate_hit(text, int[], int[], int) to service_role;
