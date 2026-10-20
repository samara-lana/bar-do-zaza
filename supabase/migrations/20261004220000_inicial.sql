-- Bar do Zazá · banco (substitui a planilha + Apps Script)
--
-- Quem lê e escreve é sempre uma função (rpc). As tabelas ficam fechadas por
-- RLS: o site público só chama site(); o admin só funciona com o usuário que
-- estiver na tabela admins.
--
--   site()                          -> mesmo JSON que o Apps Script devolvia
--   admin_listar()                  -> linhas do cardápio
--   admin_salvar_item(original, item), admin_excluir_item(original),
--   admin_em_falta(secao, nome, opcao, valor) -> linhas do cardápio
--   salvar_comandas(lista)          -> { ok, salvas }
--   listar_comandas(dias)           -> { ok, comandas }
--
-- Comanda: cada lançamento é uma linha própria. Tirar um item não apaga a
-- linha, marca `removido_em` (fica o histórico de tudo que foi lançado).

create extension if not exists unaccent with schema extensions;

-- ---------- conteúdo do site ----------

create table cardapio (
  id          bigint generated always as identity primary key,
  ordem       integer not null,
  secao       text    not null check (btrim(secao) <> ''),
  nome        text    not null check (btrim(nome) <> ''),
  opcao       text    not null default '',
  descricao   text    not null default '',
  preco       numeric(10, 2) check (preco is null or (preco >= 0 and preco < 100000)),
  em_falta    boolean not null default false,
  modificado_em timestamptz not null default now()
);
create index cardapio_ordem on cardapio (ordem);

create table horarios (
  ordem   integer primary key,
  dia     text not null,
  horario text not null default '',
  obs     text not null default ''
);

create table fotos (
  ordem   integer primary key,
  foto    text not null,
  legenda text not null default ''
);

create table sobre (
  chave text primary key,
  valor text not null default ''
);

-- ---------- comandas ----------

create table comandas (
  id         text primary key,
  cliente    text not null default '',
  status     text not null default 'aberta' check (status in ('aberta', 'pendurada', 'paga', 'excluida')),
  aberta     timestamptz,
  fechada    timestamptz,
  atualizado bigint not null,                -- relógio do celular (ms); versão mais velha não sobrescreve
  extra      jsonb not null default '{}',    -- campos da comanda que o banco não conhece (futuro)
  recebida_em   timestamptz not null default now(),
  modificada_em timestamptz not null default now()
);
create index comandas_status on comandas (status, fechada);

create table lancamentos (
  comanda_id  text not null references comandas (id) on delete cascade,
  id          text not null,
  ordem       integer not null,
  chave       text not null default '',
  nome        text not null,
  preco       numeric(10, 2) check (preco is null or (preco >= 0 and preco < 100000)),
  hora        timestamptz,
  extra       jsonb not null default '{}',
  removido_em timestamptz,
  primary key (comanda_id, id)
);

-- Pra conferir pelo painel do Supabase (Table editor): total e itens de cada comanda
create view comandas_resumo with (security_invoker = on) as
select
  c.id, c.cliente, c.status, c.aberta, c.fechada,
  coalesce(sum(l.preco) filter (where l.removido_em is null), 0) as total,
  count(l.id) filter (where l.removido_em is null) as qtd_itens,
  count(l.id) filter (where l.removido_em is not null) as qtd_tirados
from comandas c
left join lancamentos l on l.comanda_id = c.id
group by c.id;

-- ---------- quem pode ----------

create table admins (
  user_id uuid primary key references auth.users (id) on delete cascade
);

alter table cardapio    enable row level security;
alter table horarios    enable row level security;
alter table fotos       enable row level security;
alter table sobre       enable row level security;
alter table comandas    enable row level security;
alter table lancamentos enable row level security;
alter table admins      enable row level security;

create function eh_admin() returns boolean
language sql stable security definer set search_path = public
as $$ select exists (select 1 from admins where user_id = auth.uid()) $$;

-- Leitura direta (painel / relatórios) só pra admin; escrita só pelas funções
create policy admin_le on cardapio    for select to authenticated using (eh_admin());
create policy admin_le on horarios    for select to authenticated using (eh_admin());
create policy admin_le on fotos       for select to authenticated using (eh_admin());
create policy admin_le on sobre       for select to authenticated using (eh_admin());
create policy admin_le on comandas    for select to authenticated using (eh_admin());
create policy admin_le on lancamentos for select to authenticated using (eh_admin());

create function exigir_admin() returns void
language plpgsql stable security definer set search_path = public
as $$
begin
  if not eh_admin() then
    raise exception 'sessao' using errcode = '42501', hint = 'Sua sessão expirou. Entre de novo.';
  end if;
end $$;

-- ---------- utilidades ----------

-- "Cardápio " e "cardapio" são a mesma coisa (igual ao normalizar() do Apps Script)
create function normalizar(s text) returns text
language sql stable set search_path = public, extensions
as $$
  select btrim(regexp_replace(lower(unaccent(btrim(coalesce(s, '')))), '[^a-z0-9]+', '_', 'g'), '_')
$$;

-- "7,50" / "7.5" / "R$ 23" -> número; vazio -> null; lixo -> erro (nunca vira preço errado calado)
create function ler_preco(v text) returns numeric
language plpgsql immutable
as $$
declare
  s text := regexp_replace(coalesce(v, ''), '[^0-9,.]', '', 'g');
begin
  if btrim(coalesce(v, '')) = '' then return null; end if;
  if s = '' or s !~ '[0-9]' then
    raise exception 'Preço inválido: "%". Escreva só o número, ex.: 12 ou 7,50', v using errcode = '22023';
  end if;
  if position(',' in s) > 0 then s := replace(replace(s, '.', ''), ',', '.'); end if;
  if s !~ '^[0-9]+(\.[0-9]+)?$' then
    raise exception 'Preço inválido: "%". Escreva só o número, ex.: 12 ou 7,50', v using errcode = '22023';
  end if;
  return round(s::numeric, 2);
end $$;

-- 50.00 -> "50"; 7.50 -> "7,5" (o site e o admin já entendem os dois formatos)
create function preco_texto(p numeric) returns text
language sql immutable
as $$ select case when p is null then '' else replace(trim_scale(p)::text, '.', ',') end $$;

create function ms(t timestamptz) returns bigint
language sql immutable
as $$ select case when t is null then null else round(extract(epoch from t) * 1000)::bigint end $$;

create function de_ms(v jsonb) returns timestamptz
language sql immutable
as $$ select case when v is null or jsonb_typeof(v) <> 'number' then null else to_timestamp((v::text)::numeric / 1000) end $$;

create function linhas_cardapio() returns jsonb
language sql stable security definer set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'secao', secao, 'nome', nome, 'opcao', opcao, 'descricao', descricao,
    'preco', preco_texto(preco), 'em_falta', em_falta
  ) order by ordem, id), '[]'::jsonb)
  from cardapio
$$;

-- ---------- site público ----------

create function site() returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'cardapio', linhas_cardapio(),
    'horarios', (select coalesce(jsonb_agg(jsonb_build_object('dia', dia, 'horario', horario, 'obs', obs) order by ordem), '[]') from horarios),
    'fotos',    (select coalesce(jsonb_agg(jsonb_build_object('foto', foto, 'legenda', legenda) order by ordem), '[]') from fotos),
    'sobre',    (select coalesce(jsonb_object_agg(chave, valor), '{}') from sobre),
    'atualizado', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  )
$$;

-- ---------- admin: cardápio ----------

create function admin_listar() returns jsonb
language plpgsql security definer set search_path = public
as $$
begin
  perform exigir_admin();
  return linhas_cardapio();
end $$;

create function linhas_do_item(p_secao text, p_nome text) returns setof cardapio
language sql stable security definer set search_path = public
as $$
  select * from cardapio
  where normalizar(secao) = normalizar(p_secao) and normalizar(nome) = normalizar(p_nome)
  order by ordem, id
$$;

/**
 * Troca o item inteiro (todas as linhas dele) pelo que veio do admin. Mesmas
 * regras do Apps Script: item novo entra no fim da seção; seção nova entra
 * depois de `item.depoisDe` (ou no fim); editar sem trocar de seção mantém o lugar.
 */
create function admin_salvar_item(original jsonb, item jsonb) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_secao text := btrim(coalesce(item ->> 'secao', ''));
  v_nome  text := btrim(coalesce(item ->> 'nome', ''));
  v_desc  text := btrim(coalesce(item ->> 'descricao', ''));
  v_depois text := btrim(coalesce(item ->> 'depoisDe', ''));
  v_var jsonb;
  v_pos integer;
  v_n integer;
  v_antigas integer;
  v_mesma_secao boolean;
  i integer := 0;
  v jsonb;
begin
  perform exigir_admin();
  if v_nome = '' then raise exception 'O item precisa de um nome.' using errcode = '22023'; end if;
  if v_secao = '' then raise exception 'Escolha a seção.' using errcode = '22023'; end if;

  select coalesce(jsonb_agg(x), '[]') into v_var
  from jsonb_array_elements(coalesce(item -> 'variacoes', '[]')) x
  where btrim(coalesce(x ->> 'opcao', '')) <> '' or btrim(coalesce(x ->> 'preco', '')) <> '';
  if jsonb_array_length(v_var) = 0 then
    v_var := '[{"opcao":"","preco":"","em_falta":false}]';
  end if;
  v_n := jsonb_array_length(v_var);

  -- trava a tabela: duas edições ao mesmo tempo não embaralham a ordem
  lock table cardapio in share row exclusive mode;

  if original is null or original = 'null'::jsonb then
    if exists (select 1 from linhas_do_item(v_secao, v_nome)) then
      raise exception 'Já existe "%" nessa seção. Edite o que já existe.', v_nome using errcode = '22023';
    end if;
  else
    select count(*), min(ordem) into v_antigas, v_pos from linhas_do_item(original ->> 'secao', original ->> 'nome');
    if v_antigas = 0 then
      raise exception 'Esse item não está mais no cardápio. Atualize a página.' using errcode = '22023';
    end if;
    -- renomear pra um nome que já existe juntaria dois itens
    if not (normalizar(original ->> 'secao') = normalizar(v_secao) and normalizar(original ->> 'nome') = normalizar(v_nome))
       and exists (select 1 from linhas_do_item(v_secao, v_nome)) then
      raise exception 'Já existe "%" nessa seção.', v_nome using errcode = '22023';
    end if;
    delete from cardapio c using linhas_do_item(original ->> 'secao', original ->> 'nome') a where c.id = a.id;
  end if;

  v_mesma_secao := original is not null and original <> 'null'::jsonb and normalizar(original ->> 'secao') = normalizar(v_secao);
  if not v_mesma_secao then
    if not exists (select 1 from cardapio where normalizar(secao) = normalizar(v_secao)) and v_depois <> '' then
      select max(ordem) + 1 into v_pos from cardapio where normalizar(secao) = normalizar(v_depois);
    else
      select max(ordem) + 1 into v_pos from cardapio where normalizar(secao) = normalizar(v_secao);
    end if;
    if v_pos is null then select coalesce(max(ordem), 0) + 1 into v_pos from cardapio; end if;
  end if;

  update cardapio set ordem = ordem + v_n where ordem >= v_pos;

  for v in select * from jsonb_array_elements(v_var) loop
    insert into cardapio (ordem, secao, nome, opcao, descricao, preco, em_falta)
    values (
      v_pos + i, v_secao, v_nome, btrim(coalesce(v ->> 'opcao', '')),
      case when i = 0 then v_desc else '' end,
      ler_preco(v ->> 'preco'),
      coalesce((v ->> 'em_falta')::boolean, false)
    );
    i := i + 1;
  end loop;

  return linhas_cardapio();
end $$;

create function admin_excluir_item(original jsonb) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  n integer;
begin
  perform exigir_admin();
  delete from cardapio c using linhas_do_item(original ->> 'secao', original ->> 'nome') a where c.id = a.id;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'Esse item não está mais no cardápio. Atualize a página.' using errcode = '22023'; end if;
  return linhas_cardapio();
end $$;

create function admin_em_falta(secao text, nome text, opcao text, valor boolean) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  n integer;
begin
  perform exigir_admin();
  update cardapio c set em_falta = coalesce(valor, false), modificado_em = now()
  from linhas_do_item(admin_em_falta.secao, admin_em_falta.nome) a
  where c.id = a.id and normalizar(a.opcao) = normalizar(admin_em_falta.opcao);
  get diagnostics n = row_count;
  if n = 0 then raise exception 'Esse item não está mais no cardápio. Atualize a página.' using errcode = '22023'; end if;
  return linhas_cardapio();
end $$;

-- ---------- admin: comandas ----------

/**
 * Recebe as comandas que mudaram no celular. Versão mais velha que a do banco
 * não sobrescreve (mas conta como salva: o banco já tem coisa mais nova).
 * Lançamento que sumiu da comanda fica marcado como removido, não é apagado.
 */
create function salvar_comandas(lista jsonb) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  c jsonb;
  l jsonb;
  v_id text;
  v_atualizado bigint;
  v_atual bigint;
  v_ids text[];
  v_salvas text[] := '{}';
  i integer;
begin
  perform exigir_admin();
  for c in select * from jsonb_array_elements(coalesce(lista, '[]')) loop
    v_id := c ->> 'id';
    if v_id is null or v_id = '' then continue; end if;
    v_atualizado := coalesce((c ->> 'atualizado')::numeric::bigint, (extract(epoch from now()) * 1000)::bigint);

    select atualizado into v_atual from comandas where id = v_id for update;
    if v_atual is null or v_atual <= v_atualizado then
      insert into comandas (id, cliente, status, aberta, fechada, atualizado, extra)
      values (
        v_id, coalesce(c ->> 'cliente', ''), coalesce(c ->> 'status', 'aberta'),
        de_ms(c -> 'aberta'), de_ms(c -> 'fechada'), v_atualizado,
        c - array['id', 'cliente', 'status', 'aberta', 'fechada', 'atualizado', 'lancamentos', 'sincronizado']
      )
      on conflict (id) do update set
        cliente = excluded.cliente, status = excluded.status, aberta = excluded.aberta,
        fechada = excluded.fechada, atualizado = excluded.atualizado, extra = excluded.extra,
        modificada_em = now();

      v_ids := '{}';
      i := 0;
      for l in select * from jsonb_array_elements(coalesce(c -> 'lancamentos', '[]')) loop
        if coalesce(l ->> 'id', '') = '' then continue; end if;
        v_ids := v_ids || (l ->> 'id');
        insert into lancamentos (comanda_id, id, ordem, chave, nome, preco, hora, extra, removido_em)
        values (
          v_id, l ->> 'id', i, coalesce(l ->> 'chave', ''), coalesce(l ->> 'nome', ''),
          case when jsonb_typeof(l -> 'preco') = 'number' then round((l ->> 'preco')::numeric, 2) end,
          de_ms(l -> 'hora'),
          l - array['id', 'chave', 'nome', 'preco', 'hora'],
          null
        )
        on conflict (comanda_id, id) do update set
          ordem = excluded.ordem, chave = excluded.chave, nome = excluded.nome, preco = excluded.preco,
          hora = excluded.hora, extra = excluded.extra, removido_em = null;
        i := i + 1;
      end loop;

      update lancamentos set removido_em = now()
      where comanda_id = v_id and removido_em is null and not (id = any (v_ids));
    end if;
    v_salvas := v_salvas || v_id;
  end loop;
  return jsonb_build_object('ok', true, 'salvas', to_jsonb(v_salvas));
end $$;

/** Abertas e penduradas sempre; pagas/excluídas só dos últimos `dias`. Mesmo formato do celular. */
create function listar_comandas(dias integer) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_limite timestamptz := now() - make_interval(days => coalesce(dias, 40));
begin
  perform exigir_admin();
  return jsonb_build_object('ok', true, 'comandas', coalesce((
    select jsonb_agg(
      c.extra || jsonb_build_object(
        'id', c.id, 'cliente', c.cliente, 'status', c.status,
        'aberta', ms(c.aberta), 'fechada', ms(c.fechada), 'atualizado', c.atualizado,
        'lancamentos', coalesce((
          select jsonb_agg(l.extra || jsonb_build_object(
            'id', l.id, 'chave', l.chave, 'nome', l.nome, 'preco', l.preco, 'hora', ms(l.hora)
          ) order by l.ordem)
          from lancamentos l where l.comanda_id = c.id and l.removido_em is null
        ), '[]')
      )
    )
    from comandas c
    where not (c.status in ('paga', 'excluida') and c.fechada is not null and c.fechada < v_limite)
  ), '[]'));
end $$;

-- ---------- permissões das funções ----------
-- O Supabase libera toda função nova pra anon; aqui fecha tudo e abre só o necessário.

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function site() to anon, authenticated;
grant execute on function
  admin_listar(), admin_salvar_item(jsonb, jsonb), admin_excluir_item(jsonb),
  admin_em_falta(text, text, text, boolean), salvar_comandas(jsonb), listar_comandas(integer),
  eh_admin()
to authenticated;
