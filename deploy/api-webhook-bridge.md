# Ponte HTTP para o webhook Evolution Go

`api-webhook-bridge.py` roda **no manager Swarm**, com Python 3.11 e Docker CLI.
É uma alternativa operacional à edição da stack no Portainer descrita em
`portainer-whatsapp-webhook-bridge.md`: use somente um dos dois caminhos.
O helper não atualiza `vimob-crm_api`, não publica porta e cria uma service
separada inicialmente com `traefik.enable=false`.

## Escopo e segurança

- Copia o ambiente efetivo de `vimob-crm_api` dentro do processo, por
  `docker service inspect`, sem exibir valores. Substitui
  `API_BACKGROUND_WORKERS_ENABLED=false` e
  `API_WHATSAPP_CALL_RECORDING_ONLY_WORKER_ENABLED=false`.
- Transfere o ambiente ao `docker service create --env-file` por um **memfd**
  Linux herdado pelo Docker CLI. Não grava arquivo de credenciais e não coloca
  valores secretos na linha de comando. O Docker Swarm ainda armazena o ambiente
  na especificação da nova service, acessível aos administradores do Swarm.
- Exige fonte conhecida, imagem GHCR fixada por SHA de commit e digest,
  redes overlay `vimob` e `public`, modo webhook `native`, fonte com uma réplica
  saudável e Traefik em Swarm com exposição automática desativada. Se a fonte
  passar a usar mounts/secrets/configs ou seu ambiente contiver quebras de
  linha, o helper interrompe antes de criar a ponte.
- A ponte recebe apenas HTTP; o serviço API antigo continua dono de todos os
  workers. Enquanto ele permanece ativo, a ponte pode persistir webhooks e o
  worker antigo drena a fila. **Isto não autoriza parar nem atualizar a API
  antiga em modo stop-first**: nesse intervalo o processamento das filas pode
  pausar apesar de o webhook continuar recebendo ACK.

## Operação proposta

Execute os comandos no manager. Os exemplos usam um arquivo de script copiado
para `/root/api-webhook-bridge.py`; esse arquivo contém só código, nunca
credenciais. Substitua `IMAGE` por uma imagem candidata publicada com tag de
40 caracteres hexadecimais e digest SHA256. Confira a migração de chamadas e
o build da candidata antes da criação.

```sh
IMAGE='ghcr.io/iurytralha157-lab/vimob-crm-api:<40-char-commit>@sha256:<64-char-digest>'
python3 /root/api-webhook-bridge.py plan --image "$IMAGE"
python3 /root/api-webhook-bridge.py create --image "$IMAGE" --dry-run
```

O `plan` e o `create --dry-run` fazem somente leituras. O padrão é uma réplica;
`--replicas 2` é aceito somente após conferir memória e conexões do Postgres.
A service usa limite de 768 MiB e reserva de 128 MiB por réplica. Na criação:

```sh
python3 /root/api-webhook-bridge.py create --image "$IMAGE"
python3 /root/api-webhook-bridge.py status
```

`status` deve mostrar todas as tasks saudáveis, `/readyz` com o SHA da imagem
e `route_enabled=False`. O comando `enable` verifica novamente a API original,
as tasks da ponte, o ambiente copiado, as duas redes e a versão de `/readyz`.
Depois adiciona somente labels à service da ponte:

```sh
python3 /root/api-webhook-bridge.py enable
python3 /root/api-webhook-bridge.py status
```

A rota ativada é somente
`Host(api.vimobcrm.com.br) && Path(/v1/whatsapp/webhook/evolution-go)`, em
`websecure`, com prioridade 1000. O helper compara o `TaskTemplate` e os IDs
das tasks antes e depois da alteração de labels; se detectar troca de tasks,
desliga a rota e retorna erro. O serviço `vimob-crm_api` não recebe nenhum
`docker service update`.

Para reverter o encaminhamento imediatamente, mesmo se a ponte estiver sem
saúde:

```sh
python3 /root/api-webhook-bridge.py disable
python3 /root/api-webhook-bridge.py status
```

`disable` altera apenas `traefik.enable=false` na ponte. Confirme no Traefik
que a rota específica saiu e que o roteador original continua servindo o host.

## Acompanhamento no corte

Compare antes e depois: tasks/health do API original, da ponte e do Evolution
Go; ACK e latência do webhook; ingressos na `whatsapp_webhook_inbox`; tamanho e
idade das filas de webhook/outbox; mensagens recebidas e enviadas em um número
de teste; status do supervisor de sessões; conexões `pg_stat_activity` e uso de
memória. Interrompa o corte e use `disable` se houver aumento de erros, atraso
de mensagens ou qualquer alteração nas tasks da API original.

O helper não pareia números, não aplica migrações e não ativa rotas de chamadas
ou gravação. A migração da API principal exige um plano próprio que mantenha um
worker ativo durante todo o corte.
