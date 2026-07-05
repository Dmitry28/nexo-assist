# Deploy & DevOps — учебный гайд

Практический разбор деплоя nexo-assist с объяснением концепций (DevOps впервые).
На каждом шаге: **что** сделали, **зачем**, и **концепт простыми словами** + ссылки.
Высокоуровневый план — в [PRODUCT_PLAN.md §Фаза 5](PRODUCT_PLAN.md); здесь — «почему так».

## Куда деплоим (решено)

- **Приложение:** наш Docker-образ → **k3s** (лёгкий Kubernetes) на бесплатной VM
  **Oracle Cloud Always Free**. Настоящий k8s → максимум DevOps-опыта.
- **База:** **Neon** — managed Postgres (free tier). Бэкапы/аптайм — на их стороне.
- **Портируемо:** апп = образ, БД = строка `DATABASE_URL`. Переезд (напр. на Hetzner
  ~€4.5/мес) — смена таргета, не переписывание.

## Как код попадает в прод (общая картина)

```
код → docker build → образ → push в registry (GHCR) → k8s тянет образ → запускает Pod
                                                         ↑
                                     манифесты (Kustomize) описывают ЧТО запускать
```

1. **Собираем образ** (Dockerfile) — самодостаточный «архив» приложения.
2. **Кладём в registry** (GitHub Container Registry) — склад образов, откуда кластер качает.
3. **Кластер применяет манифесты** (`kubectl apply -k k8s/`) — декларативно: ты
   описываешь _желаемое состояние_, k8s его достигает и поддерживает.

## Концепции простыми словами

- **Container / образ (image):** упакованное приложение + его зависимости. Образ —
  «слепок» (read-only), контейнер — запущенный экземпляр. У нас образ строит
  многостадийный [`Dockerfile`](../Dockerfile) (build → prune dev-deps → тонкий runtime).
- **Kubernetes (k8s):** система, которая запускает контейнеры, перезапускает упавшие,
  следит за здоровьем, обновляет без простоя. **k3s** — его лёгкая версия для одной
  небольшой VM.
- **Pod** — минимальная единица запуска: один (или несколько) контейнеров вместе. Наш
  Pod = бот (+ initContainer миграций, см. ниже).
- **Deployment** — «хочу N одинаковых Pod'ов такой-то версии». Держит их живыми,
  катит обновления. У нас `replicas: 1` (бот на long-polling — singleton: один поллер
  на токен, иначе Telegram шлёт 409).
- **Service** — стабильный внутренний адрес к Pod'ам (они эфемерны, IP меняются).
- **ConfigMap vs Secret** — конфиг через env-переменные. Несекретное (порты, cron) →
  **ConfigMap**; секреты (токен бота, пароль БД в `DATABASE_URL`) → **Secret**
  (не коммитим в репо!).
- **initContainer** — контейнер, который отрабатывает **до** основного и должен
  успешно завершиться. Идеален для миграций БД: применили схему → только потом
  стартует апп.
- **Probes (пробы):** k8s спрашивает приложение о здоровье. _liveness_ — «живой?»
  (нет → перезапуск); _readiness_ — «готов принимать трафик?» (нет → убирают из
  Service); _startup_ — даёт время на медленный старт.
- **Kustomize** — накладывает манифесты без шаблонов (в отличие от Helm). `kubectl -k`
  умеет это из коробки. Наш [`k8s/kustomization.yaml`](../k8s/kustomization.yaml)
  собирает configmap + deployment + service.
- **Registry (GHCR)** — хранилище образов. CD пушит туда `nexo-assist:<sha>` и
  прописывает этот тег в деплой.

## Наши файлы

| Файл                                                  | Что описывает                                                           |
| ----------------------------------------------------- | ----------------------------------------------------------------------- |
| [`Dockerfile`](../Dockerfile)                         | как собрать образ (multi-stage, non-root, healthcheck)                  |
| [`k8s/deployment.yaml`](../k8s/deployment.yaml)       | Pod: initContainer миграций + контейнер бота, пробы, лимиты, hardening  |
| [`k8s/configmap.yaml`](../k8s/configmap.yaml)         | несекретные env                                                         |
| [`k8s/service.yaml`](../k8s/service.yaml)             | внутренний адрес                                                        |
| [`k8s/kustomization.yaml`](../k8s/kustomization.yaml) | что собрать вместе                                                      |
| Secret `nexo-assist-secrets`                          | `TELEGRAM_BOT_TOKEN` + `DATABASE_URL` (создаётся в кластере, не в репо) |

## Шаги (лог с пояснениями)

### Шаг 1 — миграции, работающие и локально, и в контейнере

**Проблема:** миграции запускались только через `ts-node` по исходникам `src/`. В
рантайм-образе нет ни `ts-node`, ни `src/` (только компилированный `dist/`) → в проде
не прогнались бы.

**Решение:** один `data-source.ts`, который сам определяет по расширению своего файла,
где он запущен — `.ts` (локально, ts-node, `src/`) или `.js` (в контейнере, node,
`dist/`). Убрали dev-зависимость `dotenv` из него (в проде env приходит из окружения
пода). Добавили prod-скрипт `migration:run:prod` (чистый `node`, без ts-node).

**Концепт — почему миграции отдельно от кода:** схема БД версионируется миграциями
(каждая — один необратимый шаг), а `synchronize` в проде запрещён (он молча меняет
схему). Так изменения БД предсказуемы и повторяемы.

### Шаг 2 — миграции при деплое (initContainer) + секреты

**Что:** в Deployment добавлен initContainer `migrate` — тот же образ, прогоняет
миграции (той же командой, что `migration:run:prod`) до старта бота. Упал → Pod не поднимется (не работаем на битой
схеме). `DATABASE_URL` кладётся в Secret (в нём пароль Neon), а не в ConfigMap.

**Концепт — почему initContainer, а не «внутри приложения»:** миграции отделены от
рантайма — приложение не должно менять схему при каждом старте (гонки при нескольких
репликах, права). initContainer прогоняет их один раз, атомарно, до апп-контейнера.
Идемпотентно: TypeORM хранит применённые миграции в таблице и пропускает их повторно.

**Концепт — ConfigMap vs Secret:** `DATABASE_URL` содержит пароль → это секрет.
Secret в кластере не коммитится; для GitOps используют sealed-secrets / external-secrets
оператор или секрет-менеджер платформы.

### Шаг 3 — верификация TLS-сертификата к базе

**Что:** для prod/staging подключение к Neon теперь идёт с `ssl: { rejectUnauthorized: true }`
(`app.module.ts`) — проверяем сертификат сервера. Локально (dev/test) SSL выключен —
Docker-Postgres без TLS.

**Концепт — шифрование ≠ аутентификация.** `rejectUnauthorized: false` шифрует канал,
но не проверяет, _с кем_ говорим — злоумышленник между нами и БД может подставить свой
сертификат (MITM) и читать/подменять трафик (пароли, данные). `rejectUnauthorized: true`
проверяет, что серт выдан доверенным CA и валиден для этого хоста. Свой CA не нужен:
серт Neon подписан публичным корнем, который есть в стандартном наборе Node.

### Шаг 5a — CI: сборка и публикация образа в GHCR

**Что:** в `.github/workflows/ci.yml` джоба `docker-and-k8s` теперь собирает образ и
пушит его в **GHCR** (`ghcr.io/<owner>/nexo-assist`). На PR — только сборка (проверка
Dockerfile), на push в `dev`/`main` — сборка + пуш. Теги: `sha-<commit>` (неизменяемый),
имя ветки, `latest` (на `main`). Аутентификация — встроенным `GITHUB_TOKEN` (право
`packages: write`), отдельный секрет не нужен. Образ **мультиарх** (`amd64` + `arm64`),
т.к. VM на Oracle — ARM (Ampere); `amd64` оставлен для локальной разработки.

**Концепт — зачем registry и почему деплоим по sha.** Кластер не собирает код — он
тянет готовый образ из registry (GHCR). Тег `latest` удобен, но «плавающий» (сегодня
один образ, завтра другой) → для деплоя пинуем **неизменяемый** `sha-<commit>`: точно
знаешь, что запущено, и откат = просто прежний sha. gha-кэш ускоряет пересборку.

## Шаг 4 — Runbook: поднять кластер и задеплоить (делаешь ты, позже)

Пошагово, с командами. Пока — **только prod** (один namespace). Бот на long-polling
ходит наружу сам, поэтому **входящие порты для бота не нужны** (ни ingress, ни домен).

### 4.1 Oracle Cloud — бесплатная VM

1. Заведи аккаунт (нужна карта для верификации, списаний нет на Always Free).
2. Compute → Instances → Create: shape **VM.Standard.A1.Flex** (ARM Ampere, Always
   Free), напр. 2 OCPU / 12 GB, образ **Ubuntu 24.04**. Добавь свой SSH-ключ.
   - _Каприз:_ ARM часто «Out of capacity» — повтори через время / смени AD/регион.
3. Запиши публичный IP. В Security List оставь открытым только **22 (SSH)** — API
   кластера наружу не открываем (ходим через SSH-туннель, см. 4.4).

### 4.2 Neon — prod-база

Создай проект → возьми **pooled** `DATABASE_URL` (вида
`postgres://user:pass@ep-xxx-pooler.neon.tech/db?sslmode=require`). SSL уже включён.

### 4.3 BotFather — prod-токен

`/newbot` → сохрани `TELEGRAM_BOT_TOKEN` (для dev позже заведёшь **отдельного** бота).

### 4.4 Установить k3s и забрать доступ

```bash
ssh ubuntu@<VM_IP>
# Лёгкий однонодовый k8s. Отключаем traefik/servicelb — входящий трафик не нужен.
curl -sfL https://get.k3s.io | INSTALL_K3S_EXEC="--disable traefik --disable servicelb" sh -
sudo cat /etc/rancher/k3s/k3s.yaml   # это kubeconfig; server = https://127.0.0.1:6443
```

Скопируй содержимое в локальный `~/.kube/config`. Оставь `server: https://127.0.0.1:6443`
и работай **через SSH-туннель** (безопасно, не открываем API наружу):

```bash
ssh -L 6443:127.0.0.1:6443 ubuntu@<VM_IP>   # держи открытым в отдельном терминале
kubectl get nodes                            # проверка: нода Ready
```

### 4.5 Образ из GHCR

CI уже пушит `ghcr.io/dmitry28/nexo-assist:sha-<...>` (шаг 5a). По умолчанию пакет
**приватный** → сделай его **public** (GitHub → Packages → package → Settings →
Change visibility). Тогда кластеру не нужен pull-секрет. _(Приватный вариант —
`kubectl create secret docker-registry ...` с PAT `read:packages` + `imagePullSecrets`.)_

### 4.6 Секреты и деплой

```bash
kubectl create secret generic nexo-assist-secrets \
  --from-literal=TELEGRAM_BOT_TOKEN='<prod-token>' \
  --from-literal=DATABASE_URL='<neon-url>'

# Запинить свежий образ по sha (тег из GitHub → Packages или из CI-лога):
# в k8s/kustomization.yaml добавь блок images (см. ниже), затем:
kubectl apply -k k8s/
```

`images` в `k8s/kustomization.yaml` (пинним оба контейнера — app и initContainer):

```yaml
images:
  - name: nexo-assist
    newName: ghcr.io/dmitry28/nexo-assist
    newTag: sha-<commit>
```

### 4.7 Проверка

```bash
kubectl get pods -w                       # initContainer 'migrate' → Completed, app → Running
kubectl logs deploy/nexo-assist -c migrate   # миграции применились
kubectl logs deploy/nexo-assist -f           # "Bot @... started"
kubectl port-forward deploy/nexo-assist 3000:3000   # затем curl /api/v1/health/ready
```

Напиши боту в Telegram — должен ответить.

### 4.8 Если что-то не так

- **ImagePullBackOff** — пакет приватный → сделай public (4.5) или заведи pull-секрет.
- **Init:CrashLoopBackOff** (migrate) — проверь `DATABASE_URL` в секрете и логи
  initContainer'а; частая причина — неверный URL/SSL.
- **CrashLoopBackOff** (app) — `kubectl logs`; обычно нет `TELEGRAM_BOT_TOKEN` или
  конфликт `409` (второй поллер на том же токене — не запускай бота ещё где-то).
- **Oracle "Out of capacity"** — повторяй создание VM / другой регион.
- **`exec format error`** в логах пода — несовпадение архитектуры образа и ноды.
  У нас образ мультиарх (amd64+arm64), так что не должно возникать; если возникло —
  проверь, что CI собрал `arm64` (шаг 5a) и тег образа свежий.

## Полезные команды

```bash
# Отрендерить итоговые манифесты (что реально уедет в кластер):
kubectl kustomize k8s/

# Проверить манифесты без применения (клиентская валидация):
kubectl apply --dry-run=client -k k8s/

# Создать секрет (пример — реальные значения не коммитить):
kubectl create secret generic nexo-assist-secrets \
  --from-literal=TELEGRAM_BOT_TOKEN='...' --from-literal=DATABASE_URL='...'
```

## Ссылки

- Kubernetes concepts: https://kubernetes.io/docs/concepts/
- initContainers: https://kubernetes.io/docs/concepts/workloads/pods/init-containers/
- ConfigMaps & Secrets: https://kubernetes.io/docs/concepts/configuration/
- Probes: https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/
- Kustomize: https://kubectl.docs.kubernetes.io/guides/introduction/kustomize/
- k3s: https://docs.k3s.io/
- Neon: https://neon.tech/docs/introduction

_Дальше гайд растёт: шаг 5b (CD: авто-деплой в кластер вместо ручного `apply`),
шаг 6 (observability/алертинг), позже — dev-окружение (overlays)._
