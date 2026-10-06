-- Pagamento em partes, desconto na conta e data da venda.
--
-- Comanda no celular ganha:
--   pagamentos: [{ id, valor, hora }]  cada dinheiro que entrou (pode ser parte)
--   desconto:   { tipo: "valor" | "pct", valor } ou null
--   vendaEm:    quando a conta saiu de "aberta" (paga ou pro fiado) = dia da venda
-- Saldo = total dos itens − desconto − pagamentos. Fiado com saldo > 0.
-- Pagamento que some da comanda (desfazer) fica marcado como removido, não é apagado.

alter table comandas
  add column venda_em timestamptz,
  add column desconto_tipo text check (desconto_tipo in ('valor', 'pct')),
  add column desconto_valor numeric(10, 2) check (desconto_valor is null or desconto_valor >= 0),
  add constraint desconto_pct_ate_100 check (desconto_tipo is distinct from 'pct' or desconto_valor <= 100);

create table pagamentos (
  comanda_id  text not null references comandas (id) on delete cascade,
  id          text not null,
  valor       numeric(10, 2) not null check (valor > 0 and valor < 1000000),
  hora        timestamptz not null,
  extra       jsonb not null default '{}',
  removido_em timestamptz,
  primary key (comanda_id, id)
);
create index pagamentos_hora on pagamentos (hora) where removido_em is null;
create index comandas_venda_em on comandas (venda_em);

alter table pagamentos enable row level security;
create policy admin_le on pagamentos for select to authenticated using (eh_admin());

-- Total com desconto, quanto já pagou e quanto falta, por comanda
drop view comandas_resumo;
create view comandas_resumo with (security_invoker = on) as
with itens as (
  select comanda_id,
    coalesce(sum(preco) filter (where removido_em is null), 0) as subtotal,
    count(*) filter (where removido_em is null) as qtd_itens,
    count(*) filter (where removido_em is not null) as qtd_tirados
  from lancamentos group by comanda_id
), pagos as (
  select comanda_id, sum(valor) as pago, count(*) as qtd_pagamentos
  from pagamentos where removido_em is null group by comanda_id
)
select
  c.id, c.cliente, c.status, c.aberta, c.venda_em, c.fechada,
  coalesce(i.subtotal, 0) as subtotal,
  case c.desconto_tipo
    when 'pct' then round(coalesce(i.subtotal, 0) * c.desconto_valor / 100, 2)
    when 'valor' then least(c.desconto_valor, coalesce(i.subtotal, 0))
    else 0
  end as desconto,
  coalesce(i.qtd_itens, 0) as qtd_itens,
  coalesce(i.qtd_tirados, 0) as qtd_tirados,
  coalesce(p.pago, 0) as pago,
  coalesce(p.qtd_pagamentos, 0) as qtd_pagamentos
from comandas c
left join itens i on i.comanda_id = c.id
left join pagos p on p.comanda_id = c.id;

-- O que o celular manda/recebe: uma comanda no formato do app (usado por listar_comandas e vendas_periodo)
create function comanda_json(c comandas) returns jsonb
language sql stable security definer set search_path = public
as $$
  select c.extra || jsonb_build_object(
    'id', c.id, 'cliente', c.cliente, 'status', c.status,
    'aberta', ms(c.aberta), 'fechada', ms(c.fechada), 'vendaEm', ms(c.venda_em), 'atualizado', c.atualizado,
    'desconto', case when c.desconto_tipo is null then null
                     else jsonb_build_object('tipo', c.desconto_tipo, 'valor', c.desconto_valor) end,
    'lancamentos', coalesce((
      select jsonb_agg(l.extra || jsonb_build_object(
        'id', l.id, 'chave', l.chave, 'nome', l.nome, 'preco', l.preco, 'hora', ms(l.hora)
      ) order by l.ordem)
      from lancamentos l where l.comanda_id = c.id and l.removido_em is null
    ), '[]'),
    'pagamentos', coalesce((
      select jsonb_agg(p.extra || jsonb_build_object('id', p.id, 'valor', p.valor, 'hora', ms(p.hora)) order by p.hora, p.id)
      from pagamentos p where p.comanda_id = c.id and p.removido_em is null
    ), '[]')
  )
$$;

create or replace function salvar_comandas(lista jsonb) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  c jsonb;
  l jsonb;
  p jsonb;
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
      insert into comandas (id, cliente, status, aberta, fechada, venda_em, desconto_tipo, desconto_valor, atualizado, extra)
      values (
        v_id, coalesce(c ->> 'cliente', ''), coalesce(c ->> 'status', 'aberta'),
        de_ms(c -> 'aberta'), de_ms(c -> 'fechada'), de_ms(c -> 'vendaEm'),
        case when jsonb_typeof(c -> 'desconto') = 'object' then c -> 'desconto' ->> 'tipo' end,
        case when jsonb_typeof(c -> 'desconto') = 'object' then round((c -> 'desconto' ->> 'valor')::numeric, 2) end,
        v_atualizado,
        c - array['id', 'cliente', 'status', 'aberta', 'fechada', 'vendaEm', 'desconto', 'atualizado',
                  'lancamentos', 'pagamentos', 'sincronizado', 'pendenteDesde']
      )
      on conflict (id) do update set
        cliente = excluded.cliente, status = excluded.status, aberta = excluded.aberta,
        fechada = excluded.fechada, venda_em = excluded.venda_em,
        desconto_tipo = excluded.desconto_tipo, desconto_valor = excluded.desconto_valor,
        atualizado = excluded.atualizado, extra = excluded.extra, modificada_em = now();

      -- itens
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

      -- pagamentos
      v_ids := '{}';
      for p in select * from jsonb_array_elements(coalesce(c -> 'pagamentos', '[]')) loop
        if coalesce(p ->> 'id', '') = '' then continue; end if;
        v_ids := v_ids || (p ->> 'id');
        insert into pagamentos (comanda_id, id, valor, hora, extra, removido_em)
        values (
          v_id, p ->> 'id', round((p ->> 'valor')::numeric, 2),
          coalesce(de_ms(p -> 'hora'), now()),
          p - array['id', 'valor', 'hora'],
          null
        )
        on conflict (comanda_id, id) do update set
          valor = excluded.valor, hora = excluded.hora, extra = excluded.extra, removido_em = null;
      end loop;
      update pagamentos set removido_em = now()
      where comanda_id = v_id and removido_em is null and not (id = any (v_ids));
    end if;
    v_salvas := v_salvas || v_id;
  end loop;
  return jsonb_build_object('ok', true, 'salvas', to_jsonb(v_salvas));
end $$;

create or replace function listar_comandas(dias integer) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_limite timestamptz := now() - make_interval(days => coalesce(dias, 40));
begin
  perform exigir_admin();
  return jsonb_build_object('ok', true, 'comandas', coalesce((
    select jsonb_agg(comanda_json(c))
    from comandas c
    where not (c.status in ('paga', 'excluida') and c.fechada is not null and c.fechada < v_limite)
  ), '[]'));
end $$;

/**
 * Comandas que importam pras Vendas de um período antigo (o celular só guarda
 * 45 dias de contas pagas): vendidas no período, ou com dinheiro entrando nele.
 * `de` e `ate` em ms, como o resto do app.
 */
create function vendas_periodo(de bigint, ate bigint) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_de timestamptz := to_timestamp(de / 1000.0);
  v_ate timestamptz := to_timestamp(ate / 1000.0);
begin
  perform exigir_admin();
  return jsonb_build_object('ok', true, 'comandas', coalesce((
    select jsonb_agg(comanda_json(c))
    from comandas c
    where c.status <> 'excluida' and (
      coalesce(c.venda_em, c.fechada) >= v_de and coalesce(c.venda_em, c.fechada) < v_ate
      or exists (select 1 from pagamentos p
                 where p.comanda_id = c.id and p.removido_em is null and p.hora >= v_de and p.hora < v_ate)
    )
  ), '[]'));
end $$;

revoke execute on function comanda_json(comandas), vendas_periodo(bigint, bigint) from public, anon, authenticated;
grant execute on function vendas_periodo(bigint, bigint) to authenticated;
