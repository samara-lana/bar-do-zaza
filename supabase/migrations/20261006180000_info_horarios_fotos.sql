-- Admin edita informações do bar, horários e fotos (antes só pela planilha).
--
--   admin_salvar_sobre(dados)      { chave: valor, ... } -> site()
--   admin_salvar_horarios(lista)   [{ dia, horario, obs }] (troca todos) -> site()
--   admin_salvar_fotos(lista)      [{ foto, legenda }] (troca todas, na ordem) -> site()
--
-- Fotos: bucket público "fotos" do Storage. Qualquer um vê (o site precisa);
-- só o admin envia, troca ou apaga.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fotos', 'fotos', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy fotos_admin_envia on storage.objects for insert to authenticated
  with check (bucket_id = 'fotos' and public.eh_admin());
create policy fotos_admin_troca on storage.objects for update to authenticated
  using (bucket_id = 'fotos' and public.eh_admin());
create policy fotos_admin_apaga on storage.objects for delete to authenticated
  using (bucket_id = 'fotos' and public.eh_admin());

create function admin_salvar_sobre(dados jsonb) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  k text;
  v jsonb;
begin
  perform exigir_admin();
  if jsonb_typeof(dados) <> 'object' then raise exception 'Dados inválidos.' using errcode = '22023'; end if;
  for k, v in select * from jsonb_each(dados) loop
    if k !~ '^[a-z0-9_]{1,40}$' then raise exception 'Campo inválido: %', k using errcode = '22023'; end if;
    insert into sobre (chave, valor) values (k, btrim(coalesce(v #>> '{}', '')))
    on conflict (chave) do update set valor = excluded.valor;
  end loop;
  return site();
end $$;

create function admin_salvar_horarios(lista jsonb) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  h jsonb;
  i integer := 0;
begin
  perform exigir_admin();
  if jsonb_typeof(lista) <> 'array' or jsonb_array_length(lista) = 0 or jsonb_array_length(lista) > 14 then
    raise exception 'Lista de horários inválida.' using errcode = '22023';
  end if;
  delete from horarios where true;
  for h in select * from jsonb_array_elements(lista) loop
    if btrim(coalesce(h ->> 'dia', '')) = '' then raise exception 'Horário sem o dia.' using errcode = '22023'; end if;
    i := i + 1;
    insert into horarios (ordem, dia, horario, obs)
    values (i, btrim(h ->> 'dia'), btrim(coalesce(h ->> 'horario', '')), btrim(coalesce(h ->> 'obs', '')));
  end loop;
  return site();
end $$;

create function admin_salvar_fotos(lista jsonb) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  f jsonb;
  i integer := 0;
begin
  perform exigir_admin();
  if jsonb_typeof(lista) <> 'array' or jsonb_array_length(lista) > 60 then
    raise exception 'Lista de fotos inválida.' using errcode = '22023';
  end if;
  delete from fotos where true;
  for f in select * from jsonb_array_elements(lista) loop
    if btrim(coalesce(f ->> 'foto', '')) = '' then continue; end if;
    i := i + 1;
    insert into fotos (ordem, foto, legenda) values (i, btrim(f ->> 'foto'), btrim(coalesce(f ->> 'legenda', '')));
  end loop;
  return site();
end $$;

revoke execute on function admin_salvar_sobre(jsonb), admin_salvar_horarios(jsonb), admin_salvar_fotos(jsonb) from public, anon;
grant execute on function admin_salvar_sobre(jsonb), admin_salvar_horarios(jsonb), admin_salvar_fotos(jsonb) to authenticated;
