# Assistente de Futebol de Botão — Web App v2

Aplicação web estática (HTML/CSS/JS puro) baseada no modelo de ângulo × altura × distância.

## Funcionalidades

1. Avaliação rápida
   - ângulo, altura e tipo de chute (opcional)
   - score por zona, destacado no campo real

2. Perfil do jogador
   - chute preferido: Reto ou Arqueado
   - zonas habituais

3. Meus botões reais
   - nome/número, ângulo, altura
   - **tipo de chute** do botão (Reto, Arqueado ou automático)
   - **melhor zona de chute**, calculada e exibida para cada botão
   - edição e exclusão

4. Comparador de botões
   - score por zona, trajetória e perda em relação à melhor zona

5. Mapa de utilização
   - heatmap nas zonas 20–25, 25–30 e 30–35 cm

6. Configurador de chute
   - zona + tipo de chute → melhores combinações de ângulo × altura

7. Melhor botão real por zona

8. Registro de testes reais
   - distância, tipo executado, resultado, tentativas e acertos
   - filtros e exportação CSV

9. Score real de eficiência
   - score teórico médio × eficiência observada (diferença em p.p.)

10. Backup
   - exportar/importar dados em JSON

## Como executar

Não é necessário instalar dependências. Abra `index.html` em um navegador moderno ou sirva localmente:

```bash
python -m http.server 8000
```

Depois acesse http://localhost:8000

## Persistência

Dados do jogador, botões e testes ficam no `localStorage` do navegador. Dados salvos na v1 são migrados automaticamente para o novo formato.

## Modelo (v2)

- Ângulo: 17° a 28° · Altura: 3,7 a 4,8 mm
- O IE descreve só o botão (a distância entra apenas no alvo):
  - IE = (0,50·A + 0,30·H) / 0,80, com A e H normalizados entre 0 e 1
- Trajetória: Rasteiro (IE < 0,36) · Reto (0,36 ≤ IE < 0,58) · Arqueado (IE ≥ 0,58)
- Alerta de excesso: IE ≥ 0,82
- IE-alvo por distância e tipo de chute:
  - IE-alvo(d) = base[chute] + 0,012 × (27,5 − d)
  - base Reto = 0,50 · base Arqueado = 0,68
- Score = 100 × (1 − |IE − IE-alvo| / 0,35), limitado a 0–100

### Melhor zona de chute do botão

Para cada botão, o score é calculado nas três zonas usando o tipo de chute registrado. Se o tipo não for informado, assume-se o chute natural da trajetória (Arqueado se IE ≥ 0,58; senão Reto). A zona com maior score é a melhor zona.

## Campo real interativo

A aplicação usa `campo_zonas.png`. As zonas são destacadas dinamicamente:

- azul → laranja: 20–25 cm
- laranja → amarela: 25–30 cm
- amarela → vermelha: 30–35 cm

As posições das zonas estão em `MODEL.field` / `MODEL.zones` (em % da imagem) e podem ser recalibradas se a imagem for trocada.

## Observação

O modelo é heurístico e deve ser confrontado com testes físicos reais.
