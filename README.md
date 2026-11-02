# Ciudadanos

Juego de estrategia por turnos: fundás bases en un mundo natural, repartís a tus ciudadanos y ellos hacen el resto solos.

**Jugar:** https://matiasmoranc.github.io/ciudadanos/

## Estado

Etapas 1 y 2 de 5, jugable contra 1 a 3 bots. Incluye mapa procedural, selección serpiente, turnos con fases de decisiones y comercio, ciudadanos autónomos, seis recursos, inventario global, construcción, mejoras, nuevas bases por expedición, comercio con contraofertas, mercado neutral, especialidad regional, reproducción, escasez y alertas.

Todavía no hay soldados, ecosistema dinámico ni partidas online. El plan por etapas y las reglas están en [docs/DISENO.md](docs/DISENO.md).

## Desarrollo

```bash
npm install
```

```bash
npm run dev
```

```bash
npm test
```

Cada push a `main` corre las pruebas, compila y publica en la rama `gh-pages`.

Parámetros de URL para probar: `?seed=42` fija el mapa, `?speed=4` acelera la simulación y `?debug=1` expone el estado en `window.ciudadanos`.

## Estructura

- `src/core`: simulación pura, sin navegador. Es lo que correrá en un servidor en la Etapa 5.
- `src/render`: mapa, personajes y animaciones con Phaser.
- `src/ui`: interfaz en HTML y CSS.
- `tests`: pruebas de reglas y partidas completas entre bots.
