# Vera — atajos de la línea de comandos.
#
# Todo lo que hay aquí se puede hacer con npm; esto es para no tener que
# recordar en qué orden. La única regla con algo propio es `deploy`, y lo propio
# es que termina comprobando que el servidor sirve lo que se acaba de compilar.

.PHONY: deploy dev serve start stop restart status build check test spec

# Publica: comprueba, compila, commitea, empuja y verifica.
#   make deploy m="qué cambió y por qué"
deploy:
	@./scripts/deploy.sh "$(m)"

# Servidor y recompilación automática del cliente, juntos.
dev:
	@npm run dev

# El servidor en primer plano, para desarrollar con él delante.
serve:
	@npm run serve

# Y el mismo servidor como algo con lo que se convive: arranca en segundo plano,
# espera a que conteste de verdad y deja su registro en `.vera-server.log`.
#
# `restart` hace falta más de lo que parece: el cliente se recompila y el
# servidor lo relee solo, pero el dominio —@vera/core, @vera/store— se carga al
# arrancar. Un cambio en las reglas no llega a la instancia hasta que el proceso
# vuelve a nacer, y no avisa: la aplicación sigue respondiendo con las viejas.
start:
	@./scripts/serve.sh start

stop:
	@./scripts/serve.sh stop

restart:
	@./scripts/serve.sh restart

status:
	@./scripts/serve.sh status

build:
	@npm run build

# Todo lo que tiene que estar bien antes de publicar, sin publicar nada.
check: test spec
	@npm run typecheck

test:
	@npm test

spec:
	@npm run spec
