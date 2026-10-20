-- Uma comanda com dado inválido não pode travar o envio das outras: cada
-- uma é salva no seu próprio bloco. A que falhar volta em "erros" e continua
-- pendente no celular (aparece a faixa vermelha), as outras são salvas.

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
  v_erros jsonb := '[]';
  i integer;
begin
  perform exigir_admin();
  for c in select * from jsonb_array_elements(coalesce(lista, '[]')) loop
    v_id := c ->> 'id';
    if v_id is null or v_id = '' then continue; end if;
    v_atualizado := coalesce((c ->> 'atualizado')::numeric::bigint, (extract(epoch from now()) * 1000)::bigint);

    begin
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
    exception when others then
      -- fica fora de "salvas": continua pendente no celular, e o resto do lote segue
      v_erros := v_erros || jsonb_build_object('id', v_id, 'erro', sqlerrm);
    end;
  end loop;
  return jsonb_build_object('ok', true, 'salvas', to_jsonb(v_salvas), 'erros', v_erros);
end $$;
