-- Trigger 1: atualiza quantidade quando quant_despacho é preenchido
CREATE OR REPLACE FUNCTION atualizar_quantidade_despacho()
RETURNS TRIGGER AS $$
BEGIN
  
    NEW.quantidade := NEW.quant_despacho;
    NEW.total_venda := NEW.quantidade * NEW.preco_unit;
    NEW.total_custo := NEW.quantidade * NEW.custo_unit;
    NEW.lucro := NEW.total_venda - NEW.total_custo;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trigger_despacho_oficial
BEFORE UPDATE ON itens_pedidos_vendas
FOR EACH ROW
EXECUTE FUNCTION atualizar_quantidade_despacho();

-- Trigger 2: atualiza totais do pedido quando qualquer item muda
CREATE OR REPLACE FUNCTION atualizar_totais_pedido()
RETURNS TRIGGER AS $$
DECLARE
  v_total_venda numeric;
  v_total_custo numeric;
  v_total_lucro numeric;
  v_margem_pct numeric;
BEGIN
  SELECT
    FLOOR(COALESCE(SUM(total_venda), 0)),
    COALESCE(SUM(total_custo), 0),
    COALESCE(SUM(total_venda), 0) - COALESCE(SUM(total_custo), 0)
  INTO v_total_venda, v_total_custo, v_total_lucro
  FROM itens_pedidos_vendas
  WHERE pedido_venda_id = NEW.pedido_venda_id;

  v_margem_pct := CASE WHEN v_total_venda > 0
    THEN (v_total_lucro / v_total_venda) * 100
    ELSE 0 END;

  UPDATE pedidos_vendas SET
    total_venda = v_total_venda,
    total_custo = v_total_custo,
    total_lucro = v_total_lucro,
    margem_pct = v_margem_pct,
    em_aberto = v_total_venda,
    status = 0
  WHERE id = NEW.pedido_venda_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trigger_totais_pedido
AFTER UPDATE OR INSERT ON itens_pedidos_vendas
FOR EACH ROW
EXECUTE FUNCTION atualizar_totais_pedido();
