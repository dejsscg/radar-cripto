# Radar Cripto

Dashboard cripto: escáner de whales multi-chain (ETH/BSC/BTC/SOL), tokens alpha recién lanzados y tendencias.

## Estructura
- `src/App.jsx` — TODA la app (componentes, estilos, lógica de escaneo). Editar aquí.
- `src/main.jsx` — entry point, no tocar.
- `deploy-template/index.html` — shell HTML.
- `deploy/` — salida compilada lista para Vercel (se regenera con `npm run build`).

## APIs usadas (gratuitas, sin keys, todas con fetchRetry de 3 intentos)
- CoinGecko: tendencias, mercados, detalle de proyectos (límite ~10-30 req/min)
- GeckoTerminal: pools nuevos (alpha) e info de tokens
- publicnode RPC: ethereum-rpc.publicnode.com y bsc-rpc.publicnode.com (bloques, logs Transfer, balances)
- api.mainnet-beta.solana.com: getTokenLargestAccounts, getLargestAccounts, balances
- blockchain.info: bloques y balances BTC (usar siempre ?cors=true)

## Comandos
- `npm run build` — compila a deploy/
- `npm run dev` — servidor local con recarga en http://localhost:8000
- Deploy: `cd deploy && vercel --prod`

## Convenciones
- Persistencia: localStorage, key "radar-wallets"
- Estilos inline con la paleta C (tema sonar oceánico), fuentes Space Grotesk + IBM Plex Mono
- Todo en español
