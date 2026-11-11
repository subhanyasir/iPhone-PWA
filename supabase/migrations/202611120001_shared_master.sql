create table if not exists public.master_numbers (
  number text primary key check (number ~ '^[0-9]{7,15}$'),
  added_at timestamptz not null default now()
);

create table if not exists public.master_access (
  user_id uuid primary key references auth.users (id) on delete cascade
);

create table if not exists public.master_state (
  singleton boolean primary key default true check (singleton),
  total_numbers bigint not null default 0,
  initialized_at timestamptz
);

alter table public.master_state
  add column if not exists total_numbers bigint not null default 0;

insert into public.master_state (singleton) values (true)
on conflict (singleton) do nothing;

update public.master_state
set total_numbers = (select count(*) from public.master_numbers)
where singleton = true
  and total_numbers = 0
  and exists (select 1 from public.master_numbers);

alter table public.master_numbers enable row level security;
alter table public.master_access enable row level security;
alter table public.master_state enable row level security;

revoke all on public.master_numbers, public.master_access, public.master_state from anon, authenticated;

create or replace function public.require_master_access()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.master_access where user_id = auth.uid()
  ) then
    raise exception 'Access to the private master is not enabled for this account.'
      using errcode = '42501';
  end if;
end;
$$;

create or replace function public.get_master_info()
returns table (total_numbers bigint, initialized boolean)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.require_master_access();
  return query
    select
      (select total_numbers from public.master_state where singleton = true),
      (select initialized_at is not null from public.master_state where singleton = true);
end;
$$;

create or replace function public.add_master_candidates(p_candidates text[])
returns table (inserted_number text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  inserted_count bigint;
begin
  perform public.require_master_access();

  if p_candidates is null or cardinality(p_candidates) < 1 or cardinality(p_candidates) > 5000 then
    raise exception 'A candidate batch must contain between 1 and 5,000 numbers.'
      using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.master_state where singleton = true and initialized_at is not null
  ) then
    raise exception 'The private master has not been initialized.'
      using errcode = '55000';
  end if;

  if exists (
    select 1 from unnest(p_candidates) as candidate(value)
    where value is null or value !~ '^[0-9]{7,15}$'
  ) then
    raise exception 'Candidate numbers must contain 7 to 15 digits.'
      using errcode = '22023';
  end if;

  return query
    insert into public.master_numbers (number)
    select candidate.value
    from unnest(p_candidates) as candidate(value)
    on conflict (number) do nothing
    returning master_numbers.number;

  get diagnostics inserted_count = row_count;
  update public.master_state
  set total_numbers = total_numbers + inserted_count
  where singleton = true;
end;
$$;

grant execute on function public.get_master_info() to authenticated;
grant execute on function public.add_master_candidates(text[]) to authenticated;

revoke all on function public.require_master_access() from public, anon, authenticated;
revoke all on function public.get_master_info() from public, anon;
revoke all on function public.add_master_candidates(text[]) from public, anon;
