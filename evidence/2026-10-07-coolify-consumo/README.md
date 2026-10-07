# DeskcommCRM single-server atrás do Coolify, numa VPS HostGator: medição de 06–07/10/2026

**Tipo: HISTÓRICA** (ver `evidence/README.md`). A VPS de teste será destruída: nada aqui
pode ser regenerado. Uma medição nova vira pasta nova; esta não se sobrescreve.

Esta pasta é a fonte dos números e das afirmações de `docs/saas/coolify.md`. O IP e o
hostname da VPS foram trocados por `<ip-da-vps>` e `<host-da-vps>` em todos os arquivos;
o domínio de teste é `<ip-da-vps>.sslip.io`.

## 1. Contra o quê

| Peça | Versão / identidade | Arquivo |
|---|---|---|
| Datas (UTC) | Coolify: 2026-10-06 20:26–21:03Z; CRM + banco: 2026-10-07 13:58–17:49Z; esta pasta: 2026-10-07 ~18:00Z | ledger do PR 4 |
| Instalador ATUAL (a falha da C2) | `main@8f220470b31f3c5ce02a1494361fa244f16061d1` | `16-c-kit-sha.txt`, `17-c-como-esta.txt` |
| Kit com o conserto, rodada 1 (D4) | `docs/saas-guia-coolify@456c052599f806ee76d84ebca69dc25fb9e22dc7` sobre `main@8f220470b` — **sem** o conserto da saída do `setup.sh` | `20-r1-kit-sha.txt` |
| Kit com o conserto, rodada 2 (G3), G5 e U1 Passo 3 | `docs/saas-guia-coolify@44c5df54161a6e0c527c9fdfbaaf570ec24be9c3` (o anterior + a saída do `setup.sh` em `.runtime/supabase-setup.log`, 600) | `24-r2-kit-sha.txt`, `43-g5-kit-sha.txt` |
| Depois da medição | a branch recebeu a `main` `ce5b87a3c` (merge `2c7fc2426`); a `main` não tocou nenhum arquivo do kit do PR desde `8f220470b`; testes de shell refeitos sobre o merge | `50-h1-testes-shell.txt` |
| Imagens do CRM | tag `1.76.0` (release `v1.76.0`, `^{commit}` = `3101682cdc9d1448304f6c613349281b2db6857d`, conferido no rótulo `revision` das três); digest `deskcommcrm` `sha256:52e1a5d3381e…`, `deskcomm-worker` `sha256:73dfbcaedbbd…`, `deskcomm-scheduler` `sha256:3596737e0371…` | `versoes-antes.txt`, `20-r1-versoes.txt` |
| Supabase self-hosted | ref `self-hosted/v0.8.1` (tag `690080884040…` → commit `8c7a4d9dbbaf…`); `setup.sh` sha256 `848973911bd5fa03…bc813c`, igual ao do GitHub nessa tag | `51-h3-supabase-ref.txt` |
| As 11 imagens do Supabase | `supabase/postgres:17.6.1.136` `f371b5f3f2ac…`, `supabase/gotrue:v2.196.0` `c0c25187a6b8…`, `postgrest/postgrest:v14.17` `c9dc201e555f…`, `supabase/realtime:v2.134.10` `cbcc6a7986fc…`, `supabase/storage-api:v1.74.0` `f1546fac6d1c…`, `darthsim/imgproxy:v3.31.4` `73c5dda13199…`, `supabase/postgres-meta:v0.99.0` `9a079ac1c94d…`, `supabase/edge-runtime:v1.76.2` `edd22bef4477…`, `supabase/studio:2026.09.07-sha-7996410` `94a2a9d2906e…`, `supabase/supavisor:2.9.12` `464b93a60ba8…`, `envoyproxy/envoy:v1.39.1` `57e14a549d7b…` (todos `sha256:`) | `versoes-antes.txt` |
| WAHA | `devlikeapro/waha:latest-2026.7.2` `sha256:65e593e30bb7…` | `versoes-antes.txt` |
| Coolify | `coollabsio/coolify:4.3.23` (de `docker.io`, não `ghcr.io`) `sha256:79d5c0443696…`; helper `1.0.17` `sha256:c7a7748b233d…`; realtime `1.0.19` `sha256:087c9d263ab0…` (o `versions.json` do CDN dizia 1.0.18); `postgres:15-alpine` `f7d23353e1b1…`; `redis:7-alpine` `858f009f9709…`; instalador `install.sh` sha256 `8ef02dce49339208…e314e0f2cd`, rodado com `AUTOUPDATE=false` | `10-coolify-versao.txt` |
| Proxy do Coolify | `traefik:v3.6` `sha256:31267173a15b…`, rede `coolify` (bridge, attachable) | `12-proxy.txt`, `versoes-antes.txt` |
| `coolify-sentinel` | em execução `coollabsio/sentinel:1.0.2` `sha256:9355fc746d5c…`, ligado de fábrica; no disco também a imagem `1.0.1` (havia duas versões apesar de `AUTOUPDATE=false`; o mecanismo da troca não foi medido) | `versoes-antes.txt`, `40-antes-da-faxina.txt` |
| Docker | Engine `29.8.2`, compose `5.6.0` | `10-coolify-versao.txt`, `versoes-antes.txt` (F4 Passo 2) |

## 2. Onde

VPS HostGator, ficha medida ANTES de qualquer instalação (`01-ficha-da-vps.txt`):
Ubuntu 22.04.5 LTS, kernel `6.8.0-138-generic`, x86_64, 4 vCPU AMD EPYC 9J45, virtualização
`kvm`, 7940 MiB de RAM (258 MiB usados pelo SO cru), **sem swap na linha de base**, disco
196 GB (4,8 GB usados), `cgroup2fs`, sem Docker, sem IPv6 global, sshd na porta 22022.

**A VPS era uma bancada COMPARTILHADA** com outras sessões de teste (contêineres
`deskcomm-test-db-*`, `typecheck`). Duas consequências, ambas medidas:

- toda janela de medição rodou dentro do `flock /root/.vps-teste.lock` das sessões, e em
  todas as amostras não havia contêiner de terceiro (`TOTAL-terceiros` nunca aparece);
- **um `/swapfile` de 4 GiB, persistente, foi criado por outra sessão às 13:46:10Z de 07/10**,
  antes da rodada 1. Durante a Fase F ~1,6 GiB estavam em uso, ~1611 MiB deles páginas dos
  nossos contêineres (`swap-e-oom.txt`). Os números de memória abaixo são RAM residente numa
  máquina COM swap (ver seção 4).

## 3. Como

### Instrumentos (transcritos; rodam na VPS como root)

`amostrar.sh` (uma linha por contêiner por amostra, mais a linha da máquina):

```bash
#!/usr/bin/env bash
# amostrar.sh <arquivo> <quantas> <intervalo_s>: uma linha por contêiner por amostra
# <instante UTC> \t <nome> \t <MEM USAGE / LIMIT> \t <CPU%>
set -eu
arq=$1; n=$2; iv=$3
: > "$arq"; : > "$arq.host"
for i in $(seq 1 "$n"); do
  t=$(date -u +%FT%TZ)
  docker stats --no-stream --format '{{.Name}}\t{{.MemUsage}}\t{{.CPUPerc}}' | sed "s/^/$t\t/" >> "$arq"
  # total da MÁQUINA no mesmo instante (inclui dockerd, containerd e docker-proxy, que o docker stats não vê)
  free -m | awk -v t="$t" '/^Mem:/{print t"\tused="$3"\tavailable="$7}' >> "$arq.host"
  [ "$i" = "$n" ] || sleep "$iv"
done
echo "amostras=$n linhas=$(wc -l < "$arq") host=$(wc -l < "$arq.host")"
```

`picos.sh` (`memory.peak` do cgroup, desde que o contêiner subiu):

```bash
#!/usr/bin/env bash
# picos.sh: memory.peak (desde que o contêiner subiu) de cada contêiner vivo, em MiB.
set -eu
for id in $(docker ps -q --no-trunc); do
  n=$(docker inspect -f '{{.Name}}' "$id")
  f=/sys/fs/cgroup/system.slice/docker-$id.scope/memory.peak
  [ -r "$f" ] || f=$(find /sys/fs/cgroup -path "*$id*" -name memory.peak 2>/dev/null | head -1)
  if [ -n "$f" ] && [ -r "$f" ]; then printf '%s\t%s MiB\n' "${n#/}" "$(( $(cat "$f") / 1048576 ))"
  else printf '%s\tindisponivel\n' "${n#/}"; fi
done | sort
```

`resumir.awk` (roda na máquina local, **sempre com `LC_ALL=C`**: em `pt_BR.UTF-8` o `awk`
lê `1.1GiB` como `1` e a vírgula decimal estraga a CPU — medido no controle da Fase A). Quatro
grupos: `coolify*`, `deskcommcrm-supabase-*`, `deskcommcrm-*` (CRM) e o resto (`terceiros`,
fora de todo total):

```awk
function mib(s,  v,u){ v=s; sub(/[A-Za-z]+$/,"",v); u=s; sub(/^[0-9.]+/,"",u)
  if(u=="GiB")return v*1024; if(u=="MiB")return v+0; if(u=="KiB")return v/1024; if(u=="B")return v/1048576; return -1 }
BEGIN{FS="\t"}
{ split($3,m," / "); mem=mib(m[1]); cpu=$4; sub(/%/,"",cpu)
  g=($2 ~ /^coolify/) ? "coolify" : (($2 ~ /^deskcommcrm-supabase-/) ? "supabase" : (($2 ~ /^deskcommcrm-/) ? "crm" : "terceiros"))
  c[$2]++; sm[$2]+=mem; if(mem>mx[$2])mx[$2]=mem; if(cpu+0>cx[$2])cx[$2]=cpu+0; sc[$2]+=cpu
  soma[$1 "|" g]+=mem; nomes[$2]=1 }
END{ for(n in nomes) printf "%s\tn=%d\tmem_med=%.0f MiB\tmem_max=%.0f MiB\tcpu_med=%.1f%%\tcpu_max=%.1f%%\n", n, c[n], sm[n]/c[n], mx[n], sc[n]/c[n], cx[n]
     for(k in soma){split(k,a,"|"); if(soma[k]>pk[a[2]])pk[a[2]]=soma[k]}
     for(g in pk) printf "TOTAL-%s\t%.0f MiB\t(maior soma num mesmo instante)\n", g, pk[g] }
```

Controle positivo do resumidor com dados de mentira: `28-f0-controle-resumidor.txt`.

`vazamento.sh` (a sonda de segredo de todo log de instalador, update e backup, e desta pasta):
conta, para cada segredo dos `.env` do CRM e do Supabase, do `admin-credentials` e das cópias
guardadas antes de cada remoção, quantas vezes o VALOR aparece no arquivo. Imprime só
`ARQUIVO:NOME=contagem`; o valor nunca vai a argumento de comando.

```bash
#!/usr/bin/env bash
set -u
log=$1; arv=${2:-/root/pr4/deskcommcrm}
conta() { grep -cFf <(printf '%s\n' "$1") "$log"; }
for arq in "$arv/.env" "$arv/.runtime/supabase/.env" "$arv/.runtime/admin-credentials" /root/deskcomm-guardado-*/env /root/deskcomm-guardado-*/env-supabase /root/deskcomm-guardado-*/admin-credentials; do
  [ -r "$arq" ] || continue
  case $arq in /root/deskcomm-guardado-*) r=${arq#/root/};; *) r=$(basename "$arq");; esac
  grep -E '^[A-Z0-9_]*(PASS|SECRET|KEY|TOKEN|DB_URL|ENC|JWKS?)[A-Z0-9_]*=' "$arq" | while IFS= read -r l; do
    k=${l%%=*}; v=${l#*=}; v=${v#\"}; v=${v%\"}; v=${v#\'}; v=${v%\'}
    [ "${#v}" -ge 12 ] || continue
    printf '%s:%s=%s\n' "$r" "$k" "$(conta "$v")"
    printf '%s\n' "$v" | grep -oE '"(d|k)":"[^"]{12,}"' | while IFS= read -r p; do
      c=${p:1:1}; x=${p#*\":\"}; x=${x%\"}
      printf '%s:%s.%s=%s\n' "$r" "$k" "$c" "$(conta "$x")"
    done
  done
done
printf 'padroes=%s\n' "$(grep -cE 'eyJ[A-Za-z0-9_-]{20,}|sb_secret_|sk-or-|sk-ant-|postgres(ql)?://[^ ]*:[^ @]+@' "$log")"
```

`gate.sh` (a bancada está livre? só lê):

```bash
#!/usr/bin/env bash
t=$(docker ps --format '{{.Names}}' | grep -vcE '^(coolify|deskcommcrm-)')
a=$(free -m | awk 'NR==2{print $7}')
l=$(flock -n /root/.vps-teste.lock true 2>/dev/null && echo livre || echo ocupado)
x=$(docker ps -a --format '{{.Names}} {{.Label "com.docker.compose.project.working_dir"}}' | awk '$1 ~ /^deskcommcrm-/ && $2 !~ /^\/root\/pr4\/deskcommcrm/' | wc -l)
echo "$(date -u +%FT%TZ) terceiros=$t available=$a lock=$l alheio=$x"
```

Leitura do gate: rodado DENTRO do `flock`, ele sempre diz `lock=ocupado` (o lock é o nosso);
por isso o `lock=` vale só para a linha de fora, e a de dentro vale para `terceiros` e RAM.

### As janelas (Fase F; linhas do gate em `29-f-janelas.txt`)

| Janela | Fora do lock, antes | Dentro do lock (início → fim) | Amostras |
|---|---|---|---|
| F1 repouso sem canal | 15:25:18Z `terceiros=1 available=5396` | 15:31:00Z `terceiros=0 available=5996` → 15:35:52Z `terceiros=0 available=5971` | 10 × 30 s |
| F2 repouso com canal | 15:37:59Z `terceiros=1 available=5826` | 15:45:07Z `terceiros=0 available=6216` → 15:49:58Z `terceiros=0 available=6117` | 10 × 30 s |
| F3 conversa | 15:50:31Z `terceiros=0 available=2372` | 16:05:51Z `terceiros=0 available=5713` → 16:12:30Z `terceiros=0 available=6094` | 48 × 5 s |

A F1 começou depois de 10 min sem toque. Na F2 a sessão do WhatsApp já estava em `FAILED`
(o QR expirou durante a fila do lock): o "repouso com canal" medido é com a sessão em `FAILED`,
não aguardando QR.

**Conversa da F3**, pelo caminho de produção (o webhook do WAHA do canal), sem número real e
com a IA desligada. Cinco POSTs, um a cada 30 s, com o token do canal lido do banco (aqui
`<token>`) e um remetente de DDD `00`, que não existe:

```bash
corpo=$(printf '{"event":"message","session":"medicao","payload":{"id":"medicao-%s-%s","from":"5500900000001@c.us","fromMe":false,"body":"Teste %s: quais horarios voces atendem?","timestamp":%s,"_data":{"notifyName":"Cliente Medicao"}}}' "$ts" "$i" "$i" "$ts")
curl -s -o /dev/null -w "msg $i -> %{http_code}\n" -H 'content-type: application/json' -d "$corpo" "https://${DOMINIO}/api/v1/webhooks/waha/<token>"
```

Durante a conversa, a linha `:drain` do crontab do HOST ficou fora (16:05:51Z–16:12:30Z),
para que a drenagem do `event_log` só pudesse vir do `scheduler`. Resultado
(`conversa-envios.txt`, `conversa-desfecho.txt`): `msg 1..5 -> 200`, `inbound 5`,
`llm_calls 0`, e desde o início da conversa `event_log` `done 12` (`message.received 5`,
`ai_agent.dispatch_requested 5`, `lead.created 1`, `conversation.routing_requested 1`),
nenhum `pending`: **o scheduler drenou** (prova pelo dado). Depois a fila foi limpa e o
contato bloqueado (`30-f3b-limpeza.txt`).

### As três réguas de memória

1. `MEM USAGE` do `docker stats` (sem cache inativo) — `*.tsv`, resumido em `resumo.txt`;
2. `memory.peak` do cgroup (com cache, desde a subida do contêiner) — `*-picos.txt`;
3. `used` do `free -m` da máquina inteira (inclui `dockerd`, `containerd`, `docker-proxy`)
   — `*.tsv.host`.

CPU% é por núcleo: 100% = um núcleo inteiro (a VPS tem 4).

## 4. O que foi medido, e o que não foi

**Medido:**

- **O instalador ATUAL falha atrás do Coolify** (C2, `17-c-como-esta.txt`): `exit=1` em 45 s
  (incluindo baixar as 11 imagens do Supabase, ~9,1 GB descompactadas), com
  `Bind for 0.0.0.0:8000 failed: port is already allocated` no gateway do Supabase — a 8000 é
  do painel do Coolify. E o `setup.sh` do Supabase imprimia na tela cada segredo gerado.
- **O conserto** (D1/D2/(a)): `API_GW_HTTP_PORT` validada e gravada, o terceiro arquivo de
  compose que põe o gateway na rede do proxy, a saída do `setup.sh` para arquivo 600. Testes
  de shell na VPS: vermelho antes, verde depois, sabotagem reprovando (`18-d-*.txt`); refeitos
  sobre o merge da `main` (`50-h1-testes-shell.txt`: 36 de 38 verdes; os 2 vermelhos falham
  IGUAL na árvore da `main`, na mesma prova — são da bancada, não do PR).
- **Rodada 1** (D4, kit `456c05259`, banco virgem): `exit=0` em 2 min 44 s com as imagens
  baixadas. A sonda achou 23 segredos no log do instalador (o `setup.sh` ainda imprimia;
  `20-r1-vazamento.txt`). A tentativa anterior (r1a) falhou por causa do INSTRUMENTO: o
  `umask 077` do runner era herdado e o Postgres não lia os init-scripts
  (`20-r1a-o-conserto-pegou.txt`, `20-r1a-supabase-logs-mascarado.txt`). Daí em diante,
  `umask 022` só antes do instalador.
- **Rodada 2** (G3, kit `44c5df541`, banco virgem, certificado já emitido): `exit=0` em
  1 min 23 s com as imagens em cache; a sonda achou só a senha do dono, onde ela deve estar
  (`24-r2-vazamento.txt`). O conserto da saída do `setup.sh` está provado numa instalação real.
- **Único desvio do comando do guia**, além do clone da branch: o `admin-credentials` foi
  pré-semeado em `.runtime/` (para a senha do dono nascer de um arquivo 600 local).
- Redes, rótulos, portas e `.env` gravados (`20-r1-env-redes-rotulos.txt`,
  `24-r2-env-redes-rotulos.txt`); certificado do Let's Encrypt no sslip.io, sem limite de taxa
  (`21-certificado.txt`; o crt.sh estava fora do ar, `21-crtsh-sslip.txt`).
- Conferências pela rede (`21c`, `21d`, `22`, `23-e5`, `24-e6`, `26`, `27`): 307 até o login,
  WAHA global fechado (403), rotas do Supabase pelo Envoy (401 sem `x-request-id`), cron do
  host pelo Traefik, crons do scheduler, o CRM falando com o banco por cinco caminhos,
  incluindo o retorno do app ao próprio domínio pelo IP público (hairpin, `app->supabase 200`).
- **O painel do banco é alcançável de qualquer contêiner da rede `coolify`**, protegido só pela
  senha do painel (`27-e8-portas.txt`, E8 Passo 2: `401`).
- Atrás do Coolify, "subiu com a lista errada de `-f`" e "CRM removido" respondem **503
  `no available server` no https** (e 404 no http), por causa do roteador `catchall` que o
  Coolify grava (`21b-coolify-503-catchall.txt`, `21b-404-lista-de-f.txt`, `47-g3-remocao.txt`).
- Sabotagem da rede do proxy (`44-g4-sabotagem-da-rede.txt`): sem a rede, a rota do banco
  trava (timeout ≥ 60 s, nunca 502/504) e o CRM inteiro cai junto; reconectar à mão pode não
  bastar. O mecanismo da queda de ~6–7 min da primeira rodada **não foi provado**.
- **Restart Proxy pela tela do Coolify** (G4): o proxy é recriado e a rota do banco sobrevive,
  sem comando nosso (`44-g4-single-server-atras-do-coolify.txt`).
- **Quem roda o instalador SEM as variáveis** (G5): falha em 13 s com o mesmo `Bind … 8000`;
  rodar o comando certo por cima, sem apagar nada, recupera tudo em 1 min 12 s
  (`43-g5-*`, `43-g5b-*`).
- Rede extra pendurada no proxy (G2): sem `TRAEFIK_NETWORK`, a descoberta escolheria a rede
  errada; com a variável, a exportada vence (`42-rede-errada.txt`, `24-r2-env-redes-rotulos.txt`).
- **`update.sh`**: no caminho do guia, recusa (`exit=3`, "versão ANTERIOR à instalada",
  `23-r1-update-recusa.txt`); com `--to v1.76.0 --force`, rebaixa o kit para a release com as
  MESMAS imagens e preserva porta e rede (`23-r1-update-forcado.txt`, `23-r1-depois-do-update-*`).
  G1 e G2 rodaram sobre esse estado (kit da branch por cima do schema da `v1.76.0`).
- Backup antes de cada remoção (`46-g3-backup.txt`, `48-g5-backup.txt`) e remoção completa
  (`47-g3-remocao.txt`, `49-g5-remocao.txt`).
- Memória, as três janelas (`resumo.txt`): repouso sem canal `coolify 203 / supabase 629 / crm
  364 MiB`, máquina `used_max 1531`; repouso com canal (FAILED) `225 / 532 / 379`, máquina 1360;
  conversa `368 / 569 / 446`, **máquina `used_max 1688 MiB`**. OOM do kernel nas janelas: 0;
  contêineres nossos com OOM ou reinício: 0. Disco: imagens 19,84 GB no Docker (todas, inclui
  Coolify e terceiros), banco + anexos 105 MiB.

**Correções de leitura** a arquivos desta pasta (o arquivo fica como foi gravado):

- `21b-*`: a observação do 503 foi repetida em t≈5/25/65/125 s (~2 min), não "4× em 60 s".
- `24-e6-scheduler.txt`: o `8` da linha 3 está errado; a soma por minuto da mesma página dá
  **63** `FALHOU` na Fase E, todos causados pelas sabotagens da própria fase (E2b e E7). O `0`
  vale para as janelas limpas `14:38–14:52Z` e `15:09:30–15:15:22Z`. As 6 de "14:57:30–15:00:30Z"
  são das 15:00:0x, já dentro da sabotagem.

**NÃO MEDIDO nesta versão:**

- **A memória sem swap.** Toda a Fase F rodou com o swap de 4 GiB de outra sessão ligado; a
  remedição sem swap e a decisão **8 GB × 16 GB** (as leituras A e B da regra dão 8 e 16 GB,
  `resumo.txt`, F4 Passo 3) ficaram pendentes. Máquina inteira sem swap e VPS de 4 GB: não medidas.
- WhatsApp com número real (F5): não medido. A IA ficou **desligada** (o single-server instala
  sem chave): a conversa mede ingestão, banco e scheduler pelo `event_log`, não o agente.
- Faxina do Coolify pela tela (G1 Passo 2): não medida, depende do ok da bancada compartilhada.
  `40-antes-da-faxina.txt` é a régua de uma instalação que depois foi removida.
- Reboot da VPS e fechamento persistente do painel do Coolify (8000/6001/6002), inclusive por
  IPv6 (G6): não executados nesta medição. Nesta VPS essas portas chegaram PÚBLICAS
  (`11-portas-antes-do-proxy.txt`); durante a medição ficaram fechadas por uma regra
  `DOCKER-USER` temporária (IPv4), que não sobrevive a reboot.
- Atualizar para uma versão MAIS NOVA pelo caminho do guia e atualizar pela tela: não medidos.
- Restaurar um backup: não medido. Levar o backup para fora da VPS: não medido.
- Os avisos "Attention required" do servidor e do item "Proxy" no painel do Coolify, e o selo
  "Update available": vistos, não investigados.
- Supabase Cloud com Coolify (o guia cita como alternativa) e Caddy puro: não medidos aqui.

## 5. O que NÃO está nesta pasta

Os logs completos dos instaladores (mesmo mascarados), a ficha crua da VPS (`00-*`: hostname,
MAC, chaves autorizadas), os scripts de janela e de SQL, e as capturas de tela. As capturas que
o guia usa estão em `docs/saas/`.

**Varredura de segredo desta pasta** (Fase H2, depois de trocar o IP): a sonda
`vazamento.sh` rodou NA VPS sobre a concatenação de todos os arquivos, contra os segredos da
instalação viva e das duas cópias guardadas: 136 contagens, todas `0` (controle positivo no
mesmo minuto: a senha do dono plantada num arquivo deu `1` nas 6 fontes). O 32-hex (o
`webhook_path_token`) deu `0`. A busca por padrão (`eyJ…`, `sk-…`, `postgres://`, `Bearer`,
`_KEY=`, `SECRET=`, `password`) acha só NOMES de segredo nas linhas de contagem da sonda
(`OWNER_PASSWORD=0`, `SUPABASE_SERVICE_ROLE_KEY=1`) e a palavra `password` em mensagens de erro;
nenhum valor. Ressalva: os segredos da C2 e da r1a não existem mais na VPS (as árvores foram
removidas), então os arquivos dessas duas tentativas foram conferidos só na hora da gravação,
quando a sonda deu `0` na cópia mascarada.
