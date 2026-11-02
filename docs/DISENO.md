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
  trade.ts    Ofertas entre jugadores y mercado neutral.
  path.ts     Rutas por tierra para viajes largos.
  war.ts      Soldados, ejércitos, combate, muros, saqueo y conquista.
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
| `Building` | tipo, base, posición, progreso, nivel, mejora en curso |
| `Expedition` | dueño, destino, colonos, ruta, posición |
| `Offer` | quién ofrece, a quién, qué da, qué pide, respuestas |
| `ResourceNode` | árbol, roca, arbusto, orilla, hierro u oro; cantidad restante |
| `Site` | ubicación fundable, nombre, recursos alcanzables, estrellas, especialidad |

Los soldados no son entidades sueltas: viven como contadores en `Base.garrison` o en un `Army`, un grupo con posición, orden y ruta. Así el jugador nunca maneja unidades individuales, y 200 soldados no pesan más que unos pocos ejércitos. Las listas `RESOURCES`, `JOBS` y `BUILDINGS` están pensadas para extenderse sin tocar la lógica de turnos.

## 3. Producción y consumo

La simulación corre a 10 ticks por segundo con reloj fijo.

| Trabajo | Tiempo por unidad | Producción por trabajador |
|---|---|---|
| Madera | 8 s | 7,5 / min |
| Piedra | 10 s | 6 / min |
| Comida, recolección | 9 s | 6,7 / min |
| Comida, en granja | 6 s | 10 / min |
| Agua | 7 s | 8,6 / min |
| Hierro | 12 s | 5 / min |
| Oro | 16 s | 3,75 / min |

Cada persona consume 1,5 de comida y 1,5 de agua por minuto. Sale una regla simple: **un recolector alimenta a unas 4,4 personas, un granjero a 6,7 y un aguatero a 5,7.** Alrededor del 40 % de la población se dedica a sobrevivir y el resto hace crecer la civilización. Ahí está la decisión central del juego.

Producción neta mostrada = trabajadores con fuente × tasa × productividad − consumo. Se calcula por base y se suma.

El mapa pone el límite: árboles, rocas y arbustos son finitos, y las orillas y los pozos no se agotan. Las granjas tienen 3 puestos y producción infinita, pero cuestan madera y agua.

**Especialidad regional.** Cada región rinde 25 % más en lo suyo: bosque en madera, montaña en piedra y hierro, cantera en oro, pradera en comida, valle en comida y agua, llanura en construcción. Se suma a lo que ya marca la geografía, que es la mayor diferencia.

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
- `trade`: 30 s de comercio del mismo jugador. Puede proponer y usar el mercado, pero no cambiar órdenes. Termina antes con «Finalizar fase»; un bot sin ofertas abiertas pasa de inmediato.
- `over`: fin de partida.

Los demás jugadores solo pueden responder ofertas: es la única excepción a «no tocar nada fuera de tu turno», y `issue` la atiende antes de mirar de quién es el turno.

**Comercio.** Una oferta se valida al proponerla y otra vez al aceptarla, porque el stock puede haber cambiado. El intercambio descuenta de ambos lados antes de sumar, así que nunca crea ni deja recursos negativos. Las ofertas abiertas vencen al terminar la fase. Una contraoferta rechaza la original y crea otra en sentido inverso; los bots regatean una sola vez.

**Mercado neutral.** Precio de referencia: 1 los recursos básicos, 3 el hierro, 5 el oro. Paga el doble de ese valor por cada lote de 5, así que solo conviene si nadie quiere comerciar.

La economía corre en todos los turnos porque el tick no mira de quién es el turno. Solo `issue` lo mira.

**Fin de partida.** Tras 30 rondas gana quien tenga más puntos: 2 por ciudadano o soldado, 5 por edificio, 3 por mejora, 10 por base. Si tu población llega a cero, perdés. Si queda un solo jugador vivo, gana. Si queda una sola civilización, gana antes. Usando tus dos fases completas, una ronda dura cerca de 1 minuto y 30 segundos, y la partida puede acercarse a los 45 minutos; lo normal es terminar fases antes.

## 6. Costos y tiempos

| Construcción | Costo | Obra (1 constructor) | Efecto |
|---|---|---|---|
| Casa | 20 madera + 10 piedra | 20 s | +8 de capacidad en la base |
| Granja | 15 madera + 10 agua | 15 s | 3 puestos a 10 comida/min |
| Pozo | 20 piedra + 10 madera | 15 s | 3 puestos de agua en cualquier lugar |
| Depósito | 25 madera + 15 piedra | 20 s | +200 de capacidad global |

| Nueva base | 60 madera + 40 piedra + 20 comida | Viaje según distancia | Envía 3 ciudadanos a fundar |

Inicio: 60 madera, 30 piedra, 50 comida, 50 agua, sin hierro ni oro; capacidad 300 por recurso.

| Mejora | Costo | Obra (1 constructor) | Efecto |
|---|---|---|---|
| Casa reforzada | 20 madera + 10 hierro | 15 s | +4 de capacidad |
| Granja con riego | 15 madera + 8 hierro | 12 s | 15 comida/min por trabajador |
| Pozo profundo | 15 piedra + 8 hierro | 12 s | +2 puestos |
| Gran depósito | 20 piedra + 10 hierro + 5 oro | 15 s | +150 de capacidad global |

Un edificio se mejora una vez y sigue funcionando durante la obra.

**Expediciones.** Salen primero los ciudadanos sin trabajo, reservan el destino desde que parten y siguen contando como población mientras viajan. La ruta usa una búsqueda sobre la grilla del mapa: vadean ríos y rodean lagos. La interceptación llega con los soldados, en la Etapa 3.

El Pozo no estaba en la lista de la Etapa 1 y se adelantó: sin él, una base lejos del agua quedaría sin salida.

## 7. Guerra

**Tamaño del mundo.** El mapa pasó de 1000 a 1600 unidades de lado, con bosques más ralos y con claros. Las bases iniciales quedan a 280 unidades o más; las que se fundan después, a 200.

**Tiempo de reacción.** Es el objetivo central del diseño militar. Un soldado común avanza 5 unidades por segundo y uno pesado 3,8, así que el ataque más cercano tarda casi un minuto y uno cruzando el mapa más de tres. Al salir un ataque, el jugador atacado recibe un aviso; mientras se acerca ve una alerta fija con la cuenta regresiva, la ruta roja en el mapa y el ejército en el minimapa. Tocar la alerta lleva hasta él.

| Soldado | Costo | Entrenamiento | Vida | Ataque | Defensa | Velocidad |
|---|---|---|---|---|---|---|
| Común | 5 hierro + 10 comida | 15 s | 40 | 6 | 2 | 5 |
| Pesado | 12 hierro + 15 comida + 5 oro | 25 s | 90 | 11 | 6 | 3,8 |

Cada soldado sale de un ciudadano de la base, que deja de trabajar, y sigue contando como población. Un ejército con pesados camina a la velocidad de los pesados.

**Tregua.** Nadie puede atacar antes de la ronda 5.

**Combate.** Se resuelve una vez por segundo. Cada bando resta vida según la suma de sus ataques, reducida por la defensa media del rival, y caen primero los comunes. Dos ejércitos enemigos que se cruzan a menos de 26 unidades pelean hasta que queda uno. Un ejército también destruye las expediciones enemigas que alcanza.

**Asalto a una base.** El atacante sigue este orden: romper un tramo si el anillo de muros está completo, vencer a la guarnición, derribar las torres y por último saquear (12 s) o conquistar (30 s).

**Muros y torres.** Se ubican solos, como el resto de los edificios: es una decisión a favor de la regla de oro, aunque el prompt preveía ubicarlos a mano. El anillo tiene hasta 12 tramos y los que caen en agua no hacen falta. Si queda un hueco, el enemigo entra por ahí, por lo que solo el anillo completo frena el paso. Una torre tiene 300 de vida, alcanza 130 unidades y hace 14 de daño por segundo.

**Saqueo.** Roba hasta el 20 % de cada recurso, con un límite de 8 por soldado y 60 por recurso, y menos si la base tiene torres o muros.

**Conquista.** La base, sus edificios y sus ciudadanos pasan al ganador, y sus trabajos se reinician. Quien pierde todo y se queda sin soldados es eliminado.

**Postura.** Con postura defensiva la guarnición espera en la base. Con equilibrada sale a 170 unidades, y con agresiva a 300. Después de pelear vuelve sola.

**Órdenes.** Trasladar, conquistar, saquear, defender una posición, atacar un ejército y retirarse. Solo se cambian en la fase de decisiones propia. «Atacar torre» no es una orden aparte: las torres son parte del asalto.

## 8. Riesgos de equilibrio

- **Posición inicial.** Las regiones se reparten con una bolsa fija de biomas (5 bosques, 4 llanuras, 3 montañas, 2 praderas, 2 valles, 2 canteras), evitando repetir el bioma de las vecinas. Un jugador no debería poder quedarse con todo.
- **Draft bloqueado.** La distancia mínima podría dejar a alguien sin lugar. Con 200 unidades, quien elegía último en 4 jugadores tenía a veces un solo sitio malo; se bajó a 165. Si aun así no queda ninguno, esa regla se relaja. Una prueba recorre muchas semillas.
- **Base de 2 sin salida.** Dos ciudadanos no pueden trabajar y reproducirse a la vez: fundar 2 bases reparte fuerzas. Es una decisión intencional del prompt, pero conviene revisarla jugando.
- **Base con menos de 2.** No puede reproducirse y en la Etapa 1 no hay migración. Por eso las muertes por escasez salen de la base más poblada. La expedición de la Etapa 2 lo resuelve.
- **Agotamiento.** Sin regeneración hasta la Etapa 4, una base de pocos árboles se queda sin madera. Es parte de elegir bien; el comercio y las nuevas bases lo alivian más adelante.
- **Pelea tardía de los bots.** Empiezan a atacar alrededor de la ronda 15 a 20, porque priorizan crecer. Evita derrotas tempranas, pero conviene revisarlo jugando.
- **Saqueos repetidos.** Un bot puede volver varias veces sobre la misma base débil. El límite por ataque frena el daño.
- **Sin caminos construidos.** El camino pavimentado y el costo por terreno todavía no afectan la velocidad.
- **Comercio entre bots.** Hacen pocos tratos (0 a 3 por partida en las simulaciones): cada uno regatea con cuidado y sus stocks se parecen. Con una persona en la mesa, en la prueba real aceptaron ofertas razonables.
- **Expansión tardía.** Como las expediciones necesitan más de 3 ciudadanos en origen, hay que crecer antes de expandirse. Es intencional.
- **Bola de nieve.** La reproducción crece rápido si hay vivienda. Las casas exigen madera y piedra a la vez, lo que frena a quien solo tiene una.

## 9. Etapas

- **Etapa 1 (hecha):** mapa, draft, turnos, ciudadanos autónomos, trabajos, inventario global, casas, granjas, pozos, depósitos, reproducción, consumo, construcción automática, bots básicos y puntaje.
- **Etapa 2 (hecha):** hierro, oro, nuevas bases, comercio, mercado neutral, mejoras, especialidad regional y alertas.
- **Etapa 3 (hecha):** cuarteles, soldados, traslados, combate automático, muros, torres, saqueo, conquista, posturas y mapa más grande con minimapa.
- **Etapa 4:** mundo vivo.
- **Etapa 5:** online, tutorial, sonido, bots con tres dificultades.
