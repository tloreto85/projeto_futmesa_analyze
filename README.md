# Assistente de Futebol de Botão — Web App v1

Aplicação web estática baseada no modelo atual de ângulo × altura × distância.

## Funcionalidades incluídas

1. Perfil do jogador
   - chute preferido: Reto ou Arqueado
   - zonas habituais

2. Cadastro de botões reais
   - nome/número
   - ângulo
   - altura

3. Comparador de botões
   - score por zona
   - trajetória
   - perda de eficiência em relação à melhor zona

4. Mapa de utilização
   - heatmap visual nas zonas 20–25, 25–30 e 30–35 cm

5. Configurador de chute
   - zona + tipo de chute
   - retorna melhores combinações de ângulo × altura

6. Melhor botão real por zona

7. Registro de testes reais
   - distância
   - tipo executado
   - resultado
   - tentativas
   - acertos

8. Score real de eficiência
   - score teórico médio
   - eficiência observada
   - diferença em pontos percentuais

## Como executar

Não é necessário instalar dependências.

Abra `index.html` em um navegador moderno.

Para servir localmente:

```bash
python -m http.server 8000
```

Depois acesse:

http://localhost:8000

## Persistência

Os dados do jogador, botões e testes são salvos no `localStorage` do navegador.

## Modelo atual

- Ângulo: 17° a 28°
- Altura: 3,7 a 4,8 mm
- IE = 0,50*A + 0,30*H + 0,20*D
- Rasteiro: IE < 0,36
- Reto: 0,36 ≤ IE < 0,58
- Arqueado: IE ≥ 0,58
- Alerta de excesso: IE ≥ 0,82

Zonas:
- 30–35 cm → IE-alvo 0,44
- 25–30 cm → IE-alvo 0,50
- 20–25 cm → IE-alvo 0,56

## Observação

O modelo é heurístico e deve ser confrontado com testes físicos reais.


## Campo real interativo

A aplicação incorpora `campo_zonas.png`, usando a imagem atual do campo.

As zonas são destacadas dinamicamente:
- azul → laranja: 20–25 cm
- laranja → amarela: 25–30 cm
- amarela → vermelha: 30–35 cm

O destaque acompanha a avaliação rápida, perfil do jogador, seleção de zona, configurador, registro de testes e mapa de utilização. No mapa de utilização, cada zona recebe uma intensidade correspondente ao score do botão.
