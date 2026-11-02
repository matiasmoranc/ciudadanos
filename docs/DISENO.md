# Ciudadanos — diseño técnico

Regla de oro: **el jugador toma decisiones sobre su civilización, y la civilización ejecuta esas decisiones automáticamente.**

Este documento cubre los ocho puntos pedidos antes de programar. Los números viven en `src/core/config.ts`; acá se explica el porqué.

## 1. Arquitectura

```
src/core/     Simulación pura: sin Phaser, sin DOM, sin Math.random ni Date.
  config.ts   Costos, tiempos y tasas.
  types.ts    Estructuras de datos.
  mapgen.ts   Mapa procedural a partir de una semilla.
  game.ts     Estado, comandos validados y tick.
  bot.ts      IA. Solo usa los mismos comandos que un humano.
  match.ts    Une tick + bots: es lo que correría un servidor.
src/render/   Phaser: dibuja el estado, nunca lo modifica.
src/ui/       HTML/CSS: lee el estado y emite comandos.
tests/        Pruebas del núcleo sin navegador.
```

**La vista nunca toca el estado.** Todo cambio pasa por `issue(state, jugador, comando)`, que valida y devuelve `{ ok, error }`. Por eso un cliente no puede hacer trampa con una orden imposible, y por eso los bots no tienen ventajas.

### GitHub Pages y el backend autoritativo

GitHub Pages sirve archivos estáticos: no puede ejecutar un servidor. En esta etapa el navegador hace de servidor local, cosa que alcanza porque se juega contra bots. Para la Etapa 5 hay que alojar `src/core` en un proceso aparte (Cloud Run, Fly, etc.), que reciba comandos por WebSocket y difunda el estado. Pages puede seguir sirviendo el cliente.

Como el núcleo es determinista (misma semilla y mismos comandos dan la misma partida) y no depende del navegador, no hace falta reescribirlo: cambia quién llama a `stepMatch` y por dónde llegan los comandos. Firebase queda para cuentas, invitaciones y guardado, sin escribir el movimiento de cada ciudadano.

## 2. Estructuras de datos

Definidas en `src/core/types.ts`.

| Entidad | Datos clave |
|---|---|
| `GameState` | tick, ronda, fase, jugadores, bases, ciudadanos, edificios, nodos, eventos, estado del RNG |
| `Player` | color, bot o humano, **inventario global**, reloj de escasez |
| `Base` | dueño, sitio, trabajos pedidos, trabajos efectivos, supervivencia automática, progreso de reproducción |
| `Citizen` | base, trabajo, estado (`idle`/`walk`/`work`), objetivo, posición |
| `Building` | tipo, base, posición, progreso |
| `ResourceNode` | árbol, roca, arbusto u orilla; cantidad restante |
| `Site` | ubicación fundable, nombre, recursos alcanzables, estrellas |

Soldados, hierro, oro y comercio se agregan en sus etapas. Las listas `RESOURCES`, `JOBS` y `BUILDINGS` están pensadas para extenderse sin tocar la lógica de turnos.

## 3. Producción y consumo

La simulación corre a 10 ticks por segundo con reloj fijo.

| Trabajo | Tiempo por unidad | Producción por trabajador |
|---|---|---|
| Madera | 8 s | 7,5 / min |
| Piedra | 10 s | 6 / min |
| Comida, recolección | 9 s | 6,7 / min |
| Comida, en granja | 6 s | 10 / min |
| Agua | 7 s | 8,6 / min |

Cada persona consume 1,5 de comida y 1,5 de agua por minuto. Sale una regla simple: **un recolector alimenta a unas 4,4 personas, un granjero a 6,7 y un aguatero a 5,7.** Alrededor del 40 % de la población se dedica a sobrevivir y el resto hace crecer la civilización. Ahí está la decisión central del juego.

Producción neta mostrada = trabajadores con fuente × tasa × productividad − consumo. Se calcula por base y se suma.

El mapa pone el límite: árboles, rocas y arbustos son finitos, y las orillas y los pozos no se agotan. Las granjas tienen 3 puestos y producción infinita, pero cuestan madera y agua.

**Escasez.** Con un recurso vital en cero, la productividad baja al 60 % y se frena la reproducción. Tras 60 s de gracia muere un ciudadano cada 12 s, siempre de la base más poblada. Antes de llegar a cero aparece el aviso «Tu comida se agotará en N segundos» si faltan menos de 90 s.

**Reproducción.** Cada pareja asignada tarda 30 s y gasta 3 de comida y 1 de agua. Con 6 y 3 no cerraba la cuenta: con 8 personas, sobrevivir y sostener una pareja requería 9 trabajadores. Necesita vivienda libre. Capacidad de una base = 4 + 8 por casa. Límite: 200 por jugador.

## 4. Órdenes automáticas

Cada segundo, cada base concilia lo pedido con lo que pasa:

1. `jobs` es lo que pidió el jugador. `effective` es lo que se aplica, y solo difiere si actúa la supervivencia automática.
2. Los ciudadanos sobrantes de un trabajo pasan a `idle`; los libres toman los trabajos con vacantes.
3. Cada ciudadano sin objetivo busca la fuente libre más cercana entre los nodos alcanzables desde su base, camina y trabaja. Si se agota, busca otra.
4. Si no hay fuente queda inactivo y aparece un aviso («No quedan árboles disponibles cerca de la Base del Río.»).

**Alcance y agua.** Un nodo es alcanzable si la línea recta desde el centro de la base no cruza agua. Si un tramo entre dos nodos la cruzaría, el ciudadano pasa primero por el centro, que siempre tiene camino. Es barato y evita caminar sobre lagos sin un pathfinding completo.

**Supervivencia automática.** Se activa por base con el stock por debajo de 25 y se apaga por encima de 40. Mueve hasta un 30 % de los trabajadores hacia el recurso en crisis, solo si la base tiene fuente de ese recurso. Las órdenes originales se conservan.

**Construcción.** Al ordenar se descuentan los materiales, se busca un lugar en espiral alrededor de la base y los constructores avanzan la obra. Varios constructores suman velocidad. Si no hay constructores, se avisa.

## 5. Turnos

Hay un reloj central en ticks. En la Etapa 1 las fases son:

- `draft`: selección serpiente (1-2-3-4, 4-3-2-1), 30 s por elección. Si vence, se elige automáticamente. La simulación todavía no corre.
- `decisions`: 30 s del jugador activo. **Es la única fase que acepta órdenes.** Se puede terminar antes.
- `over`: fin de partida.

La fase de Comercio es de la Etapa 2. No se muestra un temporizador vacío: se suma cuando el comercio exista de verdad.

La economía corre en todos los turnos porque el tick no mira de quién es el turno. Solo `issue` lo mira.

**Fin de partida.** Tras 24 rondas gana quien tenga más puntos: 2 por ciudadano, 5 por edificio, 10 por base. Si tu población llega a cero, perdés. Si queda un solo jugador vivo, gana. Con bots tardando 4 a 8 s, una ronda dura alrededor de 50 s si usás tu tiempo y la partida unos 20 minutos.

## 6. Costos y tiempos

| Construcción | Costo | Obra (1 constructor) | Efecto |
|---|---|---|---|
| Casa | 20 madera + 10 piedra | 20 s | +8 de capacidad en la base |
| Granja | 15 madera + 10 agua | 15 s | 3 puestos a 10 comida/min |
| Pozo | 20 piedra + 10 madera | 15 s | 3 puestos de agua en cualquier lugar |
| Depósito | 25 madera + 15 piedra | 20 s | +200 de capacidad global |

Inicio: 60 madera, 30 piedra, 50 comida, 50 agua; capacidad 300 por recurso.

El Pozo no estaba en la lista de la Etapa 1 y se adelantó: sin él, una base lejos del agua quedaría sin salida.

## 7. Riesgos de equilibrio

- **Posición inicial.** Las regiones se reparten con una bolsa fija de biomas (5 bosques, 4 llanuras, 3 montañas, 2 praderas, 2 valles, 2 canteras), evitando repetir el bioma de las vecinas. Un jugador no debería poder quedarse con todo.
- **Draft bloqueado.** La distancia mínima podría dejar a alguien sin lugar. Con 200 unidades, quien elegía último en 4 jugadores tenía a veces un solo sitio malo; se bajó a 165. Si aun así no queda ninguno, esa regla se relaja. Una prueba recorre muchas semillas.
- **Base de 2 sin salida.** Dos ciudadanos no pueden trabajar y reproducirse a la vez: fundar 2 bases reparte fuerzas. Es una decisión intencional del prompt, pero conviene revisarla jugando.
- **Base con menos de 2.** No puede reproducirse y en la Etapa 1 no hay migración. Por eso las muertes por escasez salen de la base más poblada. La expedición de la Etapa 2 lo resuelve.
- **Agotamiento.** Sin regeneración hasta la Etapa 4, una base de pocos árboles se queda sin madera. Es parte de elegir bien; el comercio y las nuevas bases lo alivian más adelante.
- **Bola de nieve.** La reproducción crece rápido si hay vivienda. Las casas exigen madera y piedra a la vez, lo que frena a quien solo tiene una.

## 8. Etapas

- **Etapa 1 (esta):** mapa, draft, turnos, ciudadanos autónomos, trabajos, inventario global, casas, granjas, pozos, depósitos, reproducción, consumo, construcción automática, bots básicos y puntaje.
- **Etapa 2:** hierro, oro, nuevas bases, comercio, mercado.
- **Etapa 3:** soldados, combate, defensas, saqueo.
- **Etapa 4:** mundo vivo.
- **Etapa 5:** online, tutorial, sonido, bots con tres dificultades.
